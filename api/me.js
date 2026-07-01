// api/me.js — ログイン状態確認（GET）＋ ID/PWログイン（POST）
// 認証は2系統: ①Google OAuth(access_token cookie・GBP連携に必要) ②ID/PW(pw_session cookie)
// どちらかでログイン扱い。GBP機能(口コミ/順位/インサイト)はGoogle連携が別途必要。
import { getValidCookieToken } from './_tokens.js';
import crypto from 'crypto';

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

// ID/PWセッションの署名トークン（env ADMIN_USER/ADMIN_PASS ＋ 固定ソルトから生成）
function pwToken() {
  const u = process.env.ADMIN_USER || '';
  const p = process.env.ADMIN_PASS || '';
  if (!u || !p) return null; // 未設定ならID/PWログインは無効（Googleのみ）
  return crypto.createHash('sha256').update('rakuraku|' + u + '|' + p).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const c = parseCookies(req);

  // ── ID/PWログイン（POST）──
  if (req.method === 'POST') {
    const tok = pwToken();
    if (!tok) return res.status(500).json({ error: 'ID/PWログインは未設定です（Vercel環境変数 ADMIN_USER/ADMIN_PASS を設定してください）' });
    const { user, pass } = req.body || {};
    if (String(user) !== process.env.ADMIN_USER || String(pass) !== process.env.ADMIN_PASS) {
      return res.status(401).json({ error: 'IDまたはパスワードが違います' });
    }
    const MAXAGE = 60 * 60 * 24 * 30; // 30日
    res.setHeader('Set-Cookie', [
      `pw_session=${tok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
      `user_name=${encodeURIComponent(process.env.ADMIN_NAME || '管理者')}; Path=/; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
    ]);
    return res.json({ success: true, name: process.env.ADMIN_NAME || '管理者' });
  }

  // ── ログイン状態確認（GET）──
  // ①Google: access_token cookie（GBP連携ができる本認証）
  if (c.access_token) {
    try { await getValidCookieToken(req, res); } catch (e) { /* 更新失敗時も続行 */ }
    return res.json({ loggedIn: true, method: 'google', email: c.user_email, name: c.user_name, picture: c.user_picture });
  }
  // ②ID/PW: pw_session cookie が有効トークンと一致
  const tok = pwToken();
  if (tok && c.pw_session === tok) {
    return res.json({ loggedIn: true, method: 'password', name: c.user_name || '管理者' });
  }
  return res.status(401).json({ loggedIn: false });
}
