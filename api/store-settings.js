// api/store-settings.js — 改ざん防止 + サイテーション管理
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

  const { locationId, action } = req.query;
  if (!locationId) return res.status(400).json({ error: 'locationId必須' });

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
