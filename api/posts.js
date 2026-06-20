// api/posts.js — Googleポスト管理（＋予約下書き）
import { getAccessToken } from './_tokens.js';
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { storeId, action } = req.query;

  // ── 予約下書き（KV保存。Google APIに予約機能が無いため自前管理） ──
  // ここはトークン不要（自社KVのみ操作）。storeId をキーに使う。
  if (action === 'drafts') {
    const sid = storeId || 'default';
    const key = `post_drafts_${sid}`;
    if (req.method === 'GET') {
      const list = await kvGet(key) || [];
      return res.json({ drafts: list });
    }
    if (req.method === 'POST') {
      const { id, summary, scheduledDate, topicType, callToActionType, callToActionUrl } = req.body || {};
      const list = await kvGet(key) || [];
      if (id) {
        // 更新
        const idx = list.findIndex(d => d.id === id);
        if (idx >= 0) list[idx] = { ...list[idx], summary, scheduledDate, topicType, callToActionType, callToActionUrl };
      } else {
        // 新規
        list.push({
          id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          summary, scheduledDate: scheduledDate || '', topicType: topicType || 'STANDARD',
          callToActionType: callToActionType || '', callToActionUrl: callToActionUrl || '',
          status: 'scheduled', createdAt: new Date().toISOString(),
        });
      }
      await kvSet(key, list);
      return res.json({ success: true, drafts: list });
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const list = (await kvGet(key) || []).filter(d => d.id !== id);
      await kvSet(key, list);
      return res.json({ success: true, drafts: list });
    }
    return res.status(405).end();
  }

  const access_token = storeId ? await getAccessToken(storeId) : parseCookies(req).access_token;
  if (!access_token) return res.status(401).json({ error: 'ログインが必要です' });

  let { locationName } = req.query;
  if (!locationName) return res.status(400).json({ error: 'locationName必須' });

  // 古い連携データ対策：accounts/ が欠けた "locations/xxx" 形式を補完
  if (!String(locationName).includes('accounts/')) {
    try {
      const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const accData = await accRes.json();
      const acc = accData.accounts?.[0]?.name;
      if (acc) {
        const locPart = String(locationName).match(/locations\/[^/]+/)?.[0] || locationName;
        locationName = `${acc}/${locPart}`;
      }
    } catch (e) { /* 補完失敗時はそのまま */ }
  }

  // 投稿一覧
  if (req.method === 'GET') {
    try {
      const r = await fetch(
        `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      const data = await r.json();
      if (data.error) return res.status(r.status).json({ error: data.error.message, pending: true });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }

  // 投稿作成
  if (req.method === 'POST') {
    const { summary, callToActionType, callToActionUrl, topicType } = req.body;
    const body = {
      topicType: topicType || 'STANDARD',
      summary,
      ...(callToActionType && {
        callToAction: { actionType: callToActionType, url: callToActionUrl },
      }),
    };
    try {
      const r = await fetch(
        `https://mybusiness.googleapis.com/v4/${locationName}/localPosts`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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
