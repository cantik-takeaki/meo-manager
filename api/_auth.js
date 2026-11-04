import crypto from 'node:crypto';
import { resolveSessionUser } from './_session.js';
export function sameSecret(a, b) {
  if (!a || !b) return false;
  const x=Buffer.from(String(a)), y=Buffer.from(String(b));
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
export function isMachine(req) { return sameSecret(req.headers.authorization, process.env.CRON_SECRET && `Bearer ${process.env.CRON_SECRET}`); }
export function sameOrigin(req) {
  if (['GET','HEAD','OPTIONS'].includes(req.method)) return true;
  if (req.headers['sec-fetch-site']==='cross-site') return false;
  const origin=req.headers.origin;
  if (!origin) return true;
  try { return new URL(origin).host === req.headers.host; } catch { return false; }
}
export async function requireStaff(req,res,{machine=false,admin=false}={}) {
  if (!sameOrigin(req)) {res.status(403).json({error:'同じサイトから操作してください'});return null;}
  if (machine && isMachine(req)) return {role:'machine',email:'system'};
  let user;try{user=await resolveSessionUser(req);}catch{res.status(503).json({error:'認証情報を確認できません。時間をおいて再試行してください'});return null;}
  if (!user) {res.status(401).json({error:'ログインが必要です'});return null;}
  if ((admin && !['super_admin','admin'].includes(user.role)) || (user.role==='viewer' && req.method!=='GET')) {
    res.status(403).json({error:'この操作を行う権限がありません'});return null;
  }
  return user;
}
