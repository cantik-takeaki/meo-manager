// api/_shindan.js — ラクラクMEO 店舗診断（cantik独自の採点）
// ------------------------------------------------------------------
// 何をするか：Googleに登録されている内容と、Googleが返した実績・検索語を突き合わせて、
//   「この店で今いちばん効く手」を減点の大きい順に出す。勘で順番を決めない。
//
// 配点の根拠はすべて MEOシステム/MEO施策研究/ の調査。効きの確信度が高いものほど重く引く。
//   01=Google公式 / 02=業界の実験 / 03=日本の法令とAI検索 / 04=店ごとの実データ / 06=成果事例
// 正本＝MEOシステム/ラクラクMEO_アルゴリズム.md。配点を変えるときは根拠も一緒に直す。
// ローカル版（tools/meo-kouka/shindan.py）と同じ配点。片方だけ変えない。
//
// 読み取りだけ。Googleにも設定にも書き込まない。

const BI = 'https://mybusinessbusinessinformation.googleapis.com/v1';
const V4 = 'https://mybusiness.googleapis.com/v4';
const PERF = 'https://businessprofileperformance.googleapis.com/v1';
const MASK = 'name,title,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,profile,metadata,serviceItems,latlng';
const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

// 無資格のリラク店が使えない語（厚労省あはき・柔整広告ガイドライン 2025-02-18 の10。根拠＝03-1-C）
const NG_SHOUJOU = /肩こり|肩コリ|腰痛|膝の痛み|神経痛|疲労回復|改善|解消|治る|治療|効く|効果|根本/g;
const NG_KOUHYOU = /No\.?1|ナンバーワン|日本一|最高|最安|必ず|確実|保証|完全/g;
const RELAX = ['マッサージ', '整体', 'リラク', '指圧', 'もみほぐし', '足つぼ', '足ツボ', 'エステ', 'アロマ', 'カッサ', 'リンパ'];
// 検索語の照合で無視する一般語（これが出ても「登録に無い」とは言わない）
const GENERIC = ['レストラン', '飲食店', 'ランチ', '喫茶店', 'カフェ', 'ジム', 'マッサージ'];

const today = () => new Date();
const ymd = (d) => d.toISOString().slice(0, 10);
const daysAgo = (s) => {
  const t = Date.parse(String(s || '').slice(0, 10));
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : 99999;
};
const within = (arr, n) => arr.filter((x) => x.at && daysAgo(x.at) <= n).length;
const uniq = (a) => [...new Set(a)];

