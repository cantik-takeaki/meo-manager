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

// 管理ログイン用：CookieのGoogleアクセストークンを検証し、
// 期限切れなら refresh_token で更新してCookieを再セットする（セッション持続）。
export async function getValidCookieToken(req, res) {
  const c = parseCookieHeader(req.headers.cookie || '');
  if (!c.access_token) return null;
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
