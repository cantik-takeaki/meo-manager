// api/admin.js — 店舗登録・順位入力（統合）
import { kvGet, kvSet, kvDel, kvIncrBy } from './_kv.js';
import { getMasterInfo, getMasterToken, getAccessToken } from './_tokens.js';

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function generatePassword() {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({length: 8}, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

// 店名の照合用正規化（fetch-rank/cron-rank共通）
const _normName = (s) => String(s || '').replace(/\s|　|・|（.*?）|\(.*?\)/g, '').toLowerCase();

// ── 改ざん検知の照合（cron-tamper用・store-settings.jsと同一ロジック） ──
const _normG = (s) => String(s || '').replace(/[\s　・\-―ー（）()]/g, '').toLowerCase();
const _normP = (s) => String(s || '').replace(/[^0-9]/g, '');
const _normU = (s) => String(s || '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
const _loose = (a, b) => { a = _normG(a); b = _normG(b); return !a || !b || a === b || a.includes(b) || b.includes(a); };
// 営業時間の時刻トークン抽出（store-settings.jsと同一の緩判定）
const _hoursTok = (s) => {
  const z = String(s || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':');
  return [...z.matchAll(/(\d{1,2}):(\d{2})/g)].map(m => `${parseInt(m[1], 10)}:${m[2]}`);
};
const _fmtGbpT = (t) => typeof t === 'string' ? (t.length === 4 ? `${parseInt(t.slice(0, 2), 10)}:${t.slice(2)}` : t) : (t && t.hours != null ? `${t.hours}:${String(t.minutes || 0).padStart(2, '0')}` : '');
async function fetchCurrentGbpInfo(locationName, token) {
  const locPart = String(locationName).match(/locations\/[^/]+/)?.[0];
  if (!locPart) return { error: 'no_location' };
  const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${locPart}?readMask=title,phoneNumbers,storefrontAddress,categories,websiteUri,regularHours`, { headers: { Authorization: `Bearer ${token}` } });
  const d = await r.json();
  if (d.error) return { error: d.error.status || d.error.message || 'api_error' };
  const addr = d.storefrontAddress ? [...(d.storefrontAddress.addressLines || []), d.storefrontAddress.locality, d.storefrontAddress.administrativeArea, d.storefrontAddress.postalCode].filter(Boolean).join(' ') : '';
  const hoursStr = (d.regularHours?.periods || []).map(p => `${p.openDay || ''} ${_fmtGbpT(p.openTime)}-${_fmtGbpT(p.closeTime)}`).join(' ');
  return { current: { title: d.title || '', phone: d.phoneNumbers?.primaryPhone || '', address: addr, category: d.categories?.primaryCategory?.displayName || '', url: d.websiteUri || '', hours: hoursStr } };
}
function diffGbpBaseline(saved, current) {
  const diffs = [];
  const chk = (f, label, eq) => { const s = saved[f], c = current[f]; if (s && c && !eq(s, c)) diffs.push({ field: label, saved: s, current: c }); };
  chk('title', '店舗名', _loose);
  chk('phone', '電話番号', (a, b) => _normP(a) === _normP(b) || !_normP(a) || !_normP(b));
  chk('address', '住所', _loose);
  chk('category', 'カテゴリ', _loose);
  chk('url', '公式URL', (a, b) => _normU(a) === _normU(b));
  // 営業時間（緩判定）：保存値の時刻(H:MM)がGBP側に全て含まれるかだけを見る
  if (saved.hours && current.hours) {
    const st = _hoursTok(saved.hours);
    if (st.length && st.some(t => !_hoursTok(current.hours).includes(t))) {
      diffs.push({ field: '営業時間', saved: saved.hours, current: current.hours, note: '表記ゆれの可能性あり（時刻ベースの緩判定）' });
    }
  }
  return diffs;
}

// ── 順位取得プロバイダ（既定=SerpApi無料枠 / env RANK_PROVIDER=dataforseo で有料の高精度に差替え） ──
// 戻り値: { list:[{title,position,rating,reviews,place_id}], error } — 呼び出し側はlistを店名照合して順位を出す。
// ll = 店舗の実座標（"lat,lng"）。SerpApiのgoogle_localは地点文字列(location)、DataForSEOは座標で計測でき精度が高い。
async function fetchLocalResults(keyword, { location, ll } = {}) {
  const provider = (process.env.RANK_PROVIDER || 'serpapi').toLowerCase();
  if (provider === 'dataforseo' && (process.env.DATAFORSEO_B64 || (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD))) {
    // DataForSEO（有料・座標指定で高精度）。envに認証情報がある時のみ通る＝未設定なら絶対に走らない。
    // 認証は DATAFORSEO_B64（login:password のBase64・取り違え防止）優先。無ければ LOGIN/PASSWORD から生成。前後空白は除去。
    try {
      const auth = (process.env.DATAFORSEO_B64 || '').trim()
        || Buffer.from(`${(process.env.DATAFORSEO_LOGIN || '').trim()}:${(process.env.DATAFORSEO_PASSWORD || '').trim()}`).toString('base64');
      const task = { language_code: 'ja', keyword, device: 'mobile', os: 'android' };
      if (ll) task.location_coordinate = ll.replace(/@|z$/g, ''); // "lat,lng,zoom"可 → DataForSEOは "lat,lng,zoom"
      else task.location_name = location || 'Japan';
      const r = await fetch('https://api.dataforseo.com/v3/serp/google/maps/live/advanced', {
        method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([task]),
      });
      const d = await r.json();
      const t0 = d?.tasks?.[0];
      const items = t0?.result?.[0]?.items || [];
      const list = items.filter(x => x.type === 'maps_search').map((x, i) => ({
        title: x.title, position: x.rank_absolute || (i + 1), rating: x.rating?.value || null, reviews: x.rating?.votes_count || null, place_id: x.place_id || '',
      }));
      const _dbg = { http: r.status, sc: d?.status_code, sm: d?.status_message, tsc: t0?.status_code, tsm: t0?.status_message, cost: d?.cost, resCount: (t0?.result || []).length, itemsCount: items.length, itemTypes: [...new Set(items.map(x => x.type))].slice(0, 6), sent: ll ? ('coord:' + ll.replace(/@|z$/g, '')) : ('name:' + (location || 'Japan')) };
      // 認証(401/40100)やタスクエラーを"成功0件"と誤認しない。無課金(cost0)のエラーは calls:0（使用数を増やさない）。
      if (!list.length) {
        const httpBad = r.status >= 400, topBad = (d?.status_code || 0) >= 40000, taskBad = (t0?.status_code || 0) >= 40000;
        if (httpBad || topBad || taskBad) {
          const msg = t0?.status_message || d?.status_message || ('HTTP ' + r.status);
          return { error: msg, calls: (d?.cost || 0) > 0 ? 1 : 0, _dbg };
        }
      }
      return { list, calls: 1, _dbg };
    } catch (e) { return { error: e.message, calls: 1, _dbg: { ex: e.message } }; }
  }
  // 既定: SerpApi（無料枠）。
  //  ・ll(座標)あり → google_maps エンジンで"その正確な地点"から計測（店舗の実所在地・新宿駅など任意地点に対応）
  //  ・ll なし     → google_local で地点文字列(市区の中心)から計測
  // calls = 実際に投げたSerpApiリクエスト数（再試行で2回になり得る）。呼び出し側はこの数で枠を加算し過少計上を防ぐ。
  const SERPAPI_KEY = process.env.SERPAPI_KEY;
  if (!SERPAPI_KEY) return { error: 'SERPAPI_KEY未設定', calls: 0 };
  let calls = 0;
  const parseList = (data) => (data.local_results || []).map((item, i) => ({
    position: item.position || (i + 1), title: item.title, rating: item.rating || null, reviews: item.reviews || null, place_id: item.place_id || '',
  }));
  // 座標指定（google_maps）: "lat,lng[,zoom]" → SerpApi形式 "@lat,lng,zoomz"
  const callMaps = async (coord) => {
    calls++;
    const p = String(coord).replace(/^@/, '').split(',');
    const zoom = String(p[2] || '14').replace(/z$/i, '').trim() || '14';
    const llParam = `@${String(p[0]).trim()},${String(p[1]).trim()},${zoom}z`;
    const params = new URLSearchParams({ engine: 'google_maps', type: 'search', q: keyword, ll: llParam, hl: 'ja', gl: 'jp', api_key: SERPAPI_KEY });
    const r = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    return r.json();
  };
  // 地点文字列（google_local）
  const callLocal = async (loc) => {
    calls++;
    const params = new URLSearchParams({ engine: 'google_local', q: keyword, hl: 'ja', gl: 'jp', api_key: SERPAPI_KEY });
    if (loc) params.set('location', loc);
    const r = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
    return r.json();
  };
  let data;
  if (ll && /,/.test(String(ll))) {
    data = await callMaps(ll);
    if (data.error && location) data = await callLocal(location); // 座標で取れなければ地点文字列にフォールバック
  } else {
    data = await callLocal(location);
    if (data.error && /location/i.test(data.error) && location) data = await callLocal(''); // 不正地点はKWの地域語頼みで再試行
  }
  if (data.error) return { error: data.error, calls };
  return { list: parseList(data), calls };
}

// 地名→座標（無料・OpenStreetMap Nominatim）。KVキャッシュで再取得を抑制。Nominatim規約に従いUAを明示。
async function geocodeQuery(q) {
  const query = String(q || '').trim();
  if (!query) return null;
  // 既に "lat,lng" 形式ならそのまま座標として扱う（地図クリック等で座標直指定された場合）
  const m = query.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(\d{2,3}\.\d+)\s*$/);
  if (m) return { lat: Number(m[1]), lng: Number(m[2]), label: query };
  const cacheKey = `geocode_${query}`;
  const cached = await kvGet(cacheKey);
  if (cached) return cached;
  try {
    const params = new URLSearchParams({ q: query, format: 'json', limit: '1', countrycodes: 'jp', 'accept-language': 'ja' });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
      headers: { 'User-Agent': 'rakuraku-meo/1.0 (https://meo.cantik.co.jp; cantik.co.jp)' },
    });
    const d = await r.json();
    if (!Array.isArray(d) || !d.length) return null;
    const out = { lat: Number(d[0].lat), lng: Number(d[0].lon), label: d[0].display_name || query };
    if (Number.isFinite(out.lat) && Number.isFinite(out.lng)) { await kvSet(cacheKey, out); return out; }
    return null;
  } catch (e) { return null; }
}
// 地名→複数候補（無料・Nominatim）。ユーザーが正しい地点を選べるよう候補配列を返す＝「必ず検索できる」を担保。
async function geocodeCandidates(q, limit = 5) {
  const query = String(q || '').trim();
  if (!query) return [];
  const m = query.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(\d{2,3}\.\d+)\s*$/);
  if (m) return [{ lat: Number(m[1]), lng: Number(m[2]), label: `座標 ${m[1]}, ${m[2]}` }];
  try {
    const params = new URLSearchParams({ q: query, format: 'json', limit: String(limit), countrycodes: 'jp', 'accept-language': 'ja' });
    const r = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, { headers: { 'User-Agent': 'rakuraku-meo/1.0 (https://meo.cantik.co.jp; cantik.co.jp)' } });
    const d = await r.json();
    if (!Array.isArray(d)) return [];
    return d.map(x => ({ lat: Number(x.lat), lng: Number(x.lon), label: x.display_name || query })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));
  } catch (e) { return []; }
}

// SERP結果から登録済み競合の順位を照合してcomp_historyへ記録（fetch-rank/cron-rank共通・追加APIコストなし）
async function recordCompRanks(storeId, keyword, selfRank, list) {
  try {
    const registered = (await kvGet(`competitors_${storeId}`) || []).filter(c => c.compare !== false);
    if (!registered.length) return null;
    const comps = registered.map(c => {
      let cRank = null, cMatched = null, cRating = null, cReviews = null;
      const cnPlace = String(c.placeId || '').trim();
      const cn = _normName(c.name);
      list.forEach((item, i) => {
        if (cRank) return;
        if (cnPlace && item.place_id && item.place_id === cnPlace) { cRank = item.position || (i + 1); cMatched = item.title; cRating = item.rating; cReviews = item.reviews; return; }
        const t = _normName(item.title);
        if (cn && t && (t.includes(cn) || cn.includes(t))) { cRank = item.position || (i + 1); cMatched = item.title; cRating = item.rating; cReviews = item.reviews; }
      });
      return { id: c.id, name: c.name, rank: cRank, matched: cMatched, rating: cRating, reviews: cReviews };
    });
    const histKey = `comp_history_${storeId}`;
    const hist = await kvGet(histKey) || [];
    const date = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // JST日付
    // 順位に加え、同じSERPから取れる評価・口コミ数も記録（追加APIコストなし）
    const entry = { date, keyword, self: selfRank, comps: comps.map(c => ({ id: c.id, rank: c.rank, rating: c.rating, reviews: c.reviews })) };
    const dup = hist.findIndex(h => h.date === date && h.keyword === keyword);
    if (dup >= 0) hist[dup] = entry; else hist.push(entry);
    while (hist.length > 800) hist.shift();
    await kvSet(histKey, hist);
    return comps;
  } catch (e) { return null; } // 競合記録の失敗で本体を落とさない
}

// メール送信（Resend・無料枠）。RESEND_API_KEY未設定なら false（＝送信スキップ・KV保存は継続）。
async function sendMail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) return false;
  const from = process.env.RESEND_FROM || 'ラクラクMEO <onboarding@resend.dev>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return r.ok;
  } catch (e) { return false; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;
  const KPI_ZERO = { scan: 0, rate: 0, survey: 0, ai: 0, click: 0, line: 0, lowfb: 0, rateSum: 0, rateCount: 0 };

  // 既定のアンケート設定（店舗未設定時のフォールバック）
  const DEFAULT_SURVEY = {
    title: '本日はありがとうございました',
    intro: 'よろしければ、ご感想をお聞かせください。30秒で終わります。',
    ratingQuestion: '本日の満足度はいかがでしたか？',
    lowHeading: 'もう少し詳しくお聞かせください',
    feedbackEmail: '',
    completionMsg: '貴重なご意見をいただき、ありがとうございました。',
    lowMsg: '貴重なご意見をありがとうございます。いただいたお声は改善に活かします。差し支えなければ、もう少し詳しくお聞かせください。',
    goodPoints: ['スタッフが丁寧', '雰囲気が良い', 'また来たい', '説明が分かりやすい', '清潔感がある', '対応が早い', 'コスパが良い', 'おすすめしたい'],
    lowThreshold: 4,   // この評価未満は「店内フィードバック」へ分岐（4 = ★1〜3が分岐）
    gateMode: 'branch', // 'branch'=満足度で分岐 / 'all'=全員Google誘導（コンプライアンス安全）
    qrEnabled: true,   // 口コミ受付ON/OFF（OFFで顧客ページが停止表示）
    qrToken: '',       // QR再発行トークン（空=未再発行。再発行するとURLの t= と一致しない旧QRを無効化）
    googleUrl: '',
    lineUrl: '',
  };

  // ── 口コミ獲得KPI 計測（公開・認証不要） ──
  // review.html（お客さん向けQRページ）から段階ごとにカウント。store単位のカウンタのみ。
  if (action === 'kpi-track' && req.method === 'POST') {
    const { storeId, event, value } = req.body || {};
    const valid = ['scan', 'rate', 'survey', 'ai', 'click', 'line', 'lowfb'];
    if (!storeId || !valid.includes(event)) return res.status(400).json({ error: 'storeId・event必須' });
    const ym = new Date().toISOString().slice(0, 7);
    const key = `kpi_${storeId}_${ym}`;
    const cur = { ...KPI_ZERO, ...(await kvGet(key) || {}) };
    cur[event] = (cur[event] || 0) + 1;
    // rate（満足度）は平均算出のため合計と件数も貯める
    if (event === 'rate') {
      const v = parseInt(value, 10);
      if (v >= 1 && v <= 5) { cur.rateSum = (cur.rateSum || 0) + v; cur.rateCount = (cur.rateCount || 0) + 1; }
    }
    await kvSet(key, cur);
    return res.json({ success: true });
  }

  // ── アンケート設定 取得（公開・review.htmlがお客さんのブラウザから読む） ──
  if (action === 'survey-public' && req.method === 'GET') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const s = await kvGet(`survey_${storeId}`);
    const merged = { ...DEFAULT_SURVEY, ...(s || {}) };
    // Google口コミURLが未設定なら、GBP連携済みの管理店に限りGoogle API(metadata.newReviewUri)から自動解決して永続化。
    // 未設定のまま「Googleの口コミ投稿を開く」を押すと writereview?placeid= 空でGoogleのエラーページに飛ぶ実害があった(2026-07-16)。
    if (!merged.googleUrl) {
      try {
        const managed = (await kvGet('managed_locations')) || [];
        const hit = managed.find(m => String(m.locId || '').replace(/\//g, '_') === storeId);
        if (hit) {
          const token = await getMasterToken();
          if (token) {
            const locPath = String(hit.locId || '').split('/').slice(-2).join('/'); // "locations/NNN"
            const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${locPath}?readMask=metadata`,
              { headers: { Authorization: `Bearer ${token}` } });
            const d = await r.json().catch(() => ({}));
            const auto = d?.metadata?.newReviewUri
              || (d?.metadata?.placeId ? `https://search.google.com/local/writereview?placeid=${d.metadata.placeId}` : '');
            if (auto) {
              merged.googleUrl = auto;
              await kvSet(`survey_${storeId}`, { ...(s || {}), googleUrl: auto }); // 次回からAPIを叩かずKVで即返す
            }
          }
        }
      } catch (e) { /* 自動解決の失敗は無視（従来挙動のまま返す） */ }
    }
    return res.json(merged);
  }

  // ── リード取得（公開・アンケート完了画面のメール/LINE登録を受け取る） ──
  // 再来店販促リスト用。お客さんのブラウザから叩くため認証不要。
  if (action === 'lead-submit' && req.method === 'POST') {
    const { storeId, email, name, rating } = req.body || {};
    if (!storeId || !email) return res.status(400).json({ error: 'storeId・email必須' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) return res.status(400).json({ error: 'メール形式が不正です' });
    const key = `leads_${storeId}`;
    const list = await kvGet(key) || [];
    // 同じメールは重複登録しない（最新で上書き）
    const existing = list.findIndex(l => l.email === String(email).toLowerCase());
    const item = {
      id: 'ld' + Date.now().toString(36),
      email: String(email).toLowerCase().slice(0, 120),
      name: String(name || '').slice(0, 60),
      rating: parseInt(rating, 10) || null,
      at: new Date().toISOString(),
    };
    if (existing >= 0) list[existing] = { ...list[existing], ...item, id: list[existing].id };
    else list.unshift(item);
    if (list.length > 2000) list.length = 2000;
    await kvSet(key, list);
    return res.json({ success: true });
  }

  // ── 低評価の店内フィードバック 受け取り（公開・Googleには出さず店舗だけが見る） ──
  if (action === 'feedback-submit' && req.method === 'POST') {
    const { storeId, rating, text, contact } = req.body || {};
    if (!storeId || !text) return res.status(400).json({ error: 'storeId・text必須' });
    const key = `feedback_${storeId}`;
    const list = await kvGet(key) || [];
    const item = {
      id: 'f' + Date.now().toString(36),
      rating: parseInt(rating, 10) || null,
      text: String(text).slice(0, 1000),
      contact: String(contact || '').slice(0, 200),
      at: new Date().toISOString(),
    };
    list.unshift(item);
    if (list.length > 300) list.length = 300;
    await kvSet(key, list);
    // 通知先メールが設定されていれば会社宛に送信（未設定/送信不可でもKV保存は完了しているのでエラーにしない）
    let emailed = false;
    try {
      const survey = await kvGet(`survey_${storeId}`) || {};
      const to = String(survey.feedbackEmail || '').trim();
      if (to) {
        const esc = (s) => String(s || '').replace(/</g, '&lt;');
        emailed = await sendMail(to, `【要対応】低評価フィードバックが届きました（★${item.rating || '-'}）`,
          `<div style="font-family:sans-serif;line-height:1.8"><p>お客様から店内フィードバック（Google非公開）が届きました。</p>
<p><b>評価：</b>★${item.rating || '-'}</p>
<p><b>内容：</b><br>${esc(item.text).replace(/\n/g, '<br>')}</p>
<p><b>連絡先：</b>${esc(item.contact) || '（記入なし）'}</p>
<p style="color:#666;font-size:12px">受信日時：${item.at}</p></div>`);
      }
    } catch (e) { /* メール失敗はKV保存に影響させない */ }
    return res.json({ success: true, emailed });
  }

  // 管理者ログイン確認：Google連携(access_token) または メール＋パスワード(pw_session) のどちらか。
  // ★重要: Vercel Cron は管理者Cookieを持たず CRON_SECRET のBearerのみで来る。
  //   cron系アクションは、この共通ゲートより前で「CRON_SECRET一致なら通す」＝ゲートを免除する。
  //   （従来はゲートで401になり cron-rank/cron-tamper 本体に到達できず、cronが一度も発火していなかった）
  const _c = parseCookies(req);
  const access_token = _c.access_token;
  const _isCronAction = (action === 'cron-rank' || action === 'cron-tamper');
  const _cronAuthOk = !!process.env.CRON_SECRET && (req.headers.authorization || '') === `Bearer ${process.env.CRON_SECRET}`;
  if (!(_isCronAction && _cronAuthOk) && !access_token && !_c.pw_session) {
    return res.status(401).json({ error: '管理者ログインが必要です' });
  }

  // ── 管理対象ロケーション（オーナー登録済みGBPから管理者が選抜して登録） ──
  // GETで現在の管理対象一覧、POST{location,on}で追加/除外。これで「全自動表示」をやめ管理者が判断する。
  if (action === 'managed') {
    if (req.method === 'GET') return res.json({ managed: await kvGet('managed_locations') || [] });
    if (req.method === 'POST') {
      const { location, on } = req.body || {};
      const locId = location && (location.locId || String(location.name || '').match(/locations\/[^/]+/)?.[0]);
      if (!locId) return res.status(400).json({ error: 'locId必須' });
      let list = await kvGet('managed_locations') || [];
      const prev = list.find(m => m.locId === locId);
      list = list.filter(m => m.locId !== locId);
      if (on) list.push({
        locId,
        locationName: location.locationName || (prev && prev.locationName) || '',
        title: location.title || (prev && prev.title) || '',
        clientName: location.clientName || (prev && prev.clientName) || '',
        // 会社名（クライアント分け用）。未指定なら既存値→店舗名の順でフォールバック。
        company: (location.company !== undefined ? String(location.company) : (prev && prev.company)) || location.title || (prev && prev.title) || '',
        address: location.address || (prev && prev.address) || '',
        addedAt: (prev && prev.addedAt) || new Date().toISOString(),
      });
      await kvSet('managed_locations', list);
      return res.json({ success: true, managed: list });
    }
  }

  // ── クライアント（会社）の連絡先メタ情報（メール・電話）。会社名キーの単一マップで保持 ──
  // 店舗のGBP電話を会社の電話として誤表示していた問題への対応。会社ごとに手動で設定・修正できる。
  if (action === 'client-meta') {
    if (req.method === 'GET') return res.json({ meta: await kvGet('client_meta') || {} });
    if (req.method === 'POST') {
      const { company, email, phone } = req.body || {};
      if (!company) return res.status(400).json({ error: 'company必須' });
      const map = await kvGet('client_meta') || {};
      map[String(company)] = {
        email: String(email || '').slice(0, 120),
        phone: String(phone || '').slice(0, 40),
        updatedAt: new Date().toISOString(),
      };
      await kvSet('client_meta', map);
      return res.json({ success: true, meta: map });
    }
  }

  // ── 競合店舗管理（店舗ごと・PDF競合比較や順位比較に使う） ──
  if (action === 'competitors') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `competitors_${storeId}`;
    if (req.method === 'GET') return res.json({ competitors: await kvGet(key) || [] });
    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.name) return res.status(400).json({ error: '店舗名必須' });
      const list = await kvGet(key) || [];
      const item = {
        id: b.id || ('cmp' + Date.now().toString(36)),
        name: String(b.name).slice(0, 120),
        placeId: String(b.placeId || '').slice(0, 200),
        mapsUrl: String(b.mapsUrl || '').slice(0, 400),
        area: String(b.area || '').slice(0, 80),
        compare: b.compare !== false,
        memo: String(b.memo || '').slice(0, 500),
        addedAt: new Date().toISOString(),
      };
      const idx = list.findIndex(c => c.id === item.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...item }; else list.push(item);
      await kvSet(key, list);
      return res.json({ success: true, competitors: list });
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const list = (await kvGet(key) || []).filter(c => c.id !== id);
      await kvSet(key, list);
      return res.json({ success: true, competitors: list });
    }
  }

  // ── 競合の動き（変化検知）：comp_historyから各競合の口コミ数/評価/順位の増減を算出 ──
  // ※GBP/SerpApiの制約で競合の"新規投稿・写真"は取得不可。口コミ数・評価・順位の推移のみ監視できる。
  if (req.method === 'GET' && action === 'comp-changes') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const hist = await kvGet(`comp_history_${storeId}`) || [];
    const comps = await kvGet(`competitors_${storeId}`) || [];
    const nameById = {}; comps.forEach(c => { nameById[c.id] = c.name; });
    const sorted = [...hist].sort((a, b) => (a.date < b.date ? -1 : 1));
    // 競合IDごとに、値のある観測の系列を作る
    const series = {};
    sorted.forEach(h => (h.comps || []).forEach(c => {
      if (c.id == null) return;
      (series[c.id] = series[c.id] || []).push({ date: h.date, reviews: c.reviews, rating: c.rating, rank: c.rank });
    }));
    const changes = [];
    Object.keys(series).forEach(id => {
      const s = series[id].filter(x => x.reviews != null || x.rating != null || x.rank != null);
      if (s.length < 2) return;
      const last = s[s.length - 1], first = s[0];
      const revDelta = (last.reviews != null && first.reviews != null) ? last.reviews - first.reviews : null;
      const ratDelta = (last.rating != null && first.rating != null) ? Math.round((last.rating - first.rating) * 10) / 10 : null;
      const rankDelta = (last.rank != null && first.rank != null) ? first.rank - last.rank : null; // +で順位UP
      if (!revDelta && !ratDelta && !rankDelta) return;
      changes.push({
        id, name: nameById[id] || '競合', from: first.date, to: last.date, points: s.length,
        reviews: { from: first.reviews, to: last.reviews, delta: revDelta },
        rating: { from: first.rating, to: last.rating, delta: ratDelta },
        rank: { from: first.rank, to: last.rank, delta: rankDelta },
      });
    });
    changes.sort((a, b) => Math.abs(b.reviews.delta || 0) - Math.abs(a.reviews.delta || 0));
    return res.json({ changes });
  }

  // ── LINE公式連携：チャネルアクセストークンの保管／全友だちへの配信（承認制・明示送信のみ） ──
  if (action === 'line-conn') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `line_conn_${storeId}`;
    if (req.method === 'GET') { const c = await kvGet(key); return res.json({ connected: !!(c && c.token) }); }
    if (req.method === 'POST') {
      const t = String((req.body || {}).token || '').trim();
      if (!t) return res.status(400).json({ error: 'チャネルアクセストークンが必要です' });
      await kvSet(key, { token: t });
      return res.json({ success: true });
    }
    if (req.method === 'DELETE') { await kvDel(key); return res.json({ success: true }); }
    return res.status(405).json({ error: 'method' });
  }
  // 接続テスト（Botのプロフィール/クォータ確認）
  if (action === 'line-test') {
    const c = await kvGet(`line_conn_${req.query.storeId}`);
    if (!c || !c.token) return res.status(400).json({ error: 'LINE連携が未設定です' });
    try {
      const r = await fetch('https://api.line.me/v2/bot/info', { headers: { Authorization: `Bearer ${c.token}` } });
      const d = await r.json();
      if (!r.ok) return res.json({ ok: false, error: d.message || `接続失敗(${r.status})` });
      return res.json({ ok: true, name: d.displayName || '', userId: d.userId || '' });
    } catch (e) { return res.json({ ok: false, error: 'LINEに接続できません' }); }
  }
  // 全友だちへ配信（社外送信＝承認制。フロントの明示操作でのみ実行）
  if (action === 'line-broadcast' && req.method === 'POST') {
    const c = await kvGet(`line_conn_${req.query.storeId}`);
    if (!c || !c.token) return res.status(400).json({ error: 'LINE連携が未設定です' });
    const text = String((req.body || {}).text || '').trim();
    if (!text) return res.status(400).json({ error: 'メッセージが空です' });
    try {
      const r = await fetch('https://api.line.me/v2/bot/message/broadcast', {
        method: 'POST', headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
      });
      if (r.status === 200) return res.json({ success: true });
      const t = await r.text(); let d = {}; try { d = JSON.parse(t); } catch {}
      return res.status(r.status).json({ error: d.message ? `LINE送信失敗: ${d.message}` : `LINE送信失敗(${r.status})` });
    } catch (e) { return res.status(502).json({ error: 'LINE送信に失敗しました: ' + e.message }); }
  }

  // ── 口コミPOP: 保存デザインテンプレ（Canva/アップロード画像を再利用） ──
  // 画像はCloudinary(/api/posts?action=media)に保管し、ここにはURL＋QR配置などのメタのみ。全店舗共通。
  if (action === 'pop-templates') {
    const key = 'pop_templates';
    if (req.method === 'GET') return res.json({ templates: await kvGet(key) || [] });
    if (req.method === 'POST') {
      const b = req.body || {};
      if (!b.url) return res.status(400).json({ error: '画像URL必須' });
      const q = b.designQr || {};
      const clamp = (v, mn, mx, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.max(mn, Math.min(mx, n)) : dflt; };
      const item = {
        id: b.id || ('pop' + Date.now().toString(36)),
        name: String(b.name || '無題のデザイン').slice(0, 80),
        url: String(b.url).slice(0, 600),
        publicId: String(b.publicId || '').slice(0, 300),
        width: Number(b.width) || 0,
        height: Number(b.height) || 0,
        designFit: (b.designFit === 'contain') ? 'contain' : 'cover',
        designQrFrame: b.designQrFrame !== false,
        designQr: { x: clamp(q.x, 0, 100, 50), y: clamp(q.y, 0, 100, 80), size: clamp(q.size, 8, 80, 32) },
        createdAt: new Date().toISOString(),
      };
      const list = await kvGet(key) || [];
      const idx = list.findIndex(t => t.id === item.id);
      if (idx >= 0) list[idx] = { ...list[idx], ...item }; else list.unshift(item);
      const trimmed = list.slice(0, 60); // 暴走防止の上限
      await kvSet(key, trimmed);
      return res.json({ success: true, template: item, templates: trimmed });
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const list = (await kvGet(key) || []).filter(t => t.id !== id);
      await kvSet(key, list);
      return res.json({ success: true, templates: list });
    }
  }

  // ── 一覧から非表示（重複・無関係なGBPリスティングを隠す。Google本体は一切変更しない） ──
  // hidden_locations に locId を貯め、ピッカーの既定表示から除外する。戻す(on:false)も可能。
  if (action === 'hidden') {
    if (req.method === 'GET') return res.json({ hidden: await kvGet('hidden_locations') || [] });
    if (req.method === 'POST') {
      const b = req.body || {};
      const id = b.locId || String((b.location || {}).name || '').match(/locations\/[^/]+/)?.[0];
      if (!id) return res.status(400).json({ error: 'locId必須' });
      let list = await kvGet('hidden_locations') || [];
      list = list.filter(x => x !== id);
      if (b.on) list.push(id);
      await kvSet('hidden_locations', list);
      return res.json({ success: true, hidden: list });
    }
  }

  // ── 口コミ獲得KPI 取得（管理側・当月＋前月＋平均満足度）──
  if (action === 'kpi' && req.method === 'GET') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
    const cur = { ...KPI_ZERO, ...(await kvGet(`kpi_${storeId}_${ym}`) || {}) };
    const last = { ...KPI_ZERO, ...(await kvGet(`kpi_${storeId}_${prev}`) || {}) };
    const avg = (o) => (o.rateCount > 0 ? Math.round((o.rateSum / o.rateCount) * 10) / 10 : null);
    return res.json({ month: ym, current: cur, previous: last, avgSatisfaction: avg(cur), avgSatisfactionPrev: avg(last) });
  }

  // ── 口コミ獲得KPI 手動修正・リセット（管理側・当月）──
  // スタッフのテストスキャン等で膨らんだ数値を手で正す/ゼロに戻す。
  if (action === 'kpi-set' && req.method === 'POST') {
    const { storeId, values, reset } = req.body || {};
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const ym = new Date().toISOString().slice(0, 7);
    const key = `kpi_${storeId}_${ym}`;
    if (reset) { await kvSet(key, { ...KPI_ZERO }); return res.json({ success: true, current: { ...KPI_ZERO } }); }
    const cur = { ...KPI_ZERO, ...(await kvGet(key) || {}) };
    const fields = ['scan', 'rate', 'survey', 'ai', 'click', 'line', 'lowfb'];
    fields.forEach(f => { if (values && values[f] !== undefined) { const n = parseInt(values[f], 10); cur[f] = Number.isFinite(n) && n >= 0 ? n : 0; } });
    await kvSet(key, cur);
    return res.json({ success: true, current: cur });
  }

  // ── 口コミQR成果：直近6ヶ月のKPI履歴（月別推移テーブル・ファネル用）──
  if (action === 'kpi-history' && req.method === 'GET') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const now = new Date();
    const months = [];
    for (let i = 0; i < 6; i++) {
      const dt = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const ym = dt.toISOString().slice(0, 7);
      const k = { ...KPI_ZERO, ...(await kvGet(`kpi_${storeId}_${ym}`) || {}) };
      const avg = k.rateCount > 0 ? Math.round((k.rateSum / k.rateCount) * 10) / 10 : null;
      months.push({ ym, scan: k.scan || 0, rate: k.rate || 0, survey: k.survey || 0, ai: k.ai || 0, click: k.click || 0, line: k.line || 0, lowfb: k.lowfb || 0, avg });
    }
    return res.json({ months }); // months[0]=今月
  }

  // ── QRコードの再発行：新しいトークンを発行し、旧QR（旧トークン）を無効化 ──
  if (action === 'reissue-qr' && req.method === 'POST') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `survey_${storeId}`;
    const cur = { ...DEFAULT_SURVEY, ...(await kvGet(key) || {}) };
    cur.qrToken = generateId(); // 新トークン。review.htmlはこれと一致しないURLを無効表示にする
    cur.qrReissuedAt = new Date().toISOString();
    await kvSet(key, cur);
    return res.json({ success: true, qrToken: cur.qrToken });
  }

  // ── アンケート設定 取得/保存（管理側）──
  if (action === 'survey') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `survey_${storeId}`;
    if (req.method === 'GET') return res.json({ ...DEFAULT_SURVEY, ...(await kvGet(key) || {}) });
    if (req.method === 'POST') {
      const cur = { ...DEFAULT_SURVEY, ...(await kvGet(key) || {}) };
      const b = req.body || {};
      const next = { ...cur };
      ['title', 'intro', 'ratingQuestion', 'lowHeading', 'lowMsg', 'feedbackEmail', 'completionMsg', 'gateMode', 'googleUrl', 'lineUrl', 'reportComment'].forEach(k => { if (b[k] !== undefined) next[k] = String(b[k]); });
      if (b.qrEnabled !== undefined) next.qrEnabled = !!b.qrEnabled; // boolean（Stringで潰さない）
      if (Array.isArray(b.goodPoints)) next.goodPoints = b.goodPoints.map(s => String(s).slice(0, 30)).filter(Boolean).slice(0, 16);
      if (b.lowThreshold !== undefined) next.lowThreshold = Math.min(5, Math.max(1, parseInt(b.lowThreshold, 10) || 4));
      await kvSet(key, next);
      return res.json({ success: true, survey: next });
    }
  }

  // ── リード一覧/削除/CSV（管理側）──
  if (action === 'leads') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `leads_${storeId}`;
    if (req.method === 'GET') {
      const list = await kvGet(key) || [];
      if (req.query.format === 'csv') {
        const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
        const rows = [['email', 'name', 'rating', 'date'].join(',')]
          .concat(list.map(l => [esc(l.email), esc(l.name), esc(l.rating), esc((l.at || '').slice(0, 10))].join(',')));
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="leads_${storeId}.csv"`);
        return res.status(200).send('﻿' + rows.join('\r\n'));
      }
      return res.json({ leads: list });
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const list = (await kvGet(key) || []).filter(l => l.id !== id);
      await kvSet(key, list);
      return res.json({ success: true, leads: list });
    }
  }

  // ── 低評価フィードバック 一覧/削除（管理側）──
  if (action === 'feedback') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `feedback_${storeId}`;
    if (req.method === 'GET') return res.json({ feedback: await kvGet(key) || [] });
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const list = (await kvGet(key) || []).filter(f => f.id !== id);
      await kvSet(key, list);
      return res.json({ success: true, feedback: list });
    }
  }

  // ── 店舗一覧（GBP連携状況付き）──
  if (req.method === 'GET' && !action) {
    const all = await kvGet('admin_stores') || [];
    // 既定はアーカイブ除外。archived=1でアーカイブ済みのみ返す（復元UI用）
    const list = req.query.archived === '1' ? all.filter(s => s.archived) : all.filter(s => !s.archived);
    const stores = await Promise.all(list.map(async (s) => {
      const gbp = await kvGet(`gbp_tokens_${s.storeId}`);
      return {
        ...s,
        gbpConnected: !!gbp,
        gbpEmail: gbp?.email || null,
        gbpConnectedAt: gbp?.connected_at || null,
        connectUrl: `/api/auth/connect?store=${s.storeId}`,
      };
    }));
    return res.json({ stores });
  }

  // ── 店舗登録 ──
  if (req.method === 'POST' && !action) {
    const { storeName, clientEmail } = req.body;
    if (!storeName) return res.status(400).json({ error: 'storeName必須' });
    const list = await kvGet('admin_stores') || [];
    const storeId = generateId();
    const password = generatePassword();
    const newStore = { storeId, storeName, clientEmail: clientEmail || '', password, createdAt: new Date().toISOString(), active: true };
    list.push(newStore);
    await kvSet('admin_stores', list);
    await kvSet(`client_${storeId}`, newStore);
    return res.json({ success: true, storeId, password, loginUrl: `/report.html?store=${storeId}` });
  }

  // ── 店舗削除（既定=アーカイブ・hard=1で完全削除） ──
  if (req.method === 'DELETE' && !action) {
    const { storeId, hard } = req.query;
    const list = await kvGet('admin_stores') || [];
    if (hard === '1') {
      await kvSet('admin_stores', list.filter(s => s.storeId !== storeId));
      await kvDel(`gbp_tokens_${storeId}`);
      await kvDel(`client_${storeId}`);
      return res.json({ success: true, deleted: true });
    }
    const idx = list.findIndex(s => s.storeId === storeId);
    if (idx < 0) return res.status(404).json({ error: '店舗が見つかりません' });
    list[idx].archived = true;
    list[idx].archivedAt = new Date().toISOString();
    await kvSet('admin_stores', list);
    return res.json({ success: true, archived: true });
  }

  // ── アーカイブから復元 ──
  if (req.method === 'POST' && action === 'unarchive') {
    const storeId = req.query.storeId || (req.body || {}).storeId;
    const list = await kvGet('admin_stores') || [];
    const idx = list.findIndex(s => s.storeId === storeId);
    if (idx < 0) return res.status(404).json({ error: '店舗が見つかりません' });
    delete list[idx].archived;
    delete list[idx].archivedAt;
    await kvSet('admin_stores', list);
    return res.json({ success: true });
  }

  // ── GBP連携解除 ──
  if (req.method === 'DELETE' && action === 'disconnect') {
    const { storeId } = req.query;
    await kvDel(`gbp_tokens_${storeId}`);
    return res.json({ success: true });
  }

  // ── GBP連携状況確認 ──
  if (req.method === 'GET' && action === 'gbp-status') {
    const { storeId } = req.query;
    const gbp = await kvGet(`gbp_tokens_${storeId}`);
    return res.json({
      connected: !!gbp,
      email: gbp?.email || null,
      connectedAt: gbp?.connected_at || null,
    });
  }

  // ── SerpApiで順位を自動取得 ──
  // 月間上限は環境変数 SERPAPI_MONTHLY_LIMIT で設定（既定=無料枠の100/月）。
  // 課金プランに上げた場合はVercel環境変数に契約枠を入れるだけで、コード変更なしで反映される。
  // ※GCP Places API課金事故と同種の「気づかず課金枠突入」を避けるため、既定は安全側(100)。
  const SERPAPI_LIMIT = Math.max(1, parseInt(process.env.SERPAPI_MONTHLY_LIMIT, 10) || 100);
  if (req.method === 'GET' && action === 'serpapi-usage') {
    const ym = new Date().toISOString().slice(0, 7);
    const used = await kvGet(`serpapi_usage_${ym}`) || 0;
    return res.json({ month: ym, used, limit: SERPAPI_LIMIT, remaining: Math.max(0, SERPAPI_LIMIT - used) });
  }

  // ── システムステータス（設定ページ・外部連携と枠の健全性を一目で） ──
  if (req.method === 'GET' && action === 'status') {
    const ym = new Date().toISOString().slice(0, 7);
    let kvOk = true, used = 0, cronLast = null, managedCount = 0, tamperLast = null;
    try {
      used = await kvGet(`serpapi_usage_${ym}`) || 0;
      cronLast = await kvGet('cron_rank_last') || null;
      managedCount = ((await kvGet('managed_locations')) || []).length;
      tamperLast = await kvGet('cron_tamper_last') || null;
    } catch (e) { kvOk = false; }
    let gbp = { connected: false };
    try { gbp = await getMasterInfo(); } catch (e) {}
    return res.json({
      kv: kvOk,
      gbp: { connected: !!gbp.connected, email: gbp.email || '' },
      env: {
        groq: !!process.env.GROQ_API_KEY,
        serpapi: !!process.env.SERPAPI_KEY,
        resend: !!process.env.RESEND_API_KEY,
        cronSecret: !!process.env.CRON_SECRET,
        adminEnv: !!(process.env.ADMIN_USER && process.env.ADMIN_PASS),
      },
      serpapi: { month: ym, used, limit: SERPAPI_LIMIT, remaining: Math.max(0, SERPAPI_LIMIT - used) },
      cronLast: cronLast ? { at: cronLast.at, date: cronLast.date, ok: cronLast.ok, fail: cronLast.fail, targets: cronLast.targets } : null,
      tamperLast: tamperLast ? { at: tamperLast.at, date: tamperLast.date, checked: tamperLast.checked, changed: tamperLast.changed, pending: tamperLast.pending } : null,
      managedStores: managedCount,
    });
  }

  // ── 順位の定期自動取得（Vercel Cron: 毎週月曜3時JST = 0 18 * * 0 UTC）──
  // 安全設計: 優先度「A」の有効KWのみ自動計測。無料枠の20%を手動用に温存し、残枠が尽きたら自動停止。
  // 1回の実行はMAX_CALLS件まで（関数実行時間の上限内に収める）。CRON_SECRET設定時はBearer認証必須。
  if (req.method === 'GET' && action === 'cron-rank') {
    if (process.env.CRON_SECRET && (req.headers.authorization || '') !== `Bearer ${process.env.CRON_SECRET}` && !access_token && !_c.pw_session) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const _cronProvider = (process.env.RANK_PROVIDER || 'serpapi').toLowerCase();
    const _cronUseSerp = !(_cronProvider === 'dataforseo' && (process.env.DATAFORSEO_B64 || process.env.DATAFORSEO_LOGIN));
    if (_cronUseSerp && !process.env.SERPAPI_KEY) return res.status(500).json({ error: 'SERPAPI_KEY未設定' });
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // JST日付
    // 同日の再実行はスキップ（誤操作・外部からの連打で枠を浪費しない。force=1で強制再実行）
    const last = await kvGet('cron_rank_last');
    if (last && last.date === today && req.query.force !== '1') {
      return res.json({ skipped: '本日はすでに実行済みです', last });
    }
    const ym = new Date().toISOString().slice(0, 7);
    const usedKey = `serpapi_usage_${ym}`;
    let used = await kvGet(usedKey) || 0;
    // ── プロバイダ別のガード ──
    // SerpApi(無料枠): 月100・20%温存・1回20件。DataForSEO(従量): 月間コール上限＋関数60秒に収まる1回件数。
    const _dfsUsedKey = `dfs_usage_${ym}`;
    let _dfsUsed = _cronUseSerp ? 0 : (await kvGet(_dfsUsedKey) || 0);
    const _dfsMonthlyLimit = Math.max(1, parseInt(process.env.DATAFORSEO_MONTHLY_LIMIT, 10) || 1500); // 従量課金の月間コール上限(安全弁・GCP課金事故の再発防止)
    const _dfsPerRun = Math.max(1, parseInt(process.env.DATAFORSEO_MAX_CALLS_PER_RUN, 10) || 8);      // 1回の実行件数(60秒の関数上限に収める。DataForSEO Liveは1件数秒)
    let budget, MAX_CALLS;
    if (_cronUseSerp) {
      const reserve = Math.ceil(SERPAPI_LIMIT * 0.2); // 手動取得用に2割温存
      budget = Math.max(0, SERPAPI_LIMIT - reserve - used);
      MAX_CALLS = Math.min(budget, 20);
    } else {
      budget = Math.max(0, _dfsMonthlyLimit - _dfsUsed);
      MAX_CALLS = Math.min(budget, _dfsPerRun);
    }
    // 対象店舗（GBP管理店＋手動登録）
    const managed = await kvGet('managed_locations') || [];
    const manual = await kvGet('admin_stores') || [];
    const stores = [];
    const seen = new Set();
    for (const m of managed) { const sid = String(m.locId || '').replace(/\//g, '_'); if (sid && !seen.has(sid)) { seen.add(sid); stores.push({ storeId: sid, name: m.title || '' }); } }
    for (const s of manual) { if (s.storeId && !seen.has(s.storeId)) { seen.add(s.storeId); stores.push({ storeId: s.storeId, name: s.storeName || '' }); } }
    // 計測ジョブ＝優先度A・有効のKWのみ
    const jobs = [];
    for (const st of stores) {
      if (!st.name) continue;
      const rk = await kvGet(`rankings_${st.storeId}`) || {};
      const meta = rk.meta || {};
      // 計測地点(rank_point)があれば ll を付与。無ければ店舗住所からgeocodeして座標を得る
      // （DataForSEOのGoogleマップは座標が実質必須。国レベルだと0件になるため）。
      const rp = await kvGet(`rank_point_${st.storeId}`);
      let ll = (rp && Number.isFinite(+rp.lat) && Number.isFinite(+rp.lng)) ? `${rp.lat},${rp.lng},14z` : '';
      if (!ll) {
        const _kn = await kvGet(`knowledge_${st.storeId}`) || {};
        const _geoQ = _kn.address || st.name;
        if (_geoQ) { const _g = await geocodeQuery(_geoQ); if (_g) ll = `${_g.lat},${_g.lng},14z`; }
      }
      (rk.keywords || []).forEach(kw => {
        const m = meta[kw] || {};
        if (kw && m.enabled !== false && m.priority === 'A') jobs.push({ st, kw, area: m.area || '', ll });
      });
    }
    // ── 回転カーソル：毎回続きから測って全KWを一巡させる（先頭N件に偏らない） ──
    let _cursor = await kvGet('cron_rank_cursor');
    if (!Number.isFinite(_cursor) || _cursor >= jobs.length) _cursor = 0;
    const orderedJobs = jobs.length ? jobs.slice(_cursor).concat(jobs.slice(0, _cursor)) : [];
    // カーソルは「先行更新」：関数が60秒制限で途中終了しても次回は続きから測れる（同じ先頭10件を測り続ける事故を防ぐ）。
    if (jobs.length) await kvSet('cron_rank_cursor', (_cursor + Math.min(MAX_CALLS, jobs.length)) % jobs.length);
    let ok = 0, fail = 0, _processedCount = 0;
    const processed = [];
    for (const job of orderedJobs) {
      if (ok + fail >= MAX_CALLS) break;
      _processedCount++;
      try {
        const { list, error, calls } = await fetchLocalResults(job.kw, { location: job.area ? `${job.area},Japan` : '', ll: job.ll });
        if (_cronUseSerp && calls) { used = await kvIncrBy(usedKey, calls); } // アトミック加算（並行実行のアンダーカウント防止・戻り値=真の合計）
        else if (!_cronUseSerp && calls) { _dfsUsed = await kvIncrBy(_dfsUsedKey, calls); } // DataForSEO従量の使用数を計上
        if (error) { fail++; processed.push({ store: job.st.name, kw: job.kw, error }); continue; }
        const target = _normName(job.st.name);
        let rank = null;
        list.forEach((item, i) => {
          if (rank) return;
          const t = _normName(item.title);
          if (t && (t.includes(target) || target.includes(t))) rank = item.position || (i + 1);
        });
        // rankings履歴へ保存（rank-input相当）
        const ex = await kvGet(`rankings_${job.st.storeId}`) || { history: [], keywords: [] };
        ex.keywords = ex.keywords || [];
        let ki = ex.keywords.indexOf(job.kw);
        if (ki < 0) { ex.keywords.push(job.kw); ki = ex.keywords.length - 1; }
        let entry = ex.history.find(h => h.date === today);
        if (!entry) { entry = { date: today, rankings: [], recordedAt: new Date().toISOString() }; ex.history.push(entry); }
        entry.rankings = entry.rankings || [];
        entry.rankings[ki] = (Number.isFinite(rank) && rank >= 1) ? rank : null;
        entry.recordedAt = new Date().toISOString();
        ex.history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        if (ex.history.length > 60) ex.history = ex.history.slice(-60);
        await kvSet(`rankings_${job.st.storeId}`, ex);
        // 競合順位も同時記録（追加APIコストなし）
        await recordCompRanks(job.st.storeId, job.kw, rank, list);
        ok++;
        processed.push({ store: job.st.name, kw: job.kw, rank });
      } catch (e) { fail++; processed.push({ store: job.st.name, kw: job.kw, error: e.message }); }
    }
    // カーソルはループ前に先行更新済み（途中終了対策）。ここでは更新しない。
    const summary = {
      at: new Date().toISOString(), date: today,
      provider: _cronUseSerp ? 'serpapi' : 'dataforseo',
      targets: jobs.length, ok, fail,
      measuredThisRun: _processedCount, cursorNext: jobs.length ? (_cursor + _processedCount) % jobs.length : 0,
      capped: jobs.length > MAX_CALLS ? `全${jobs.length}件のうち今回${MAX_CALLS}件を計測（続きは次回・回転カーソルで一巡）` : null,
      budgetStopped: budget <= 0 ? (_cronUseSerp ? '残枠が手動温存分(20%)に達したため停止' : `DataForSEO月間上限(${_dfsMonthlyLimit}コール)に達したため停止`) : null,
      used, limit: SERPAPI_LIMIT,
      dfsUsed: _cronUseSerp ? undefined : _dfsUsed, dfsLimit: _cronUseSerp ? undefined : _dfsMonthlyLimit,
      processed,
    };
    await kvSet('cron_rank_last', summary);

    // 週次サマリーメール（RESEND設定時のみ・設定ページでOFF可）
    try {
      const notifyPref = await kvGet('notify_weekly');
      if (notifyPref !== false && (ok + fail) > 0) {
        const to = process.env.ADMIN_USER || ((await kvGet('admin_credential')) || {}).user;
        if (to) {
          const rows = processed.map(p => `<tr><td style="padding:4px 10px;border-bottom:1px solid #eee">${p.store}</td><td style="padding:4px 10px;border-bottom:1px solid #eee">${p.kw}</td><td style="padding:4px 10px;border-bottom:1px solid #eee">${p.error ? '取得失敗' : (p.rank ? p.rank + '位' : '圏外')}</td></tr>`).join('');
          await sendMail(to, `【ラクラクMEO】週次順位レポート（${today}）`,
            `<div style="font-family:sans-serif;color:#1e293b"><h2 style="font-size:18px">週次の順位自動計測が完了しました</h2>
            <p>計測 ${ok}件成功 / ${fail}件失敗（今月のAPI使用 ${used}/${SERPAPI_LIMIT}回）</p>
            ${rows ? `<table style="border-collapse:collapse;font-size:13px"><tr><th style="padding:4px 10px;text-align:left">店舗</th><th style="padding:4px 10px;text-align:left">キーワード</th><th style="padding:4px 10px;text-align:left">順位</th></tr>${rows}</table>` : ''}
            ${summary.capped ? `<p style="color:#b45309">${summary.capped}</p>` : ''}
            ${summary.budgetStopped ? `<p style="color:#b91c1c">${summary.budgetStopped}</p>` : ''}
            <p style="margin-top:14px"><a href="https://meo.cantik.co.jp" style="color:#2e8ff0">ラクラクMEOで詳細を見る →</a></p></div>`);
        }
      }
    } catch (e) { /* メール失敗で本体を落とさない */ }

    return res.json(summary);
  }

  // ── 改ざん検知の定期自動巡回（Vercel Cron: 毎日3時JST = 0 18 * * * UTC）──
  // 正規情報(baseline)を保存済みの管理店を毎日GBPと自動照合→変化があればアラート記録＋メール通知。
  if (req.method === 'GET' && action === 'cron-tamper') {
    if (process.env.CRON_SECRET && (req.headers.authorization || '') !== `Bearer ${process.env.CRON_SECRET}` && !access_token && !_c.pw_session) {
      return res.status(401).json({ error: 'unauthorized' });
    }
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
    const last = await kvGet('cron_tamper_last');
    if (last && last.date === today && req.query.force !== '1') return res.json({ skipped: '本日はすでに実行済みです', last });
    const masterToken = await getMasterToken();
    const managed = await kvGet('managed_locations') || [];
    let checked = 0, changed = 0, pending = 0;
    const changes = [];
    for (const m of managed) {
      const locId = String(m.locId || '').replace(/\//g, '_');
      if (!locId) continue;
      const saved = await kvGet(`settings_${locId}`);
      if (!saved || !saved.info) continue; // 正規情報が未保存の店はスキップ
      const locationName = m.locId || m.locationName || '';
      const token = m.storeId ? (await getAccessToken(m.storeId)) || masterToken : masterToken;
      if (!token || !locationName) { pending++; continue; }
      try {
        const got = await fetchCurrentGbpInfo(locationName, token);
        if (got.error) { pending++; continue; }
        const diffs = diffGbpBaseline(saved.info, got.current);
        const now = new Date().toISOString();
        if (diffs.length) {
          const alerts = saved.alerts || [];
          alerts.unshift({ detectedAt: now, diffs, auto: true });
          if (alerts.length > 20) alerts.length = 20;
          await kvSet(`settings_${locId}`, { ...saved, alerts, lastCheckedAt: now });
          changed++;
          changes.push({ store: m.title || locId, diffs });
        } else {
          await kvSet(`settings_${locId}`, { ...saved, lastCheckedAt: now });
        }
        checked++;
      } catch (e) { pending++; }
    }
    const summary = { at: new Date().toISOString(), date: today, checked, changed, pending };
    await kvSet('cron_tamper_last', summary);
    // 変化を検知したらメール通知（RESEND設定時・通知ONのみ）
    try {
      if (changed > 0 && (await kvGet('notify_tamper')) !== false) {
        const to = process.env.ADMIN_USER || ((await kvGet('admin_credential')) || {}).user;
        if (to) {
          const rows = changes.map(c => `<div style="margin-bottom:8px"><b>${c.store}</b><ul style="margin:2px 0">${c.diffs.map(d => `<li>${d.field}: 「${d.saved}」→「${d.current}」</li>`).join('')}</ul></div>`).join('');
          await sendMail(to, `【ラクラクMEO】ビジネス情報の変更を検知（${today}）`,
            `<div style="font-family:sans-serif;color:#1e293b"><h2 style="font-size:18px">GBPビジネス情報の変更を検知しました</h2><p>${changed}店舗で正規情報との差分を検出しました。心当たりのない変更は改ざんの可能性があります。</p>${rows}<p style="margin-top:14px"><a href="https://meo.cantik.co.jp" style="color:#2e8ff0">ラクラクMEOで確認する →</a></p></div>`);
        }
      }
    } catch (e) { /* メール失敗で本体を落とさない */ }
    return res.json(summary);
  }

  // ── 営業デモ用のサンプル店舗を作成/削除（実データと同じKVに入れるので全機能がそのまま動く） ──
  if (action === 'seed-demo' && req.method === 'POST') {
    const DID = 'demo-store';
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);
    const prevYm = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
    const dstr = (daysAgo) => new Date(now - daysAgo * 86400000).toISOString().slice(0, 10);
    // 手動店舗として登録（サイドバー・店舗管理に出る）
    const stores = await kvGet('admin_stores') || [];
    if (!stores.some(s => s.storeId === DID)) {
      stores.push({ storeId: DID, storeName: '【デモ】さくら美容室 渋谷店', clientEmail: '', password: 'demo1234', createdAt: now.toISOString(), active: true, isDemo: true });
      await kvSet('admin_stores', stores);
    }
    // 企業ナレッジ
    await kvSet(`knowledge_${DID}`, {
      storeName: '【デモ】さくら美容室 渋谷店', category: '美容室', postalCode: '150-0002',
      address: '東京都渋谷区渋谷2-1-1', phone: '03-1234-5678', businessDays: '火〜日', closedDays: '毎週月曜',
      businessHours: '10:00〜20:00', parking: '近隣コインパーキング利用', nearbyLandmarks: 'JR渋谷駅 東口から徒歩5分',
      description: '渋谷駅徒歩5分の隠れ家サロン。縮毛矯正とヘアカラーが得意で、丁寧なカウンセリングが好評です。',
      strengths: '経験10年以上のスタイリストが在籍。髪質改善・縮毛矯正が得意。個室でゆったり施術。',
      expertise: '毛髪診断士在籍・縮毛矯正の症例2000件以上', services: 'カット/カラー/縮毛矯正/トリートメント/ヘッドスパ',
      serviceArea: '渋谷区・目黒区・世田谷区', targetCustomer: '20〜40代の働く女性',
      keywords: ['渋谷 美容室', '渋谷 縮毛矯正', '渋谷 髪質改善'], updatedAt: now.toISOString(), isDemo: true,
    });
    // 対策キーワード（順位履歴つき・優先度・エリア）
    await kvSet(`rankings_${DID}`, {
      keywords: ['渋谷 美容室', '渋谷 縮毛矯正', '渋谷 髪質改善', '渋谷 ヘッドスパ', '渋谷 カラー 上手い'],
      meta: {
        '渋谷 美容室': { area: '渋谷区', category: '今すぐ客', priority: 'A', enabled: true },
        '渋谷 縮毛矯正': { area: '渋谷区', category: '悩み・目的', priority: 'A', enabled: true },
        '渋谷 髪質改善': { area: '渋谷区', category: '悩み・目的', priority: 'B', enabled: true },
        '渋谷 ヘッドスパ': { area: '渋谷区', category: '差別化', priority: 'B', enabled: true },
        '渋谷 カラー 上手い': { area: '渋谷区', category: '差別化', priority: 'C', enabled: true },
      },
      history: [
        { date: dstr(28), rankings: [8, 12, 15, 6, 20], recordedAt: now.toISOString() },
        { date: dstr(21), rankings: [6, 10, 14, 5, 18], recordedAt: now.toISOString() },
        { date: dstr(14), rankings: [5, 9, 12, 4, 16], recordedAt: now.toISOString() },
        { date: dstr(7), rankings: [4, 7, 11, 4, 15], recordedAt: now.toISOString() },
        { date: dstr(1), rankings: [3, 6, 10, 3, 14], recordedAt: now.toISOString() },
      ],
    });
    // 競合＋競合順位の記録
    const compA = 'demo-cmp-a', compB = 'demo-cmp-b';
    await kvSet(`competitors_${DID}`, [
      { id: compA, name: 'BEAUTY SALON Lumiere', placeId: '', area: '渋谷区', compare: true, memo: '駅近・価格帯やや高め', addedAt: now.toISOString() },
      { id: compB, name: 'hair studio Neo 渋谷', placeId: '', area: '渋谷区', compare: true, memo: 'カラー訴求が強い', addedAt: now.toISOString() },
    ]);
    await kvSet(`comp_history_${DID}`, [
      { date: dstr(14), keyword: '渋谷 美容室', self: 5, comps: [{ id: compA, rank: 2 }, { id: compB, rank: 7 }] },
      { date: dstr(7), keyword: '渋谷 美容室', self: 4, comps: [{ id: compA, rank: 2 }, { id: compB, rank: 6 }] },
      { date: dstr(1), keyword: '渋谷 美容室', self: 3, comps: [{ id: compA, rank: 3 }, { id: compB, rank: 8 }] },
      { date: dstr(1), keyword: '渋谷 縮毛矯正', self: 6, comps: [{ id: compA, rank: 4 }, { id: compB, rank: null }] },
    ]);
    // KPI（当月＋前月）
    await kvSet(`kpi_${DID}_${ym}`, { scan: 46, rate: 0, survey: 31, ai: 18, click: 27, line: 9, lowfb: 2, rateSum: 142, rateCount: 31 });
    await kvSet(`kpi_${DID}_${prevYm}`, { scan: 38, rate: 0, survey: 24, ai: 12, click: 19, line: 6, lowfb: 3, rateSum: 106, rateCount: 24 });
    // 口コミ統計（レポート・クライアント配布用）
    await kvSet(`review_stats_${DID}`, { averageRating: 4.6, totalCount: 128, unrepliedCount: 3, distribution: { 1: 3, 2: 5, 3: 12, 4: 38, 5: 70 }, updatedAt: now.toISOString() });
    // survey（担当者コメント・アンケート設定の既定）
    await kvSet(`survey_${DID}`, { reportComment: '今月は「渋谷 美容室」でTOP3を達成しました。縮毛矯正のキーワードも上昇傾向です。来月は口コミ返信の徹底で評価維持を狙います。', isDemo: true });
    // クライアント配布用アカウント
    await kvSet(`client_${DID}`, { storeId: DID, storeName: '【デモ】さくら美容室 渋谷店', password: 'demo1234', active: true, createdAt: now.toISOString(), isDemo: true });
    return res.json({ success: true, storeId: DID });
  }
  if (action === 'remove-demo' && req.method === 'POST') {
    const DID = 'demo-store';
    const now = new Date();
    const ym = now.toISOString().slice(0, 7);
    const prevYm = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 7);
    const stores = (await kvGet('admin_stores') || []).filter(s => s.storeId !== DID);
    await kvSet('admin_stores', stores);
    for (const k of [`knowledge_${DID}`, `rankings_${DID}`, `competitors_${DID}`, `comp_history_${DID}`, `review_stats_${DID}`, `survey_${DID}`, `client_${DID}`, `kpi_${DID}_${ym}`, `kpi_${DID}_${prevYm}`]) {
      await kvDel(k);
    }
    return res.json({ success: true });
  }

  // ── クライアント用レポートのPW発行（GBP管理店にも発行できる・監査#4） ──
  if (req.method === 'POST' && action === 'client-issue') {
    const { storeId, storeName, regenerate } = req.body || {};
    if (!storeId || !storeName) return res.status(400).json({ error: 'storeId・storeName必須' });
    const prev = await kvGet(`client_${storeId}`);
    const password = (!prev || regenerate) ? generatePassword() : prev.password;
    const rec = {
      storeId, storeName: String(storeName).slice(0, 120), password, active: true,
      createdAt: prev?.createdAt || new Date().toISOString(), issuedAt: new Date().toISOString(),
    };
    await kvSet(`client_${storeId}`, rec);
    return res.json({ success: true, storeId, password, existing: !!prev && !regenerate, loginUrl: `/report.html?store=${encodeURIComponent(storeId)}` });
  }

  // ── 企業ナレッジ（旧api/knowledge.jsを統合・Vercel関数枠を1つ回復） ──
  if (action === 'knowledge') {
    // 認証: Google連携(access_token) または メール＋パスワード(pw_session) のどちらでも可
    const _kc = parseCookies(req);
    if (!_kc.access_token && !_kc.pw_session) return res.status(401).json({ error: 'ログインが必要です' });
    const { locationId } = req.query;
    if (!locationId) return res.status(400).json({ error: 'locationId必須' });
    const kKey = `knowledge_${locationId}`;
    if (req.method === 'GET') {
      const data = await kvGet(kKey) || {
        storeName: '', category: '', address: '', phone: '', businessHours: '',
        description: '', strengths: '', services: '', targetCustomer: '',
        nearbyLandmarks: '', parking: '', keywords: ['', '', '', '', ''], updatedAt: null,
      };
      return res.json(data);
    }
    if (req.method === 'POST') {
      const body = req.body || {};
      body.updatedAt = new Date().toISOString();
      await kvSet(kKey, body);
      return res.json({ success: true });
    }
  }

  // ── AIプロンプトの追加指示（設定ページ・typeごとにKV保存→generate-contentが末尾付加） ──
  if (action === 'prompt-extra') {
    const ALLOWED = ['reply_positive', 'reply_negative', 'post', 'instagram_post', 'catchcopy', 'gbp_description', 'hp_content', 'product_desc', 'qa_generate', 'weekly_tasks', 'diagnosis', 'keyword_ideas'];
    if (req.method === 'GET') {
      const out = {};
      for (const t of ALLOWED) { const v = await kvGet(`prompt_extra_${t}`); if (v) out[t] = v; }
      return res.json({ extras: out, types: ALLOWED });
    }
    if (req.method === 'POST') {
      const { type: pType, text } = req.body || {};
      if (!ALLOWED.includes(pType)) return res.status(400).json({ error: '不明なtypeです' });
      const v = String(text || '').trim().slice(0, 1500);
      if (v) await kvSet(`prompt_extra_${pType}`, v);
      else await kvDel(`prompt_extra_${pType}`);
      return res.json({ success: true });
    }
  }

  // ── 通知メールのON/OFF（設定ページ）type=weekly(週次サマリー・既定)/tamper(改ざん検知) ──
  if (action === 'notify-pref') {
    const nType = (req.method === 'GET' ? req.query.type : (req.body || {}).type) || 'weekly';
    const nKey = nType === 'tamper' ? 'notify_tamper' : 'notify_weekly';
    if (req.method === 'GET') {
      const v = await kvGet(nKey);
      return res.json({ enabled: v !== false, available: !!process.env.RESEND_API_KEY });
    }
    if (req.method === 'POST') {
      await kvSet(nKey, !!(req.body || {}).enabled);
      return res.json({ success: true });
    }
  }

  // GET /api/admin?action=comp-history&storeId=xxx — 競合順位の自動記録履歴（fetch-rankが同時記録したもの）
  if (req.method === 'GET' && action === 'comp-history') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const history = await kvGet(`comp_history_${storeId}`) || [];
    const competitors = await kvGet(`competitors_${storeId}`) || [];
    return res.json({ history, competitors });
  }

  // GET /api/admin?action=fetch-rank&keyword=新宿 カフェ&location=Shinjuku,Tokyo,Japan&ll=35.6,139.7,14z&store=店舗名(部分一致)&storeId=xxx
  // storeIdを渡すと、同じ検索結果から登録済み競合店舗の順位も同時記録する（追加APIリクエストなし＝枠を消費しない）
  // ll(座標)を渡すと店舗の実所在地を基準に計測でき精度が上がる（DataForSEO時は座標計測・SerpApi時は精密location併用）。
  if (req.method === 'GET' && action === 'fetch-rank') {
    const { keyword, location, ll, store, storeId } = req.query;
    if (!keyword || !store) return res.status(400).json({ error: 'keyword・store必須' });
    const provider = (process.env.RANK_PROVIDER || 'serpapi').toLowerCase();
    const useSerp = !(provider === 'dataforseo' && (process.env.DATAFORSEO_B64 || process.env.DATAFORSEO_LOGIN));
    // SerpApi時のみ月間上限ガード（DataForSEOは従量なので別管理）。上限到達で自動停止し課金枠突入を防ぐ。
    const ym = new Date().toISOString().slice(0, 7);
    const usedKey = `serpapi_usage_${ym}`;
    const used = await kvGet(usedKey) || 0;
    if (useSerp && used >= SERPAPI_LIMIT) return res.status(429).json({ error: `今月の順位取得上限（${SERPAPI_LIMIT}回）に達しました。来月リセットされます`, overLimit: true, used, limit: SERPAPI_LIMIT });
    try {
      // DataForSEOのGoogleマップは座標が実質必須。ll未指定なら店舗住所からgeocodeして補う（国レベルだと0件になる）。
      let _ll = ll;
      if (!_ll && !useSerp && storeId) {
        const _kn = await kvGet(`knowledge_${storeId}`) || {};
        const _geoQ = _kn.address || store;
        if (_geoQ) { const _g = await geocodeQuery(_geoQ); if (_g) _ll = `${_g.lat},${_g.lng},14z`; }
      }
      const { list, error, calls, _dbg } = await fetchLocalResults(keyword, { location, ll: _ll });
      if (useSerp && calls) await kvIncrBy(usedKey, calls); // アトミック加算（並行実行のアンダーカウント防止）
      else if (!useSerp && calls) await kvIncrBy(`dfs_usage_${ym}`, calls); // DataForSEO従量の使用数を計上
      if (error) return res.status(502).json({ error: error + '（検索地点は「市区,都道府県,Japan」の英語表記が確実。空欄でもキーワードに地域があれば取得できます）' });
      const target = _normName(store);
      let rank = null, matched = null;
      list.forEach((item, i) => {
        if (rank) return;
        const t = _normName(item.title);
        if (t && (t.includes(target) || target.includes(t))) { rank = item.position || (i + 1); matched = item.title; }
      });
      const top = list.slice(0, 20).map((item, i) => ({ position: item.position || (i + 1), title: item.title, rating: item.rating || null, reviews: item.reviews || null }));
      // ── 競合順位の同時記録（同じ検索結果を使うだけ＝枠を消費しない） ──
      const comps = storeId ? await recordCompRanks(storeId, keyword, rank, list) : null;
      return res.json({ keyword, location: location || null, rank, matched, found: rank !== null, top, comps, provider: useSerp ? 'serpapi' : 'dataforseo', checkedAt: new Date().toISOString() });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 独自情報・学習メモ（店舗ごと）。全コンテンツ生成が毎回読み込む蓄積メモ ──
  if (action === 'meo-memo') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `meo_memo_${storeId}`;
    if (req.method === 'GET') return res.json({ memo: (await kvGet(key)) || '' });
    if (req.method === 'POST') {
      const memo = String((req.body || {}).memo || '').slice(0, 4000);
      await kvSet(key, memo);
      return res.json({ success: true });
    }
  }

  // ── 口コミ獲得の月間目標（店舗ごと）。ペース表示用の目標値のみ保持 ──
  if (action === 'review-goal') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `review_goal_${storeId}`;
    if (req.method === 'GET') return res.json({ goal: (await kvGet(key)) || 0 });
    if (req.method === 'POST') {
      const g = Math.max(0, Math.min(999, parseInt((req.body || {}).goal, 10) || 0));
      await kvSet(key, g);
      return res.json({ success: true, goal: g });
    }
  }

  // ── 月次レポート：対策前(baseline)スナップショット。先方報告で「対策前→現在」を出すため記憶する ──
  if (action === 'meo-baseline') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `meo_baseline_${storeId}`;
    if (req.method === 'GET') return res.json({ baseline: (await kvGet(key)) || null });
    if (req.method === 'POST') {
      const b = req.body || {};
      const num = v => (v == null || v === '' || isNaN(+v)) ? null : +v;
      const baseline = {
        capturedAt: new Date().toISOString(),
        month: String(b.month || '').slice(0, 7),
        avgRank: num(b.avgRank), top3: Number(b.top3) || 0, top10: Number(b.top10) || 0, out: Number(b.out) || 0, measured: Number(b.measured) || 0,
        reviewCount: num(b.reviewCount), rating: num(b.rating),
        insights: (b.insights && typeof b.insights === 'object') ? { impressions: Number(b.insights.impressions) || 0, calls: Number(b.insights.calls) || 0, directionRequests: Number(b.insights.directionRequests) || 0, websiteClicks: Number(b.insights.websiteClicks) || 0 } : null,
        ranksByKw: (b.ranksByKw && typeof b.ranksByKw === 'object') ? Object.fromEntries(Object.entries(b.ranksByKw).slice(0, 60).map(([k, v]) => [String(k).slice(0, 80), num(v)])) : {},
        note: String(b.note || '').slice(0, 500),
      };
      await kvSet(key, baseline);
      return res.json({ success: true, baseline });
    }
  }

  // ── AIコンサル結果の保存（グレード推移履歴・使い捨て解消）。同日実行は上書き・最大24件 ──
  if (action === 'consul-log') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `consul_log_${storeId}`;
    if (req.method === 'GET') return res.json({ logs: (await kvGet(key)) || [] });
    if (req.method === 'POST') {
      const b = req.body || {};
      const entry = {
        date: String(b.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10),
        score: Number(b.score) || 0,
        grade: String(b.grade || '').slice(0, 2),
        tasks: Array.isArray(b.tasks) ? b.tasks.slice(0, 6).map(t => String(t).slice(0, 120)) : [],
      };
      let logs = (await kvGet(key)) || [];
      logs = logs.filter(l => l.date !== entry.date); // 同日再実行は上書き
      logs.push(entry);
      logs.sort((a, b2) => String(a.date).localeCompare(String(b2.date)));
      if (logs.length > 24) logs = logs.slice(-24);
      await kvSet(key, logs);
      return res.json({ success: true, logs });
    }
  }

  // ── AIO診断スコアの履歴（URL別・前回比表示用）。診断の使い捨てを解消 ──
  if (action === 'aio-log') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `aio_log_${storeId}`;
    if (req.method === 'GET') return res.json({ logs: (await kvGet(key)) || [] });
    if (req.method === 'POST') {
      const b = req.body || {};
      const entry = { date: new Date().toISOString().slice(0, 10), url: String(b.url || '').slice(0, 300), score: Math.max(0, Math.min(100, parseInt(b.score, 10) || 0)) };
      let logs = (await kvGet(key)) || [];
      logs.push(entry);
      if (logs.length > 24) logs = logs.slice(-24);
      await kvSet(key, logs);
      return res.json({ success: true });
    }
  }

  // ── AIコンサル週次タスクの完了チェック（端末をまたいで共有。週キーで自動リセット） ──
  if (action === 'consul-done') {
    const { storeId, week } = req.query;
    if (!storeId || !week) return res.status(400).json({ error: 'storeId,week必須' });
    const key = `consul_done_${storeId}_${String(week).slice(0, 10)}`;
    if (req.method === 'GET') return res.json({ done: (await kvGet(key)) || [] });
    if (req.method === 'POST') {
      const arr = Array.isArray((req.body || {}).done) ? req.body.done.slice(0, 10).map(n => parseInt(n, 10)).filter(Number.isFinite) : [];
      await kvSet(key, arr);
      return res.json({ success: true });
    }
  }

  // ── 口コミ分析(AI)の結果保存（使い捨て解消：次回表示時に前回の分析を出す） ──
  if (action === 'review-analysis') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `review_analysis_${storeId}`;
    if (req.method === 'GET') return res.json({ saved: (await kvGet(key)) || null });
    if (req.method === 'POST') {
      const text = String((req.body || {}).text || '').slice(0, 6000);
      await kvSet(key, { date: new Date().toISOString(), text });
      return res.json({ success: true });
    }
  }

  // ── 月次レポート：来月の施策計画（月ごと・編集可）。先方に「次に何をするか」を示す ──
  if (action === 'meo-report-plan') {
    const { storeId, month } = req.query;
    if (!storeId || !month) return res.status(400).json({ error: 'storeId,month必須' });
    const key = `meo_plan_${storeId}_${month}`;
    if (req.method === 'GET') return res.json({ plan: (await kvGet(key)) || '' });
    if (req.method === 'POST') {
      const plan = String((req.body || {}).plan || '').slice(0, 4000);
      await kvSet(key, plan);
      return res.json({ success: true });
    }
  }

  // ── HP(WordPress)連携：接続情報の保存／接続テスト／記事の投稿 ──
  // アプリケーションパスワードはサーバ側KV(wp_conn_${storeId})に保管。公開は承認制のため既定は下書き(draft)。
  if (action === 'wp-conn') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `wp_conn_${storeId}`;
    if (req.method === 'GET') {
      const c = (await kvGet(key)) || {};
      // アプリパスワードは返さない（設定済みか否か＋URL/ユーザー名だけ返す）
      return res.json({ connected: !!(c.siteUrl && c.appPassword), siteUrl: c.siteUrl || '', username: c.username || '' });
    }
    if (req.method === 'POST') {
      const b = req.body || {};
      const existing = (await kvGet(key)) || {};
      let siteUrl = String(b.siteUrl || '').trim().replace(/\s+/g, '').replace(/\/+$/, '');
      if (siteUrl && !/^https?:\/\//i.test(siteUrl)) siteUrl = 'https://' + siteUrl;
      let appPassword = String(b.appPassword || '').replace(/\s+/g, ''); // WordのアプリPWは空白区切り表示→詰める
      if (!appPassword && existing.appPassword) appPassword = existing.appPassword; // 空欄なら既存PWを維持（URL/ユーザー名だけ更新可）
      const conn = { siteUrl, username: String(b.username || '').trim(), appPassword };
      if (!conn.siteUrl || !conn.username || !conn.appPassword) return res.status(400).json({ error: 'サイトURL・ユーザー名・アプリケーションパスワードは必須です' });
      await kvSet(key, conn);
      return res.json({ success: true });
    }
    if (req.method === 'DELETE') { await kvDel(key); return res.json({ success: true }); }
    return res.status(405).json({ error: 'method' });
  }

  // 接続テスト（/wp-json/wp/v2/users/me を叩いて認証と権限を確認）
  if (action === 'wp-test') {
    const c = await kvGet(`wp_conn_${req.query.storeId}`);
    if (!c || !c.siteUrl) return res.status(400).json({ error: 'HP連携が未設定です' });
    try {
      const auth = Buffer.from(`${c.username}:${c.appPassword}`).toString('base64');
      const r = await fetch(`${c.siteUrl}/wp-json/wp/v2/users/me?context=edit`, { headers: { Authorization: `Basic ${auth}` } });
      const t = await r.text();
      if (!r.ok) return res.json({ ok: false, status: r.status, error: r.status === 401 ? 'ユーザー名またはアプリケーションパスワードが違います' : `接続失敗(${r.status})` });
      let u = {}; try { u = JSON.parse(t); } catch {}
      const caps = u.capabilities || {};
      // WPのcapabilitiesは付与された権限のみ列挙（Contributor等はpublish_posts自体が無い）→ true明示のときだけ公開可
      return res.json({ ok: true, name: u.name || u.slug || '', canPublish: caps.publish_posts === true });
    } catch (e) {
      return res.json({ ok: false, error: 'サイトに接続できません（URLとREST API有効化をご確認ください）' });
    }
  }

  // 記事投稿（既定=下書き。status=publish のときのみ公開＝承認制で明示指定）
  if (action === 'wp-publish' && req.method === 'POST') {
    const c = await kvGet(`wp_conn_${req.query.storeId}`);
    if (!c || !c.siteUrl) return res.status(400).json({ error: 'HP連携が未設定です' });
    const b = req.body || {};
    const title = String(b.title || '').trim();
    const content = String(b.content || '').trim();
    if (!title || !content) return res.status(400).json({ error: 'タイトルと本文が必要です' });
    const status = b.status === 'publish' ? 'publish' : 'draft';
    // メタ説明はexcerptに格納（多くのテーマ/SEOプラグインが説明文として利用）。スラッグ/カテゴリ/アイキャッチも任意で反映。
    const payload = { title, content, status };
    if (b.excerpt) payload.excerpt = String(b.excerpt).slice(0, 300);
    if (b.slug) payload.slug = String(b.slug).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80);
    if (Array.isArray(b.categories) && b.categories.length) payload.categories = b.categories.map(Number).filter(Boolean);
    if (b.featuredMediaId) { const fm = Number(b.featuredMediaId); if (fm) payload.featured_media = fm; }
    try {
      const auth = Buffer.from(`${c.username}:${c.appPassword}`).toString('base64');
      const r = await fetch(`${c.siteUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const t = await r.text();
      let d = {}; try { d = JSON.parse(t); } catch {}
      if (!r.ok) return res.status(r.status).json({ error: d.message || `投稿失敗(${r.status})` });
      // 投稿履歴を保存（言いっぱなし解消：HP SEOページに一覧表示。最大30件）
      try {
        const hk = `wp_history_${req.query.storeId}`;
        let hist = (await kvGet(hk)) || [];
        hist.unshift({ date: new Date().toISOString(), id: d.id, title: title.slice(0, 80), link: d.link || '', status: d.status });
        if (hist.length > 30) hist = hist.slice(0, 30);
        await kvSet(hk, hist);
      } catch (e) { /* 履歴保存失敗は投稿成功に影響させない */ }
      return res.json({ success: true, id: d.id, link: d.link, status: d.status, editLink: `${c.siteUrl}/wp-admin/post.php?post=${d.id}&action=edit` });
    } catch (e) {
      return res.status(502).json({ error: 'HP投稿に失敗しました: ' + e.message });
    }
  }

  // HP投稿履歴の取得（wp-publishが保存した一覧）
  if (action === 'wp-history' && req.method === 'GET') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    return res.json({ history: (await kvGet(`wp_history_${storeId}`)) || [] });
  }

  // ── サイテーション掲載URLのNAP突合チェック（無料・素のfetchで電話/店名の実掲載を判定） ──
  // クライアントが5件ずつ分割して呼ぶ前提（Vercel 10s制限対策）。1リクエストあたり最大6件を並列fetch(各3秒timeout)。
  if (req.method === 'POST' && action === 'citation-verify') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const cit = (await kvGet(`citation_${storeId}`)) || {};
    const nap = cit.nap || {};
    const phoneDigits = String(nap.phone || '').replace(/\D/g, '');
    const nameNorm = String(nap.name || '').replace(/\s+/g, '');
    if (!phoneDigits && !nameNorm) return res.status(400).json({ error: 'NAP情報（店舗名・電話番号）を先に保存してください' });
    const wanted = Array.isArray((req.body || {}).siteIds) ? req.body.siteIds : null;
    const targets = (cit.sites || [])
      .filter(s => s.listingUrl && /^https?:\/\//i.test(String(s.listingUrl)))
      .filter(s => !wanted || wanted.includes(s.id))
      .slice(0, 6);
    // 電話は「数字の間に区切り記号を許す」正規表現で照合（03-1234-5678 / 0312345678 / (03)1234 5678 すべて拾う）
    const phoneRe = phoneDigits ? new RegExp(phoneDigits.split('').join('[-‐－ー()（）\\s.]{0,2}')) : null;
    const results = await Promise.all(targets.map(async (s) => {
      try {
        const ctl = new AbortController();
        const tm = setTimeout(() => ctl.abort(), 3000);
        const r = await fetch(s.listingUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rakuraku-meo/1.0)' }, signal: ctl.signal, redirect: 'follow' });
        clearTimeout(tm);
        if (!r.ok) return { siteId: s.id, status: 'unreachable' };
        const html = String(await r.text()).slice(0, 900000);
        const phoneOk = !phoneRe || phoneRe.test(html);
        const nameOk = !nameNorm || html.replace(/\s+/g, '').includes(nameNorm);
        if (phoneOk && nameOk) return { siteId: s.id, status: 'ok' };
        // 両方とも見つからない＝JS描画/bot遮断の可能性が高い→不一致と断定せず手動確認へ
        if (!phoneOk && !nameOk) return { siteId: s.id, status: 'unreachable' };
        return { siteId: s.id, status: phoneOk ? 'name_missing' : 'phone_mismatch' };
      } catch (e) { return { siteId: s.id, status: 'unreachable' }; }
    }));
    return res.json({ results });
  }

  // WPのカテゴリ一覧（アイキャッチ/カテゴリ指定用）
  if (action === 'wp-terms') {
    const c = await kvGet(`wp_conn_${req.query.storeId}`);
    if (!c || !c.siteUrl) return res.status(400).json({ error: 'HP連携が未設定です' });
    try {
      const auth = Buffer.from(`${c.username}:${c.appPassword}`).toString('base64');
      const r = await fetch(`${c.siteUrl}/wp-json/wp/v2/categories?per_page=100&orderby=count&order=desc`, { headers: { Authorization: `Basic ${auth}` } });
      const t = await r.text(); let d = []; try { d = JSON.parse(t); } catch {}
      if (!r.ok) return res.status(r.status).json({ error: 'カテゴリの取得に失敗しました' });
      const categories = (Array.isArray(d) ? d : []).map(x => ({ id: x.id, name: x.name, count: x.count })).filter(x => x.id);
      return res.json({ categories });
    } catch (e) { return res.status(502).json({ error: 'カテゴリの取得に失敗しました' }); }
  }

  // 画像URLをWPメディアにアップロード→アイキャッチ用のmedia IDを返す
  if (action === 'wp-upload-media' && req.method === 'POST') {
    const c = await kvGet(`wp_conn_${req.query.storeId}`);
    if (!c || !c.siteUrl) return res.status(400).json({ error: 'HP連携が未設定です' });
    const url = String((req.body || {}).imageUrl || '').trim();
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: '画像URLが不正です' });
    try {
      const img = await fetch(url);
      if (!img.ok) return res.status(400).json({ error: '画像の取得に失敗しました' });
      const buf = Buffer.from(await img.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: '画像が大きすぎます（8MBまで）' });
      const ct = img.headers.get('content-type') || 'image/jpeg';
      const ext = ct.includes('png') ? 'png' : ct.includes('webp') ? 'webp' : 'jpg';
      const auth = Buffer.from(`${c.username}:${c.appPassword}`).toString('base64');
      const r = await fetch(`${c.siteUrl}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': ct, 'Content-Disposition': `attachment; filename="featured-${new Date().getTime()}.${ext}"` },
        body: buf,
      });
      const t = await r.text(); let d = {}; try { d = JSON.parse(t); } catch {}
      if (!r.ok) return res.status(r.status).json({ error: d.message || 'アイキャッチのアップロードに失敗しました' });
      return res.json({ id: d.id, url: d.source_url });
    } catch (e) { return res.status(502).json({ error: 'アイキャッチのアップロードに失敗しました: ' + e.message }); }
  }

  // ── ジオコーディング（無料・Nominatim）：地名→座標＋候補。任意地点での順位計測に使う ──
  if (action === 'geocode') {
    const cands = await geocodeCandidates(req.query.q, 5);
    if (!cands.length) return res.status(404).json({ error: '地点が見つかりませんでした。別の言い方（例：新宿駅／渋谷区道玄坂／市区名）でお試しください', candidates: [] });
    return res.json({ ...cands[0], candidates: cands });
  }

  // ── 順位計測の基準地点（店舗ごと）。未設定なら店舗のGBP座標を使う（フロントで判定） ──
  if (action === 'rank-point') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const key = `rank_point_${storeId}`;
    if (req.method === 'GET') return res.json({ point: (await kvGet(key)) || null });
    if (req.method === 'POST') {
      const b = req.body || {};
      const lat = Number(b.lat), lng = Number(b.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: '座標が不正です' });
      await kvSet(key, { lat, lng, label: String(b.label || '').slice(0, 120) });
      return res.json({ success: true, point: { lat, lng, label: String(b.label || '').slice(0, 120) } });
    }
    if (req.method === 'DELETE') { await kvDel(key); return res.json({ success: true }); }
    return res.status(405).json({ error: 'method' });
  }

  // ── 簡易ジオグリッド：指定した地点ごとに順位を計測（自店の"場所による見え方"）──
  // 各地点＝SerpApi 1回。枠ガード必須（上限到達で停止）。自動では回さない（フロントの手動実行のみ）。
  // 地点は地名(新宿駅・相模原市中央区 等)でOK＝内部でジオコーディングし"その座標"から計測（google_maps）。
  if (req.method === 'GET' && action === 'geo-rank') {
    const { keyword, store, storeId } = req.query;
    const areas = String(req.query.areas || '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 9);
    if (!keyword || !store || !areas.length) return res.status(400).json({ error: 'keyword・store・areas必須' });
    const provider = (process.env.RANK_PROVIDER || 'serpapi').toLowerCase();
    const useSerp = !(provider === 'dataforseo' && (process.env.DATAFORSEO_B64 || process.env.DATAFORSEO_LOGIN));
    const ym = new Date().toISOString().slice(0, 7);
    const usedKey = `serpapi_usage_${ym}`;
    let used = await kvGet(usedKey) || 0;
    if (useSerp && (SERPAPI_LIMIT - used) < areas.length) {
      return res.status(429).json({ error: `残り枠が不足しています（残り${Math.max(0, SERPAPI_LIMIT - used)}回／必要${areas.length}回）。来月リセットされます`, overLimit: true, remaining: Math.max(0, SERPAPI_LIMIT - used), need: areas.length });
    }
    const target = _normName(store);
    const results = [];
    for (const area of areas) {
      // 途中でも上限に達したら停止（再試行で1件2回呼ぶ場合があるため事前チェックだけに頼らない＝枠突入を防ぐ）
      if (useSerp && used >= SERPAPI_LIMIT) { results.push({ area, rank: null, error: '取得枠に達したため中断' }); continue; }
      try {
        // 地名を座標化して"その地点"から計測（google_maps）。座標化できなければ従来の地点文字列でフォールバック
        const geo = await geocodeQuery(area);
        const opts = geo ? { ll: `${geo.lat},${geo.lng},14z` } : { location: area };
        const { list, error, calls } = await fetchLocalResults(keyword, opts);
        if (useSerp && calls) { used = await kvIncrBy(usedKey, calls); } // アトミック加算（エラー時も消費分を計上・戻り値=真の合計で枠ガードが正確に）
        if (error) { results.push({ area, rank: null, error, point: geo ? { lat: geo.lat, lng: geo.lng } : null }); continue; }
        let rank = null;
        (list || []).forEach((item, i) => {
          if (rank) return;
          const t = _normName(item.title);
          if (t && (t.includes(target) || target.includes(t))) rank = item.position || (i + 1);
        });
        results.push({ area, rank, point: geo ? { lat: geo.lat, lng: geo.lng } : null, byCoord: !!geo });
      } catch (e) { results.push({ area, rank: null, error: e.message }); }
    }
    // 履歴に保存＋同一KWの前回結果を返す（エリア別の前回比表示用）。storeId無しは保存スキップ
    let prev = null;
    if (storeId) {
      try {
        const histKey = `geo_history_${storeId}`;
        let gh = (await kvGet(histKey)) || [];
        const sameKw = gh.filter(h => h.keyword === keyword);
        prev = sameKw.length ? sameKw[sameKw.length - 1] : null;
        gh.push({ date: new Date().toISOString().slice(0, 10), keyword, results: results.map(r => ({ area: r.area, rank: r.rank })) });
        if (gh.length > 12) gh = gh.slice(-12);
        await kvSet(histKey, gh);
      } catch (e) { /* 履歴保存失敗は結果返却を妨げない */ }
    }
    return res.json({ keyword, results, prev, used, limit: SERPAPI_LIMIT, remaining: Math.max(0, SERPAPI_LIMIT - used) });
  }

  // ── ダッシュボード全社集計（順位ロールアップ＋口コミ獲得KPI合計＋店舗別サマリー） ──
  // 競合ぐるっとMEOのダッシュボード相当。managed_locations＋手動store を横断集計。既存データのみ使用。
  if (req.method === 'GET' && action === 'dashboard') {
    const ym = new Date().toISOString().slice(0, 7);
    const managed = await kvGet('managed_locations') || [];
    const manual = await kvGet('admin_stores') || [];
    // 集計対象の店舗リスト（managed GBP ＋ 手動登録）。storeIdはrankings/kpiのキーに合わせる。
    const stores = [];
    const seen = new Set();
    for (const m of managed) {
      const sid = String(m.locId || '').replace(/\//g, '_');
      if (!sid || seen.has(sid)) continue; seen.add(sid);
      stores.push({ storeId: sid, name: m.title || '店舗', company: m.company || m.title || m.clientName || '未分類' });
    }
    for (const s of manual) {
      const sid = s.storeId;
      if (!sid || seen.has(sid)) continue; seen.add(sid);
      stores.push({ storeId: sid, name: s.storeName || '店舗', company: s.storeName || '手動登録' });
    }

    let totalKw = 0, top3 = 0, top10 = 0, outRange = 0, upCount = 0, downCount = 0, filled = 0;
    const kpiSum = { scan: 0, survey: 0, ai: 0, click: 0, line: 0, mail: 0 };
    const kpiPrevSum = { scan: 0, survey: 0, ai: 0, click: 0, line: 0, mail: 0 };
    const perStore = [];
    const clients = new Set();

    // 店舗ごとのKV読み(rankings/kpi/leads)を並列化（直列N+1→並列でダッシュボード高速化）。集約は結果順で行い出力shapeは不変
    const prevYm = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7);
    const _storeResults = await Promise.all(stores.map(async (st) => {
      const rk = await kvGet(`rankings_${st.storeId}`) || { history: [], keywords: [] };
      const kws = (rk.keywords || []).filter(Boolean);
      const hist = rk.history || [];
      const last = hist[hist.length - 1] || null;
      const ranksArr = last ? (last.rankings || []) : [];
      let s3 = 0, s10 = 0, sOut = 0, sum = 0, cnt = 0;
      kws.forEach((_, i) => {
        const r = parseInt(ranksArr[i], 10);
        if (Number.isFinite(r) && r >= 1) {
          if (r <= 3) s3++;
          if (r <= 10) s10++;
          if (r > 20) sOut++;
          sum += r; cnt++;
        } else if (last) { sOut++; }
      });
      const avg = cnt ? Math.round((sum / cnt) * 10) / 10 : null;
      const monthLast = (m) => { const hs = hist.filter(h => (h.date || '').slice(0, 7) === m); return hs[hs.length - 1] || null; };
      const avgOf = (entry) => { if (!entry) return null; const rs = (entry.rankings || []).map(x => parseInt(x, 10)).filter(x => Number.isFinite(x) && x >= 1); return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null; };
      const curAvg = avgOf(monthLast(ym)), prevAvg = avgOf(monthLast(prevYm));
      const mom = (curAvg != null && prevAvg != null) ? Math.round((prevAvg - curAvg) * 10) / 10 : null;
      const inputThisMonth = hist.some(h => (h.date || '').slice(0, 7) === ym);
      let status = 'KW未登録';
      if (kws.length > 0) status = hist.length === 0 ? 'データなし' : (inputThisMonth ? '入力済み' : '未入力');
      const kpi = await kvGet(`kpi_${st.storeId}_${ym}`) || {};
      const kpiPrev = await kvGet(`kpi_${st.storeId}_${prevYm}`) || {};
      const leads = await kvGet(`leads_${st.storeId}`) || [];
      const mailCount = leads.filter(l => String(l.at || '').slice(0, 7) === ym).length;
      const mailPrev = leads.filter(l => String(l.at || '').slice(0, 7) === prevYm).length;
      return { st, kwCount: kws.length, s3, s10, sOut, avg, mom, inputThisMonth, status, kpi, kpiPrev, mailCount, mailPrev, lastInput: last ? last.date : null };
    }));
    for (const r of _storeResults) {
      clients.add(r.st.company);
      totalKw += r.kwCount; top3 += r.s3; top10 += r.s10; outRange += r.sOut;
      if (r.mom != null) { if (r.mom > 0) upCount++; else if (r.mom < 0) downCount++; }
      if (r.inputThisMonth) filled++;
      kpiSum.scan += r.kpi.scan || 0; kpiSum.survey += r.kpi.survey || 0; kpiSum.ai += r.kpi.ai || 0;
      kpiSum.click += r.kpi.click || 0; kpiSum.line += r.kpi.line || 0;
      kpiSum.mail += r.mailCount;
      kpiPrevSum.scan += r.kpiPrev.scan || 0; kpiPrevSum.survey += r.kpiPrev.survey || 0; kpiPrevSum.ai += r.kpiPrev.ai || 0;
      kpiPrevSum.click += r.kpiPrev.click || 0; kpiPrevSum.line += r.kpiPrev.line || 0;
      kpiPrevSum.mail += r.mailPrev;
      perStore.push({
        storeId: r.st.storeId, name: r.st.name, company: r.st.company, status: r.status,
        kwCount: r.kwCount, top3: r.s3, top10: r.s10, out: r.sOut, avgRank: r.avg,
        mom: r.mom, lastInput: r.lastInput,
      });
    }

    return res.json({
      month: ym,
      totals: {
        clients: clients.size, stores: stores.length, keywords: totalKw,
        top3, top10, outRange, upCount, downCount,
        filled, unfilled: stores.length - filled,
        top3Pct: totalKw ? Math.round((top3 / totalKw) * 100) : 0,
        top10Pct: totalKw ? Math.round((top10 / totalKw) * 100) : 0,
      },
      kpi: kpiSum,
      kpiPrev: kpiPrevSum,
      perStore,
    });
  }

  // ── 順位取得 ──
  if (req.method === 'GET' && action === 'rankings') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const data = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    return res.json(data);
  }

  // ── 順位保存 ──
  if (req.method === 'POST' && action === 'rankings') {
    const { keywords, rankings, date } = req.body;
    const storeId = req.query.storeId || req.body.storeId; // クエリ・body両対応
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const existing = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    // 計測日は指定があればそれを使う（一括順位入力）。無ければ本日。
    const useDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : new Date().toISOString().split('T')[0];
    const entry = { date: useDate, rankings, recordedAt: new Date().toISOString() };
    const idx = existing.history.findIndex(h => h.date === entry.date);
    if (idx >= 0) existing.history[idx] = entry;
    else existing.history.push(entry);
    existing.history.sort((a, b) => String(a.date).localeCompare(String(b.date))); // 日付昇順（過去日入力に対応）
    if (existing.history.length > 60) existing.history = existing.history.slice(-60);
    if (Array.isArray(keywords)) existing.keywords = keywords;
    await kvSet(`rankings_${storeId}`, existing);
    return res.json({ success: true });
  }

  // ── キーワード追加（メタ付き：計測地域/分類/優先度/メモ/有効） ──
  // 対策キーワードのメタは rankings_ オブジェクト内 meta{ keyword: {...} } に保持。
  // 順位履歴(history[].rankings[]) は keywords[] に index対応するモデルを維持する。
  if (req.method === 'POST' && action === 'kw-add') {
    const storeId = req.query.storeId || req.body.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const { keyword, area, category, priority, memo, enabled } = req.body;
    const kw = String(keyword || '').trim();
    if (!kw) return res.status(400).json({ error: 'keyword必須' });
    const ex = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    ex.keywords = ex.keywords || []; ex.meta = ex.meta || {};
    const exists = ex.keywords.includes(kw);
    if (!exists) ex.keywords.push(kw);
    // 既存キーワードの場合は手動設定(area/category/priority/memo/enabled)を勝手に潰さない
    if (!exists || !ex.meta[kw]) {
      ex.meta[kw] = { area: area || '', category: category || '', priority: priority || '', memo: memo || '', enabled: enabled !== false };
    }
    await kvSet(`rankings_${storeId}`, ex);
    return res.json({ success: true, duplicated: exists });
  }

  // ── キーワード編集（改名しても同indexを保持し順位履歴の整合を維持） ──
  if (req.method === 'POST' && action === 'kw-edit') {
    const storeId = req.query.storeId || req.body.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const { oldKeyword, keyword, area, category, priority, memo, enabled } = req.body;
    const oldk = String(oldKeyword || '').trim(), newk = String(keyword || '').trim();
    if (!newk) return res.status(400).json({ error: 'keyword必須' });
    const ex = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    ex.keywords = ex.keywords || []; ex.meta = ex.meta || {};
    // 別indexに既存の名前へ改名するとkeywordsが重複しindex対応が崩れる→拒否
    if (newk !== oldk && ex.keywords.some((k, ix) => k === newk && ix !== ex.keywords.indexOf(oldk))) {
      return res.status(409).json({ error: 'そのキーワードは既に登録されています' });
    }
    const i = ex.keywords.indexOf(oldk);
    if (i >= 0) ex.keywords[i] = newk;
    else if (!ex.keywords.includes(newk)) ex.keywords.push(newk);
    if (oldk && oldk !== newk && ex.meta[oldk]) delete ex.meta[oldk];
    ex.meta[newk] = { area: area || '', category: category || '', priority: priority || '', memo: memo || '', enabled: enabled !== false };
    await kvSet(`rankings_${storeId}`, ex);
    return res.json({ success: true });
  }

  // ── キーワード削除（keywords＋全履歴の同indexを除去して整合を保つ） ──
  if (req.method === 'POST' && action === 'kw-del') {
    const storeId = req.query.storeId || req.body.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const kw = String(req.body.keyword || '').trim();
    const ex = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    const i = (ex.keywords || []).indexOf(kw);
    if (i >= 0) {
      ex.keywords.splice(i, 1);
      (ex.history || []).forEach(h => { if (Array.isArray(h.rankings)) h.rankings.splice(i, 1); });
    }
    if (ex.meta && ex.meta[kw]) delete ex.meta[kw];
    await kvSet(`rankings_${storeId}`, ex);
    return res.json({ success: true });
  }

  // ══ Notion連携（登録店舗・企業ナレッジをNotionデータベースに反映） ══
  // 設定はenv(NOTION_TOKEN/NOTION_DB_ID)優先、無ければKV(notion_config)。トークンは秘匿のため返さない。
  const notionCfg = async () => {
    const kv = await kvGet('notion_config') || {};
    return { token: process.env.NOTION_TOKEN || kv.token || '', dbId: process.env.NOTION_DB_ID || kv.dbId || '' };
  };
  if (action === 'notion-config') {
    if (req.method === 'GET') {
      const c = await notionCfg();
      return res.json({ configured: !!(c.token && c.dbId), hasToken: !!c.token, hasDb: !!c.dbId, envManaged: !!(process.env.NOTION_TOKEN) });
    }
    if (req.method === 'POST') {
      if (process.env.NOTION_TOKEN) return res.status(400).json({ error: 'Notion設定はVercel環境変数で管理されています（画面からの変更は不可）' });
      const { token, dbId } = req.body || {};
      const cur = await kvGet('notion_config') || {};
      const next = { token: (token || '').trim() || cur.token || '', dbId: (dbId || '').trim() || cur.dbId || '' };
      if (!next.token || !next.dbId) return res.status(400).json({ error: 'Integrationトークンとデータベースidの両方が必要です' });
      await kvSet('notion_config', next);
      return res.json({ success: true, configured: true });
    }
  }
  if (req.method === 'POST' && action === 'notion-sync') {
    const c = await notionCfg();
    if (!c.token || !c.dbId) return res.status(400).json({ error: 'Notionが未設定です（設定でIntegrationトークンとデータベースidを保存してください）', notConfigured: true });
    const storeId = req.query.storeId || req.body.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const k = await kvGet(`knowledge_${storeId}`) || {};
    const rk = await kvGet(`rankings_${storeId}`) || {};
    const kws = (rk.keywords || []).filter(Boolean);
    const name = k.storeName || req.body.storeName || '店舗';
    const NHEAD = { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', 'Notion-Version': '2022-06-28' };
    const rt = (t) => [{ type: 'text', text: { content: String(t || '').slice(0, 1900) } }];
    const para = (label, val) => val ? ({ object: 'block', type: 'paragraph', paragraph: { rich_text: rt(`${label}：${val}`) } }) : null;
    const children = [
      para('業種', k.category), para('住所', [k.postalCode, k.address].filter(Boolean).join(' ')),
      para('電話', k.phone), para('営業時間', k.businessHours), para('定休日', k.closedDays),
      para('対策キーワード', kws.join('、')), para('強み・特徴', k.strengths),
      para('専門性・実績(E-E-A-T)', k.expertise), para('サービス・メニュー', k.services),
      para('対応エリア', k.serviceArea), para('ターゲット', k.targetCustomer),
      para('WebサイトURL', k.website), para('storeId', storeId),
    ].filter(Boolean);
    try {
      // upsert: KVに保存したページIDがあれば旧ページをアーカイブして作り直す（内容を最新に）
      const prevId = (await kvGet(`notion_page_${storeId}`)) || null;
      if (prevId) { try { await fetch(`https://api.notion.com/v1/pages/${prevId}`, { method: 'PATCH', headers: NHEAD, body: JSON.stringify({ archived: true }) }); } catch (e) {} }
      const body = { parent: { database_id: c.dbId }, properties: { title: { title: rt(name) } }, children };
      const r = await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers: NHEAD, body: JSON.stringify(body) });
      const d = await r.json();
      if (d.object === 'error') return res.status(400).json({ error: 'Notion: ' + (d.message || 'エラー') + '（データベースにタイトル列があり、Integrationがそのdbに共有(接続)されているか確認してください）' });
      if (d.id) await kvSet(`notion_page_${storeId}`, d.id);
      return res.json({ success: true, url: d.url || '', pageId: d.id || '' });
    } catch (e) {
      return res.status(500).json({ error: 'Notion同期に失敗: ' + e.message });
    }
  }

  // ── 単一キーワードの順位入力（その日付エントリの該当indexだけ更新） ──
  if (req.method === 'POST' && action === 'rank-input') {
    const storeId = req.query.storeId || req.body.storeId;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const { keyword, date, rank } = req.body;
    const kw = String(keyword || '').trim();
    if (!kw) return res.status(400).json({ error: 'keyword必須' });
    const ex = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    ex.keywords = ex.keywords || [];
    let i = ex.keywords.indexOf(kw);
    if (i < 0) { ex.keywords.push(kw); i = ex.keywords.length - 1; }
    const useDate = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : new Date().toISOString().split('T')[0];
    let entry = ex.history.find(h => h.date === useDate);
    if (!entry) { entry = { date: useDate, rankings: [], recordedAt: new Date().toISOString() }; ex.history.push(entry); }
    entry.rankings = entry.rankings || [];
    const v = parseInt(rank, 10);
    entry.rankings[i] = (Number.isFinite(v) && v >= 1) ? v : null; // 空欄/非数値＝圏外＝null
    entry.recordedAt = new Date().toISOString();
    ex.history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    if (ex.history.length > 60) ex.history = ex.history.slice(-60);
    await kvSet(`rankings_${storeId}`, ex);
    return res.json({ success: true });
  }

  // ── GBPカテゴリ検索（categoryId= "categories/gcid:xxx" を取得） ──
  if (req.method === 'GET' && action === 'gbp-categories') {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q必須（例: 中華料理）' });
    const token = await getMasterToken();
    if (!token) return res.status(401).json({ error: 'GBP未連携' });
    try {
      const params = new URLSearchParams({ regionCode: 'JP', languageCode: 'ja', view: 'BASIC', filter: `displayName=${q}`, pageSize: '20' });
      const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/categories?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.error) return res.status(502).json({ error: d.error.message || 'カテゴリ検索失敗', code: d.error.code });
      return res.json({ categories: (d.categories || []).map(c => ({ id: c.name, displayName: c.displayName })) });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── GBP現在の店舗情報を取得（カテゴリID付き。更新前の確認用） ──
  if (req.method === 'GET' && action === 'gbp-get') {
    const storeId = req.query.storeId;
    let locationName = req.query.locationName || '';
    let token = await getMasterToken();
    if (!locationName && storeId) {
      const managed = await kvGet('managed_locations') || [];
      const m = managed.find(x => String(x.locId || '').replace(/\//g, '_') === storeId || x.storeId === storeId);
      if (m) { locationName = m.locId || m.locationName || ''; if (m.storeId) token = (await getAccessToken(m.storeId)) || token; }
    }
    const locPart = String(locationName).match(/locations\/[^/]+/)?.[0];
    if (!locPart) return res.status(400).json({ error: 'locationName不明' });
    if (!token) return res.status(401).json({ error: 'GBP未連携' });
    try {
      const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${locPart}?readMask=title,categories,phoneNumbers,websiteUri,profile`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.error) return res.status(502).json({ error: d.error.message || 'GBP取得失敗', code: d.error.code });
      const pc = d.categories?.primaryCategory;
      const ac = d.categories?.additionalCategories || [];
      return res.json({ title: d.title, websiteUri: d.websiteUri || '', phone: d.phoneNumbers?.primaryPhone || '', hasDescription: !!(d.profile && d.profile.description),
        primary: pc ? { id: pc.name, displayName: pc.displayName } : null,
        additional: ac.map(c => ({ id: c.name, displayName: c.displayName })) });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── GBP店舗情報の更新（カテゴリ/説明/電話/URL）。社長承認の上で実行する対外アクション ──
  // body: { storeId?, locationName?, primaryCategoryId?, additionalCategoryIds?[], description?, phone?, websiteUri?, dryRun? }
  if (req.method === 'POST' && action === 'gbp-update') {
    const storeId = req.query.storeId || req.body.storeId;
    const b = req.body || {};
    let locationName = b.locationName || '';
    let token = await getMasterToken();
    if (!locationName && storeId) {
      const managed = await kvGet('managed_locations') || [];
      const m = managed.find(x => String(x.locId || '').replace(/\//g, '_') === storeId || x.storeId === storeId);
      if (m) { locationName = m.locId || m.locationName || ''; if (m.storeId) token = (await getAccessToken(m.storeId)) || token; }
    }
    const locPart = String(locationName).match(/locations\/[^/]+/)?.[0];
    if (!locPart) return res.status(400).json({ error: 'locationName不明（storeId か locationName を指定）' });
    if (!token) return res.status(401).json({ error: 'GBP未連携' });
    const bodyObj = {}; const masks = [];
    if (b.primaryCategoryId) {
      bodyObj.categories = { primaryCategory: { name: b.primaryCategoryId } };
      if (Array.isArray(b.additionalCategoryIds) && b.additionalCategoryIds.length) bodyObj.categories.additionalCategories = b.additionalCategoryIds.map(id => ({ name: id }));
      masks.push('categories');
    }
    if (typeof b.description === 'string') { bodyObj.profile = { description: b.description.slice(0, 750) }; masks.push('profile.description'); }
    if (typeof b.websiteUri === 'string') { bodyObj.websiteUri = b.websiteUri; masks.push('websiteUri'); }
    if (typeof b.phone === 'string') { bodyObj.phoneNumbers = { primaryPhone: b.phone }; masks.push('phoneNumbers.primaryPhone'); }
    // サービス（自由記述サービス項目）: services=["メニュー名",...] ＋ カテゴリ(primaryCategoryId か serviceCategoryId)
    if (Array.isArray(b.services) && b.services.length) {
      const cat = b.primaryCategoryId || b.serviceCategoryId;
      if (!cat) return res.status(400).json({ error: 'services にはカテゴリ(primaryCategoryId か serviceCategoryId)が必要です' });
      bodyObj.serviceItems = b.services.slice(0, 100).map(s => ({ freeFormServiceItem: { category: cat, label: { displayName: String(s).slice(0, 120), languageCode: 'ja' } } }));
      masks.push('serviceItems');
    }
    // 営業時間: hours=[{day:'MON'..'SUN'|英名, open:'11:00', close:'22:00'},...]（同日内・複数可＝昼夜別に2件）
    if (Array.isArray(b.hours) && b.hours.length) {
      const DAY = { MON: 'MONDAY', TUE: 'TUESDAY', WED: 'WEDNESDAY', THU: 'THURSDAY', FRI: 'FRIDAY', SAT: 'SATURDAY', SUN: 'SUNDAY' };
      const T = (s) => { const m = String(s).match(/(\d{1,2}):(\d{2})/); return m ? { hours: +m[1], minutes: +m[2] } : null; };
      const periods = [];
      for (const h of (b.hours || [])) {
        const d = DAY[String(h.day || '').slice(0, 3).toUpperCase()] || String(h.day || '').toUpperCase();
        const o = T(h.open), c = T(h.close);
        if (Object.values(DAY).includes(d) && o && c) periods.push({ openDay: d, openTime: o, closeDay: d, closeTime: c });
      }
      if (periods.length) { bodyObj.regularHours = { periods }; masks.push('regularHours'); }
    }
    if (!masks.length) return res.status(400).json({ error: '更新項目がありません' });
    if (b.dryRun) return res.json({ dryRun: true, locPart, updateMask: masks.join(','), body: bodyObj });
    try {
      const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${locPart}?updateMask=${encodeURIComponent(masks.join(','))}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(bodyObj),
      });
      const d = await r.json();
      if (d.error) return res.status(502).json({ error: d.error.message || 'GBP更新失敗', code: d.error.code, details: d.error.details });
      return res.json({ success: true, updated: masks, title: d.title, primaryCategory: d.categories?.primaryCategory?.displayName, description: d.profile?.description });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── GBP属性: カテゴリで利用可能な属性を一覧（id/表示名/型） ──
  if (req.method === 'GET' && action === 'gbp-attributes-list') {
    const token = await getMasterToken();
    if (!token) return res.status(401).json({ error: 'GBP未連携' });
    let categoryName = req.query.categoryName || '';
    if (!categoryName && req.query.storeId) {
      const l = ((await kvGet('managed_locations')) || []).find(x => String(x.locId || '').replace(/\//g, '_') === req.query.storeId);
      // カテゴリは _locations 側にあるためstoreIdからは取得できない場合がある。categoryName直指定を推奨。
    }
    if (!categoryName) return res.status(400).json({ error: 'categoryName必須（例: categories/gcid:cafe）' });
    try {
      const p = new URLSearchParams({ categoryName, regionCode: 'JP', languageCode: 'ja', showAll: 'false' });
      const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/attributes?${p.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      const d = await r.json();
      if (d.error) return res.status(502).json({ error: d.error.message, code: d.error.code });
      const list = (d.attributeMetadata || []).filter(a => !a.deprecated).map(a => ({ id: a.parent, name: a.displayName, type: a.valueType, group: a.groupDisplayName || '' }));
      return res.json({ attributes: list });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  // ── GBP属性の設定（BOOL属性を中心に。body.attributes=[{id:"attributes/xxx", bool:true}] or {id, enums:[...]}） ──
  if (req.method === 'POST' && action === 'gbp-attributes-set') {
    const storeId = req.query.storeId || req.body.storeId;
    const b = req.body || {};
    let locationName = b.locationName || '';
    let token = await getMasterToken();
    if (!locationName && storeId) {
      const m = ((await kvGet('managed_locations')) || []).find(x => String(x.locId || '').replace(/\//g, '_') === storeId || x.storeId === storeId);
      if (m) { locationName = m.locId || m.locationName || ''; if (m.storeId) token = (await getAccessToken(m.storeId)) || token; }
    }
    const locPart = String(locationName).match(/locations\/[^/]+/)?.[0];
    if (!locPart) return res.status(400).json({ error: 'locationName不明' });
    if (!token) return res.status(401).json({ error: 'GBP未連携' });
    const attrs = (b.attributes || []).map(a => {
      const o = { name: a.id };
      if (Array.isArray(a.enums)) o.repeatedEnumValue = { setValues: a.enums };
      else o.values = [a.bool !== false];
      return o;
    });
    if (!attrs.length) return res.status(400).json({ error: 'attributes必須' });
    if (b.dryRun) return res.json({ dryRun: true, locPart, body: { name: `${locPart}/attributes`, attributes: attrs } });
    try {
      const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${locPart}/attributes?updateMask=${encodeURIComponent(attrs.map(a => a.name).join(','))}`, {
        method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${locPart}/attributes`, attributes: attrs }),
      });
      const d = await r.json();
      if (d.error) return res.status(502).json({ error: d.error.message, code: d.error.code });
      return res.json({ success: true, count: (d.attributes || []).length });
    } catch (e) { return res.status(500).json({ error: e.message }); }
  }

  return res.status(405).end();
}
