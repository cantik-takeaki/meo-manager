// api/auth/callback.js — Google OAuthコールバック
import { kvGet, kvSet } from '../_kv.js';

// お客さんのGBPアカウント→店舗を取得し、口コミAPI用の locationName を返す
async function fetchGbpLocations(accessToken) {
  const out = [];
  const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const accData = await accRes.json();
  for (const account of (accData.accounts || []).slice(0, 5)) {
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const locData = await locRes.json();
    for (const l of (locData.locations || [])) {
      // v4 reviews API は accounts/{aid}/locations/{lid} 形式が必要
      out.push({ locationName: `${account.name}/${l.name}`, title: l.title });
    }
  }
  return out;
}

export default async function handler(req, res) {
  const { code, error, state } = req.query;
  if (error) return res.redirect('/?error=' + error);
  if (!code) return res.redirect('/?error=no_code');

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI || 'https://meo-manager-rho.vercel.app/api/auth/callback';

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

  // stateにstoreIdが含まれる場合 → お客さんのGBP連携
  const storeId = state?.startsWith('store:') ? state.slice(6) : null;
  if (storeId) {
    await kvSet(`gbp_tokens_${storeId}`, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
      email: user.email,
      name: user.name,
      connected_at: new Date().toISOString(),
    });

    // お客さんのGBP店舗を取得して紐付け
    let gbpLocations = [];
    try { gbpLocations = await fetchGbpLocations(tokens.access_token); } catch {}
    const primary = gbpLocations[0] || null;

    // 店舗レコードを「連携済み」に更新
    const list = await kvGet('admin_stores') || [];
    const idx = list.findIndex(s => s.storeId === storeId);
    if (idx >= 0) {
      list[idx] = {
        ...list[idx],
        gbpConnected: true,
        gbpEmail: user.email,
        gbpLocationName: primary?.locationName || null,
        gbpLocations,
        connectedAt: new Date().toISOString(),
      };
      await kvSet('admin_stores', list);
      await kvSet(`client_${storeId}`, list[idx]);
    }

    return res.redirect(`/?connected=${storeId}`);
  }

  // 通常の管理者ログイン → cookieに保存
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