// ページをすべて辿って集める（GBP v4.9）
async function fetchAll(url, key, token, cap = 5) {
  const out = [];
  let pageToken = '';
  for (let i = 0; i < cap; i++) {
    const r = await fetch(`${url}?pageSize=100${pageToken ? '&pageToken=' + pageToken : ''}`, { headers: { Authorization: `Bearer ${token}` } });
    // パスを間違えるとGoogleはJSONでなくHTMLの404を返す。ここで落とさず、取得エラーとして持ち帰る。
    const txt = await r.text();
    let d;
    try { d = JSON.parse(txt); } catch { return { items: out, error: `HTTP ${r.status}（JSONでない応答）` }; }
    if (d.error) return { items: out, error: d.error.status || d.error.message };
    out.push(...(d[key] || []));
    pageToken = d.nextPageToken;
    if (!pageToken) break;
  }
  return { items: out };
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

  const bad = [];
  const ng = (pt, kind, msg, todo) => bad.push({ pt, kind, msg, todo });
  const hits = (re, s) => uniq(String(s || '').match(new RegExp(re.source, 'g')) || []).sort();

  // ── 0. 規約・法令（ここが残っていると他をやる前に直す。根拠＝01-3・03-1-C・03-7） ──
  if (isRelax) {
    const h = hits(NG_SHOUJOU, desc);
    if (h.length) ng(12, '法令', `説明文に症状・効果の語（${h.join('・')}）`, '言い換える。症状名と効果を結びつけない');
    const hs = hits(NG_SHOUJOU, svcs.join(' '));
    if (hs.length) ng(12, '法令', `サービス欄に症状・効果の語（${hs.join('・')}）`, 'メニュー名を実際の施術名に直す');
    if (desc.includes('マッサージ') || svcs.some((s) => s.includes('マッサージ')))
      ng(8, '法令', '説明文かサービス欄に「マッサージ」', '国家資格の有無を店に確認。無資格ならボディケア等に言い換える');
  }
  for (const [where, txt] of [['説明文', desc], ['サービス欄', svcs.join(' ')]]) {
    const h = hits(NG_KOUHYOU, txt);
    if (h.length) ng(10, '法令', `${where}に景表法で危ない語（${h.join('・')}）`, '削除する');
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
  if (cats.length < 2) ng(6, '基本', `カテゴリが${cats.length}つだけ`, '実際にやっていることだけ、主1＋追加5〜6個まで足す（Localo：6個がピーク69.1%、7個で64.1%に下がる）');
  else if (cats.length > 7) ng(3, '基本', `カテゴリが${cats.length}個（7個超）`, '実態と離れたものを外す（根拠＝同上）');
  if (desc.length < 300) ng(6, '基本', `説明文が${desc.length}字（750字まで入る）`, '悩み→提供内容→誰に向くか→行動の順で書く');
  if (!svcs.length) ng(8, '基本', 'サービス欄が0件', 'Googleが用意している既定のサービスを、店に確認して全部入れる（既定サービスは順位に効く）');
  else if (svcs.length < 5) ng(4, '基本', `サービス欄が${svcs.length}件`, '既定のサービスを増やす');
  if (!info.websiteUri) ng(5, '基本', '公式サイトが未登録', 'サイトのURLを入れる');
  if (!futureSp.length) ng(5, '基本', '今後の特別営業時間が0件', '年末年始・祝日の営業を店に聞いて入れる（閉まっているのに営業中の表示は低評価のもと）');
  if (!attrs.has('attributes/url_appointment') && !attrs.has('attributes/url_menu'))
    ng(4, '基本', '予約・メニューのリンクが未設定', 'ある店は入れる（行動の入口）');

  // ── 1-2. 属性（2026-10-22 追加。Googleマップの絞り込みに直接効く） ──
  // Googleは業種ごとに設定できる属性を用意していて、利用者は「PayPay可」「駐車場あり」等で絞り込める。
  // 絞り込まれた時点で、未設定の店は順位以前に候補から消える。設定は無料で、店に聞けば今日できる。
  // 実測（2026-10-22）：美康堂は43個設定できるのに1個しか入っていなかった。広島っ子は96個中80個設定済み。
  let attrGap = null;
  if (Array.isArray(availAttrs) && availAttrs.length) {
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
    ng(12, '口コミ', `口コミが${rv.length}件（1〜5件は0件より不利）`, 'だらだら増やさず20件まで一気に。全員に同じ方法で頼む（見返りなし・星で選ばない・文面を指定しない）。Localo 16,098件：1〜5件の上位3位率39.3%は0件の46.7%より低い');
  else if (rv.length < 10)
    ng(10, '口コミ', `口コミが${rv.length}件（10件未満）`, 'まず20件を目標に。全員に同じ方法で頼む');
  if (n90 === 0) ng(10, '口コミ', '90日間、新しい口コミが0件', '頼み方を店と決め直す。週1件を目標にする');
  else if (n30 === 0) ng(5, '口コミ', '30日間、新しい口コミが0件', '声かけが止まっていないか確認');
  if (nore) ng(6, '口コミ', `直近90日で未返信が${nore}件`, '全件に返信する（返信を始めた店は星+0.12・口コミ数+12%）');

  // ── 3. 写真（順位には効かないが行動に効く。根拠＝02-1-3・02-4） ──
  const md = activity.media || [];
  if (md.length < 20) ng(6, '写真', `写真が${md.length}枚（上位3位の中央値は41枚）`, '店の実写を増やす。外観・内観・料理か施術・スタッフ・メニュー表。Localo 16,098件（相関・標本は上位寄り）');
  if (within(md, 90) === 0) ng(6, '写真', '90日間、写真を1枚も足していない', '店の実写を月に数枚足す。素材写真とAI画像は使わない');
  else if (within(md, 30) === 0) ng(3, '写真', '30日間、写真を足していない', '月に数枚のペースに戻す');

  // ── 4. 投稿（順位には効かない。見た人を動かすために書く。根拠＝02-4） ──
  const po = activity.posts || [];
  const lastAt = po.map((x) => String(x.at || '').slice(0, 10)).sort().pop() || '';
  const alive = within(po, 180); // Googleの投稿は約6か月でアーカイブされる
  if (alive < 10) ng(5, '投稿', `生きている投稿が${alive}本（10本未満）`, '月2本ペースで常時10本以上を保つ。Localo：10本以上73.0%、1〜9本66.0%。頻度でなく本数');
  if (!po.length) ng(3, '投稿', '投稿が0件', '特典かイベント型で、タイトル・実写・期限・行動1つを入れる');
  else if (daysAgo(lastAt) > 60) ng(3, '投稿', `最後の投稿から${daysAgo(lastAt)}日`, '月2本のペースに戻す');
  const recent = po.filter((x) => x.at && daysAgo(x.at) <= 120);
  if (recent.length) {
    const nomedia = recent.filter((x) => !x.media).length;
    if (nomedia / recent.length > 0.5)
      ng(4, '投稿', `直近の投稿${recent.length}本中${nomedia}本に写真がない`, '実写を必ず付ける（素材写真はクリックが5.6分の1）');
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
  if (perf?.daily) {
    const MAPS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS'];
    const ACT = ['BUSINESS_DIRECTION_REQUESTS', 'CALL_CLICKS', 'WEBSITE_CLICKS'];
    const back = (n) => ymd(new Date(Date.now() - n * 86400000));
    const A = back(74), B = back(14);
    const lastYear = (s) => `${Number(s.slice(0, 4)) - 1}${s.slice(4)}`;
    const tot = (a, b, keys) => Object.entries(perf.daily)
      .filter(([d]) => d >= a && d <= b)
      .reduce((s, [, v]) => s + keys.reduce((t, k) => t + (v[k] || 0), 0), 0);
    const m1 = tot(A, B, MAPS), m0 = tot(lastYear(A), lastYear(B), MAPS);
    const c1 = tot(A, B, ACT), c0 = tot(lastYear(A), lastYear(B), ACT);
    // 母数が小さいと率が暴れるので、前年の実数がある程度ある時だけ判定する
    if (m0 >= 300) {
      yoy = (m1 / m0 - 1) * 100;
      if (yoy <= -25) ng(6, '実績', `地図での表示が前年同期比 ${yoy > 0 ? '+' : ''}${yoy.toFixed(0)}%`, '写真と口コミが止まっていないか。カテゴリと営業時間が正しいか');
    }
    if (c0 >= 50 && c1 / c0 - 1 <= -0.25)
      ng(4, '実績', `電話・ルート・サイトの合計が前年同期比 ${((c1 / c0 - 1) * 100).toFixed(0)}%`, '行動の入口（予約ボタン・写真・口コミ）を見直す');
  }

  bad.sort((a, b) => b.pt - a.pt);
  return {
    title,
    score: Math.max(0, 100 - bad.reduce((s, x) => s + x.pt, 0)),
    items: bad,
    next3: bad.slice(0, 3),                 // 「今やること上位3つ」＝画面に出すのはこれ
    missingKeywords: missing.slice(0, 10),
    attributes: attrGap,
    facts: {
      categories: cats.filter(Boolean).length, descLen: desc.length, services: svcs.length,
      reviews: rv.length, reviews90: n90, unreplied90: nore,
      media: md.length, media90: within(md, 90),
      postsAlive: alive, specialHours: futureSp.length, yoyMaps: yoy,
      // 写真のカテゴリ別の枚数。2026-10-22の実測で、20店すべて外観カテゴリが0枚だった。
      // 撮り直さなくても、今ある写真を正しいカテゴリに入れ直すだけで直る（費用0円）。
      mediaByCat: md.reduce((o, x) => { const k = x.cat || '(なし)'; o[k] = (o[k] || 0) + 1; return o; }, {}),
      hasCover: md.some((x) => x.cat === 'COVER'),
      exterior: md.filter((x) => x.cat === 'EXTERIOR').length,
      videos: md.filter((x) => x.fmt === 'VIDEO').length,
    },
  };
}

// ── 取得して採点する（1店） ──
export async function shindanOne(locationName, token, { withPerf = true } = {}) {
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

  const ir = await fetch(`${BI}/${locPart}?readMask=${MASK}`, { headers: H });
  const info = await ir.json();
  if (info.error) return { error: info.error.message || '登録内容の取得に失敗', code: info.error.code };
  const at = await (await fetch(`${BI}/${locPart}/attributes`, { headers: H })).json();
  info.attributes = at.attributes || [];

  const [posts, media, reviews] = await Promise.all([
    fetchAll(`${V4}/${v4Path}/localPosts`, 'localPosts', token),
    fetchAll(`${V4}/${v4Path}/media`, 'mediaItems', token),
    fetchAll(`${V4}/${v4Path}/reviews`, 'reviews', token),
  ]);
  const activity = {
    posts: posts.items.map((p) => ({ at: p.createTime, type: p.topicType, media: (p.media || []).length, cta: p.callToAction?.actionType || '' })),
    media: media.items.map((x) => ({ at: x.createTime, cat: x.locationAssociation?.category || '', fmt: x.mediaFormat })),
    reviews: reviews.items.map((r) => ({ at: r.createTime, star: STAR[r.starRating] || 0, replyAt: r.reviewReply?.updateTime || null })),
    errors: { posts: posts.error, media: media.error, reviews: reviews.error },
  };

  let perf = null;
  if (withPerf) perf = await fetchPerf(lid, token);
  // その業種で設定できる属性の一覧（カテゴリごとに違う）。取れなくても採点は続ける。
  const availAttrs = await fetchAvailableAttributes(info.categories?.primaryCategory?.name, token);
  const out = scoreLocation(info, activity, perf, availAttrs);
  out.locationName = locPart;
  out.fetchErrors = Object.fromEntries(Object.entries(activity.errors).filter(([, v]) => v));
  return out;
}

// その業種で設定できる属性の一覧。カテゴリごとに違う（お好み焼き店96個・整体43個・美容院49個）。
// 失敗しても null を返し、採点の属性の章だけを落とす（店1つの失敗で全体を止めない）。
export async function fetchAvailableAttributes(categoryName, token) {
  if (!categoryName) return null;
  try {
    const r = await fetch(`${BI}/attributes?categoryName=${encodeURIComponent(categoryName)}&regionCode=JP&languageCode=ja&showAll=false`,
      { headers: { Authorization: `Bearer ${token}` } });
    const txt = await r.text();
    let d; try { d = JSON.parse(txt); } catch { return null; }
    if (d.error) return null;
    return d.attributeMetadata || null;
  } catch { return null; }
}

// 実績（日別の指標18か月＋月別の検索語）。採点の「検索語」と「実績」の章で使う。
export async function fetchPerf(lid, token) {
  const H = { Authorization: `Bearer ${token}` };
  const end = new Date(), start = new Date(Date.now() - 400 * 86400000);
  const METRICS = ['BUSINESS_IMPRESSIONS_DESKTOP_MAPS', 'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
    'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH', 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
    'BUSINESS_DIRECTION_REQUESTS', 'CALL_CLICKS', 'WEBSITE_CLICKS'];
  const p = new URLSearchParams();
  for (const m of METRICS) p.append('dailyMetrics', m);
  p.set('dailyRange.start_date.year', String(start.getFullYear()));
  p.set('dailyRange.start_date.month', String(start.getMonth() + 1));
  p.set('dailyRange.start_date.day', String(start.getDate()));
  p.set('dailyRange.end_date.year', String(end.getFullYear()));
  p.set('dailyRange.end_date.month', String(end.getMonth() + 1));
  p.set('dailyRange.end_date.day', String(end.getDate()));
  const daily = {};
  try {
    const d = await (await fetch(`${PERF}/locations/${lid}:fetchMultiDailyMetricsTimeSeries?${p}`, { headers: H })).json();
    for (const s of d.multiDailyMetricTimeSeries || []) {
      for (const m of s.dailyMetricTimeSeries || []) {
        const key = m.dailyMetric;
        for (const v of m.timeSeries?.datedValues || []) {
          const dt = `${v.date.year}-${String(v.date.month).padStart(2, '0')}-${String(v.date.day).padStart(2, '0')}`;
          (daily[dt] = daily[dt] || {})[key] = Number(v.value || 0);
        }
      }
    }
  } catch (e) { /* 実績が取れなくても採点は続ける（その章だけ落ちる） */ }

  // 月別の検索語（直近3か月）
  const searchKeywords = {};
  try {
    const q = new URLSearchParams();
    const s3 = new Date(Date.now() - 100 * 86400000);
    q.set('monthlyRange.start_month.year', String(s3.getFullYear()));
    q.set('monthlyRange.start_month.month', String(s3.getMonth() + 1));
    q.set('monthlyRange.end_month.year', String(end.getFullYear()));
    q.set('monthlyRange.end_month.month', String(end.getMonth() + 1));
    q.set('pageSize', '100');
    const kr = await (await fetch(`${PERF}/locations/${lid}/searchkeywords/impressions/monthly?${q}`, { headers: H })).json();
    for (const row of kr.searchKeywordsCounts || []) {
      const m = row.insightsValue || {};
      // Googleは少ない語を「しきい値」でしか返さない。その場合は下限値を使う。
      const c = Number(m.value ?? m.threshold ?? 0);
      const ym = 'recent';
      (searchKeywords[ym] = searchKeywords[ym] || []).push([row.searchKeyword, c]);
    }
  } catch (e) { /* 同上 */ }
  return { daily, searchKeywords };
}
