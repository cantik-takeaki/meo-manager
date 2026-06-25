// api/auth/login.js — OAuthログイン開始（管理者ログイン / GBP連携 / Instagram連携 兼用）
export default function handler(req, res) {
  const redirectUri = process.env.REDIRECT_URI || 'https://meo-manager-rho.vercel.app/api/auth/callback';

  // provider=instagram → お客さん（または自社）のInstagram Business Login連携
  // ※同じ /api/auth/callback に戻る。stateの "ig:" 接頭辞でcallback側が判別する。
  const { store, provider } = req.query;
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
    igUrl.searchParams.set('state', `ig:${store || 'cantik'}`);
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
  if (store) url.searchParams.set('state', `store:${store}`);

  res.redirect(url.toString());
}
