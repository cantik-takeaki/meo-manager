// api/verify-store.js — 店舗情報の改ざんチェック（Cronで呼び出し）
import { kvGet, kvSet } from './_kv.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Cron認証
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // UIからの手動チェックも許可（クッキーあり）
    const cookies = (req.headers.cookie || '');
    if (!cookies.includes('access_token=')) {
      return res.status(401).json({ error: '認証エラー' });
    }
  }

  const { locationName, locationId, access_token } = req.body || req.query;
  if (!locationId) return res.status(400).json({ error: 'locationId必須' });

  const key = `settings_${locationId}`;
  const saved = await kvGet(key);
  if (!saved?.info) return res.json({ status: 'no_baseline', message: '基準情報未設定' });

  // GBP APIから現在の情報を取得
  const token = access_token || (req.headers.cookie || '').match(/access_token=([^;]+)/)?.[1];
  if (!token) return res.status(401).json({ error: 'アクセストークン必要' });

  try {
    const r = await fetch(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=title,storefrontAddress,websiteUri,phoneNumbers`,
      { headers: { Authorization: `Bearer ${decodeURIComponent(token)}` } }
    );
    const current = await r.json();
    if (current.error) return res.json({ status: 'api_error', message: current.error.message });

    // 比較
    const diffs = [];
    const s = saved.info;
    if (s.title && current.title !== s.title) diffs.push({ field: '店舗名', saved: s.title, current: current.title });
    if (s.websiteUri && current.websiteUri !== s.websiteUri) diffs.push({ field: 'URL', saved: s.websiteUri, current: current.websiteUri });

    if (diffs.length > 0) {
      // アラート保存
      const alerts = saved.alerts || [];
      alerts.unshift({ detectedAt: new Date().toISOString(), diffs });
      if (alerts.length > 10) alerts.pop();
      await kvSet(key, { ...saved, alerts });
      return res.json({ status: 'changed', diffs, alerts });
    }

    return res.json({ status: 'ok', message: '変更なし', checkedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
