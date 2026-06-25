// api/posts.js — Googleポスト管理（＋予約下書き／Instagram連携／クライアント別写真ライブラリ）
import { getAccessToken, getValidCookieToken } from './_tokens.js';
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
      const b = req.body || {};
      const { id, summary, scheduledDate, scheduledTime, topicType, callToActionType, callToActionUrl, images, targetGoogle, targetInstagram } = b;
      const list = await kvGet(key) || [];
      if (id) {
        // 更新（送られたフィールドだけ上書き。未指定の既存値は保持）
        const idx = list.findIndex(d => d.id === id);
        if (idx >= 0) list[idx] = {
          ...list[idx],
          ...(summary !== undefined && { summary }),
          ...(scheduledDate !== undefined && { scheduledDate }),
          ...(scheduledTime !== undefined && { scheduledTime }),
          ...(topicType !== undefined && { topicType }),
          ...(callToActionType !== undefined && { callToActionType }),
          ...(callToActionUrl !== undefined && { callToActionUrl }),
          ...(images !== undefined && { images }),
          ...(targetGoogle !== undefined && { targetGoogle }),
          ...(targetInstagram !== undefined && { targetInstagram }),
        };
      } else {
        // 新規
        list.push({
          id: 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          summary, scheduledDate: scheduledDate || '', scheduledTime: scheduledTime || '',
          topicType: topicType || 'STANDARD',
          callToActionType: callToActionType || '', callToActionUrl: callToActionUrl || '',
          images: images || [], targetGoogle: targetGoogle !== false, targetInstagram: !!targetInstagram,
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

  // ── 施策履歴・作業ログ（店舗ごと・KV） ──
  if (action === 'actionlog') {
    const sid = storeId || 'default';
    const key = `actionlog_${sid}`;
    if (req.method === 'GET') {
      return res.json({ logs: await kvGet(key) || [] });
    }
    if (req.method === 'POST') {
      const { text, date } = req.body || {};
      if (!text) return res.status(400).json({ error: 'text必須' });
      const list = await kvGet(key) || [];
      list.unshift({ id: 'l' + Date.now().toString(36), text, date: date || new Date().toISOString().split('T')[0], createdAt: new Date().toISOString() });
      if (list.length > 200) list.length = 200;
      await kvSet(key, list);
      return res.json({ success: true, logs: list });
    }
    if (req.method === 'DELETE') {
      const { id } = req.query;
      const list = (await kvGet(key) || []).filter(l => l.id !== id);
      await kvSet(key, list);
      return res.json({ success: true, logs: list });
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

    // 一覧取得 ／ 直接アップロード用の署名発行（動画など大きいファイル用）
    if (req.method === 'GET') {
      if (req.query.sub === 'sign') {
        if (!CLOUD || !CKEY || !CSECRET) return res.status(500).json({ error: 'Cloudinary環境変数が未設定です' });
        const ts = Math.floor(Date.now() / 1000);
        const folder = `meo/${sid}`;
        const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${ts}` + CSECRET).digest('hex');
        return res.json({ cloudName: CLOUD, apiKey: CKEY, timestamp: ts, folder, signature });
      }
      const list = await kvGet(key) || [];
      return res.json({ media: list });
    }

    // アップロード（画像dataURI）／ 直接アップ済みメディアの登録（sub=register・主に動画）
    if (req.method === 'POST') {
      if (req.query.sub === 'register') {
        const { publicId, url, isVideo, width, height, note } = req.body || {};
        if (!publicId || !url) return res.status(400).json({ error: 'publicId・url必須' });
        const sq = url.replace('/upload/', '/upload/c_fill,g_auto,w_1080,h_1080/');
        const portrait = url.replace('/upload/', '/upload/c_fill,g_auto,w_1080,h_1350/');
        const thumb = isVideo
          ? url.replace('/upload/', '/upload/so_0,c_fill,w_400,h_400/').replace(/\.\w+$/, '.jpg')
          : sq;
        const item = {
          publicId, url,
          squareUrl: isVideo ? url : sq,
          portraitUrl: isVideo ? url : portrait,
          thumbnailUrl: thumb,
          isVideo: !!isVideo,
          width: width || null, height: height || null,
          note: note || '', createdAt: new Date().toISOString(),
        };
        const list = await kvGet(key) || [];
        list.unshift(item);
        await kvSet(key, list);
        return res.json({ success: true, item, media: list });
      }
      if (!CLOUD || !CKEY || !CSECRET) {
        return res.status(500).json({ error: 'Cloudinary環境変数が未設定です（CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET）' });
      }
      const { image, note, noCrop } = req.body || {};
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

        // 生成画像(noCrop)は選んだ比率のまま使う。通常写真はInstagram用に正方形/縦長へスマート切り抜き
        const sq = noCrop ? data.secure_url : data.secure_url.replace('/upload/', '/upload/c_fill,g_auto,w_1080,h_1080/');
        const portrait = noCrop ? data.secure_url : data.secure_url.replace('/upload/', '/upload/c_fill,g_auto,w_1080,h_1350/');
        const item = {
          publicId: data.public_id,
          url: data.secure_url,
          squareUrl: sq,
          portraitUrl: portrait,
          width: data.width,
          height: data.height,
          isGenerated: !!noCrop,
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
      const fullList = await kvGet(key) || [];
      const target = fullList.find(m => m.publicId === publicId);
      const rtype = target?.isVideo ? 'video' : 'image';
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
          await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/${rtype}/destroy`, { method: 'POST', body: form });
        } catch (e) { /* Cloudinary削除失敗してもKVは消す */ }
      }
      const list = fullList.filter(m => m.publicId !== publicId);
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
    let igConn = null;
    if (storeId) {
      igConn = await kvGet(`ig_conn_${storeId}`);
      if (igConn?.token && igConn?.userId) { IG_TOKEN = igConn.token; IG_USER = igConn.userId; }
    }
    // 連携状態の確認（トークン不要・店舗ごと）。UIの「連携済み/未連携」判定に使う。
    if (req.method === 'GET' && req.query.sub === 'conn-status') {
      return res.json({ connected: !!(igConn?.token), username: igConn?.username || '', userId: igConn?.userId || '' });
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
        const { imageUrl, imageUrls, videoUrl, caption, mediaType } = req.body || {};
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const waitFinished = async (cid) => {
          for (let i = 0; i < 6; i++) {
            const sr = await fetch(`${BASE}/${cid}?fields=status_code&access_token=${IG_TOKEN}`);
            const sd = await sr.json();
            if (sd.status_code === 'FINISHED') return true;
            if (sd.status_code === 'ERROR') return false;
            await sleep(1500);
          }
          return true;
        };

        // ── カルーセル（複数画像2〜10枚） ──
        const imgs = Array.isArray(imageUrls) ? imageUrls.filter(Boolean) : [];
        if (imgs.length >= 2) {
          const childIds = [];
          for (const u of imgs.slice(0, 10)) {
            const cp = new URLSearchParams();
            cp.set('image_url', u); cp.set('is_carousel_item', 'true'); cp.set('access_token', IG_TOKEN);
            const cr = await fetch(`${BASE}/${IG_USER}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: cp.toString() });
            const cd = await cr.json();
            if (cd.error) return res.status(400).json({ error: 'カルーセル子作成失敗: ' + cd.error.message });
            childIds.push(cd.id);
          }
          const pp = new URLSearchParams();
          pp.set('media_type', 'CAROUSEL'); pp.set('children', childIds.join(','));
          if (caption) pp.set('caption', caption); pp.set('access_token', IG_TOKEN);
          const pr = await fetch(`${BASE}/${IG_USER}/media`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: pp.toString() });
          const pd = await pr.json();
          if (pd.error) return res.status(400).json({ error: 'カルーセル作成失敗: ' + pd.error.message });
          await waitFinished(pd.id);
          const fp = new URLSearchParams(); fp.set('creation_id', pd.id); fp.set('access_token', IG_TOKEN);
          const fr = await fetch(`${BASE}/${IG_USER}/media_publish`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: fp.toString() });
          const fd = await fr.json();
          if (fd.error) return res.status(400).json({ error: '公開失敗: ' + fd.error.message, creationId: pd.id });
          return res.json({ success: true, id: fd.id, creationId: pd.id, carousel: true });
        }

        // ── 単一画像 / 動画 ──
        const singleImage = imageUrl || imgs[0];
        if (!singleImage && !videoUrl) return res.status(400).json({ error: '画像または動画の公開URLが必須です' });

        const p1 = new URLSearchParams();
        if (videoUrl) { p1.set('video_url', videoUrl); p1.set('media_type', mediaType || 'REELS'); }
        else { p1.set('image_url', singleImage); }
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

        // 画像は処理完了まで待ってから公開（"Media ID is not available"対策）
        const okImg = await waitFinished(creationId);
        if (!okImg) return res.status(400).json({ error: '画像処理エラー', creationId });

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

  const access_token = storeId ? await getAccessToken(storeId) : await getValidCookieToken(req, res);
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

  // GBPに写真を追加（ライブラリの公開URLをGoogleビジネスプロフィールのメディアに登録）
  // ※社外書き込み。フロントで承認ダイアログを通してから呼ぶ設計。
  if (action === 'gbp-photo' && req.method === 'POST') {
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: '画像URLが必要です' });
    try {
      const r = await fetch(`https://mybusiness.googleapis.com/v4/${locationName}/media`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaFormat: 'PHOTO', sourceUrl: imageUrl, locationAssociation: { category: 'ADDITIONAL' } }),
      });
      const data = await r.json();
      if (data.error) return res.status(r.status).json({ error: data.error.message, pending: true });
      return res.json({ success: true, name: data.name });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
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
