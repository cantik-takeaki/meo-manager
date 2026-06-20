// api/me.js — ログイン状態確認（ロード時にトークン更新＆セッション延長）
import { getValidCookieToken } from './_tokens.js';

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
  const c = parseCookies(req);
  if (!c.access_token) return res.status(401).json({ loggedIn: false });
  // 期限切れていれば refresh_token で更新し、Cookieを再セット（セッションを30日持続）
  try { await getValidCookieToken(req, res); } catch (e) { /* 更新失敗時も従来通り続行 */ }
  res.json({
    loggedIn: true,
    email: c.user_email,
    name: c.user_name,
    picture: c.user_picture,
  });
}
