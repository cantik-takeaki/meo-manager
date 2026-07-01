// api/me.js — 認証（GET=状態 / POST=登録・ログイン・2段階認証）
// ユーザー入口: メール＋パスワード → メールに送られた6桁コードで2段階認証 → ログイン。
// GBP(Google)は裏で常時接続(_tokens.jsのmaster)。ログイン画面にGoogleは出さない。
// メール送信が未設定(RESEND_API_KEY無)の場合は2段階を自動スキップ(パスワードのみ)＝ロックアウト防止。
import { getValidCookieToken, getMasterInfo } from './_tokens.js';
import { kvGet, kvSet } from './_kv.js';
import crypto from 'crypto';

const ADMIN_KEY = 'admin_credential'; // { user(email), salt, hash, name, createdAt }

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}
const hashPw = (pass, salt) => crypto.createHash('sha256').update('rakuraku|' + salt + '|' + pass).digest('hex');
const sessionToken = (cred) => crypto.createHash('sha256').update('sess|' + cred.user + '|' + cred.hash).digest('hex');
const codeKey = (email) => 'login_code_' + String(email).toLowerCase();

async function getCred() {
  // KVに登録があれば最優先（パスワード変更を永続化するため）。無ければ環境変数のブートストラップ資格情報。
  try { const kv = await kvGet(ADMIN_KEY); if (kv && kv.user && kv.hash) return kv; } catch (e) {}
  if (process.env.ADMIN_USER && process.env.ADMIN_PASS) {
    const salt = 'env';
    return { user: String(process.env.ADMIN_USER).toLowerCase(), salt, hash: hashPw(process.env.ADMIN_PASS, salt), name: process.env.ADMIN_NAME || '管理者', _env: true };
  }
  return null;
}

// メール送信（Resend・無料枠）。未設定なら false を返す（＝2段階スキップ）。
async function sendMail(to, subject, html) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return false;
  const from = process.env.RESEND_FROM || 'ラクラクMEO <onboarding@resend.dev>';
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    });
    return r.ok;
  } catch (e) { return false; }
}

function setSession(res, cred) {
  const MAXAGE = 60 * 60 * 24 * 30;
  res.setHeader('Set-Cookie', [
    `pw_session=${sessionToken(cred)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
    `user_name=${encodeURIComponent(cred.name || '管理者')}; Path=/; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
  ]);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const c = parseCookies(req);

  if (req.method === 'POST') {
    const { action, user, pass, newPass, name, code } = req.body || {};
    const cred = await getCred();

    // ── 初回登録（管理者未登録のときだけ）──
    if (action === 'signup') {
      if (cred) return res.status(400).json({ error: '既に登録済みです。ログインしてください。' });
      if (!user || !pass) return res.status(400).json({ error: 'メールとパスワードを入力してください' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(user))) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
      if (String(pass).length < 6) return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
      const salt = crypto.randomBytes(8).toString('hex');
      const rec = { user: String(user).toLowerCase(), salt, hash: hashPw(String(pass), salt), name: String(name || '管理者'), createdAt: new Date().toISOString() };
      await kvSet(ADMIN_KEY, rec);
      setSession(res, rec);
      return res.json({ success: true, name: rec.name });
    }

    // ── パスワード変更（ログイン中のみ）──
    if (action === 'changepw') {
      if (!cred) return res.status(400).json({ error: '未登録です' });
      if (!(c.pw_session && c.pw_session === sessionToken(cred))) return res.status(401).json({ error: 'ログインが必要です' });
      if (hashPw(String(pass || ''), cred.salt) !== cred.hash) return res.status(401).json({ error: '現在のパスワードが違います' });
      if (String(newPass || '').length < 6) return res.status(400).json({ error: '新しいパスワードは6文字以上にしてください' });
      const salt = crypto.randomBytes(8).toString('hex');
      const rec = { user: cred.user, salt, hash: hashPw(String(newPass), salt), name: cred.name || '管理者', createdAt: cred.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      await kvSet(ADMIN_KEY, rec);
      setSession(res, rec);
      return res.json({ success: true });
    }

    // ── コード検証（2段階認証の2手目）──
    if (action === 'verify') {
      if (!cred) return res.status(400).json({ error: '未登録です' });
      const rec = await kvGet(codeKey(cred.user));
      if (!rec) return res.status(400).json({ error: 'コードの有効期限が切れました。もう一度ログインしてください。' });
      if (Date.now() > rec.exp) { await kvSet(codeKey(cred.user), null); return res.status(400).json({ error: 'コードの有効期限が切れました' }); }
      if ((rec.tries || 0) >= 5) return res.status(429).json({ error: '試行回数の上限です。もう一度ログインしてください。' });
      if (String(code) !== rec.code) {
        await kvSet(codeKey(cred.user), { ...rec, tries: (rec.tries || 0) + 1 });
        return res.status(401).json({ error: '認証コードが違います' });
      }
      await kvSet(codeKey(cred.user), null); // 使い切り
      setSession(res, cred);
      return res.json({ success: true, name: cred.name || '管理者' });
    }

    // ── ログイン（1手目: メール＋パスワード）──
    if (!cred) return res.status(400).json({ error: 'まだ登録されていません。先に登録してください。' });
    if (String(user).toLowerCase() !== cred.user || hashPw(String(pass), cred.salt) !== cred.hash) {
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
    }
    // 6桁コードを生成→メール送信。送れたら2段階へ、送れなければ(未設定)そのままログイン。
    const digits = (crypto.randomBytes(4).readUInt32BE(0) % 1000000).toString().padStart(6, '0');
    const sent = await sendMail(cred.user, 'ラクラクMEO 認証コード',
      `<div style="font-family:sans-serif"><p>ラクラクMEOのログイン認証コードです。</p><p style="font-size:28px;font-weight:800;letter-spacing:4px">${digits}</p><p style="color:#666;font-size:13px">10分間有効です。心当たりがない場合はこのメールを破棄してください。</p></div>`);
    if (sent) {
      await kvSet(codeKey(cred.user), { code: digits, exp: Date.now() + 10 * 60 * 1000, tries: 0 });
      return res.json({ step: 'code', email: cred.user });
    }
    // メール未設定 → 2段階スキップ（パスワードのみでログイン）
    setSession(res, cred);
    return res.json({ success: true, name: cred.name || '管理者', twofaSkipped: true });
  }

  // ── GET: ログイン状態 ──
  if (c.access_token) {
    try { await getValidCookieToken(req, res); } catch (e) {}
    return res.json({ loggedIn: true, method: 'google', email: c.user_email, name: c.user_name, picture: c.user_picture });
  }
  const cred = await getCred();
  if (cred && c.pw_session && c.pw_session === sessionToken(cred)) {
    const gbp = await getMasterInfo();
    return res.json({ loggedIn: true, method: 'password', name: cred.name || c.user_name || '管理者', gbpConnected: gbp.connected, gbpEmail: gbp.email });
  }
  return res.status(401).json({ loggedIn: false, needsSetup: !cred });
}
