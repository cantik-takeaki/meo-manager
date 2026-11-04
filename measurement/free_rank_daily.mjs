import { recordObservation } from './observation.mjs';
// 全店・全キーワードの順位を課金ゼロで測る（ローカルChrome）。
// ------------------------------------------------------------------
// 使い方：
//   node tools/meo-kouka/free_rank_daily.mjs            # 全語を測ってKVに書く
//   node tools/meo-kouka/free_rank_daily.mjs --dry 20   # 20語だけ測って書かない（試し）
//   node tools/meo-kouka/free_rank_daily.mjs --store 耳舎
//
// 書き込み先：KVの rank_free_<sid>（新しいキー）。
//   既存の rankings_<sid>（有料DataForSEOの記録）には一切触らない。
//   並べて見られるようにして、食い違いが出たら測り方を疑えるようにする。
//
// 費用：0円。Googleマップを自分のChromeで見ているだけ。
// 所要：1語あたり約16秒。163語で約45分。深夜に回す想定。
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { openBrowser, measure, ZOOM } from './lib_maps.mjs';

const readEnv = (f) => { try { return Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; })); } catch { return {}; } };
const E = {};
for (const f of [path.join(os.homedir(), 'meo-manager', '.env'), path.join(os.homedir(), 'Desktop', 'meo-manager', '.env')])
  for (const [k, v] of Object.entries(readEnv(f))) if (v) E[k] = v;
if (!E.KV_REST_API_TOKEN) { console.error('KVの鍵が無い。~/meo-manager/.env を確認する'); process.exit(1); }
const H = { Authorization: `Bearer ${E.KV_REST_API_TOKEN}` };
const kvGet = async (k) => { const r = await fetch(`${E.KV_REST_API_URL}/get/${encodeURIComponent(k)}`, { headers: H });
  const d = await r.json(); if (d.result == null) return null; let x = d.result;
  for (let i = 0; i < 2 && typeof x === 'string'; i++) { try { x = JSON.parse(x); } catch { break; } } return x; };
const kvSet = async (k, v) => { const r = await fetch(`${E.KV_REST_API_URL}/set/${encodeURIComponent(k)}`,
  { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(v) });
  return (await r.json()).result; };

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const LIMIT = Number(args[args.indexOf('--dry') + 1]) || (DRY ? 20 : 0);
const STORE = args.includes('--store') ? args[args.indexOf('--store') + 1] : '';
// 主力＝毎日測る語（meta.priority='A'）／探索＝月1で測る語（'B'）。既定は主力だけ。
// なぜ分けるか：1語16秒かかるので全部毎日だと12時間かかる。毎日追うのは順位を動かす語だけでよい。
const TIER = args.includes('--tier') ? args[args.indexOf('--tier') + 1] : 'main';
// 端末。sp＝お客さんが実際に使う携帯（Android）。pc＝これまでの測り方。
// 2026-11-02実測＝同じ語でもパソコンは携帯より平均4.37位悪く出る（73語中53語）。混ぜると比較できないので
// 保存先を分ける（pc＝rank_free_<店> / sp＝rank_sp_<店>）。社長に見せるのは携帯の数字。
const DEV = args.includes('--device') ? args[args.indexOf('--device') + 1] : 'pc';
const SP = DEV === 'sp';
const PORT = Number(args.includes('--port') ? args[args.indexOf('--port') + 1] : (SP ? 9851 : 9841));
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10); // JST

