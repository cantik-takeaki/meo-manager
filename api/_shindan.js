import { comparisonPeriods, coveredTotal, keywordValue } from './_metric_integrity.js';
// 店舗情報の事実・取得状況・改善候補を返す。書き込みは行わない。
// 点数は基本4項目の登録充足度（各25点）。順位予測・法令判定ではない。
// 運用目安は提案として残すが、相関や任意の件数で減点しない。
// 旧版とは尺度が異なるためscoreVersionを必ず併記する。

const BI = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';
const PERF = 'https://businessprofileperformance.googleapis.com/v1';
const MASK = 'name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,profile,metadata,serviceItems,latlng';
const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

// 無資格のリラク店が使えない語（厚労省あはき・柔整広告ガイドライン 2025-02-18 の10。根拠＝03-1-C）
const NG_SHOUJOU = /肩こり|肩コリ|腰痛|膝の痛み|神経痛|疲労回復|改善|解消|治る|治療|効く|効果|根本/g;
const NG_KOUHYOU = /No\.?1|ナンバーワン|日本一|必ず(?:治|改善)|確実に(?:治|改善)|完全(?:治癒|に治る)/g;
const RELAX = ['マッサージ', '整体', 'リラク', '指圧', 'もみほぐし', '足つぼ', '足ツボ', 'エステ', 'アロマ', 'カッサ', 'リンパ'];
// 検索語の照合で無視する一般語（これが出ても「登録に無い」とは言わない）
const GENERIC = ['レストラン', '飲食店', 'ランチ', '喫茶店', 'カフェ', 'ジム', 'マッサージ'];

const today = () => new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (s) => {
  const t = Date.parse(String(s || '').slice(0, 10));
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : 99999;
};
const within = (arr, n) => arr.filter((x) => x.at && daysAgo(x.at) >= 0 && daysAgo(x.at) <= n).length;
const uniq = (a) => [...new Set(a)];

