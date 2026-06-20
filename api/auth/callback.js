// api/auth/callback.js — Google OAuthコールバック
import { kvGet, kvSet } from '../_kv.js';

// お客さんのGBPアカウント→店舗を取得し、口コミAPI用の locationName を返す
async function fetchGbpLocations(accessToken) {
  const out = [];
  const accRes = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const accData = await accRes.json();
  if (accData.error) return { locations: [], error: 'acc:' + (accData.error.status || accData.error.message || accData.error.code) };
  const accounts = accData.accounts || [];
  if (!accounts.length) return { locations: [], error: 'no_accounts' };
  let lastErr = '';
  for (const account of accounts.slice(0, 5)) {
    const locRes = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title&pageSize=100`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const locData = await locRes.json();
    if (locData.error) { lastErr = 'loc:' + (locData.error.status || locData.error.message || locData.error.code); continue; }
    for (const l of (locData.locations || [])) {
      // v4 reviews API は accounts/{aid}/locations/{lid} 形式が必要
      out.push({ locationName: `${account.name}/${l.name}`, title: l.title });
    }
  }
  return { locations: out, error: out.length ? '' : (lastErr || 'no_locations') };
}

export default async function handler(req, res) {
  const { code, error, state } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(error));
  if (!code) return res.redirect('/?error=no_code&got=' + encodeURIComponent(Object.keys(req.query).join(',') || 'none'));

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI || 'https://meo-manager-rho.vercel.app/api/auth/callback';

  const storeId = state?.startsWith('store:') ? state.slice(6) : null;

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
  if (tokens.error) {
    const pfx = storeId ? 'token_' : '';
    return res.redirect('/?error=' + pfx + encodeURIComponent(tokens.error));
  }

  // ユーザー情報取得
  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const user = await userRes.json();

  // stateにstoreIdが含まれる場合 → お客さんのGBP連携
  if (storeId) {
    let kvErr = '';
    try {
      await kvSet(`gbp_tokens_${storeId}`, {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: Date.now() + (tokens.expires_in || 3600) * 1000,
        email: user.email,
        name: user.name,
        connected_at: new Date().toISOString(),
      });
    } catch (e) { kvErr = 'kvset:' + (e.message || 'fail'); }

    // お客さんのGBP店舗を取得して紐付け（診断付き）
    let gbpLocations = [];
    let locErr = '';
    try {
      const r = await fetchGbpLocations(tokens.access_token);
      gbpLocations = r.locations;
      locErr = r.error || '';
    } catch (e) { locErr = 'exception:' + (e.message || 'unknown'); }
    const primary = gbpLocations[0] || null;

    // 店舗レコードを「連携済み」に更新
    let storeMiss = false;
    try {
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
      } else {
        storeMiss = true;
      }
    } catch (e) { kvErr = kvErr || ('kvupd:' + (e.message || 'fail')); }

    const q = new URLSearchParams({ connected: storeId, locs: String(gbpLocations.length) });
    if (locErr) q.set('locerr', locErr);
    if (kvErr) q.set('kverr', kvErr);
    if (storeMiss) q.set('storemiss', '1');
    return res.redirect(`/?${q.toString()}`);
  }

  // 通常の管理者ログイン → cookieに保存（30日持続・Secure・トークン期限も保存）
  const MAXAGE = 60 * 60 * 24 * 30; // 30日
  const cookieOpts = `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAXAGE}`;
  const pubOpts = `Path=/; Secure; SameSite=Lax; Max-Age=${MAXAGE}`;
  const tokenExp = Date.now() + (tokens.expires_in || 3600) * 1000;
  res.setHeader('Set-Cookie', [
    `access_token=${tokens.access_token}; ${cookieOpts}`,
    `refresh_token=${tokens.refresh_token || ''}; ${cookieOpts}`,
    `token_expires_at=${tokenExp}; ${pubOpts}`,
    `user_email=${user.email}; ${pubOpts}`,
    `user_name=${encodeURIComponent(user.name || '')}; ${pubOpts}`,
    `user_picture=${encodeURIComponent(user.picture || '')}; ${pubOpts}`,
  ]);

  res.redirect('/');
}
