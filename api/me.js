// api/me.js — 認証（GET=状態 / POST=登録・ログイン・2段階認証）
// ユーザー入口: メール＋パスワード → メールに送られた6桁コードで2段階認証 → ログイン。
// GBP(Google)は裏で常時接続(_tokens.jsのmaster)。ログイン画面にGoogleは出さない。
// メール送信が未設定(RESEND_API_KEY無)の場合は2段階を自動スキップ(パスワードのみ)＝ロックアウト防止。
import { getValidCookieToken, getMasterInfo } from './_tokens.js';
import { kvGet, kvSet } from './_kv.js';
import crypto from 'crypto';

const ADMIN_KEY = 'admin_credential'; // { user(email), salt, hash, name, createdAt }
const NAME_KEY = 'admin_display_name'; // 表示名の上書き（env管理でも表示名だけは変えられる）
const TWOFA_KEY = 'twofa_enabled'; // 2段階認証の設定（false=無効。未設定=有効＝従来挙動）
const TEAM_KEY = 'team_users'; // 追加ユーザー配列 [{ user,salt,hash,name,role,createdAt }]。roleは admin/editor/viewer
const ROLES = ['admin', 'editor', 'viewer'];

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

function envCred() {
  const salt = 'env';
  return { user: String(process.env.ADMIN_USER).toLowerCase(), salt, hash: hashPw(process.env.ADMIN_PASS, salt), name: process.env.ADMIN_NAME || '管理者', _env: true };
}