// ページをすべて辿って集める（GBP v4.9）
export async function fetchAll(url, key, token, cap = 20, request = fetch) {
  const out = []; let pageToken = ''; const seen = new Set();
  try {
    for (let i=0;i<cap;i++) {
      const r = await request(`${url}?pageSize=100${pageToken ? '&pageToken='+encodeURIComponent(pageToken):''}`, {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
      const d = await r.json();
      if (!r.ok || d.error) return {items:out,complete:false,error:`取得失敗 HTTP ${r.status}`};
      if (d[key] != null && !Array.isArray(d[key])) return {items:out,complete:false,error:'応答形式不正'};
      out.push(...(d[key]||[])); pageToken=d.nextPageToken;
      if (!pageToken) return {items:out,complete:true};
      if(seen.has(pageToken)) break; seen.add(pageToken);
    }
    return {items:out,complete:false,error:'ページ取得未完了'};
  } catch { return {items:out,complete:false,error:'通信または応答の取得失敗'}; }
}

// ── 採点の本体（取得済みのデータだけで採点する純粋な関数。テストしやすいように分けてある） ──
export function scoreLocation(info, activity, perf, availAttrs = null) {
  const title = info.title || '';
  const cats = [info.categories?.primaryCategory?.displayName || '']
    .concat((info.categories?.additionalCategories || []).map((c) => c.displayName || ''));
  const desc = info.profile?.description || '';
  const svcs = (info.serviceItems || []).map((s) =>
    s.freeFormServiceItem?.label?.displayName || s.structuredServiceItem?.serviceTypeId || '');
  const attrs = new Set((info.attributes || []).map((x) => x.name));
  const sp = info.specialHours?.specialHourPeriods || [];
  const t0 = ymd(today());
  const futureSp = sp.filter((x) => {
    const s = x.startDate;
    return s && `${s.year}-${String(s.month).padStart(2, '0')}-${String(s.day).padStart(2, '0')}` >= t0;
  });
  const isRelax = RELAX.some((k) => cats.join(' ').includes(k) || title.includes(k));

  const sources = Object.fromEntries(['reviews','media','posts'].map(k=>[k,
    Array.isArray(activity[k]) && !activity.errors?.[k] && activity.complete?.[k] !== false]));
  sources.attributes = Array.isArray(info.attributes) && !info.attributesError;
  const bad = [];
  const ng = (pt, kind, msg, todo) => {
    const key = {'口コミ':'reviews','写真':'media','投稿':'posts','属性':'attributes'}[kind];
    if (key && !sources[key]) return;
    // 提案の優先度と点数を分離。相関・文字数・頻度から順位を採点しない。
    bad.push({ pt:0, priority:pt, kind:kind==='法令'||kind==='規約'?'要確認':kind, msg, todo });
  };
  const hits = (re, s) => uniq(String(s || '').match(new RegExp(re.source, 'g')) || []).sort();

  // ── 0. 規約・法令（ここが残っていると他をやる前に直す。根拠＝01-3・03-1-C・03-7） ──
  if (isRelax) {
    const h = hits(NG_SHOUJOU, desc);
    if (h.length) ng(12, '法令', `説明文に症状・効果の語（${h.join('・')}）`, '資格・提供内容・表現の文脈を店舗に確認する。語だけでは違反と判定しない');
    const hs = hits(NG_SHOUJOU, svcs.join(' '));
    if (hs.length) ng(12, '法令', `サービス欄に症状・効果の語（${hs.join('・')}）`, '実際の施術内容と資格を確認する。自動で削除・変更しない');
    if (desc.includes('マッサージ') || svcs.some((s) => s.includes('マッサージ')))
      ng(8, '法令', '説明文かサービス欄に「マッサージ」', '国家資格の有無を店に確認。無資格ならボディケア等に言い換える');
  }
  for (const [where, txt] of [['説明文', desc], ['サービス欄', svcs.join(' ')]]) {
    const h = hits(NG_KOUHYOU, txt);
    if (h.length) ng(10, '法令', `${where}に根拠・文脈の確認が必要な表現（${h.join('・')}）`, '根拠と文脈を確認する。違反や削除の必要性を自動で断定しない');
  }
  if (/[×xX]\s*\S|【|】/.test(title) && title.length > 18)
    ng(6, '規約', '店名にキーワードらしき語が入っている', '店に伝えて、実際の店名だけにする（Googleのガイドライン）');
  // 住所欄にキーワードを詰め込む手口。店名だけ見ていると見落とす（2026-10-22にほしの接骨院で発見）。
  // 実例＝住所2行目が「接骨院/整骨院/整体/腰痛/肩こり/頭痛/骨盤矯正/交通事故治療/むち打ち」。
  const addrLines = info.storefrontAddress?.addressLines || [];
  const addrExtra = addrLines.slice(1).join(' ');
  if (addrExtra && ((addrExtra.match(/[\/／・]/g) || []).length >= 2 || addrExtra.length >= 25))
    ng(6, '規約', `住所欄にキーワードらしき文字列（${addrExtra.slice(0, 40)}）`,
       '住所は建物名・部屋番号までにする。キーワードを入れるとGoogleのガイドライン違反で表示が止まることがある');

  // ── 1. 基本情報（順位への効きが大きい。根拠＝01-1・02-1-1） ──
  if (!cats[0]) ng(10, '基本', 'メインカテゴリが空', '最も具体的なカテゴリを入れる');
  if (cats.length < 2) ng(6, '基本', `カテゴリが${cats.length}つだけ`, '実態を表すカテゴリが足りているか確認。追加数に一律の目標は設けない');
  else if (cats.length > 7) ng(3, '基本', `カテゴリが${cats.length}個（7個超）`, '実態と離れたものを外す（根拠＝同上）');
  if (desc.length < 300) ng(6, '基本', `説明文が${desc.length}字（750字まで入る）`, '悩み→提供内容→誰に向くか→行動の順で書く');
  if (!svcs.length) ng(8, '基本', 'サービス欄が0件', '業種で利用できる場合、実際に提供するサービスだけを店に確認して登録する');
  else if (svcs.length < 5) ng(4, '基本', `サービス欄が${svcs.length}件`, '件数を目標にせず、実際の提供内容に不足がないか確認する');
  if (!info.websiteUri) ng(5, '基本', '公式サイトが未登録', 'サイトのURLを入れる');
  if (!futureSp.length) ng(5, '基本', '今後の特別営業時間が0件', '年末年始・祝日の営業を店に聞いて入れる（閉まっているのに営業中の表示は低評価のもと）');
  if (sources.attributes && !attrs.has('attributes/url_appointment') && !attrs.has('attributes/url_menu'))
    ng(4, '基本', '予約・メニューのリンクが未設定', 'ある店は入れる（行動の入口）');

  // ── 1-2. 属性（2026-10-22 追加。Googleマップの絞り込みに直接効く） ──
  // Googleは業種ごとに設定できる属性を用意していて、利用者は「PayPay可」「駐車場あり」等で絞り込める。
  // 絞り込まれた時点で、未設定の店は順位以前に候補から消える。設定は無料で、店に聞けば今日できる。
  // 実測（2026-10-22）：美康堂は43個設定できるのに1個しか入っていなかった。広島っ子は96個中80個設定済み。
  let attrGap = null;
  if (sources.attributes && Array.isArray(availAttrs) && availAttrs.length) {
    const have = new Set((info.attributes || []).map((a) => a.name));
    const missing = availAttrs.filter((a) => !have.has(a.parent));
    const rate = 1 - missing.length / availAttrs.length;
    const group = (a) => a.groupDisplayName || 'その他';
    const byGroup = {};
    for (const a of missing) (byGroup[group(a)] = byGroup[group(a)] || []).push(a.displayName || a.parent);
    attrGap = { available: availAttrs.length, set: availAttrs.length - missing.length, missing: missing.length,
                coverage: Number((rate * 100).toFixed(0)), byGroup };
    if (rate < 0.5)
      ng(6, '属性', `設定できる属性${availAttrs.length}個のうち${missing.length}個が未設定（${attrGap.coverage}%しか埋まっていない）`,
         '店に聞いて埋める。設定は無料で、絞り込み検索の候補に入るかどうかが変わる');
    else if (rate < 0.75)
      ng(3, '属性', `設定できる属性${availAttrs.length}個のうち${missing.length}個が未設定`, '店に聞いて埋める');
    // 決済方法は絞り込みで使われやすい。1つも入っていない店は別立てで引く。
    const payMissing = (byGroup['決済方法'] || []).length;
    const payTotal = availAttrs.filter((a) => group(a) === '決済方法').length;
    if (payTotal && payMissing === payTotal)
      ng(5, '属性', `決済方法が1つも設定されていない（${payTotal}個設定できる）`,
         '店に使える支払い方法を聞いて入れる。PayPayやクレジットカードで絞り込む人が落ちている');
    // SNSと予約のリンクはプロフィールからの行き先を増やす。
    // ★持っていないSNSを責めない（2026-10-22に直した）。TikTokやPinterestを運用していない会社を
    //   「3個未設定」で減点するのは成り立たない。見るのは「1つも入っていないか」だけ。
    const snsSet = (info.attributes || []).filter((a) => /^attributes\/url_(instagram|twitter|facebook|youtube|tiktok|linkedin|pinterest)$/.test(a.name)).length;
    if (snsSet === 0)
      ng(2, '属性', 'SNSのリンクが1つも入っていない', '店が実際に運用しているものだけ入れる（無いなら入れない）');
  }

  // ── 2. 口コミ（順位にも行動にも効く。根拠＝02-1-2・自社データ） ──
  const rv = activity.reviews || [];
  const n30 = within(rv, 30), n90 = within(rv, 90);
  const nore = rv.filter((x) => x.at && daysAgo(x.at) <= 90 && !x.replyAt).length;
  if (rv.length >= 1 && rv.length <= 5)
    ng(12, '口コミ', `口コミが${rv.length}件（取得できた件数）`, '実際の利用者に任意の感想をお願いする。見返り・評価の選別・文面の指定はしない');
  else if (rv.length < 10)
    ng(10, '口コミ', `口コミが${rv.length}件（10件未満）`, '件数を保証せず、実際の利用者に同じ方法で任意の感想をお願いする');
  if (n90 === 0) ng(10, '口コミ', '90日間、新しい口コミが0件', '頼み方を店と決め直す。週1件を目標にする');
  else if (n30 === 0) ng(5, '口コミ', '30日間、新しい口コミが0件', '声かけが止まっていないか確認');
  if (nore) ng(6, '口コミ', `直近90日で未返信が${nore}件`, '内容を確認して返信する。評価や件数の増加は保証しない');

  // ── 3. 写真（順位には効かないが行動に効く。根拠＝02-1-3・02-4） ──
  const md = activity.media || [];
  if (md.length < 20) ng(6, '写真', `写真が${md.length}枚（上位3位の中央値は41枚）`, '店の実写を増やす。外観・内観・料理か施術・スタッフ・メニュー表。Localo 16,098件（相関・標本は上位寄り）');
  if (within(md, 90) === 0) ng(6, '写真', '90日間、写真を1枚も足していない', '店の実写を月に数枚足す。素材写真とAI画像は使わない');
  else if (within(md, 30) === 0) ng(3, '写真', '30日間、写真を足していない', '月に数枚のペースに戻す');

  // ── 4. 投稿（順位には効かない。見た人を動かすために書く。根拠＝02-4） ──
  const po = activity.posts || [];
  const lastAt = po.map((x) => String(x.at || '').slice(0, 10)).sort().pop() || '';
  const alive = within(po, 180); // Googleの投稿は約6か月でアーカイブされる
  if (alive < 10) ng(5, '投稿', `生きている投稿が${alive}本（10本未満）`, '営業変更や新サービスなど、案内すべき情報があるときに投稿する。本数は順位の必須条件ではない');
  if (!po.length) ng(3, '投稿', '投稿が0件', '特典かイベント型で、タイトル・実写・期限・行動1つを入れる');
  else if (daysAgo(lastAt) > 60) ng(3, '投稿', `最後の投稿から${daysAgo(lastAt)}日`, '月2本のペースに戻す');
  const recent = po.filter((x) => x.at && daysAgo(x.at) <= 120);
  if (recent.length) {
    const nomedia = recent.filter((x) => !x.media).length;
    if (nomedia / recent.length > 0.5)
      ng(4, '投稿', `直近の投稿${recent.length}本中${nomedia}本に写真がない`, '内容が伝わる実際の写真を検討する。効果の倍率は保証しない');
    const nocta = recent.filter((x) => !x.cta).length;
    if (nocta / recent.length > 0.5)
      ng(3, '投稿', `直近の投稿${recent.length}本中${nocta}本にボタンがない`, '予約・電話・経路のボタンを1つ付ける');
  }

  // ── 5. 検索されているのに登録に無い語（cantik独自。根拠＝04） ──
  // Googleが「この店はこの語で表示された」と返した語を、登録内容に全部含まれるかで照合する。
  const missing = [];
  const kwMap = perf?.searchKeywords || {};
  const yms = Object.keys(kwMap).sort().slice(-3);
  if (yms.length) {
    const blob = `${title} ${cats.join(' ')} ${desc} ${svcs.join(' ')}`.toLowerCase();
    const brand = title.replace(/[（(].*/, '').trim().split(/[\s　]/)[0].slice(0, 3).toLowerCase();
    const sum = {};
    for (const ym of yms) for (const [w, c] of (kwMap[ym] || [])) if (Number.isFinite(c)) sum[w] = (sum[w] || 0) + c;
    const ranked = Object.entries(sum).sort((a, b) => b[1] - a[1]).slice(0, 30);
    for (const [w, c] of ranked) {
      if (brand && w.toLowerCase().includes(brand)) continue;           // 店名で探された語は施策にならない
      if (/[0-9０-９]+\s*[−\-ー]|丁目|東京都|ビル/.test(w)) continue;      // 住所で探された語
      if (GENERIC.includes(w)) continue;                                // 一般語すぎる
      const parts = w.toLowerCase().split(/[\s　]+/).filter(Boolean);
      if (!parts.every((x) => blob.includes(x))) missing.push({ word: w, count: c });
    }
    if (missing.length)
      ng(8, '検索語', `検索されているのに登録に無い語：${missing.slice(0, 5).map((m) => `${m.word}(${m.count})`).join('・')}`,
         '店にあるものだけ、サービス欄と説明文に入れる');
  }

  // ── 6. 実績の落ち込み（前年同期比。根拠＝効果検証README） ──
  let yoy = null;
  const periods = comparisonPeriods();
  const comparisons = {};
  for (const [name, keys, minimum] of [
    ['maps',['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_MOBILE_MAPS'],300],
    ['actions',['BUSINESS_DIRECTION_REQUESTS','CALL_CLICKS','WEBSITE_CLICKS'],50]]) {
    const current=coveredTotal(perf?.daily,periods.start,periods.end,keys);
    const previous=coveredTotal(perf?.daily,periods.previousStart,periods.previousEnd,keys);
    const percent=current.complete&&previous.complete&&previous.total>=minimum?(current.total/previous.total-1)*100:null;
    comparisons[name]={current,previous,percent};
    if(name==='maps') yoy=percent;
    if(percent!==null && percent<=-25) ng(4,'実績',`${name==='maps'?'地図表示':'電話・ルート・サイト操作'}が同日数の前年期間比 ${percent.toFixed(0)}%`,
      '対象期間と営業状況を確認する。集客施策だけを増減の原因と断定しない');
  }
  for(const [k,ok] of Object.entries(sources)) if(!ok) bad.push({pt:0,priority:100,kind:'取得未完了',msg:`${({reviews:'口コミ',media:'写真',posts:'投稿',attributes:'属性'})[k]}は判定保留`,todo:'取得を再試行する。0件として扱わない'});
  const registrationChecks = [
    {id:'title',label:'店名',ok:!!title.trim()},
    {id:'category',label:'主カテゴリ',ok:!!cats[0]},
    {id:'description',label:'説明文',ok:!!desc.trim()},
    {id:'contact',label:'電話または公式サイト',ok:!!(info.phoneNumbers?.primaryPhone||info.websiteUri)}
  ];
  const complete=Object.values(sources).every(Boolean);
  bad.sort((a, b) => b.priority - a.priority);
  return {
    title,
    keywordCounts:perf?.keywordCounts||[], keywordPeriod:perf?.keywordPeriod||null, performanceErrors:perf?.errors||{},
    score: complete ? registrationChecks.filter(x=>x.ok).length*25 : null,
    scoreVersion:'registration-v2', scoreLabel:'基本4項目の登録充足度',
    scoreNotice:'各25点。情報の正確さ・順位・集客効果・法令適合を保証する点数ではありません。旧診断点との比較はできません。',
    registrationChecks, coverage:{sources,checked:Object.values(sources).filter(Boolean).length,total:4},
    periods, comparisons,
    items: bad,
    next3: bad.slice(0, 3),                 // 「今やること上位3つ」＝画面に出すのはこれ
    missingKeywords: missing.slice(0, 10),
    attributes: attrGap,
    facts: {
      categories: cats.filter(Boolean).length, descLen: desc.length, services: svcs.length,
      reviews: sources.reviews?rv.length:null, reviews90: sources.reviews?n90:null, unreplied: sources.reviews?rv.filter(x=>!x.replyAt).length:null, unreplied90: sources.reviews?nore:null,
      media: sources.media?md.length:null, media90: sources.media?within(md,90):null,
      postsAlive: sources.posts?alive:null, specialHours: futureSp.length, yoyMaps: yoy,
      // 写真のカテゴリ別の枚数。2026-10-22の実測で、20店すべて外観カテゴリが0枚だった。
      // 撮り直さなくても、今ある写真を正しいカテゴリに入れ直すだけで直る（費用0円）。
      mediaByCat: !sources.media?null:md.reduce((o, x) => { const k = x.cat || '(なし)'; o[k] = (o[k] || 0) + 1; return o; }, {}),
      hasCover: !sources.media?null:md.some((x) => x.cat === 'COVER'),
      exterior: !sources.media?null:md.filter((x) => x.cat === 'EXTERIOR').length,
      videos: !sources.media?null:md.filter((x) => x.fmt === 'VIDEO').length,
    },
  };
}

// ── 取得して採点する（1店） ──
export async function shindanOne(locationName, token, { withPerf = true } = {}) {
  const budget=AbortSignal.timeout(45000);
  const request=async(url,options={})=>{
    const settings={...options,signal:AbortSignal.any([budget,options.signal].filter(Boolean))};
    let response=await fetch(url,settings);
    if([502,503,504].includes(response.status)&&!settings.signal.aborted){
      await new Promise(resolve=>setTimeout(resolve,300));response=await fetch(url,settings);
    }
    return response;
  };
  // パスの使い分け（取り違えると v4 が HTML の404を返す）
  //   Business Information v1 … locations/{id}
  //   v4.9（投稿・写真・口コミ） … accounts/{acc}/locations/{id} のフルパスが要る
  //   Performance v1           … locations/{id}
  const full = String(locationName || '');
  const locPart = full.match(/locations\/[^/]+/)?.[0];
  if (!locPart) return { error: 'locationName不明' };
  const lid = locPart.split('/').pop();
  const v4Path = /accounts\//.test(full) ? full.match(/accounts\/[^/]+\/locations\/[^/]+/)[0] : null;
  if (!v4Path) return { error: '投稿・写真・口コミの取得には accounts/ から始まるフルパスが要ります' };
  const H = { Authorization: `Bearer ${token}` };

  let info;
  try {
    const ir = await request(`${BI}/${locPart}?readMask=${MASK}`, { headers: H, signal:AbortSignal.timeout(10000) });
    info = await ir.json();
    if (!ir.ok || info.error) return { error: '登録内容の取得に失敗しました', code: ir.status, score:null };
  } catch { return {error:'登録内容を取得できませんでした。時間をおいて再試行してください',score:null}; }
  let at;
  try { const r=await request(`${BI}/${locPart}/attributes`,{headers:H,signal:AbortSignal.timeout(15000)}); at=await r.json(); if(!r.ok||at.error) throw new Error(); info.attributes=at.attributes||[]; }
  catch { info.attributes=null; info.attributesError='属性取得失敗'; }

  const [posts, media, reviews] = await Promise.all([
    fetchAll(`${V4}/${v4Path}/localPosts`, 'localPosts', token,20,request),
    fetchAll(`${V4}/${v4Path}/media`, 'mediaItems', token,20,request),
    fetchAll(`${V4}/${v4Path}/reviews`, 'reviews', token,20,request),
  ]);
  const activity = {
    posts: posts.items.map((p) => ({ at: p.createTime, type: p.topicType, media: (p.media || []).length, cta: p.callToAction?.actionType || '' })),
    media: media.items.map((x) => ({ at: x.createTime, cat: x.locationAssociation?.category || '', fmt: x.mediaFormat })),
    reviews: reviews.items.map((r) => ({ at: r.createTime, star: STAR[r.starRating] || 0, replyAt: r.reviewReply?.updateTime || null })),
    errors: { posts: posts.error, media: media.error, reviews: reviews.error },
    complete: { posts:posts.complete,media:media.complete,reviews:reviews.complete },
  };

  let perf = null;
  if (withPerf) perf = await fetchPerf(lid, token, new Date(), request);
  // その業種で設定できる属性の一覧（カテゴリごとに違う）。取れなくても採点は続ける。
  const availAttrs = await fetchAvailableAttributes(info.categories?.primaryCategory?.name, token, request);
  const out = scoreLocation(info, activity, perf, availAttrs);
  out.locationName = locPart;
  out.fetchErrors = Object.fromEntries(Object.entries({...activity.errors,attributes:info.attributesError}).filter(([, v]) => v));
  out.profileSnapshot={title:info.title,description:info.profile?.description,categories:info.categories,storefrontAddress:info.storefrontAddress,phoneNumbers:info.phoneNumbers,websiteUri:info.websiteUri,observedAt:new Date().toISOString()};
  return out;
}

// その業種で設定できる属性の一覧。カテゴリごとに違う（お好み焼き店96個・整体43個・美容院49個）。
// 失敗しても null を返し、採点の属性の章だけを落とす（店1つの失敗で全体を止めない）。
export async function fetchAvailableAttributes(categoryName, token, request = fetch) {
  if (!categoryName) return null;
  const all=[],seen=new Set(); let pageToken='';
  try {
    for(let i=0;i<20;i++) {
      const q=new URLSearchParams({categoryName,regionCode:'JP',languageCode:'ja',showAll:'false',pageSize:'100'});
      if(pageToken) q.set('pageToken',pageToken);
      const r=await request(`${BI}/attributes?${q}`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(10000)});
      const d=await r.json();
      if(!r.ok||d.error||!Array.isArray(d.attributeMetadata||[])) return null;
      all.push(...(d.attributeMetadata||[]));pageToken=d.nextPageToken;
      if(!pageToken)return all;
      if(seen.has(pageToken))return null;seen.add(pageToken);
    }
    return null;
  } catch { return null; }
}

// 実績（日別の指標18か月＋月別の検索語）。採点の「検索語」と「実績」の章で使う。
export async function fetchPerf(lid, token, now = new Date(), request = fetch) {
  const H={Authorization:`Bearer ${token}`}, periods=comparisonPeriods(now);
  const start=new Date(periods.previousStart+'T00:00:00Z'),end=new Date(periods.end+'T00:00:00Z');
  const metrics=['BUSINESS_IMPRESSIONS_DESKTOP_MAPS','BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH','BUSINESS_IMPRESSIONS_MOBILE_SEARCH','BUSINESS_DIRECTION_REQUESTS','CALL_CLICKS','WEBSITE_CLICKS'];
  const p=new URLSearchParams();for(const m of metrics)p.append('dailyMetrics',m);
  for(const [key,d] of [['start_date',start],['end_date',end]]) {
    p.set(`dailyRange.${key}.year`,d.getUTCFullYear());p.set(`dailyRange.${key}.month`,d.getUTCMonth()+1);p.set(`dailyRange.${key}.day`,d.getUTCDate());
  }
  const daily={},errors={};
  try {
    const r=await request(`${PERF}/locations/${lid}:fetchMultiDailyMetricsTimeSeries?${p}`,{headers:H,signal:AbortSignal.timeout(20000)});
    const d=await r.json();if(!r.ok||d.error)throw new Error();
    for(const s of d.multiDailyMetricTimeSeries||[])for(const m of s.dailyMetricTimeSeries||[])for(const v of m.timeSeries?.datedValues||[]) {
      const dt=`${v.date.year}-${String(v.date.month).padStart(2,'0')}-${String(v.date.day).padStart(2,'0')}`;
      // Googleの明示されたdatedValueでvalue省略はprotobufの0。日自体の欠落は埋めない。
      const n=Number(v.value??0);if(Number.isFinite(n)&&n>=0)(daily[dt]??={})[m.dailyMetric]=n;
    }
  }catch {errors.daily='実績取得失敗';}
  const jst=new Date(+now+9*3600000),first=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth()-3,1)),last=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth()-1,1));
  const q=new URLSearchParams({'monthlyRange.start_month.year':first.getUTCFullYear(),'monthlyRange.start_month.month':first.getUTCMonth()+1,
    'monthlyRange.end_month.year':last.getUTCFullYear(),'monthlyRange.end_month.month':last.getUTCMonth()+1,pageSize:'100'});
  const keywordCounts=[], searchKeywords={recent:[]};let complete=false;const seen=new Set();
  try {
    for(let i=0;i<100;i++) {
      const r=await request(`${PERF}/locations/${lid}/searchkeywords/impressions/monthly?${q}`,{headers:H,signal:AbortSignal.timeout(15000)});
      const d=await r.json();if(!r.ok||d.error)throw new Error();
      for(const row of d.searchKeywordsCounts||[]) {
        const v=keywordValue(row.insightsValue);keywordCounts.push({word:row.searchKeyword,...v});
        if(v.value!==null) searchKeywords.recent.push([row.searchKeyword,v.value]);
      }
      if(!d.nextPageToken){complete=true;break;}
      if(seen.has(d.nextPageToken))break;seen.add(d.nextPageToken);q.set('pageToken',d.nextPageToken);
    }
    if(!complete) errors.keywords='検索語の取得未完了';
  }catch {errors.keywords='検索語取得失敗';}
  // 一部取得した検索語で上位・不足を断定しない。
  return {daily,searchKeywords:complete?searchKeywords:{},keywordCounts,errors,keywordComplete:complete,
    keywordPeriod:{start:first.toISOString().slice(0,7),end:last.toISOString().slice(0,7)},periods};
}
