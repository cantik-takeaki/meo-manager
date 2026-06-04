// api/locations.js — 店舗一覧取得
import { getAccessToken } from './_tokens.js';

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { storeId } = req.query;
  const access_token = storeId ? await getAccessToken(storeId) : parseCookies(req).access_token;
  if (!access_token) return res.status(401).json({ error: 'ログインが必要です' });

  try {
    // アカウント一覧取得
    const accountsRes = await fetch(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const accountsData = await accountsRes.json();
    if (!accountsData.accounts?.length) return res.json({ locations: [] });

    // 各アカウントの店舗を取得
    const locations = [];
    for (const account of accountsData.accounts.slice(0, 5)) {
      const locRes = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress,websiteUri,regularHours,phoneNumbers,categories`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      const locData = await locRes.json();
      if (locData.locations) {
        locations.push(...locData.locations.map(l => ({ ...l, accountName: account.name })));
      }
    }
    res.json({ locations });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
