// api/line-hook.js — 公式LINE「株式会社cantik」の受け口（ラクラクMEO側）
// ------------------------------------------------------------------
// 社長指示 2026-10-06「グループでokと連絡したらクチコミするように／2人しかいないからどちらかがokしたらいい」
// cantik.co.jp/line/webhook.php（月次レポート）を置き換えるのではなく、その前に立つ中継：
//   ・署名（X-Line-Signature）を検証する
//   ・グループのIDを記録する（確認先の指定は管理画面から行う。名前での自動設定はしない）
//   ・口コミのボタン（rv=ok/ng）は、ここで受けて admin.js の review-approve に渡し、結果をグループに返信する
//   ・それ以外のイベントは、届いた本文と署名をそのまま webhook.php に中継する（月次レポートの動きは変えない）
// LINE Developers の Webhook URL をここに向けたときだけ動く（向ける前は何も起きない）。
import crypto from 'node:crypto';
import { kvGet, kvSet } from './_kv.js';
import { LINE_TOKEN_KEY } from './_review_line.js';

export const config = { api: { bodyParser: false } };   // 署名検証と中継に「届いたままの本文」が要る

const FORWARD = 'https://cantik.co.jp/line/webhook.php';
const BASE = 'https://meo-manager-rho.vercel.app';

async function rawBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(typeof c === 'string' ? Buffer.from(c) : c);
  return Buffer.concat(chunks);
}

async function lineApi(token, method, path, body) {
  const r = await fetch('https://api.line.me' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = {}; try { j = await r.json(); } catch (e) {}
  return { status: r.status, j };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('OK');
  const raw = await rawBody(req);
  const sig = req.headers['x-line-signature'] || '';
  const secret = await kvGet('line_channel_secret__review_alert');
  const calc = secret ? crypto.createHmac('sha256', secret).update(raw).digest('base64') : '';
  if (!sig || !calc || sig.length !== calc.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(calc))) {
    return res.status(403).send('forbidden');
  }
  let events = [];
  try { events = JSON.parse(raw.toString('utf8')).events || []; } catch (e) {}
  const conn = await kvGet(LINE_TOKEN_KEY);
  const token = conn && conn.token;

  // 1) グループのIDを記録する（管理画面の一覧に出すため。送り先の設定はここではしない）
  const seen = (await kvGet('line_seen_groups')) || {};
  let seenChanged = false;
  for (const e of events) {
    const gid = e.source && e.source.groupId;
    if (!gid) continue;
    if (!seen[gid] && token) {
      const g = await lineApi(token, 'GET', `/v2/bot/group/${gid}/summary`);
      seen[gid] = { name: (g.j && g.j.groupName) || '', firstAt: new Date().toISOString() };
      seenChanged = true;
    }
    if (seen[gid]) { seen[gid].lastAt = new Date().toISOString(); seenChanged = true; }
    // ★グループ名で送り先を自動設定しない（2026-10-30）。
    //   LINEのグループ名は誰でも自由に付けられるので、「ラクラクMEO」を含む名前の
    //   グループにこのボットを招待するだけで、口コミ本文と返信案がそこへ流れ、
    //   「この返信で送る」まで外部に押させることになっていた。
    //   送り先は管理画面から明示的に選ぶ（一覧＝line-seen-groups / 設定＝review-alert-line）。
    //   ここは「見かけたグループを記録する」だけに留める。
  }
  if (seenChanged) await kvSet('line_seen_groups', seen);

  // 2) 口コミのボタン（rv=ok/ng）はここで処理する
  const rvEvents = events.filter(e => e.type === 'postback' && /(^|&)rv=/.test((e.postback && e.postback.data) || ''));
  for (const e of rvEvents) {
    const q = new URLSearchParams(e.postback.data);
    let text = '処理に失敗しました。ラクラクMEOの口コミ画面で確認してください。';
    try {
      const sec = await kvGet('review_approve_secret');
      const r = await fetch(`${BASE}/api/admin?action=review-approve`, {
        method: 'POST', headers: { Authorization: `Bearer ${sec}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: q.get('rv'), id: q.get('id') || '', userId: e.source.userId || '',
          groupId: e.source.groupId || '', sourceType: e.source.type || '' }),
      });
      const j = await r.json(); if (j && j.text) text = j.text;
    } catch (err) { /* text は既定の失敗文 */ }
    if (e.replyToken && token) await lineApi(token, 'POST', '/v2/bot/message/reply', { replyToken: e.replyToken, messages: [{ type: 'text', text }] });
  }

  // 3) それ以外は月次レポートの受け口へ、届いた本文と署名をそのまま中継する
  //    口コミのボタンだけの通知は中継しない（webhook.php が「管理者のみ」等を二重に返すため）
  const onlyRv = events.length > 0 && rvEvents.length === events.length;
  if (!onlyRv) {
    try {
      await fetch(FORWARD, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sig }, body: raw });
    } catch (e) { /* 中継の失敗でLINEへの応答を落とさない */ }
  }
  return res.status(200).send('OK');
}
