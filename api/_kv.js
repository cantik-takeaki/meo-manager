// api/_kv.js — Upstash REST API ヘルパー
export function getKV() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV未設定');
  return { url, token };
}

export async function kvSet(key, value) {
  const { url, token } = getKV();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, JSON.stringify(value)]),
  });
  return res.json();
}

export async function kvGet(key) {
  const { url, token } = getKV();
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

export async function kvDel(key) {
  const { url, token } = getKV();
  await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['DEL', key]),
  });
}

// アトミック加算（SerpApi使用量カウンタ等の並行実行アンダーカウント対策）。新しい合計値を返す
export async function kvIncrBy(key, n) {
  const { url, token } = getKV();
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['INCRBY', key, String(parseInt(n, 10) || 0)]),
  });
  const data = await res.json();
  return Number(data.result);
}

// 全キー走査（SCANをカーソルで反復）。データ書き出し用。
export async function kvScanKeys(match = '*') {
  const { url, token } = getKV();
  let cursor = '0';
  const keys = [];
  let guard = 0;
  do {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SCAN', cursor, 'MATCH', match, 'COUNT', 500]),
    });
    const data = await res.json();
    if (!data.result) break;
    cursor = String(data.result[0]);
    for (const k of (data.result[1] || [])) keys.push(k);
  } while (cursor !== '0' && ++guard < 200);
  return [...new Set(keys)];
}
