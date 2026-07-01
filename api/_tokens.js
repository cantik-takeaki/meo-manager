// api/_tokens.js — GBPトークン管理（取得・自動更新）
import { kvGet, kvSet } from './_kv.js';

export async function getAccessToken(storeId) {
  const data = await kvGet(`gbp_tokens_${storeId}`);
  if (!data) return null;

  // 有効期限チェック（5分の余裕を持つ）
  if (data.expires_at && Date.now() < data.expires_at - 5 * 60 * 1000) {
    return data.access_token;
  }

  // リフレッシュ
  if (!data.refresh_token) return null;
  const refreshed = await refreshToken(data.refresh_token);
  if (!refreshed) return null;

  const updated = {
    ...data,
    access_token: refreshed.access_token,
    expires_at: Date.now() + refreshed.expires_in * 1000,
  };
  await kvSet(`gbp_tokens_${storeId}`, updated);
  return updated.access_token;
}

function parseCookieHeader(header) {
  const c = {};
  (header || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

const SESSION_MAXAGE = 60 * 60 * 24 * 30; // 30日
const MASTER_KEY = 'master_gbp'; // cantikのGoogle接続をサーバー側に永続保存（常時ログイン）

// マスターGoogle接続を保存（callbackで管理者がGoogle連携したとき）
export async function saveMasterToken(tokens, user) {
  if (!tokens.refresh_token) return; // refresh_tokenが無いと永続化できない
  await kvSet(MASTER_KEY, {
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
    email: user?.email, name: user?.name, connected_at: new Date().toISOString(),
  });
}
export async function getMasterInfo() {
  try { const d = await kvGet(MASTER_KEY); return d ? { connected: true, email: d.email, connected_at: d.connected_at } : { connected: false }; }
  catch (e) { return { connected: false }; }
}
// マスターGoogleのアクセストークン（KV永続・refreshで自動更新）。cookie無しでも使える。
export async function getMasterToken() {
  const d = await kvGet(MASTER_KEY);
  if (!d) return null;
  if (d.access_token && d.expires_at && Date.now() < d.expires_at - 5 * 60 * 1000) return d.access_token;
  if (!d.refresh_token) return d.access_token || null;
  const refreshed = await refreshToken(d.refresh_token);
  if (!refreshed || !refreshed.access_token) return d.access_token || null;
  await kvSet(MASTER_KEY, { ...d, access_token: refreshed.access_token, expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000 });
  return refreshed.access_token;
}

// 管理用トークン取得：①Cookieのトークン（更新）→ 無ければ ②マスターGoogle接続（KV永続）。
// これにより ID/PW ログインでも、cantikがGoogle連携済みなら常にGBP機能が使える。
export async function getValidCookieToken(req, res) {
  const c = parseCookieHeader(req.headers.cookie || '');
  if (!c.access_token) return await getMasterToken(); // cookie無し→マスター接続で常時ログイン
  const expiresAt = parseInt(c.token_expires_at || '0', 10);
  // まだ有効（5分の余裕）ならそのまま
  if (expiresAt && Date.now() < expiresAt - 5 * 60 * 1000) return c.access_token;
  // refresh_tokenが無ければ従来通り（更新不可）
  if (!c.refresh_token) return c.access_token;
  const refreshed = await refreshToken(c.refresh_token);
  if (!refreshed || !refreshed.access_token) return c.access_token;
  const newExp = Date.now() + (refreshed.expires_in || 3600) * 1000;
  const base = `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAXAGE}`;
  const pub = `Path=/; Secure; SameSite=Lax; Max-Age=${SESSION_MAXAGE}`;
  const newCookies = [
    `access_token=${refreshed.access_token}; ${base}`,
    `refresh_token=${c.refresh_token}; ${base}`,
    `token_expires_at=${newExp}; ${pub}`,
  ];
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, newCookies) : newCookies);
  return refreshed.access_token;
}

async function refreshToken(refresh_token) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (data.error) return null;
  return data;
}
