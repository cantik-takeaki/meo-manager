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

// ── Instagram Business Login コールバック（state="ig:storeId"） ──
// 短期トークン → 長期トークン(~60日) に交換し、posts.js が読む ig_conn_{storeId} に保存。
async function handleInstagram(req, res, code, igStoreId) {
  const redirectUri = process.env.REDIRECT_URI || 'https://meo-manager-rho.vercel.app/api/auth/callback';
  const igAppId = process.env.IG_APP_ID || '1664344041536126';
  const igAppSecret = process.env.IG_APP_SECRET;
  if (!igAppSecret) return res.redirect('/?error=ig_no_secret');

  // 1. 短期トークン交換
  const shortRes = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: igAppId,
      client_secret: igAppSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    }).toString(),
  });
  const shortData = await shortRes.json();
  let shortToken = shortData.access_token;
  let userId = shortData.user_id;
  let perms = shortData.permissions;
  if (!shortToken && Array.isArray(shortData.data) && shortData.data[0]) {
    shortToken = shortData.data[0].access_token;
    userId = shortData.data[0].user_id;
    perms = shortData.data[0].permissions;
  }
  const permissions = Array.isArray(perms) ? perms.join(',') : (perms || '');
  if (!shortToken) {
    const msg = shortData.error_message || shortData.error?.message || 'exchange_failed';
    return res.redirect('/?error=ig_token_' + encodeURIComponent(String(msg).slice(0, 60)));
  }

  // 2. 長期トークンへ交換（~60日有効）
  let longToken = shortToken;
  let expiresIn = 60 * 24 * 3600;
  try {
    const llRes = await fetch(`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${igAppSecret}&access_token=${shortToken}`);
    const llData = await llRes.json();
    if (llData.access_token) { longToken = llData.access_token; expiresIn = llData.expires_in || expiresIn; }
  } catch (e) { /* 失敗時は短期トークンのまま保存 */ }

  // 3. ユーザー情報（username）取得。pathに使うidはトークン交換のuser_idを優先。
  let username = '';
  try {
    const meRes = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${longToken}`);
    const me = await meRes.json();
    if (me.username) username = me.username;
    if (!userId && me.user_id) userId = me.user_id;
  } catch (e) { /* username取得失敗は無視 */ }

  // 4. 保存（posts.js は ig_conn_{storeId}.token / .userId を読む）
  let kvErr = '';
  try {
    await kvSet(`ig_conn_${igStoreId}`, {
      token: longToken,
      userId: String(userId || ''),
      username,
      permissions, // 実際に付与されたスコープ（診断・UI表示用）
      expires_at: Date.now() + expiresIn * 1000,
      connected_at: new Date().toISOString(),
    });
    const list = await kvGet('admin_stores') || [];
    const idx = list.findIndex(s => s.storeId === igStoreId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], igConnected: true, igUsername: username };
      await kvSet('admin_stores', list);
      await kvSet(`client_${igStoreId}`, list[idx]);
    }
  } catch (e) { kvErr = 'kv:' + (e.message || 'fail'); }

  const q = new URLSearchParams({ ig_connected: igStoreId, iguser: username });
  if (kvErr) q.set('kverr', kvErr);
  return res.redirect(`/?${q.toString()}`);
}

export default async function handler(req, res) {
  const { code, error, state } = req.query;
  if (error) return res.redirect('/?error=' + encodeURIComponent(error));
  if (!code) return res.redirect('/?error=no_code&got=' + encodeURIComponent(Object.keys(req.query).join(',') || 'none'));

  // Instagram連携のコールバックは専用処理へ分岐
  if (state && state.startsWith('ig:')) {
    return handleInstagram(req, res, code, state.slice(3));
  }

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
