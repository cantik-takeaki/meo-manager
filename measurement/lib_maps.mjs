// Googleマップの順位を課金ゼロで測る共通部品。
// ------------------------------------------------------------------
// なぜ要るか：2026-10-22実測で、同じ条件なら再現性はほぼ完璧だった（9語中8語が完全一致・平均のずれ0.11位）。
//   一方、有料のDataForSEO（携帯・Android指定）とは平均6.6位ずれた。
//   ずれの原因は計測が不安定だからではなく「測っている端末が違う」こと。
//   どちらが正しいかではなく、**同じ測り方で測り続ける**ことが確実さの正体。
//
// この部品が守る約束。
//   1. 端末はパソコン（1280×1400）で固定。ズームは14で固定。変えると数字が変わる。
//   2. Emulation.setGeolocationOverride で「その地点にいる」状態を作る。
//      URLの@lat,lngだけでは、ブラウザの現在地が優先されて別の街の結果が出ることがある。
//   3. 一覧が出ずに店のページへ直行したら 1位として扱う（★下記）。
//
// ★一覧なし＝圏外ではない（2026-10-22に発見）
//   検索語に対して店が1件だけ強く該当すると、Googleは一覧を出さずその店のページへ飛ぶ。
//   例：「高田馬場 イヤーエステ」→ /maps/place/イヤーエステ耳舎 に転送され div[role=feed] が無い。
//   それまでのコードはこれを「一覧なし」＝圏外として記録していた。実際は独占表示で、有料計測では1位。
//   だから URL が /maps/place/ で h1 が自店なら rank=1 と判定する。
import { spawn } from 'node:child_process';

export const ZOOM = 14;        // 固定。変えると順位が変わるので触らない
export const WAIT_MS = 9000;   // 読み込み待ち。6.5秒だと読み込み前に判定して遮断と誤判定する
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const UA_SP = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export const normName = (s) => String(s || '').replace(/[\s　（）()【】・]/g, '').toLowerCase();

// ブラウザを1つ立ち上げて使い回す。測るたびに起動し直さない。
export async function openBrowser({ port = 9841, profile = '/tmp/ckmaps', device = 'pc' } = {}) {
  // device='sp' ＝ お客さんが実際に使う端末（Android携帯）で測る。
  // 2026-11-02実測＝パソコンで測ると携帯より平均4.37位悪く出た（73語中53語）。ばらつきではなく片側のずれ。
  // ただし携帯版の一覧は店のリンクを持たないので、場所IDは「自店候補を開いて」取る（下記）。
  const sp = device === 'sp';
  // 同じポートに別の計測がすでに居ると、2本が同じブラウザを奪い合って**両方とも黙って止まる**
  // （2026-11-02に実際に発生＝11時間1語も進まなかった）。先に当たって止める。
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) throw new Error(`ポート${port}は別の計測が使っている。--port を変えるか、先にそちらを終わらせる`);
  } catch (e) { if (String(e.message).includes('別の計測')) throw e; }
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, '--no-first-run',
    '--disable-gpu', '--lang=ja-JP', sp ? '--window-size=412,915' : '--window-size=1280,1400',
    `--user-data-dir=${profile}`], { stdio: 'ignore' });
  let v = null;
  for (let i = 0; i < 80 && !v; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) v = await r.json(); } catch {}
    if (!v) await wait(250);
  }
  if (!v) { chrome.kill(); throw new Error('Chromeが起動しない'); }
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pend = new Map();
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const i = ++id; pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });
  const { result: { targetId } } = await send('Target.createTarget', { url: 'about:blank' });
  const { result: { sessionId } } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Network.setUserAgentOverride', { userAgent: sp ? UA_SP : UA, acceptLanguage: 'ja-JP,ja;q=0.9' }, sessionId);
  await send('Emulation.setDeviceMetricsOverride',
    sp ? { width: 412, height: 915, deviceScaleFactor: 2.6, mobile: true }
       : { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false }, sessionId);
  if (sp) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  return {
    send, sessionId, device,
    close: () => { try { ws.close(); } catch {} try { chrome.kill(); } catch {} },
  };
}

