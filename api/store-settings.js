// api/store-settings.js — 改ざん防止 + サイテーション管理
import { kvGet, kvSet } from './_kv.js';
import { getAccessToken, getValidCookieToken } from './_tokens.js';

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

// 比較用の正規化：空白・記号・全角ゆれを吸収し、誤検知を抑える
const normGeneric = (s) => String(s || '').replace(/[\s　・\-―ー（）()]/g, '').toLowerCase();
const normPhone = (s) => String(s || '').replace(/[^0-9]/g, '');
const normUrl = (s) => String(s || '').replace(/^https?:\/\//, '').replace(/\/$/, '').toLowerCase();
const looseSame = (a, b) => { a = normGeneric(a); b = normGeneric(b); return !a || !b || a === b || a.includes(b) || b.includes(a); };
// 営業時間の時刻トークン抽出（全角→半角・H:MM正規化）。自由記述とGBP構造化の表記ゆれを吸収する緩判定用
const hoursTokens = (s) => {
  const z = String(s || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/：/g, ':');
  return [...z.matchAll(/(\d{1,2}):(\d{2})/g)].map(m => `${parseInt(m[1], 10)}:${m[2]}`);
};
const fmtGbpTime = (t) => typeof t === 'string' ? (t.length === 4 ? `${parseInt(t.slice(0, 2), 10)}:${t.slice(2)}` : t) : (t && t.hours != null ? `${t.hours}:${String(t.minutes || 0).padStart(2, '0')}` : '');

// 現在のGBP店舗情報を取得（Business Information API）
async function fetchCurrentGbp(locationName, token) {
  const locPart = String(locationName).match(/locations\/[^/]+/)?.[0];
  if (!locPart) return { error: 'no_location' };
  const mask = 'title,phoneNumbers,storefrontAddress,categories,websiteUri,regularHours';
  const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${locPart}?readMask=${mask}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  if (d.error) return { error: d.error.status || d.error.message || 'api_error' };
  const addr = d.storefrontAddress
    ? [...(d.storefrontAddress.addressLines || []), d.storefrontAddress.locality, d.storefrontAddress.administrativeArea, d.storefrontAddress.postalCode].filter(Boolean).join(' ')
    : '';
  const hoursStr = (d.regularHours?.periods || []).map(p => `${p.openDay || ''} ${fmtGbpTime(p.openTime)}-${fmtGbpTime(p.closeTime)}`).join(' ');
  return {
    current: {
      title: d.title || '',
      phone: d.phoneNumbers?.primaryPhone || '',
      address: addr,
      category: d.categories?.primaryCategory?.displayName || '',
      url: d.websiteUri || '',
      hours: hoursStr,
    },
  };
}

// 正規情報と現在のGBP情報を比較して差分を返す
function diffBaseline(saved, current) {
  const diffs = [];
  const check = (field, label, eq) => {
    const s = saved[field], c = current[field];
    if (s && c && !eq(s, c)) diffs.push({ field: label, saved: s, current: c });
  };
  check('title', '店舗名', looseSame);
  check('phone', '電話番号', (a, b) => normPhone(a) === normPhone(b) || !normPhone(a) || !normPhone(b));
  check('address', '住所', looseSame);
  check('category', 'カテゴリ', looseSame);
  check('url', '公式URL', (a, b) => normUrl(a) === normUrl(b));
  // 営業時間（緩判定）：保存値の時刻(H:MM)がGBP側に全て含まれるかだけを見る。自由記述との表記ゆれ誤検知を防ぐ
  if (saved.hours && current.hours) {
    const st = hoursTokens(saved.hours);
    if (st.length && st.some(t => !hoursTokens(current.hours).includes(t))) {
      diffs.push({ field: '営業時間', saved: saved.hours, current: current.hours, note: '表記ゆれの可能性あり（時刻ベースの緩判定）' });
    }
  }
  return diffs;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // 認証: Google連携(access_token) または メール＋パスワード(pw_session) のどちらでも可（KVのみ使用）。
  const _c = parseCookies(req);
  if (!_c.access_token && !_c.pw_session) return res.status(401).json({ error: 'ログインが必要です' });

  const { locationId, action } = req.query;
  if (!locationId) return res.status(400).json({ error: 'locationId必須' });

  // ── 改ざん検知：正規情報 vs 現在のGBP情報を自動比較 ──
  if (action === 'verify') {
    const key = `settings_${locationId}`;
    const saved = await kvGet(key);
    if (!saved || !saved.info) return res.json({ status: 'no_baseline' });

    const { locationName, storeId } = req.query;
    if (!locationName) return res.json({ status: 'pending', reason: 'no_location_name' });
    // 店舗(クライアント)はgbp_tokens、自社はCookieトークン
    const token = storeId ? await getAccessToken(storeId) : await getValidCookieToken(req, res);
    if (!token) return res.json({ status: 'pending', reason: 'no_token' });

    const got = await fetchCurrentGbp(locationName, token);
    if (got.error) return res.json({ status: 'pending', reason: got.error });

    const diffs = diffBaseline(saved.info, got.current);
    const now = new Date().toISOString();
    if (diffs.length) {
      const alerts = saved.alerts || [];
      alerts.unshift({ detectedAt: now, diffs });
      if (alerts.length > 20) alerts.length = 20;
      await kvSet(key, { ...saved, alerts, lastCheckedAt: now });
      return res.json({ status: 'changed', diffs, current: got.current, checkedAt: now });
    }
    await kvSet(key, { ...saved, lastCheckedAt: now });
    return res.json({ status: 'ok', current: got.current, checkedAt: now });
  }

  // ── 改ざん防止 ──
  if (!action || action === 'protection') {
    const key = `settings_${locationId}`;
    if (req.method === 'GET') {
      return res.json(await kvGet(key) || { savedAt: null, info: null, alerts: [] });
    }
    if (req.method === 'POST') {
      const { info } = req.body;
      // 正規情報を更新しても過去の検知アラート履歴は消さない（監査証跡の保全）
      const existing = await kvGet(key) || {};
      const alerts = Array.isArray(existing.alerts) ? existing.alerts : [];
      await kvSet(key, { info, savedAt: new Date().toISOString(), alerts });
      return res.json({ success: true });
    }
  }

  // ── サイテーション ──
  if (action === 'citation') {
    const key = `citation_${locationId}`;
    if (req.method === 'GET') {
      return res.json(await kvGet(key) || { nap: {}, sites: [] });
    }
    if (req.method === 'POST') {
      await kvSet(key, req.body);
      return res.json({ success: true });
    }
  }

  // ── AIO/LLMO/GEO ──
  if (action === 'aio') {
    const key = `aio_${locationId}`;
    if (req.method === 'GET') {
      return res.json(await kvGet(key) || { checks: {}, notes: {}, updatedAt: null });
    }
    if (req.method === 'POST') {
      const data = { ...req.body, updatedAt: new Date().toISOString() };
      await kvSet(key, data);
      return res.json({ success: true });
    }
  }

  return res.status(405).end();
}
