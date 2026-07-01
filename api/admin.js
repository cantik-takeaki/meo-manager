// api/admin.js — 店舗登録・順位入力（統合）
import { kvGet, kvSet, kvDel } from './_kv.js';

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
    completionMsg: '貴重なご意見をいただき、ありがとうございました。',
    lowMsg: '貴重なご意見をありがとうございます。いただいたお声は改善に活かします。差し支えなければ、もう少し詳しくお聞かせください。',
    goodPoints: ['スタッフが丁寧', '雰囲気が良い', 'また来たい', '説明が分かりやすい', '清潔感がある', '対応が早い', 'コスパが良い', 'おすすめしたい'],
    lowThreshold: 4,   // この評価未満は「店内フィードバック」へ分岐（4 = ★1〜3が分岐）
    gateMode: 'branch', // 'branch'=満足度で分岐 / 'all'=全員Google誘導（コンプライアンス安全）
    qrEnabled: true,   // 口コミ受付ON/OFF（OFFで顧客ページが停止表示）
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
    return res.json({ ...DEFAULT_SURVEY, ...(s || {}) });
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
    list.unshift({
      id: 'f' + Date.now().toString(36),
      rating: parseInt(rating, 10) || null,
      text: String(text).slice(0, 1000),
      contact: String(contact || '').slice(0, 200),
      at: new Date().toISOString(),
    });
    if (list.length > 300) list.length = 300;
    await kvSet(key, list);
    return res.json({ success: true });
  }

  // 管理者ログイン確認：Google連携(access_token) または メール＋パスワード(pw_session) のどちらか。
  const _c = parseCookies(req);
  const access_token = _c.access_token;
  if (!access_token && !_c.pw_session) return res.status(401).json({ error: '管理者ログインが必要です' });

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
      ['title', 'intro', 'completionMsg', 'lowMsg', 'gateMode', 'googleUrl', 'lineUrl'].forEach(k => { if (b[k] !== undefined) next[k] = String(b[k]); });
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
    const list = await kvGet('admin_stores') || [];
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

  // ── 店舗削除 ──
  if (req.method === 'DELETE' && !action) {
    const { storeId } = req.query;
    const list = (await kvGet('admin_stores') || []).filter(s => s.storeId !== storeId);
    await kvSet('admin_stores', list);
    await kvDel(`gbp_tokens_${storeId}`);
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
  // SerpApi 今月の使用回数（無料枠100/月の管理）
  if (req.method === 'GET' && action === 'serpapi-usage') {
    const ym = new Date().toISOString().slice(0, 7);
    const used = await kvGet(`serpapi_usage_${ym}`) || 0;
    return res.json({ month: ym, used, limit: 250, remaining: Math.max(0, 250 - used) });
  }

  // GET /api/admin?action=fetch-rank&keyword=新宿 カフェ&location=Shinjuku,Tokyo,Japan&store=店舗名(部分一致)
  if (req.method === 'GET' && action === 'fetch-rank') {
    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) return res.status(500).json({ error: 'SERPAPI_KEY未設定' });
    const { keyword, location, store } = req.query;
    if (!keyword || !store) return res.status(400).json({ error: 'keyword・store必須' });
    // 無料枠100/月の上限ガード
    const ym = new Date().toISOString().slice(0, 7);
    const usedKey = `serpapi_usage_${ym}`;
    const used = await kvGet(usedKey) || 0;
    if (used >= 250) return res.status(429).json({ error: '今月の無料枠（250回）に達しました。来月リセットされます', overLimit: true, used });
    try {
      const callSerp = async (loc) => {
        const params = new URLSearchParams({ engine: 'google_local', q: keyword, hl: 'ja', gl: 'jp', api_key: SERPAPI_KEY });
        if (loc) params.set('location', loc);
        const r = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
        return r.json();
      };
      let data = await callSerp(location);
      // 地点が不正（Unsupported location）なら地点なしで自動リトライ（KWに地域が入っていれば十分）
      if (data.error && /location/i.test(data.error) && location) {
        data = await callSerp('');
      }
      if (data.error) return res.status(502).json({ error: data.error + '（検索地点は「市区,都道府県,Japan」の英語表記が確実。空欄でもキーワードに地域があれば取得できます）' });
      await kvSet(usedKey, used + 1); // 使用回数を記録
      const list = data.local_results || [];
      const norm = (s) => String(s || '').replace(/\s|　|・|（.*?）|\(.*?\)/g, '').toLowerCase();
      const target = norm(store);
      let rank = null, matched = null;
      list.forEach((item, i) => {
        if (rank) return;
        const t = norm(item.title);
        if (t && (t.includes(target) || target.includes(t))) {
          rank = item.position || (i + 1); matched = item.title;
        }
      });
      const top = list.slice(0, 20).map((item, i) => ({
        position: item.position || (i + 1),
        title: item.title, rating: item.rating || null, reviews: item.reviews || null,
      }));
      return res.json({
        keyword, location: location || null, rank, matched,
        found: rank !== null, top, checkedAt: new Date().toISOString(),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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
    const { storeId, keywords, rankings } = req.body;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const existing = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    const entry = { date: new Date().toISOString().split('T')[0], rankings, recordedAt: new Date().toISOString() };
    const idx = existing.history.findIndex(h => h.date === entry.date);
    if (idx >= 0) existing.history[idx] = entry;
    else existing.history.push(entry);
    if (existing.history.length > 30) existing.history = existing.history.slice(-30);
    existing.keywords = keywords;
    await kvSet(`rankings_${storeId}`, existing);
    return res.json({ success: true });
  }

  return res.status(405).end();
}