// ── 測る対象を組み立てる（既存の登録キーワードをそのまま使う） ──
const managed = await kvGet('managed_locations') || [];
const jobs = [];
for (const m of managed) {
  const sid = String(m.locId || m.locationName || '').replace(/\//g, '_');
  if (!sid) continue;
  if (STORE && !String(m.title || '').includes(STORE)) continue;
  const rk = await kvGet(`rankings_${sid}`);
  let kws = (rk && rk.keywords) || [];
  if (!kws.length) continue;
  if (TIER !== 'all') {
    const want = TIER === 'explore' ? 'B' : 'A';
    const meta = (rk && rk.meta) || {};
    // priority が無い語は主力として扱う（取りこぼさない側に倒す）
    kws = kws.filter((k) => ((meta[k] && meta[k].priority) || 'A') === want);
    if (!kws.length) continue;
  }
  const rp = await kvGet(`rank_point_${sid}`);
  if (!rp || !Number.isFinite(rp.lat) || !Number.isFinite(rp.lng)) { console.log('計測地点が無いので飛ばす:', m.title); continue; }
  const pk = await kvGet(`place_key_${sid}`);   // 店を一意に決める鍵。あれば名前では判定しない。
  for (const kw of kws) jobs.push({ sid, title: m.title, kw, lat: rp.lat, lng: rp.lng, placeId: (pk && pk.pid) || '' });
}
const target = LIMIT ? jobs.slice(0, LIMIT) : jobs;
const tierName = TIER === 'explore' ? '探索（月1）' : TIER === 'all' ? '全部' : '主力（毎日）';
console.log(`対象 ${target.length} 語 / 全 ${jobs.length} 語　端末＝${SP ? 'スマホ' : 'パソコン'}　区分＝${tierName}${DRY ? '（試し・書き込みなし）' : ''}`);

const br = await openBrowser({ port: PORT, profile: `/tmp/ckfree_${DEV}_${Date.now()}`, device: DEV });
const results = [];
const t0 = Date.now();
for (const [i, j] of target.entries()) {
  let r = {};
  const once = async () => {
    try { return await measure(br, { keyword: j.kw, lat: j.lat, lng: j.lng, storeName: j.title, placeId: j.placeId, scrolls: SP ? 6 : 10 }); }
    catch (e) { return { error: e.message }; }
  };
  r = await once();
  // 取得失敗は読み込みが間に合わなかっただけのことが多い。1回だけ測り直す。
  // （2026-11-01の実測＝257語中27語が失敗。失敗を「圏外」と混ぜると実態より悪く見える）
  if (r.error && !r.blocked) { await new Promise((s) => setTimeout(s, 3000)); const r2 = await once(); if (!r2.error) { r = r2; r.retried = true; } }
  results.push({ ...j, ...r, observedAt:new Date().toISOString() });
  const show = r.blocked ? '遮断' : (r.error ? '×' : (r.rank ?? (r.complete?'観測範囲外':'未確認')));
  const tag = r.solo ? ' (独占)' : (r.retried ? ' (測り直し)' : '');
  const by = r.matched ? `  ←一致:${r.matched.slice(0, 18)}[${r.matchedBy}]` : '';
  console.log(`  [${i + 1}/${target.length}] ${String(show).padStart(4)}${tag}  ${j.title.slice(0, 12)} / ${j.kw}${by}`);
}
br.close();

const blocked = results.filter((x) => x.blocked).length;
const errs = results.filter((x) => x.error).length;
const ok = results.filter((x) => !x.blocked && !x.error);
const ranked = ok.filter((x) => Number.isFinite(x.rank));
console.log(`\n測れた ${ok.length}/${results.length} ／ 遮断 ${blocked} ／ 取得失敗 ${errs}`);
console.log(`順位あり ${ranked.length} ／ 10位以内 ${ranked.filter((x) => x.rank <= 10).length} ／ 3位以内 ${ranked.filter((x) => x.rank <= 3).length}`);
console.log(`所要 ${Math.round((Date.now() - t0) / 60000)}分`);

// ── 有料の記録と突き合わせる（どちらが正しいかではなく、食い違いを見つけるため） ──
let cmp = { both: 0, same: 0, within2: 0, gapSum: 0, big: [] };
for (const m of new Set(results.map((x) => x.sid))) {
  const rk = await kvGet(`rankings_${m}`); if (!rk) continue;
  const last = (rk.history || [])[rk.history.length - 1];
  if (!last) continue;
  for (const r of results.filter((x) => x.sid === m)) {
    const ki = (rk.keywords || []).indexOf(r.kw);
    const paid = ki >= 0 ? last.rankings?.[ki] : undefined;
    if (!Number.isFinite(paid) || !Number.isFinite(r.rank)) continue;
    cmp.both++; cmp.gapSum += Math.abs(paid - r.rank);
    if (paid === r.rank) cmp.same++;
    if (Math.abs(paid - r.rank) <= 2) cmp.within2++;
    if (Math.abs(paid - r.rank) >= 10) cmp.big.push({ store: r.title, kw: r.kw, 有料: paid, 無料: r.rank });
  }
}
if (cmp.both) {
  console.log(`\n■ 有料(DataForSEO・携帯)との比較 ${cmp.both}語`);
  console.log(`  完全一致 ${cmp.same} ／ ±2以内 ${cmp.within2} ／ 平均のずれ ${(cmp.gapSum / cmp.both).toFixed(1)}位`);
  if (cmp.big.length) { console.log('  10位以上ずれた語:'); for (const b of cmp.big.slice(0, 10)) console.log('   ', JSON.stringify(b, null, 0)); }
}

if (DRY) { console.log('\n試しなので書き込んでいない'); process.exit(0); }

// ── KVへ保存（新しいキーだけ。既存は書き換えない） ──
const bySid = {};
for (const r of results) (bySid[r.sid] = bySid[r.sid] || []).push(r);
for (const [sid, rows] of Object.entries(bySid)) {
  const key = SP ? `rank_sp_${sid}` : `rank_free_${sid}`;
  const ex = await kvGet(key) || { keywords: [], history: [] };
  ex.keywords = ex.keywords || []; ex.history = ex.history || [];
  let entry = ex.history.find((h) => h.date === today);
  if (!entry) { entry = { date: today, rankings: [], solo: [], recordedAt: '' }; ex.history.push(entry); }
  for (const r of rows) {
    let ki = ex.keywords.indexOf(r.kw);
    if (ki < 0) { ex.keywords.push(r.kw); ki = ex.keywords.length - 1; }
    recordObservation(entry,r,ki,{device:SP?'mobile-android':'desktop',zoom:ZOOM});
    // ★証拠。「この順位は本当か」を人があとから確かめられるようにする。
    // 数字だけ残すと、取り違えが起きていても気づけない（2026-11-02まで数字しか残していなかった）。
    entry.evidence = entry.evidence || {};
    entry.evidence[r.kw] = {
      一致した店名: r.matched || null, 判定: r.matchedBy || null, 失敗: r.error || null,
      上位5: (r.top20 || []).slice(0, 5).map((x) => `${x.順位}. ${x.店名}`),
      出た件数: r.total ?? null,
    };
  }
  entry.recordedAt = new Date().toISOString();
  entry.method = { device: SP ? 'mobile-android' : 'desktop', zoom: ZOOM, source: 'local-chrome', cost: 0 };
  ex.history.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (ex.history.length > 120) ex.history = ex.history.slice(-120);
  // 証拠は直近14日ぶんだけ持つ（全部持つとKVが膨らむ）
  ex.history.forEach((h, n) => { if (n < ex.history.length - 14) delete h.evidence; });
  await kvSet(key, ex);
}
console.log(`\n保存した: ${SP ? 'rank_sp' : 'rank_free'}_<店> ${Object.keys(bySid).length}件（既存の rankings_<店> は触っていない）`);
