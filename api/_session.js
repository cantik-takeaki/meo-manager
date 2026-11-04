import crypto from 'node:crypto';
import { getKV } from './_kv.js';
async function kvGet(key){
 const {url,token}=getKV();const response=await fetch(`${url}/get/${encodeURIComponent(key)}`,{headers:{Authorization:`Bearer ${token}`}});const data=await response.json();
 if(!response.ok||data.error)throw new Error('認証情報を確認できません');
 return data.result?JSON.parse(data.result):null;
}
const ADMIN_KEY='admin_credential', TEAM_KEY='team_users';
function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) { try { c[k.trim()] = decodeURIComponent(v.join('=')); } catch { /* 不正Cookieは無視 */ } }
  });
  return c;
}
const hashPw = (pass, salt) => crypto.createHash('sha256').update('rakuraku|' + salt + '|' + pass).digest('hex');
const sessionToken = (cred) => crypto.createHash('sha256').update('sess|' + cred.user + '|' + cred.hash).digest('hex');

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
  const configured=process.env.KV_REST_API_URL&&process.env.KV_REST_API_TOKEN;
  let stored=null;
  if(configured)stored=await kvGet(ADMIN_KEY);
  if(stored?.user&&stored?.hash&&stored._userSet)return stored;
  if(hasEnv)return envCred();
  if(stored?.user&&stored?.hash)return stored;
  return null;
}


const teamSessionToken = (u) => crypto.createHash('sha256').update('team|' + u.user + '|' + u.hash).digest('hex');
async function getTeamUsers() { try { return (await kvGet(TEAM_KEY)) || []; } catch (e) { return []; } }

async function resolveSessionUser(req, c = parseCookies(req)) {
  if (c.team_user) {
    const users = await getTeamUsers();
    const u = users.find(x => x.user === String(c.team_user).toLowerCase() && x.active !== false && ['admin','editor','viewer'].includes(x.role));
    if (u && c.pw_session === teamSessionToken(u)) return { role: u.role, email: u.user, name: u.name, team: true };
  }
  const cred = await getCred();
  if (cred && c.pw_session === sessionToken(cred)) return { role: 'super_admin', email: cred.user, name: cred.name, primary: true, _env: !!cred._env };
  return null;
}


export { parseCookies, hashPw, sessionToken, getCred, teamSessionToken, getTeamUsers, resolveSessionUser };

export const sessionUser = req => resolveSessionUser(req);
export const canUseAdmin = (u,method) => !!u && (['super_admin','admin'].includes(u.role)||method==='GET');
