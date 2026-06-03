// api/admin-stores.js — 店舗登録・管理（管理者用）
import { kvGet, kvSet } from './_kv.js';

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

  const { access_token } = parseCookies(req);
  if (!access_token) return res.status(401).json({ error: '管理者ログインが必要です' });

  // 全店舗一覧
  if (req.method === 'GET') {
    const list = await kvGet('admin_stores') || [];
    return res.json({ stores: list });
  }

  // 新規店舗登録
  if (req.method === 'POST') {
    const { storeName, clientEmail, locationId } = req.body;
    if (!storeName) return res.status(400).json({ error: 'storeName必須' });

    const list = await kvGet('admin_stores') || [];
    const storeId = generateId();
    const password = generatePassword();

    const newStore = {
      storeId,
      storeName,
      clientEmail: clientEmail || '',
      locationId: locationId || '',
      password,
      createdAt: new Date().toISOString(),
      active: true,
    };

    list.push(newStore);
    await kvSet('admin_stores', list);
    await kvSet(`client_${storeId}`, newStore);

    return res.json({ success: true, storeId, password, loginUrl: `/report.html?store=${storeId}` });
  }

  // 店舗削除
  if (req.method === 'DELETE') {
    const { storeId } = req.query;
    const list = (await kvGet('admin_stores') || []).filter(s => s.storeId !== storeId);
    await kvSet('admin_stores', list);
    return res.json({ success: true });
  }

  return res.status(405).end();
}
