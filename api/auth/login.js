import crypto from 'node:crypto';
import { requireStaff } from '../_auth.js';
import { redis } from '../../lib/workspace-store.js';
// api/auth/login.js — OAuthログイン開始（管理者ログイン / GBP連携 / Instagram連携 兼用）
export default async function handler(req, res) {
  const redirectUri = process.env.REDIRECT_URI || 'https://meo-manager-rho.vercel.app/api/auth/callback';

  // provider=instagram → お客さん（または自社）のInstagram Business Login連携
  // ※同じ /api/auth/callback に戻る。stateの "ig:" 接頭辞でcallback側が判別する。
  const actor=await requireStaff(req,res,{admin:true}); if(!actor) return;
  const { store, provider } = req.query;
  if(store && !/^[a-zA-Z0-9_-]{1,100}$/.test(store)) return res.status(400).json({error:'店舗IDが不正です'});
  const state=crypto.randomBytes(32).toString('hex');
  const target=provider==='instagram'?`ig:${store||'cantik'}`:store?`store:${store}`:'';
  await redis(['SET','oauth_pending_'+state,JSON.stringify({email:actor.email,target}),'EX',600]);
  res.setHeader('Set-Cookie',`oauth_state=${state}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
  if (provider === 'instagram') {
    const igAppId = process.env.IG_APP_ID || '1664344041536126'; // Instagram App ID（非機密）
    const igScopes = [
      'instagram_business_basic',
      'instagram_business_content_publish',
      'instagram_business_manage_comments',
      'instagram_business_manage_insights',
      'instagram_business_manage_messages',
    ].join(',');
    const igUrl = new URL('https://www.instagram.com/oauth/authorize');
    igUrl.searchParams.set('client_id', igAppId);
    igUrl.searchParams.set('redirect_uri', redirectUri);
    igUrl.searchParams.set('response_type', 'code');
    igUrl.searchParams.set('scope', igScopes);
    igUrl.searchParams.set('state', state);
    if (req.query.lang === 'en') igUrl.searchParams.set('locale', 'en_US');
    return res.redirect(igUrl.toString());
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;

  const scopes = [
    'https://www.googleapis.com/auth/business.manage',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ].join(' ');

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes);
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);

  res.redirect(url.toString());
}
