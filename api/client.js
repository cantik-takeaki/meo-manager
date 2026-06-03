// api/client.js — クライアント認証・レポート（統合）
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
  try {
    const cookies = parseCookies(req);
    if (!cookies.client_session) return null;
    const s = JSON.parse(Buffer.from(cookies.client_session, 'base64').toString());
    if (s.exp < Date.now()) return null;
    return s;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { action } = req.query;

  // ── ログイン ──
  if (req.method === 'POST' && action === 'login') {
    const { storeId, password } = req.body;
    if (!storeId || !password) return res.status(400).json({ error: 'storeId・password必須' });
    const store = await kvGet(`client_${storeId}`);
    if (!store) return res.status(404).json({ error: '店舗が見つかりません' });
    if (!store.active) return res.status(403).json({ error: 'アクセスが無効です' });
    if (store.password !== password) return res.status(401).json({ error: 'パスワードが違います' });
    const session = Buffer.from(JSON.stringify({ storeId, storeName: store.storeName, exp: Date.now() + 86400000 * 7 })).toString('base64');
    res.setHeader('Set-Cookie', `client_session=${session}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
    return res.json({ success: true, storeName: store.storeName, storeId });
  }

  // ── ログアウト ──
  if (req.method === 'DELETE' && action === 'login') {
    res.setHeader('Set-Cookie', 'client_session=; Path=/; Max-Age=0');
    return res.json({ success: true });
  }

  // ── レポート取得 ──
  if (req.method === 'GET' && action === 'report') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const session = getClientSession(req);
    const cookies = parseCookies(req);
    if (!session?.storeId && !cookies.access_token) return res.status(401).json({ error: '認証エラー' });
    if (session && session.storeId !== storeId && !cookies.access_token) return res.status(403).json({ error: '権限なし' });

    const [store, knowledge, rankings] = await Promise.all([
      kvGet(`client_${storeId}`),
      kvGet(`knowledge_${storeId}`),
      kvGet(`rankings_${storeId}`),
    ]);
    if (!store) return res.status(404).json({ error: '店舗が見つかりません' });

    const history = rankings?.history || [];
    const latest = history[history.length - 1];
    const prev = history[history.length - 2];
    const rankingData = (rankings?.keywords || []).map((kw, i) => ({
      keyword: kw,
      current: latest?.rankings[i] ?? null,
      prev: prev?.rankings[i] ?? null,
      change: (latest && prev) ? (prev.rankings[i] - latest.rankings[i]) : null,
      history: history.map(h => ({ date: h.date, rank: h.rankings[i] })),
    }));

    const challenges = [];
    rankingData.forEach(r => {
      if (r.current > 10) challenges.push({ type: 'ranking', level: 'high', message: `「${r.keyword}」の順位が${r.current}位です。上位表示に向けた投稿強化が必要です。` });
      else if (r.current > 5) challenges.push({ type: 'ranking', level: 'mid', message: `「${r.keyword}」は${r.current}位。あと少しでトップ5入りできます。` });
    });
    if (rankingData.length && rankingData.every(r => r.current && r.current <= 3)) {
      challenges.push({ level: 'low', message: '全キーワードがトップ3以内です。引き続き口コミ返信と定期投稿で維持しましょう。' });
    }

    return res.json({ store: { storeName: store.storeName }, knowledge: knowledge || {}, rankingData, rankingHistory: history, challenges, updatedAt: latest?.recordedAt || null });
  }

  return res.status(405).end();
}
