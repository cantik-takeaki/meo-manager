// api/client-auth.js — クライアントログイン
import { kvGet } from './_kv.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ログアウト
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', 'client_session=; Path=/; Max-Age=0');
    return res.json({ success: true });
  }

  if (req.method !== 'POST') return res.status(405).end();

  const { storeId, password } = req.body;
  if (!storeId || !password) return res.status(400).json({ error: 'storeId・password必須' });

  const store = await kvGet(`client_${storeId}`);
  if (!store) return res.status(404).json({ error: '店舗が見つかりません' });
  if (!store.active) return res.status(403).json({ error: 'アクセスが無効化されています' });
  if (store.password !== password) return res.status(401).json({ error: 'パスワードが違います' });

  // セッションCookie
  const session = Buffer.from(JSON.stringify({ storeId, storeName: store.storeName, exp: Date.now() + 86400000 * 7 })).toString('base64');
  res.setHeader('Set-Cookie', `client_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
  return res.json({ success: true, storeName: store.storeName, storeId });
}