async function getCred() {
  // 優先順位（社長指示2026-07-04で設定ページからのメール/PW変更に対応）:
  // 1) ADMIN_RESET=1 が設定されていれば env を強制（新PWを忘れた時の復旧用エスケープハッチ）
  // 2) 設定ページから明示変更されたKV資格情報（_userSet=true のみ。テスト残骸の古いKVは対象外）
  // 3) env（ADMIN_USER/ADMIN_PASS）
  // 4) KV（envが無い環境で初回セットアップした場合）
  const hasEnv = process.env.ADMIN_USER && process.env.ADMIN_PASS;
  if (hasEnv && process.env.ADMIN_RESET === '1') return envCred();
  try {
    const kv = await kvGet(ADMIN_KEY);
    if (kv && kv.user && kv.hash && kv._userSet) return kv;
  } catch (e) {}
  if (hasEnv) return envCred();
  try { const kv = await kvGet(ADMIN_KEY); if (kv && kv.user && kv.hash) return kv; } catch (e) {}
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

function setSession(res, cred, dispName) {
  const MAXAGE = 60 * 60 * 24 * 30;
  res.setHeader('Set-Cookie', [
    `pw_session=${sessionToken(cred)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
    `user_name=${encodeURIComponent(dispName || cred.name || '管理者')}; Path=/; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
  ]);
}

// 表示名（KVの上書きがあれば優先。env管理アカウントでも表示名だけは設定ページから変更できる）
async function getDisplayName(cred) {
  try { const nm = await kvGet(NAME_KEY); if (nm) return nm; } catch (e) {}
  return (cred && cred.name) || '管理者';
}

// ── チームユーザー（追加メンバー）── プライマリ管理者は常にsuper_admin（ロックアウト防止）。
const teamSessionToken = (u) => crypto.createHash('sha256').update('team|' + u.user + '|' + u.hash).digest('hex');
async function getTeamUsers() { try { return (await kvGet(TEAM_KEY)) || []; } catch (e) { return []; } }
function setTeamSession(res, u) {
  const MAXAGE = 60 * 60 * 24 * 30;
  res.setHeader('Set-Cookie', [
    // 既存API(存在チェックのみ)を通すため pw_session に team トークンを入れる。GET /api/me が team_user で識別しロールを返す。
    `pw_session=${teamSessionToken(u)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
    `team_user=${encodeURIComponent(u.user)}; Path=/; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
    `user_name=${encodeURIComponent(u.name || u.user)}; Path=/; Secure; SameSite=Lax; Max-Age=${MAXAGE}`,
  ]);
}
// リクエストのログインユーザーを解決（プライマリ=super_admin / チーム=各ロール）。not logged in → null
async function resolveSessionUser(req, c) {
  if (c.team_user) {
    const users = await getTeamUsers();
    const u = users.find(x => x.user === String(c.team_user).toLowerCase());
    if (u && c.pw_session === teamSessionToken(u)) return { role: u.role, email: u.user, name: u.name, team: true };
  }
  const cred = await getCred();
  if (cred && c.pw_session === sessionToken(cred)) return { role: 'super_admin', email: cred.user, name: cred.name, primary: true, _env: !!cred._env };
  return null;
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

    // ── パスワード変更（ログイン中のみ・env管理でも変更可＝KVに_userSetで保存しenvより優先） ──
    // 復旧: 新PWを忘れた場合はVercelで ADMIN_RESET=1 を設定するとenvのADMIN_USER/PASSで必ずログインできる
    if (action === 'changepw') {
      if (!cred) return res.status(400).json({ error: '未登録です' });
      if (!(c.pw_session && c.pw_session === sessionToken(cred))) return res.status(401).json({ error: 'ログインが必要です' });
      if (hashPw(String(pass || ''), cred.salt) !== cred.hash) return res.status(401).json({ error: '現在のパスワードが違います' });
      if (String(newPass || '').length < 6) return res.status(400).json({ error: '新しいパスワードは6文字以上にしてください' });
      const salt = crypto.randomBytes(8).toString('hex');
      const rec = { user: cred.user, salt, hash: hashPw(String(newPass), salt), name: cred.name || '管理者', createdAt: cred.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), _userSet: true };
      await kvSet(ADMIN_KEY, rec);
      setSession(res, rec, await getDisplayName(rec));
      return res.json({ success: true });
    }

    // ── ログインメールアドレス変更（ログイン中のみ・現在のパスワード必須） ──
    if (action === 'changemail') {
      if (!cred) return res.status(400).json({ error: '未登録です' });
      if (!(c.pw_session && c.pw_session === sessionToken(cred))) return res.status(401).json({ error: 'ログインが必要です' });
      if (hashPw(String(pass || ''), cred.salt) !== cred.hash) return res.status(401).json({ error: '現在のパスワードが違います' });
      const newMail = String((req.body || {}).newEmail || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newMail)) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
      const rec = { user: newMail, salt: cred.salt, hash: cred.hash, name: cred.name || '管理者', createdAt: cred.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(), _userSet: true };
      await kvSet(ADMIN_KEY, rec);
      setSession(res, rec, await getDisplayName(rec)); // user変更でセッショントークンが変わるため再発行
      return res.json({ success: true, email: newMail });
    }

    // ── プロフィール（表示名）変更（ログイン中のみ）──
    if (action === 'profile') {
      if (!cred) return res.status(400).json({ error: '未登録です' });
      if (!(c.pw_session && c.pw_session === sessionToken(cred))) return res.status(401).json({ error: 'ログインが必要です' });
      const nm = String(name || '').trim();
      if (!nm) return res.status(400).json({ error: '表示名を入力してください' });
      if (nm.length > 30) return res.status(400).json({ error: '表示名は30文字以内にしてください' });
      await kvSet(NAME_KEY, nm);
      res.setHeader('Set-Cookie', `user_name=${encodeURIComponent(nm)}; Path=/; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}`);
      return res.json({ success: true, name: nm });
    }

    // ── 2段階認証のON/OFF（ログイン中のみ）──
    if (action === 'twofa') {
      if (!cred) return res.status(400).json({ error: '未登録です' });
      if (!(c.pw_session && c.pw_session === sessionToken(cred))) return res.status(401).json({ error: 'ログインが必要です' });
      const enabled = !!(req.body || {}).enabled;
      if (enabled && !process.env.RESEND_API_KEY) {
        return res.status(400).json({ error: 'メール送信（RESEND_API_KEY）が未設定のため2段階認証を有効にできません' });
      }
      await kvSet(TWOFA_KEY, enabled);
      return res.json({ success: true, enabled });
    }

    // ── チームユーザー管理（super_adminのみ）──
    if (action === 'team-list' || action === 'team-add' || action === 'team-del') {
      const me = await resolveSessionUser(req, c);
      if (!me || me.role !== 'super_admin') return res.status(403).json({ error: '管理者権限が必要です' });
      const users = await getTeamUsers();
      if (action === 'team-list') {
        return res.json({ users: users.map(u => ({ user: u.user, name: u.name, role: u.role, createdAt: u.createdAt })) });
      }
      if (action === 'team-add') {
        const em = String(user || '').trim().toLowerCase();
        const role = ROLES.includes((req.body || {}).role) ? req.body.role : 'viewer';
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) return res.status(400).json({ error: 'メールアドレスの形式が正しくありません' });
        if (cred && cred.user === em) return res.status(400).json({ error: 'このメールは管理者アカウントです' });
        if (String(pass || '').length < 6) return res.status(400).json({ error: 'パスワードは6文字以上にしてください' });
        const salt = crypto.randomBytes(8).toString('hex');
        const rec = { user: em, salt, hash: hashPw(String(pass), salt), name: String(name || em).slice(0, 40), role, createdAt: new Date().toISOString() };
        const idx = users.findIndex(u => u.user === em);
        if (idx >= 0) users[idx] = { ...users[idx], ...rec }; else users.push(rec);
        await kvSet(TEAM_KEY, users);
        return res.json({ success: true });
      }
      if (action === 'team-del') {
        const em = String(user || '').trim().toLowerCase();
        await kvSet(TEAM_KEY, users.filter(u => u.user !== em));
        return res.json({ success: true });
      }
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
      const dn = await getDisplayName(cred);
      setSession(res, cred, dn);
      return res.json({ success: true, name: dn });
    }

    // ── ログイン（1手目: メール＋パスワード）──
    if (!cred) return res.status(400).json({ error: 'まだ登録されていません。先に登録してください。' });
    const _em = String(user || '').toLowerCase();
    // プライマリ管理者に一致しなければチームユーザーを照合（チームは2FA無しで即ログイン）
    if (_em !== cred.user || hashPw(String(pass), cred.salt) !== cred.hash) {
      const team = (await getTeamUsers()).find(u => u.user === _em);
      if (team && hashPw(String(pass), team.salt) === team.hash) {
        setTeamSession(res, team);
        return res.json({ success: true, name: team.name || team.user, role: team.role });
      }
      return res.status(401).json({ error: 'メールアドレスまたはパスワードが違います' });
    }
    // 設定で2段階認証がOFFなら、コードを送らずそのままログイン
    const twofaPref = await kvGet(TWOFA_KEY);
    if (twofaPref === false) {
      const dn = await getDisplayName(cred);
      setSession(res, cred, dn);
      return res.json({ success: true, name: dn, twofaSkipped: true });
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
    const dn = await getDisplayName(cred);
    setSession(res, cred, dn);
    return res.json({ success: true, name: dn, twofaSkipped: true });
  }

  // ── GET: ログイン状態 ──
  // チームユーザー（team_user cookie）を先に判定→各ロールを返す。
  if (c.team_user) {
    const users = await getTeamUsers();
    const tu = users.find(x => x.user === String(c.team_user).toLowerCase());
    if (tu && c.pw_session === teamSessionToken(tu)) {
      const gbp = await getMasterInfo();
      return res.json({
        loggedIn: true, method: 'password', name: tu.name || tu.user, email: tu.user, role: tu.role,
        gbpConnected: gbp.connected, gbpEmail: gbp.email, twofaAvailable: false, twofaEnabled: false,
      });
    }
  }
  // パスワードセッションを優先判定する。GBP連携で access_token Cookie が残っていても、
  // 実際のログインはメール＋パスワードなので、設定ページで正しくアカウント管理できるようにする。
  const cred = await getCred();
  if (cred && c.pw_session && c.pw_session === sessionToken(cred)) {
    const gbp = await getMasterInfo();
    const dn = await getDisplayName(cred);
    const twofaPref = await kvGet(TWOFA_KEY);
    const twofaAvailable = !!process.env.RESEND_API_KEY;
    return res.json({
      loggedIn: true, method: 'password', name: dn, email: cred.user, envManaged: !!cred._env, role: 'super_admin',
      gbpConnected: gbp.connected, gbpEmail: gbp.email,
      twofaAvailable, twofaEnabled: twofaAvailable && twofaPref !== false,
    });
  }
  if (c.access_token) {
    try { await getValidCookieToken(req, res); } catch (e) {}
    return res.json({ loggedIn: true, method: 'google', email: c.user_email, name: c.user_name, picture: c.user_picture });
  }
  return res.status(401).json({ loggedIn: false, needsSetup: !cred });
}