// 画面に今出ているカードを読む（順位の判定はここではしない。呼び出し側で積む）。
// ★Googleマップの一覧は画面外の項目をDOMから捨てて作り直す（仮想スクロール）。
//   最後まで送ってから feed.children を数えると、上の方が消えていて順位がずれる。
//   実測2026-10-22：スクロール6回で69件・14回で59件と、送るほど減った。
//   だから「送るたびに読んで、初めて見た店を順に積む」方式にする。
const READ = `(()=>{
 const t=document.body.innerText||'';
 if(/送信された通信|unusual traffic|ロボットでは/.test(t)) return JSON.stringify({blocked:true});
 const feed=document.querySelector('div[role=feed]');
 if(!feed){
   if(/\\/maps\\/place\\//.test(location.href)){
     const h1=(document.querySelector('h1')||{}).textContent||'';
     const pid=(location.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/)||location.href.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/)||[])[1]||'';
     return JSON.stringify({solo:true, h1:h1.trim(), pid});
   }
   return JSON.stringify({error:'一覧なし'});
 }
 const cards=[...feed.children].filter(c=>c.querySelector('a[href*="/maps/place/"]'));
 const rows=cards.map(c=>{const a=c.querySelector('a[href*="/maps/place/"]');
   const h=a.getAttribute('href')||'';
   // Googleが場所ごとに持つ一意のID（0x...:0x...）。名前が同じ別店と取り違えないための鍵。
   const pid=(h.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/)||h.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/)||[])[1]||'';
   return {href:h, pid, name:(a.getAttribute('aria-label')||'').trim(),
           ad:/スポンサー|広告/.test(c.innerText||'')};});
 const f=feed;
 return JSON.stringify({rows, atEnd: f.scrollTop + f.clientHeight >= f.scrollHeight - 40});})()`;


// 携帯版の一覧を読む。構造がパソコン版と別物（div[role=feed] も店のリンクも無い）。
// 2026-11-02実測＝結果カードは [role=article]、店名は .qBF1Pd、広告は本文に「スポンサー」。
// 携帯版は画面外の項目を捨てないので、毎回ぜんぶ読み直して置き換えてよい（22件まで確認）。
const READ_SP = `(()=>{
 const t=document.body.innerText||'';
 if(/送信された通信|unusual traffic|ロボットでは/.test(t)) return JSON.stringify({blocked:true});
 if(/\\/maps\\/place\\//.test(location.href)){
   const h1=(document.querySelector('h1')||{}).textContent||'';
   const pid=(location.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/)||location.href.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/)||[])[1]||'';
   return JSON.stringify({solo:true, h1:h1.trim(), pid});
 }
 const arts=[...document.querySelectorAll('[role=article]')];
 if(!arts.length) return JSON.stringify({error:'一覧なし'});
 const rows=arts.map((e,i)=>({idx:i, pid:'', href:'',
   name:((e.querySelector('.qBF1Pd')||{}).textContent||'').trim(),
   ad:/スポンサー/.test(e.innerText||'')}));
 return JSON.stringify({rows});})()`;

// 携帯版は地図が先に出るので「リストを表示」を押さないと一覧が無い。
const SHOW_LIST = `(()=>{const b=[...document.querySelectorAll('button,a,[role=button]')]
  .find(e=>/リストを表示/.test((e.innerText||'')+(e.getAttribute('aria-label')||'')));
  if(b){b.click();return 1}return 0})()`;

// 携帯版の一覧を1画面ぶん送る。スクロールする親はDOMの位置が変わるので、都度たどって探す。
const SCROLL_SP = `(()=>{const a=document.querySelector('[role=article]');let c=a;
  while(c&&!(c.scrollHeight>c.clientHeight+50))c=c.parentElement;
  if(c)c.scrollTop+=c.clientHeight*0.9; else window.scrollBy(0,800);})()`;

