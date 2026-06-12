// api/reviews.js — 口コミ一覧・返信
import { getAccessToken } from './_tokens.js';

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { storeId } = req.query;
  const token = storeId ? await getAccessToken(storeId) : parseCookies(req).access_token;
  if (!token) return res.status(401).json({ error: 'ログインが必要です' });

  const { locationName } = req.query;
  if (!locationName) return res.status(400).json({ error: 'locationName必須' });

  // 口コミ一覧取得（＋集計・低評価アラート）
  if (req.method === 'GET') {
    try {
      const r = await fetch(
        `https://mybusiness.googleapis.com/v4/${locationName}/reviews`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = await r.json();
      if (data.error) return res.status(r.status).json({ error: data.error.message, pending: true });

      // ── 集計を付加 ──
      const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
      const reviews = data.reviews || [];
      let sum = 0, count = 0, unreplied = 0;
      const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      const lowAlerts = [];
      for (const rv of reviews) {
        const star = STAR[rv.starRating] || 0;
        if (star) { sum += star; count++; dist[star]++; }
        const hasReply = !!rv.reviewReply;
        if (!hasReply) unreplied++;
        if (star && star <= 2 && !hasReply) {
          lowAlerts.push({
            reviewName: rv.name,
            reviewer: rv.reviewer?.displayName || 'お客様',
            star,
            comment: rv.comment || '',
            createTime: rv.createTime || '',
          });
        }
      }
      data.stats = {
        averageRating: count ? Math.round((sum / count) * 10) / 10 : 0,
        totalCount: count,
        unrepliedCount: unreplied,
        distribution: dist,
        lowRatingAlerts: lowAlerts,
      };
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  // 口コミ返信
  if (req.method === 'PUT') {
    const { reviewName, comment } = req.body;
    try {
      const r = await fetch(
        `https://mybusiness.googleapis.com/v4/${reviewName}/reply`,
        {
          method: 'PUT',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ comment }),
        }
      );
      const data = await r.json();
      if (data.error) return res.status(r.status).json({ error: data.error.message, pending: true });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
}
