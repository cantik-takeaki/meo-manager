import { rankingReport } from '../api/_metric_integrity.js';
import crypto from 'node:crypto';
import { redis, repository } from './workspace-store.js';
import { resolveSessionUser } from '../api/_session.js';
import { sameOrigin } from '../api/_auth.js';
// api/client.js — クライアント認証・レポート（統合）
import { kvGet, kvSet } from '../api/_kv.js';

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

export async function getClientSession(req) {
  try {
    const token=parseCookies(req).client_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const raw=await redis(['GET','client_session_'+crypto.createHash('sha256').update(token).digest('hex')]);
    const session=raw?JSON.parse(raw):null;
    if (!session || session.exp<Date.now()) return null;
    const store=await kvGet(`client_${session.storeId}`);
    if (!store?.active || session.credential!==crypto.createHash('sha256').update(String(store.password)).digest('hex')) return null;
    return session;
  } catch { return null; }
}

export async function revokeClientSession(req){
 const token=parseCookies(req).client_session;
 if(token&&/^[a-f0-9]{64}$/.test(token))await redis(['DEL','client_session_'+crypto.createHash('sha256').update(token).digest('hex')]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!sameOrigin(req)) return res.status(403).json({error:'同じサイトから操作してください'});
  const { action } = req.query;

  if(req.method==='GET'&&action==='session'){
    const session=await getClientSession(req);if(!session)return res.status(401).json({error:'ログインが必要です'});
    const store=await kvGet(`client_${session.storeId}`);res.setHeader('Cache-Control','no-store');
    return res.json({storeId:session.storeId,storeName:store.storeName});
  }
  // ── ログイン ──
  if (req.method === 'POST' && action === 'login') {
    const { storeId, password } = req.body;
    if (!storeId || !password) return res.status(400).json({ error: 'storeId・password必須' });
    try { await repository.limit(crypto.createHash('sha256').update(String(storeId)).digest('hex'),crypto.createHash('sha256').update(String(req.headers['x-forwarded-for']||'unknown')).digest('hex')); } catch(e) { return res.status(e.status||503).json({error:e.message}); }
    const store = await kvGet(`client_${storeId}`);
    if (!store) return res.status(404).json({ error: '店舗が見つかりません' });
    if (!store.active) return res.status(403).json({ error: 'アクセスが無効です' });
    if (store.password !== password) return res.status(401).json({ error: 'パスワードが違います' });
    const session = crypto.randomBytes(32).toString('hex');
    await redis(['SET','client_session_'+crypto.createHash('sha256').update(session).digest('hex'),JSON.stringify({storeId,exp:Date.now()+604800000,credential:crypto.createHash('sha256').update(String(store.password)).digest('hex')}),'EX',604800]);
    res.setHeader('Set-Cookie', `client_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`);
    return res.json({ success: true, storeName: store.storeName, storeId });
  }

  // ── ログアウト ──
  if (req.method === 'DELETE' && action === 'login') {
    const token=parseCookies(req).client_session;
    if(token && /^[a-f0-9]{64}$/.test(token)) await redis(['DEL','client_session_'+crypto.createHash('sha256').update(token).digest('hex')]);
    res.setHeader('Set-Cookie', 'client_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    return res.json({ success: true });
  }

  // ── レポート取得 ──
  if (req.method === 'GET' && action === 'report') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const session = await getClientSession(req);
    const staff = await resolveSessionUser(req);
    const cookies = parseCookies(req);
    if (!session?.storeId && !staff) return res.status(401).json({ error: '認証エラー' });
    if (session && session.storeId !== storeId && !staff) return res.status(403).json({ error: '権限なし' });

    const [store, knowledge, rankings, reviewStats, compHist, competitors] = await Promise.all([
      kvGet(`client_${storeId}`),
      kvGet(`knowledge_${storeId}`),
      kvGet(`rankings_${storeId}`),
      kvGet(`review_stats_${storeId}`),   // reviews.jsが管理画面での閲覧時にキャッシュした口コミ統計
      kvGet(`comp_history_${storeId}`),   // 競合順位の自動記録
      kvGet(`competitors_${storeId}`),
    ]);
    if (!store) return res.status(404).json({ error: '店舗が見つかりません' });

    // 競合比較（KWごとの最新記録）
    const compList = (competitors || []).filter(c => c.compare !== false);
    const latestByKw = {};
    (compHist || []).forEach(h => { if (!latestByKw[h.keyword] || latestByKw[h.keyword].date <= h.date) latestByKw[h.keyword] = h; });
    const compCompare = compList.length ? Object.values(latestByKw).map(h => ({
      keyword: h.keyword, date: h.date, self: h.self,
      comps: compList.map(c => ({ name: c.name, rank: ((h.comps || []).find(x => x.id === c.id) || {}).rank ?? null })),
    })) : [];

    const history = [...(rankings?.history || [])].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
    const latest = history.at(-1);
    const rankingData = rankingReport(rankings || {});

    const challenges = [];
    rankingData.forEach(r => {
      if (r.current > 10) challenges.push({ type: 'ranking', level: 'high', message: `「${r.keyword}」の順位が${r.current}位です。検索地点・競合・店舗情報を確認し、改善策を検討してください。` });
      else if (r.current > 5) challenges.push({ type: 'ranking', level: 'mid', message: `「${r.keyword}」は${r.current}位。検索条件を揃えて推移を確認してください。` });
    });
    if (rankingData.length && rankingData.every(r => r.current && r.current <= 3)) {
      challenges.push({ level: 'low', message: '全キーワードがトップ3以内です。計測条件と確認日時を揃えて継続観測します。' });
    }

    return res.json({
      store: { storeName: store.storeName }, knowledge: knowledge || {},
      rankingData, rankingHistory: history, challenges,
      reviewStats: reviewStats || null, compCompare, competitors: compList.map(c => c.name),
      updatedAt: latest?.recordedAt || null,
    });
  }

  return res.status(405).end();
}
