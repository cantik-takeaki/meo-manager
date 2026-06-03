// api/rankings.js — キーワード順位の入力・取得
import { kvGet, kvSet } from './_kv.js';

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

function getClientSession(req) {
  const cookies = parseCookies(req);
  if (!cookies.client_session) return null;
  try {
    const s = JSON.parse(Buffer.from(cookies.client_session, 'base64').toString());
    if (s.exp < Date.now()) return null;
    return s;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: 'storeId必須' });

  // 管理者 or クライアントどちらでも閲覧可
  const cookies = parseCookies(req);
  const clientSession = getClientSession(req);
  const isAdmin = !!cookies.access_token;
  const isClient = clientSession?.storeId === storeId;
  if (!isAdmin && !isClient) return res.status(401).json({ error: '認証エラー' });

  const key = `rankings_${storeId}`;

  if (req.method === 'GET') {
    const data = await kvGet(key) || { history: [], keywords: [] };
    return res.json(data);
  }

  // 管理者のみ書き込み可
  if (req.method === 'POST') {
    if (!isAdmin) return res.status(403).json({ error: '管理者のみ' });
    const { keywords, rankings } = req.body;
    // keywords: ['渋谷 美容室', ...]
    // rankings: [3, 7, 1, ...] 各キーワードの順位

    const existing = await kvGet(key) || { history: [], keywords: [] };
    const entry = {
      date: new Date().toISOString().split('T')[0],
      rankings,
      recordedAt: new Date().toISOString(),
    };

    // 同じ日付があれば上書き
    const idx = existing.history.findIndex(h => h.date === entry.date);
    if (idx >= 0) existing.history[idx] = entry;
    else existing.history.push(entry);

    // 直近30件
    if (existing.history.length > 30) existing.history = existing.history.slice(-30);
    existing.keywords = keywords;

    await kvSet(key, existing);
    return res.json({ success: true });
  }

  return res.status(405).end();
}
