// ラクラクMEO 店舗診断（cantik独自の採点）— ラクラクMEO本体と同じ部品を使う。
// ------------------------------------------------------------------
// 採点のロジックは ~/meo-manager/api/_shindan.js の1か所だけに置く。
// 以前は tools/meo-kouka/shindan.py にも同じ配点を書いていて、片方だけ直す事故が起きうる形だった。
// このファイルは「全店を回して読みやすい表にする」役だけを持つ。
//
// 使い方：
//   node tools/meo-kouka/shindan.mjs           # 画面に出す
//   node tools/meo-kouka/shindan.mjs --md      # MEOシステム/効果検証/診断_<日付>.md に書き出す
//   node tools/meo-kouka/shindan.mjs 広島っ子    # 店名の部分一致で絞る
//
// 読み取りだけ。Googleにも設定にも書き込まない。
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { shindanOne } from '../api/_shindan.js';

const readEnv = (f) => { try { return Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n')
  .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^["']|["']$/g, '')]; })); } catch { return {}; } };
const E = {};
for (const f of [path.join(os.homedir(), 'meo-manager', '.env'), path.join(os.homedir(), 'Desktop', 'meo-manager', '.env')])
  for (const [k, v] of Object.entries(readEnv(f))) if (v) E[k] = v;
const H0 = { Authorization: `Bearer ${E.KV_REST_API_TOKEN}` };
const kvGet = async (k) => { const r = await fetch(`${E.KV_REST_API_URL}/get/${encodeURIComponent(k)}`, { headers: H0 });
  const d = await r.json(); if (d.result == null) return null; let x = d.result;
  for (let i = 0; i < 2 && typeof x === 'string'; i++) { try { x = JSON.parse(x); } catch { break; } } return x; };

const args = process.argv.slice(2);
const wantMd = args.includes('--md');
const sel = args.filter((a) => !a.startsWith('--'));

const master = await kvGet('master_gbp');
const tr = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ client_id: E.GOOGLE_CLIENT_ID, client_secret: E.GOOGLE_CLIENT_SECRET,
    refresh_token: master.refresh_token, grant_type: 'refresh_token' }) })).json();
const token = tr.access_token;

const managed = (await kvGet('managed_locations') || [])
  .filter((m) => !sel.length || sel.some((s) => String(m.title || '').includes(s)));
console.error(`対象 ${managed.length} 店`);

const rows = [];
for (const m of managed) {
  const name = m.locationName || m.locId || '';
  try {
    const r = await shindanOne(name, token, { withPerf: true });
    if (r.error) { console.error('×', m.title, r.error); continue; }
    rows.push(r);
    console.error(`  ${String(r.score??'保留').padStart(3)}点  ${String(r.title).slice(0, 24)}  指摘${r.items.length}件`);
  } catch (e) { console.error('×', m.title, e.message); }
}
rows.sort((a,b)=>(a.score??101)-(b.score??101));

const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const out = [`# ラクラクMEO 店舗診断（${today}）`, '',
  '点数は基本4項目の登録充足度（各25点）。順位や集客効果の点数ではありません。旧診断点との比較はできません。',
  '取得が未完了の場合は点数を出しません。要確認の表現は文脈と資格を確認し、違反と断定しません。',
  '費用はすべて0円（Googleが返す実数を読んでいるだけ）。', ''];

// 半分以上の店で出ている穴＝施策の優先順位
const tally = {};
for (const r of rows) for (const it of r.items) {
  const key = `${it.kind}｜${it.msg.replace(/（.*/, '').replace(/[0-9０-９]+/g, 'N')}`;
  tally[key] = (tally[key] || 0) + 1;
}
const common = Object.entries(tally).filter(([, n]) => n >= Math.ceil(rows.length / 2)).sort((a, b) => b[1] - a[1]);
if (common.length) {
  out.push('## 全店に共通する穴（ここから手を付ける）', '', '| 店数 | 区分 | 中身 |', '|---:|---|---|');
  for (const [k, n] of common) { const [kind, msg] = k.split('｜'); out.push(`| ${n}/${rows.length} | ${kind} | ${msg} |`); }
  out.push('');
}

out.push('## 店ごと', '');
for (const r of rows) {
  out.push(`### ${r.title}　${r.score==null?'判定保留':r.score+'点'}`, '');
  const f=Object.fromEntries(Object.entries(r.facts).map(([k,v])=>[k,v??'未取得']));
  out.push(`確認率 ${r.coverage.checked}/${r.coverage.total}。${r.scoreNotice}`, '');
  out.push(`口コミ${f.reviews}件（90日${f.reviews90}件・未返信${f.unreplied90}件）／写真${f.media}枚（90日${f.media90}枚）／生きている投稿${f.postsAlive}本／説明文${f.descLen}字／サービス${f.services}件／カテゴリ${f.categories}個`);
  if (r.attributes) out.push(`属性 ${r.attributes.set}/${r.attributes.available}個（${r.attributes.coverage}%）`);
  out.push('');
  if (!r.items.length) { out.push('穴は見つからなかった。', ''); continue; }
  out.push('| 提案の優先度 | 区分 | 今どうなっているか | やること |', '|---:|---|---|---|');
  for (const it of r.items) out.push(`| ${it.priority} | ${it.kind} | ${it.msg} | ${it.todo} |`);
  out.push('');
  if (r.attributes && r.attributes.missing) {
    out.push('<details><summary>未設定の属性（店に聞いて埋める）</summary>', '');
    for (const [g, v] of Object.entries(r.attributes.byGroup)) out.push(`- **${g}**：${v.join('・')}`);
    out.push('', '</details>', '');
  }
}

const txt = out.join('\n') + '\n';
if (wantMd) {
  const f = path.join(os.homedir(), 'CantikVault', 'MEOシステム', '効果検証', `診断_${today}.md`);
  fs.writeFileSync(f, txt);
  console.log(f);
} else console.log(txt);
