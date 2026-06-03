// api/store-settings.js — 改ざん防止用の正規店舗情報保存
import { kvGet, kvSet } from './_kv.js';

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { access_token } = parseCookies(req);
  if (!access_token) return res.status(401).json({ error: 'ログインが必要です' });

  const { locationId } = req.query;
  if (!locationId) return res.status(400).json({ error: 'locationId必須' });

  const key = `settings_${locationId}`;

  if (req.method === 'GET') {
    const data = await kvGet(key) || { savedAt: null, info: null, alerts: [] };
    return res.json(data);
  }

  // 正規情報を保存（改ざん防止ベースライン）
  if (req.method === 'POST') {
    const { info } = req.body;
    await kvSet(key, { info, savedAt: new Date().toISOString(), alerts: [] });
    return res.json({ success: true });
  }

  return res.status(405).end();
}