// 携帯版は一覧に店のリンクが無いので場所IDが取れない。自店らしいカードを1つだけ開いて確かめる。
// ★これをやらないと、携帯の計測だけ「名前の一致」に逆戻りして同名の別店を拾う。
async function pidOfCard(br, idx) {
  const { send, sessionId } = br;
  await send('Runtime.evaluate', { expression:
    `(()=>{const a=document.querySelectorAll('[role=article]')[${idx}];if(a){const c=a.querySelector('.qBF1Pd')||a;c.click();}})()` }, sessionId);
  await wait(4500);
  const r = await send('Runtime.evaluate', { expression:
    `(location.href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/)||location.href.match(/(0x[0-9a-f]+:0x[0-9a-f]+)/)||[])[1]||''`,
    returnByValue: true }, sessionId);
  const pid = r.result?.result?.value || '';
  await send('Runtime.evaluate', { expression: 'history.back()' }, sessionId);
  await wait(3500);
  return pid;
}

// 1語を1地点で測る。戻り値 {rank,total,blocked,error,solo,top3}
export async function measure(br, { keyword, lat, lng, storeName, placeId = '', scrolls = 10 }) {
  const { send, sessionId } = br;
  const sp = br.device === 'sp';
  await send('Emulation.setGeolocationOverride', { latitude: Number(lat), longitude: Number(lng), accuracy: 40 }, sessionId);
  await send('Page.navigate', {
    url: `https://www.google.com/maps/search/${encodeURIComponent(keyword)}/@${lat},${lng},${ZOOM}z?hl=ja&gl=jp`,
  }, sessionId);
  await wait(WAIT_MS);
  if (sp) { await send('Runtime.evaluate', { expression: SHOW_LIST }, sessionId); await wait(5000); }

  const seen = new Set();      // 同じ店を二重に積まない（hrefで見分ける）
  const order = [];            // 広告を除いた並び。これが順位になる
  let blocked = false, error = null, solo = null, soloPid = '';

  const readOnce = async () => {
    const r = await send('Runtime.evaluate', { expression: sp ? READ_SP : READ, returnByValue: true }, sessionId);
    let d; try { d = JSON.parse(r.result.result.value); } catch { error='応答解析失敗'; return { stop:true }; }
    if (d.blocked) { blocked = true; return { stop: true }; }
    if (d.solo) { solo = d.h1; soloPid = d.pid || ''; return { stop: true }; }
    if (d.error) { error = d.error; return { stop: true }; }
    if (sp) {
      // 携帯版は捨てずに持ち続けるので、毎回ぜんぶ入れ替える（積み足すと二重になる）
      order.length = 0;
      for (const row of d.rows || []) if (!row.ad) order.push({ name: row.name, pid: '', idx: row.idx });
      return { atEnd: false };
    }
    for (const row of d.rows || []) {
      const id = row.href || row.name;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (!row.ad) order.push({ name: row.name, pid: row.pid, href: row.href }); // 広告は順位に数えない
    }
    return { atEnd: !!d.atEnd };
  };

  let st = await readOnce();
  let same = 0, prev = order.length;
  for (let i = 0; i < scrolls && !st.stop && !st.atEnd; i++) {
    // 一気に最下部へ送ると途中が読まれないまま捨てられる。1画面ぶんずつ送る。
    await send('Runtime.evaluate', { expression: sp ? SCROLL_SP :
      `(()=>{const f=document.querySelector('div[role=feed]');if(f)f.scrollTop+=f.clientHeight*0.9;})()` }, sessionId);
    await wait(sp ? 2000 : 1100);
    st = await readOnce();
    // 携帯版は「終わり」の合図を持たないので、件数が2回続けて増えなければ終わりとみなす
    if (sp) { if (order.length === prev) { if (++same >= 3) break; } else { same = 0; prev = order.length; } }
  }

  if (blocked) return { blocked: true };
  if (solo !== null) {
    if (isSelf({ name: solo, pid: soloPid }, { storeName, placeId }))
      return { rank: 1, total: 1, solo: true, matched: solo, matchedPid: soloPid, matchedBy: '独占表示' };
    return { error: '他店のページに転送された', soloOther: solo, soloPid };
  }
  if (error) return { error, total:order.length, complete:false };

  let i = order.findIndex((o) => isSelf(o, { storeName, placeId }));
  // 携帯版は一覧に場所IDが無い。名前で当たった候補を1つだけ開いて、本当に自店か確かめる。
  if (sp && placeId) {
    i = -1;
    const cand = order.map((o, n) => ({ o, n })).filter((x) => isSelf(x.o, { storeName, placeId: '' })).slice(0, 2);
    for (const c of cand) {
      const pid = await pidOfCard(br, c.o.idx);
      if (pid === placeId) { order[c.n].pid = pid; i = c.n; break; }
    }
  }
  return {
    rank: i >= 0 ? i + 1 : null,
    total: order.length,
    complete: false, // 一定回数のスクロールは全件取得の証明ではない
    matched: i >= 0 ? order[i].name : null,
    matchedPid: i >= 0 ? order[i].pid : null,
    matchedBy: i >= 0 ? (placeId && order[i].pid === placeId ? '場所ID' : '店名') : null,
    device: sp ? 'スマホ' : 'パソコン',
    // ★証拠。あとから「この順位は本当か」を人が見て確かめられるようにする。
    top20: order.slice(0, 20).map((o, n) => ({ 順位: n + 1, 店名: o.name, pid: o.pid })),
    top3: order.slice(0, 3).map((o) => o.name),
  };
}

