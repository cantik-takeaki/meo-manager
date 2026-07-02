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

// 現在のGBP店舗情報を取得（Business Information API）
async function fetchCurrentGbp(locationName, token) {
  const locPart = String(locationName).match(/locations\/[^/]+/)?.[0];
  if (!locPart) return { error: 'no_location' };
  const mask = 'title,phoneNumbers,storefrontAddress,categories,websiteUri';
  const r = await fetch(`https://mybusinessbusinessinformation.googleapis.com/v1/${locPart}?readMask=${mask}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const d = await r.json();
  if (d.error) return { error: d.error.status || d.error.message || 'api_error' };
  const addr = d.storefrontAddress
    ? [...(d.storefrontAddress.addressLines || []), d.storefrontAddress.locality, d.storefrontAddress.administrativeArea, d.storefrontAddress.postalCode].filter(Boolean).join(' ')
    : '';
  return {
    current: {
      title: d.title || '',
      phone: d.phoneNumbers?.primaryPhone || '',
      address: addr,
      category: d.categories?.primaryCategory?.displayName || '',
      url: d.websiteUri || '',
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
      await kvSet(key, { info, savedAt: new Date().toISOString(), alerts: [] });
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
