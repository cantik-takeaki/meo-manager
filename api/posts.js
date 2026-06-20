// api/posts.js — Googleポスト管理（＋予約下書き／Instagram連携／クライアント別写真ライブラリ）
import { getAccessToken } from './_tokens.js';
import { kvGet, kvSet } from './_kv.js';
import crypto from 'crypto';

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

  // ── クライアント別 写真ライブラリ（Cloudinary保管＋KVで一覧管理） ──
  // storeId（クライアント）ごとに写真を蓄積。Instagram用に正方形URLも保持。
  if (action === 'media') {
    const sid = storeId || 'default';
    const key = `media_${sid}`;
    const CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
    const CKEY = process.env.CLOUDINARY_API_KEY;
    const CSECRET = process.env.CLOUDINARY_API_SECRET;

    // 一覧取得
    if (req.method === 'GET') {
      const list = await kvGet(key) || [];
      return res.json({ media: list });
    }

    // アップロード（ブラウザでリサイズ済みのdataURIを受け取りCloudinaryへ）
    if (req.method === 'POST') {
      if (!CLOUD || !CKEY || !CSECRET) {
        return res.status(500).json({ error: 'Cloudinary環境変数が未設定です（CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET）' });
      }
      const { image, note } = req.body || {};
      if (!image) return res.status(400).json({ error: '画像データ(image)が必須です' });

      const ts = Math.floor(Date.now() / 1000);
      const folder = `meo/${sid}`;
      // 署名対象パラメータはアルファベット順（file/api_key/resource_type除く）
      const toSign = `folder=${folder}&timestamp=${ts}`;
      const signature = crypto.createHash('sha1').update(toSign + CSECRET).digest('hex');

      const form = new URLSearchParams();
      form.set('file', image);          // base64 data URI
      form.set('api_key', CKEY);
      form.set('timestamp', String(ts));
      form.set('folder', folder);
      form.set('signature', signature);

      try {
        const r = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
          method: 'POST', body: form,
        });
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: 'Cloudinaryアップロード失敗: ' + data.error.message });

        // 元URLと、Instagram用の正方形URL（スマート切り抜き）を生成
        const sq = data.secure_url.replace('/upload/', '/upload/c_fill,g_auto,w_1080,h_1080/');
        const portrait = data.secure_url.replace('/upload/', '/upload/c_fill,g_auto,w_1080,h_1350/');
        const item = {
          publicId: data.public_id,
          url: data.secure_url,
          squareUrl: sq,
          portraitUrl: portrait,
          width: data.width,
          height: data.height,
          note: note || '',
          createdAt: new Date().toISOString(),
        };
        const list = await kvGet(key) || [];
        list.unshift(item);
        await kvSet(key, list);
        return res.json({ success: true, item, media: list });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }

    // 削除（CloudinaryからもKVからも削除）
    if (req.method === 'DELETE') {
      const { publicId } = req.query;
      if (!publicId) return res.status(400).json({ error: 'publicId必須' });
      if (CLOUD && CKEY && CSECRET) {
        try {
          const ts = Math.floor(Date.now() / 1000);
          const toSign = `public_id=${publicId}&timestamp=${ts}`;
          const signature = crypto.createHash('sha1').update(toSign + CSECRET).digest('hex');
          const form = new URLSearchParams();
          form.set('public_id', publicId);
          form.set('api_key', CKEY);
          form.set('timestamp', String(ts));
          form.set('signature', signature);
          await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/destroy`, { method: 'POST', body: form });
        } catch (e) { /* Cloudinary削除失敗してもKVは消す */ }
      }
      const list = (await kvGet(key) || []).filter(m => m.publicId !== publicId);
      await kvSet(key, list);
      return res.json({ success: true, media: list });
    }

    return res.status(405).end();
  }

  // ── Instagram連携（Instagram Login API / graph.instagram.com） ──
  // 認証はInstagramの長期トークン（環境変数）を使用。Google APIとは別系統。
  if (action === 'instagram') {
    // 既定はcantik共通アカウント（環境変数）。クライアントが自分のIGを連携済みなら
    // ig_conn_{storeId} に保存されたトークンを優先（審査通過後の本番運用で各店舗へ投稿）。
    let IG_TOKEN = process.env.IG_ACCESS_TOKEN;
    let IG_USER = process.env.IG_USER_ID;
    if (storeId) {
      const conn = await kvGet(`ig_conn_${storeId}`);
      if (conn?.token && conn?.userId) { IG_TOKEN = conn.token; IG_USER = conn.userId; }
    }
    if (!IG_TOKEN || !IG_USER) {
      return res.status(500).json({ error: 'IG_ACCESS_TOKEN / IG_USER_ID が未設定です（Vercel環境変数）' });
    }
    const BASE = 'https://graph.instagram.com/v21.0';
    const sub = req.query.sub || (req.method === 'GET' ? 'account' : 'publish');

    try {
      // 疎通確認：アカウント情報
      if (req.method === 'GET' && sub === 'account') {
        const r = await fetch(`${BASE}/${IG_USER}?fields=id,username,name,profile_picture_url,followers_count,media_count&access_token=${IG_TOKEN}`);
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message });
        return res.json(data);
      }

      // 最近の投稿一覧
      if (req.method === 'GET' && sub === 'media') {
        const r = await fetch(`${BASE}/${IG_USER}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,comments_count,like_count&limit=25&access_token=${IG_TOKEN}`);
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message });
        return res.json(data);
      }

      // 指定メディアのコメント一覧
      if (req.method === 'GET' && sub === 'comments') {
        const { mediaId } = req.query;
        if (!mediaId) return res.status(400).json({ error: 'mediaId必須' });
        const r = await fetch(`${BASE}/${mediaId}/comments?fields=id,text,username,timestamp,replies{id,text,username,timestamp}&access_token=${IG_TOKEN}`);
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message });
        return res.json(data);
      }

      // インサイト（アカウント単位）
      if (req.method === 'GET' && sub === 'insights') {
        const metric = req.query.metric || 'reach,profile_views,follower_count';
        const period = req.query.period || 'day';
        const r = await fetch(`${BASE}/${IG_USER}/insights?metric=${metric}&period=${period}&access_token=${IG_TOKEN}`);
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message, pending: true });
        return res.json(data);
      }

      // コンテナの処理状況確認（動画/リール用）
      if (req.method === 'GET' && sub === 'status') {
        const { creationId } = req.query;
        if (!creationId) return res.status(400).json({ error: 'creationId必須' });
        const r = await fetch(`${BASE}/${creationId}?fields=status_code,status&access_token=${IG_TOKEN}`);
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message });
        return res.json(data);
      }

      // 投稿公開（2段階：media コンテナ作成 → media_publish）
      // ※会社ルール：実公開は社長承認後にこのエンドポイントを叩く設計（自動全公開はしない）
      if (req.method === 'POST' && sub === 'publish') {
        const { imageUrl, videoUrl, caption, mediaType } = req.body || {};
        if (!imageUrl && !videoUrl) return res.status(400).json({ error: '画像または動画の公開URLが必須です' });

        // step1: コンテナ作成
        const p1 = new URLSearchParams();
        if (videoUrl) { p1.set('video_url', videoUrl); p1.set('media_type', mediaType || 'REELS'); }
        else { p1.set('image_url', imageUrl); }
        if (caption) p1.set('caption', caption);
        p1.set('access_token', IG_TOKEN);
        const cr = await fetch(`${BASE}/${IG_USER}/media`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p1.toString(),
        });
        const cdata = await cr.json();
        if (cdata.error) return res.status(400).json({ error: 'コンテナ作成失敗: ' + cdata.error.message });
        const creationId = cdata.id;

        // 動画/リールは処理に時間がかかるため、creationIdを返してfinalizeで公開する。
        if (videoUrl) {
          return res.json({ pending: true, creationId, message: '動画処理中。statusがFINISHEDになったらfinalizeで公開してください' });
        }

        // 画像も処理完了まで一瞬ラグがある（"Media ID is not available"対策）。
        // status_code が FINISHED になるまで最大5回ポーリングしてから公開。
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        for (let i = 0; i < 5; i++) {
          const sr = await fetch(`${BASE}/${creationId}?fields=status_code&access_token=${IG_TOKEN}`);
          const sdata = await sr.json();
          if (sdata.status_code === 'FINISHED') break;
          if (sdata.status_code === 'ERROR') return res.status(400).json({ error: '画像処理エラー', creationId });
          await sleep(1500);
        }

        // step2: 公開（画像）
        const p2 = new URLSearchParams();
        p2.set('creation_id', creationId);
        p2.set('access_token', IG_TOKEN);
        const pr = await fetch(`${BASE}/${IG_USER}/media_publish`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p2.toString(),
        });
        const pdata = await pr.json();
        if (pdata.error) return res.status(400).json({ error: '公開失敗: ' + pdata.error.message, creationId });
        return res.json({ success: true, id: pdata.id, creationId });
      }

      // 動画/リールの公開を確定（status FINISHED後）
      if (req.method === 'POST' && sub === 'finalize') {
        const { creationId } = req.body || {};
        if (!creationId) return res.status(400).json({ error: 'creationId必須' });
        const p2 = new URLSearchParams();
        p2.set('creation_id', creationId);
        p2.set('access_token', IG_TOKEN);
        const pr = await fetch(`${BASE}/${IG_USER}/media_publish`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p2.toString(),
        });
        const pdata = await pr.json();
        if (pdata.error) return res.status(400).json({ error: '公開失敗: ' + pdata.error.message, creationId });
        return res.json({ success: true, id: pdata.id, creationId });
      }

      // DM：会話一覧
      if (req.method === 'GET' && sub === 'conversations') {
        const r = await fetch(`${BASE}/${IG_USER}/conversations?platform=instagram&fields=id,updated_time,participants&access_token=${IG_TOKEN}`);
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message, pending: true });
        return res.json(data);
      }

      // DM：会話内のメッセージ取得
      if (req.method === 'GET' && sub === 'messages') {
        const { conversationId } = req.query;
        if (!conversationId) return res.status(400).json({ error: 'conversationId必須' });
        const r = await fetch(`${BASE}/${conversationId}?fields=messages{id,created_time,from,to,message}&access_token=${IG_TOKEN}`);
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message });
        return res.json(data);
      }

      // DM：メッセージ送信（※相手の最終メッセージから24時間以内のみ送信可）
      if (req.method === 'POST' && sub === 'send-dm') {
        const { recipientId, text } = req.body || {};
        if (!recipientId || !text) return res.status(400).json({ error: 'recipientId・text必須' });
        const r = await fetch(`${BASE}/${IG_USER}/messages?access_token=${IG_TOKEN}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
        });
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message });
        return res.json({ success: true, ...data });
      }

      // コメント返信
      if (req.method === 'POST' && sub === 'reply') {
        const { commentId, message } = req.body || {};
        if (!commentId || !message) return res.status(400).json({ error: 'commentId・message必須' });
        const p = new URLSearchParams();
        p.set('message', message);
        p.set('access_token', IG_TOKEN);
        const r = await fetch(`${BASE}/${commentId}/replies`, {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: p.toString(),
        });
        const data = await r.json();
        if (data.error) return res.status(400).json({ error: data.error.message });
        return res.json({ success: true, ...data });
      }

      return res.status(400).json({ error: '不明なinstagramサブアクション: ' + sub });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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
