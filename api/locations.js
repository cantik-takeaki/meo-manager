// api/locations.js — 店舗一覧取得
import { getAccessToken, getValidCookieToken } from './_tokens.js';
import { kvGet } from './_kv.js';

function parseCookies(req) {
  const c = {};
  (req.headers.cookie || '').split(';').forEach(s => {
    const [k, ...v] = s.trim().split('=');
    if (k) c[k.trim()] = decodeURIComponent(v.join('='));
  });
  return c;
}

// 直近Nヶ月の日付レンジ
function monthRange(months = 3) {
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - months);
  const f = (d) => ({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() });
  return { start: f(start), end: f(end) };
}

// ── インサイト（パフォーマンス）取得 ──
async function fetchInsights(access_token, locationName) {
  const m = String(locationName).match(/locations\/[^/]+/);
  const locPath = m ? m[0] : locationName;
  const { start, end } = monthRange(3);
  const metrics = [
    'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
    'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'CALL_CLICKS',
    'WEBSITE_CLICKS',
    'BUSINESS_DIRECTION_REQUESTS',
    'BUSINESS_CONVERSATIONS',
  ];
  const params = new URLSearchParams();
  metrics.forEach((mt) => params.append('dailyMetrics', mt));
  params.set('dailyRange.start_date.year', start.year);
  params.set('dailyRange.start_date.month', start.month);
  params.set('dailyRange.start_date.day', start.day);
  params.set('dailyRange.end_date.year', end.year);
  params.set('dailyRange.end_date.month', end.month);
  params.set('dailyRange.end_date.day', end.day);

  const url = `https://businessprofileperformance.googleapis.com/v1/${locPath}:fetchMultiDailyMetricsTimeSeries?${params.toString()}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
  const data = await r.json();
  if (data.error) return { error: data.error.message, pending: true };

  const totals = {};
  const series = {};
  for (const mts of data.multiDailyMetricTimeSeries || []) {
    for (const dm of mts.dailyMetricTimeSeries || []) {
      const key = dm.dailyMetric;
      const points = dm.timeSeries?.datedValues || [];
      let sum = 0;
      const line = points.map((p) => {
        const v = Number(p.value || 0);
        sum += v;
        const d = p.date || {};
        return { date: `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}`, value: v };
      });
      totals[key] = (totals[key] || 0) + sum;
      series[key] = line;
    }
  }
  const mapsImpressions =
    (totals.BUSINESS_IMPRESSIONS_DESKTOP_MAPS || 0) + (totals.BUSINESS_IMPRESSIONS_MOBILE_MAPS || 0);
  const searchImpressions =
    (totals.BUSINESS_IMPRESSIONS_DESKTOP_SEARCH || 0) + (totals.BUSINESS_IMPRESSIONS_MOBILE_SEARCH || 0);

  return {
    range: { start, end },
    summary: {
      impressions: mapsImpressions + searchImpressions,
      mapsImpressions,
      searchImpressions,
      calls: totals.CALL_CLICKS || 0,
      websiteClicks: totals.WEBSITE_CLICKS || 0,
      directionRequests: totals.BUSINESS_DIRECTION_REQUESTS || 0,
      conversations: totals.BUSINESS_CONVERSATIONS || 0,
    },
    totals,
    series,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { storeId, action, locationName } = req.query;
  const access_token = storeId ? await getAccessToken(storeId) : await getValidCookieToken(req, res);
  if (!access_token) return res.status(401).json({ error: 'ログインが必要です' });

  // インサイト取得モード
  if (action === 'insights') {
    if (!locationName) return res.status(400).json({ error: 'locationName必須' });
    try {
      return res.json(await fetchInsights(access_token, locationName));
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  try {
    // アカウント一覧取得
    const accountsRes = await fetch(
      'https://mybusinessaccountmanagement.googleapis.com/v1/accounts',
      { headers: { Authorization: `Bearer ${access_token}` } }
    );
    const accountsData = await accountsRes.json();
    if (!accountsData.accounts?.length) return res.json({ locations: [], accounts: [], managedCount: 0 });

    // 管理者が選抜した「管理対象」集合（無ければ空＝まだ何も登録していない）
    const managedList = await kvGet('managed_locations') || [];
    const managedMap = new Map(managedList.map(m => [m.locId, m]));

    // 各アカウント（≒クライアント企業）の店舗を取得。
    // accountName(表示名)をクライアント名として付与し、GBP内の重複はlocationIDで排除。
    // ※ここでは「Googleが権限を持つ全店舗」を返し、managedフラグで管理対象を示す（実際に表示するのは管理対象のみ＝フロントで選別）。
    const locations = [];
    const seen = new Set();
    const accounts = [];
    for (const account of accountsData.accounts.slice(0, 10)) {
      const clientName = account.accountName || '（名称未設定のアカウント）';
      accounts.push({ id: account.name, name: clientName, type: account.type });
      const locRes = await fetch(
        `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=name,title,storefrontAddress,websiteUri,regularHours,phoneNumbers,categories&pageSize=100`,
        { headers: { Authorization: `Bearer ${access_token}` } }
      );
      const locData = await locRes.json();
      if (locData.locations) {
        for (const l of locData.locations) {
          const locId = String(l.name || '').match(/locations\/[^/]+/)?.[0] || l.name;
          if (locId && seen.has(locId)) continue; // 同一ロケーションIDの重複を排除
          if (locId) seen.add(locId);
          const mrec = managedMap.get(locId);
          locations.push({
            ...l,
            accountName: account.name,
            clientName,
            locId,                                   // locations/xxx（管理対象の識別子）
            locationName: `${account.name}/${l.name}`, // 口コミ等v4 API用の完全参照
            managed: !!mrec,                         // 管理者が管理対象に選抜済みか
            company: mrec?.company || '',            // クライアント分け用の会社名（管理対象のみ）
          });
        }
      }
    }
    res.json({ locations, accounts, managedCount: managedList.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
