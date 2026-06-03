// api/auth/callback.js — Google OAuthコールバック
export default async function handler(req, res) {
  const { code, error } = req.query;
  if (error) return res.redirect('/?error=' + error);
  if (!code) return res.redirect('/?error=no_code');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI || 'https://meo-manager.vercel.app/api/auth/callback';

  // コードをトークンに交換
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await tokenRes.json();
  if (tokens.error) return res.redirect('/?error=' + tokens.error);

  // ユーザー情報取得
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();

  // cookieにトークンを保存（1日）
  const cookieOpts = 'Path=/; HttpOnly; SameSite=Lax; Max-Age=86400';
  res.setHeader('Set-Cookie', [
    `access_token=${tokens.access_token}; ${cookieOpts}`,
    `refresh_token=${tokens.refresh_token || ''}; ${cookieOpts}`,
    `user_email=${user.email}; Path=/; SameSite=Lax; Max-Age=86400`,
    `user_name=${encodeURIComponent(user.name || '')}; Path=/; SameSite=Lax; Max-Age=86400`,
    `user_picture=${encodeURIComponent(user.picture || '')}; Path=/; SameSite=Lax; Max-Age=86400`,
  ]);

  res.redirect('/');
}
