// api/admin.js — 店舗登録・順位入力（統合）
import { kvGet, kvSet, kvDel } from './_kv.js';

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

  const { action } = req.query;

  // ── 店舗一覧（GBP連携状況付き）──
  if (req.method === 'GET' && !action) {
    const list = await kvGet('admin_stores') || [];
    const stores = await Promise.all(list.map(async (s) => {
      const gbp = await kvGet(`gbp_tokens_${s.storeId}`);
      return {
        ...s,
        gbpConnected: !!gbp,
        gbpEmail: gbp?.email || null,
        gbpConnectedAt: gbp?.connected_at || null,
        connectUrl: `/api/auth/connect?store=${s.storeId}`,
      };
    }));
    return res.json({ stores });
  }

  // ── 店舗登録 ──
  if (req.method === 'POST' && !action) {
    const { storeName, clientEmail } = req.body;
    if (!storeName) return res.status(400).json({ error: 'storeName必須' });
    const list = await kvGet('admin_stores') || [];
    const storeId = generateId();
    const password = generatePassword();
    const newStore = { storeId, storeName, clientEmail: clientEmail || '', password, createdAt: new Date().toISOString(), active: true };
    list.push(newStore);
    await kvSet('admin_stores', list);
    await kvSet(`client_${storeId}`, newStore);
    return res.json({ success: true, storeId, password, loginUrl: `/report.html?store=${storeId}` });
  }

  // ── 店舗削除 ──
  if (req.method === 'DELETE' && !action) {
    const { storeId } = req.query;
    const list = (await kvGet('admin_stores') || []).filter(s => s.storeId !== storeId);
    await kvSet('admin_stores', list);
    await kvDel(`gbp_tokens_${storeId}`);
    return res.json({ success: true });
  }

  // ── GBP連携解除 ──
  if (req.method === 'DELETE' && action === 'disconnect') {
    const { storeId } = req.query;
    await kvDel(`gbp_tokens_${storeId}`);
    return res.json({ success: true });
  }

  // ── GBP連携状況確認 ──
  if (req.method === 'GET' && action === 'gbp-status') {
    const { storeId } = req.query;
    const gbp = await kvGet(`gbp_tokens_${storeId}`);
    return res.json({
      connected: !!gbp,
      email: gbp?.email || null,
      connectedAt: gbp?.connected_at || null,
    });
  }

  // ── SerpApiで順位を自動取得 ──
  // SerpApi 今月の使用回数（無料枠100/月の管理）
  if (req.method === 'GET' && action === 'serpapi-usage') {
    const ym = new Date().toISOString().slice(0, 7);
    const used = await kvGet(`serpapi_usage_${ym}`) || 0;
    return res.json({ month: ym, used, limit: 250, remaining: Math.max(0, 250 - used) });
  }

  // GET /api/admin?action=fetch-rank&keyword=新宿 カフェ&location=Shinjuku,Tokyo,Japan&store=店舗名(部分一致)
  if (req.method === 'GET' && action === 'fetch-rank') {
    const SERPAPI_KEY = process.env.SERPAPI_KEY;
    if (!SERPAPI_KEY) return res.status(500).json({ error: 'SERPAPI_KEY未設定' });
    const { keyword, location, store } = req.query;
    if (!keyword || !store) return res.status(400).json({ error: 'keyword・store必須' });
    // 無料枠100/月の上限ガード
    const ym = new Date().toISOString().slice(0, 7);
    const usedKey = `serpapi_usage_${ym}`;
    const used = await kvGet(usedKey) || 0;
    if (used >= 250) return res.status(429).json({ error: '今月の無料枠（250回）に達しました。来月リセットされます', overLimit: true, used });
    try {
      const params = new URLSearchParams({
        engine: 'google_local', q: keyword, hl: 'ja', gl: 'jp', api_key: SERPAPI_KEY,
      });
      if (location) params.set('location', location);
      const r = await fetch(`https://serpapi.com/search.json?${params.toString()}`);
      const data = await r.json();
      if (data.error) return res.status(502).json({ error: data.error });
      await kvSet(usedKey, used + 1); // 使用回数を記録
      const list = data.local_results || [];
      const norm = (s) => String(s || '').replace(/\s|　|・|（.*?）|\(.*?\)/g, '').toLowerCase();
      const target = norm(store);
      let rank = null, matched = null;
      list.forEach((item, i) => {
        if (rank) return;
        const t = norm(item.title);
        if (t && (t.includes(target) || target.includes(t))) {
          rank = item.position || (i + 1); matched = item.title;
        }
      });
      const top = list.slice(0, 20).map((item, i) => ({
        position: item.position || (i + 1),
        title: item.title, rating: item.rating || null, reviews: item.reviews || null,
      }));
      return res.json({
        keyword, location: location || null, rank, matched,
        found: rank !== null, top, checkedAt: new Date().toISOString(),
      });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // ── 順位取得 ──
  if (req.method === 'GET' && action === 'rankings') {
    const { storeId } = req.query;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const data = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    return res.json(data);
  }

  // ── 順位保存 ──
  if (req.method === 'POST' && action === 'rankings') {
    const { storeId, keywords, rankings } = req.body;
    if (!storeId) return res.status(400).json({ error: 'storeId必須' });
    const existing = await kvGet(`rankings_${storeId}`) || { history: [], keywords: [] };
    const entry = { date: new Date().toISOString().split('T')[0], rankings, recordedAt: new Date().toISOString() };
    const idx = existing.history.findIndex(h => h.date === entry.date);
    if (idx >= 0) existing.history[idx] = entry;
    else existing.history.push(entry);
    if (existing.history.length > 30) existing.history = existing.history.slice(-30);
    existing.keywords = keywords;
    await kvSet(`rankings_${storeId}`, existing);
    return res.json({ success: true });
  }

  return res.status(405).end();
}