// 自店かどうかを決める。★名前の部分一致だけで決めない。
// 2026-11-02の実測＝旧方式は22店すべてで誤認しうる（「台湾式マッサージ」という名の別店を自店と判定した）。
export function isSelf(o, { storeName, placeId }) {
  // ① 場所IDが分かっているならそれだけで決める（同名の別店と取り違えない）
  if (placeId) return o.pid === placeId;
  // ② 分からないときは「屋号」が相手の名前に入っているかで見る。業種語だけの一致は認めない。
  const brand = brandKey(storeName);
  if (!brand) return false;
  return normName(o.name).includes(brand);
}

// 店名から業種語・地域語を取り除いて「屋号」だけ残す。
const GENERIC = ['台湾式マッサージ','台湾式リラクゼーション','リラクゼーションサロン','リラクゼーション',
 '台湾式','韓国式','中国式','タイ古式','本格台湾','パーソナルジム','骨格矯正','イヤーエステ','足踏みマッサージ',
 '韓国家庭料理','中国家庭料理','温熱サロン','リンパマッサージ','お好み焼き','中華美食屋','四川料理','漢方アロマハウス',
 'マッサージ','整体院','接骨院','整骨院','整体','エステ','カフェ','レンタカー','株式会社','有限会社','フラワーカフェ',
 'カッサ','ハウス','サロン','トレーニング','ジム','中華','料理','本店','支店'];
export function brandKey(title) {
  let s = String(title || '').replace(/[（(].*?[）)]/g, ' ');
  s = s.replace(/[A-Za-z]+\s*店|[^\s]*?店$/g, ' ');       // 「新宿西口店」などの店舗名
  for (const g of GENERIC.slice().sort((a, b) => b.length - a.length)) s = s.split(g).join(' ');
  let parts = s.split(/[\s　・×＆&／\/]+/).map(normName).filter((x) => x.length >= 2);
  // 業種語を取り除いたら何も残らない店がある（漢方アロマハウス／禅）。その時は1文字も許し、
  // それでも空なら店名そのものを使う。**空のまま返すと「誰とも一致しない」で全部圏外になる。**
  if (!parts.length) parts = s.split(/[\s　・×＆&／\/]+/).map(normName).filter(Boolean);
  if (!parts.length) return normName(title);
  return parts.sort((a, b) => b.length - a.length)[0];
}

// n×n の格子を作る。中心が店。stepM メートル間隔。
export function gridPoints(lat, lng, n, stepM) {
  const half = (n - 1) / 2;
  const dLat = stepM / 111320;                                   // 緯度1度 ≒ 111.32km
  const dLng = stepM / (111320 * Math.cos(lat * Math.PI / 180)); // 経度は緯度で縮む
  const pts = [];
  for (let r = -half; r <= half; r++) for (let c = -half; c <= half; c++)
    pts.push({ row: r + half, col: c + half, lat: lat + r * dLat, lng: lng + c * dLng,
               distM: Math.round(Math.hypot(r * stepM, c * stepM)) });
  return pts;
}
