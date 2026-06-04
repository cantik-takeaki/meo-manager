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
