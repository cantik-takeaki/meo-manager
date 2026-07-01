// api/me.js — 認証（GET=状態 / POST=ログイン or 初回登録）
// 2系統: ①Google OAuth(access_token cookie・GBP連携に必要) ②ID/PW(KV保存・pw_session cookie)
// ID/PWは初回に画面から登録（KVにハッシュ保存）。以後そのID/PWでログイン。
import { getValidCookieToken, getMasterInfo } from './_tokens.js';
import { kvGet, kvSet } from './_kv.js';
import crypto from 'crypto';

const ADMIN_KEY = 'admin_credential'; // { user, salt, hash, name, createdAt }

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}
const hashPw = (pass, salt) => crypto.createHash('sha256').update('rakuraku|' + salt + '|' + pass).digest('hex');
// セッショントークン（保存済みハッシュから派生・cookie照合用）
const sessionToken = (cred) => crypto.createHash('sha256').update('sess|' + cred.user + '|' + cred.hash).digest('hex');

async function getCred() {
  // env のADMIN_USER/ADMIN_PASS があれば優先（後方互換）。無ければKVの登録情報。
  if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
    const salt = 'env';
    return { user: process.env.ADMIN_USER, salt, hash: hashPw(process.env.ADMIN_PASS, salt), name: process.env.ADMIN_NAME || '管理者', _env: true };
  }
  try { return await kvGet(ADMIN_KEY); } catch (e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const c = parseCookies(req);

  if (req.method === 'POST') {
    const { action, user, pass, name } = req.body || {};
    const cred = await getCred();

    // ── 初回登録（まだID/PWが無い時だけ・env設定時は不可）──
    if (action === 'signup') {
      if (cred) return res.status(400).json({ error: '既に管理者が登録されています。ログインしてください。' });
      if (!user || !pass) return res.status(400).json({ error: 'IDとパスワードを入力してください' });
      if (String(pass).length < 6) return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
      const salt = crypto.randomBytes(8).toString('hex');
      const rec = { user: String(user), salt, hash: hashPw(String(pass), salt), name: String(name || '管理者'), createdAt: new Date().toISOString() };
      await kvSet(ADMIN_KEY, rec);
      const MAXAGE = 60 * 60 * 24 * 30;
      res.setHeader('Set-Cookie', [
        `pw_session=${sessionToken(rec)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
        `user_name=${encodeURIComponent(rec.name)}; Path=/; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
      ]);
      return res.json({ success: true, name: rec.name });
    }

    // ── ログイン ──
    if (!cred) return res.status(400).json({ error: 'まだ管理者が登録されていません。先に登録してください。' });
    if (String(user) !== cred.user || hashPw(String(pass), cred.salt) !== cred.hash) {
      return res.status(401).json({ error: 'IDまたはパスワードが違います' });
    }
    const MAXAGE = 60 * 60 * 24 * 30;
    res.setHeader('Set-Cookie', [
      `pw_session=${sessionToken(cred)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
      `user_name=${encodeURIComponent(cred.name || '管理者')}; Path=/; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
    ]);
    return res.json({ success: true, name: cred.name || '管理者' });
  }

  // ── GET: ログイン状態 ──
  // ①Google
  if (c.access_token) {
    try { await getValidCookieToken(req, res); } catch (e) {}
    return res.json({ loggedIn: true, method: 'google', email: c.user_email, name: c.user_name, picture: c.user_picture });
  }
  // ②ID/PW（pw_session が現在の資格情報から派生したトークンと一致）
  const cred = await getCred();
  if (cred && c.pw_session && c.pw_session === sessionToken(cred)) {
    const gbp = await getMasterInfo(); // マスターGoogle接続の状態（常時ログイン）
    return res.json({ loggedIn: true, method: 'password', name: cred.name || c.user_name || '管理者', gbpConnected: gbp.connected, gbpEmail: gbp.email });
  }
  // 未ログイン。needsSetup=true なら「まだ管理者未登録＝初回登録画面を出す」
  return res.status(401).json({ loggedIn: false, needsSetup: !cred });
}
