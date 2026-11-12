// api/_kv.js — Upstash REST API ヘルパー
export function getKV() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV未設定');
  return { url, token };
}

async function responseData(res) {
  let data;try {data=await res.json();}catch {throw new Error('保存先の応答形式を確認できません');}
  if(!res.ok||data.error||!Object.hasOwn(data,'result'))throw new Error('保存先の処理が完了しませんでした');
  return data;
}

export async function kvSet(key, value) {
  const { url, token } = getKV();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', key, JSON.stringify(value)]),
  });
  return responseData(res);
}

export async function kvGet(key) {
  const { url, token } = getKV();
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    signal: AbortSignal.timeout(10000),
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await responseData(res);
  if (!data.result) return null;
  try { return JSON.parse(data.result); } catch { return data.result; }
}

export async function kvGetMany(keys) {
  if (!keys.length) return [];
  const {url, token} = getKV();
  const response = await fetch(url, {
    method: 'POST', signal: AbortSignal.timeout(8000),
    headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(['MGET', ...keys]),
  });
  const {result} = await responseData(response);
  return result.map(value => value === null ? null : JSON.parse(value));
}

export async function kvDel(key) {
  const { url, token } = getKV();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['DEL', key]),
  });
  await responseData(res);
}

// アトミック加算（SerpApi使用量カウンタ等の並行実行アンダーカウント対策）。新しい合計値を返す
export async function kvIncrBy(key, n) {
  const { url, token } = getKV();
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['INCRBY', key, String(parseInt(n, 10) || 0)]),
  });
  const data = await responseData(res);
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
    signal: AbortSignal.timeout(10000),
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SCAN', cursor, 'MATCH', match, 'COUNT', 500]),
    });
    const data = await responseData(res);
    if (!Array.isArray(data.result) || !Array.isArray(data.result[1])) throw new Error('保存先の一覧を取得できません');
    cursor = String(data.result[0]);
    for (const k of (data.result[1] || [])) keys.push(k);
  } while (cursor !== '0' && ++guard < 200);
  if(cursor!=='0')throw new Error('保存先の一覧取得が上限に達しました');
  return [...new Set(keys)];
}

export async function acquireReviewLock(owner) {
  const {url,token}=getKV();
  const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(['SET','review_run_lock',owner,'NX','EX',120]),signal:AbortSignal.timeout(5000)});
  return (await responseData(r)).result==='OK';
}
export async function releaseReviewLock(owner) {
  const {url,token}=getKV();
  const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(['EVAL',"if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0",1,'review_run_lock',owner]),signal:AbortSignal.timeout(5000)});
  await responseData(r);
}
