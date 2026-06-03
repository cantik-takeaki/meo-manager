// api/report.js — クライアント向けレポートデータ
import { kvGet } from './_kv.js';

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
  if (req.method !== 'GET') return res.status(405).end();

  const { storeId } = req.query;
  if (!storeId) return res.status(400).json({ error: 'storeId必須' });

  const cookies = parseCookies(req);
  const clientSession = getClientSession(req);
  const isAdmin = !!cookies.access_token;
  const isClient = clientSession?.storeId === storeId;
  if (!isAdmin && !isClient) return res.status(401).json({ error: '認証エラー' });

  const [store, knowledge, rankings] = await Promise.all([
    kvGet(`client_${storeId}`),
    kvGet(`knowledge_${storeId}`),
    kvGet(`rankings_${storeId}`),
  ]);

  if (!store) return res.status(404).json({ error: '店舗が見つかりません' });

  // 最新順位・前回比
  const history = rankings?.history || [];
  const latest = history[history.length - 1];
  const prev = history[history.length - 2];

  const rankingData = (rankings?.keywords || []).map((kw, i) => ({
    keyword: kw,
    current: latest?.rankings[i] ?? null,
    prev: prev?.rankings[i] ?? null,
    change: latest && prev ? (prev.rankings[i] - latest.rankings[i]) : null,
    history: history.map(h => ({ date: h.date, rank: h.rankings[i] })),
  }));

  // 課題生成
  const challenges = [];
  rankingData.forEach(r => {
    if (r.current > 10) challenges.push({ type: 'ranking', level: 'high', message: `「${r.keyword}」の順位が${r.current}位です。上位表示に向けた投稿強化が必要です。` });
    else if (r.current > 5) challenges.push({ type: 'ranking', level: 'mid', message: `「${r.keyword}」は${r.current}位。あと少しでトップ5入りできます。` });
  });

  res.json({
    store: { storeName: store.storeName, clientEmail: store.clientEmail },
    knowledge: knowledge || {},
    rankingData,
    rankingHistory: history,
    challenges,
    updatedAt: latest?.recordedAt || null,
  });
}
