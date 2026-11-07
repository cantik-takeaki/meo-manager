import {reserveSharedWording} from './review-shared-history.js';
import {internationalVariants} from './review-international.js';
import sentenceLines from '../assets/review-common/sentence-lines.js';
import {chooseWording} from './review-variants.js';
import {japaneseParagraph} from './review-japanese.js';
import {createHash} from 'node:crypto';
import {sameOrigin} from '../api/_auth.js';
import {kvGet,getKV} from '../api/_kv.js';
import {storeGroups,choices} from './review-catalog.js';

// 選んだ項目の意味を変えない言い換えだけを許可する。自由記述は原文を保持する。
const politeJa = {
  '料理がおいしい':'料理がおいしかったです', 'スタッフが丁寧':'スタッフの方が丁寧でした',
  '雰囲気が良い':'雰囲気が良かったです','清潔感がある':'清潔感がありました',
  '提供が早い':'料理の提供が早かったです','コスパが良い':'コストパフォーマンスが良かったです',
  'また来たい':'また来たいです','おすすめしたい':'おすすめしたいです',
  '施術が丁寧':'施術が丁寧でした','力加減がちょうど良い':'力加減がちょうど良かったです',
  '体が楽になった':'体が楽になりました','説明が分かりやすい':'説明が分かりやすかったです',
  '予約が取りやすい':'予約が取りやすかったです','指導が丁寧':'指導が丁寧でした',
  '自分に合ったメニュー':'自分に合ったメニューでした','続けやすい':'続けやすいです',
  '設備が清潔':'設備が清潔でした','変化を感じられた':'変化を感じられました',
  'スタッフの対応が良い':'スタッフの対応が良かったです',
 '説明が分かりやすかった':'説明が分かりやすかったです','質問する時間があった':'質問する時間がありました',
  '受付の流れが分かりやすかった':'受付の流れが分かりやすかったです','予約時間から待った':'予約時間を過ぎてからも待ちました'
};
const internationalForms={
  en:{
    food:['The food was delicious','The staff were attentive','I liked the atmosphere','It felt clean','The service was quick','It was good value','I would like to visit again','I would recommend it'],
    relax:['The treatment was attentive','The pressure felt right for me','I felt more relaxed','The explanation was clear','It felt clean','It was easy to book','It was good value','I would like to visit again'],
    gym:['The coaching was attentive','The program suited me','It was easy to keep up','The facilities were clean','I noticed a change','The staff were helpful','It was good value','I would recommend it'],
    clinic:['I found the explanation clear','There was time for my questions','I found the check-in process clear','I waited beyond my appointment time']
  },
  zh:{
    food:['我觉得菜很好吃','工作人员很有礼貌','我喜欢这里的氛围','这里给人的感觉很干净','上菜挺快','我觉得性价比不错','我还想再来','我愿意推荐这里'],
    relax:['服务很细致','力度对我来说刚刚好','我觉得身体轻松了','说明很好懂','这里给人的感觉很干净','预约很方便','我觉得性价比不错','我还想再来'],
    gym:['指导很细致','训练计划适合我','我觉得容易坚持','设施很干净','我感觉到了变化','工作人员的服务态度很好','我觉得性价比不错','我愿意推荐这里'],
    clinic:['我觉得说明很清楚','我有时间提问','我觉得接待流程很清楚','过了预约时间我还在等']
  },
  ko:{
    food:['음식이 맛있었어요','직원 응대가 정중했어요','분위기가 좋았어요','청결하게 느껴졌어요','음식이 빨리 나왔어요','가격 대비 만족스러웠어요','다시 방문하고 싶어요','추천하고 싶어요'],
    relax:['관리가 꼼꼼했어요','압이 저에게 알맞았어요','몸이 편안해졌어요','설명이 이해하기 쉬웠어요','청결하게 느껴졌어요','예약하기 편했어요','가격 대비 만족스러웠어요','다시 방문하고 싶어요'],
    gym:['지도가 꼼꼼했어요','저에게 맞는 프로그램이었어요','꾸준히 하기 좋았어요','시설이 깨끗했어요','변화를 느꼈어요','직원 응대가 좋았어요','가격 대비 만족스러웠어요','추천하고 싶어요'],
    clinic:['설명을 이해하기 쉬웠어요','질문할 시간이 있었어요','접수 절차를 이해하기 쉬웠어요','예약 시간을 넘겨 기다렸어요']
  }
};
// 自由入力を優先。比較用の表記だけを揃え、本人の文章には手を加えない。
const compact = value=>value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
const jaKey=value=>compact(value).replace(/美味し/g,'おいし').replace(/わかり/g,'分かり').replace(/(?:かった|くなかった|くありませんでした|いです|かったです)$/u,'い').replace(/(?:です|でした|ました)$/u,'').replace(/[がはをも]/gu,'');
const topics={
 '予約が取りやすい':/予約.{0,10}(?:取り|とり|取れ|とれ|し[やづ]|難し|簡単|スムーズ)/u,
 '設備が清潔':/(?:設備|器具|マシン|機材).{0,12}(?:清潔|きれい|綺麗|汚|衛生)/u,
 'スタッフの対応が良い':/(?:スタッフ|トレーナー|対応|接客).{0,12}(?:丁寧|親切|冷た|雑|良|よか|好印象)/u,
 '施術が丁寧':/施術.{0,10}(?:丁寧|ていねい|雑)/u,
 'スタッフが丁寧':/(?:スタッフ|店員|接客|対応).{0,12}(?:丁寧|親切|雑|冷た)/u,
 'コスパが良い':/(?:コスパ|コストパフォーマンス|値段|価格).{0,10}(?:良|よ|高|悪|安|満足)/u,
 '感謝を伝えたい':/(?:ありがと|有難|感謝|お礼)/u,'おすすめしたい':/(?:勧め|すすめ|薦め|おすすめし)/u,'また来たい':/再訪|(?:また|もう一度|次も|二度と|もう).{0,12}(?:来|行|伺|訪れ|利用|通)|(?:来る|行く|利用する)(?:予定|つもり)はない/u,
 '説明が分かりやすかった':/説明.{0,8}(?:分か|わか|理解|明快)/u,'説明が分かりやすい':/説明.{0,8}(?:分か|わか|理解|明快)/u,
 '説明が足りなかった':/説明.{0,6}(?:足り|不足|充分|十分)/u,'料理がおいしい':/(?:料理|食事|味).{0,7}(?:おいし|美味し|まず|不味)/u,
 '予約時間から待った':/予約.{0,18}待/u,'料理が出るまで待った':/(?:注文|料理|提供).{0,18}待/u,
 '清潔感がある':/(?:店内|お店|店|室内|院内).{0,6}(?:清潔|きれい|綺麗|汚)/u,
 '力加減がちょうど良い':/(?:力加減|強さ|圧).{0,8}(?:良|よ|合|強|弱)/u,'力加減が合わなかった':/力加減.{0,5}(?:合|強|弱)/u,
 '雰囲気が良い':/雰囲気.{0,10}(?:良|よ|悪|好き|苦手|気に入|合わ)/u,'提供が早い':/(?:提供|料理が出る|料理が出てくる).{0,7}(?:早|速|遅)/u
};
// メニューの待ち時間は味と別の話題。会計や予約の待ち時間まで提供速度と混同しない。
const foodTiming = {
 ja: /(?:料理|注文|提供|食事|出てくる|出るまで).{0,18}(?:待|遅|早|速|かか|掛か)|(?:待|遅|早|速).{0,12}(?:提供|料理が届)/u,
 en: /(?:food|dish|order|service).{0,28}(?:wait|slow|quick|fast|took|minutes)|waited.{0,30}(?:food|order)/iu,
 zh: /(?:上菜|出餐|等菜|等餐|等了.{0,10}(?:上菜|菜才))/u,
 ko: /(?:음식|주문|요리).{0,18}(?:기다|늦|빨|걸렸|분)/u
};
function overlaps(label,free,lang,group){
 if(!free)return false;
 // 主語のない強弱の感想は、力加減の項目を選んだ施術業種に限って扱う。
 if(group==='relax' && lang==='ja' && ['力加減がちょうど良い','力加減が合わなかった'].includes(label)){
   const pressureOnly=/^(?:私には|自分には)?(?:少し|ちょっと|かなり|とても)?(?:強|弱)(?:かった|すぎ|過ぎ)/u;
   if(free.split(/[。！？!?\n]/u).some(line=>pressureOnly.test(line.trim()) || /(?:力加減|押す強さ|施術の圧).{0,12}(?:良|よ|合|強|弱)/u.test(line)))return true;
 }
 const i=choices[group]?.[lang]?.indexOf(label);
 const key=choices[group]?.ja?.[i];
 if(lang!=='ja' && key==='感謝を伝えたい' && ({en:/thank|appreciat/i,zh:/谢|感激/,ko:/감사|고맙|고마/})[lang]?.test(free))return true;
 if(lang!=='ja' && key==='また来たい' && ({en:/(?:return|visit again|come back)/i,zh:/再来|再去/,ko:/다시 방문|또 오고|다시 오/})[lang]?.test(free))return true;
 if(group==='food' && key==='料理がおいしい' && lang==='ja' && /(?:美味し|おいし)(?:かった|く|い)/u.test(free))return true;
 if(group==='food' && ['提供が早い','料理が出るまで待った'].includes(key) && free.split(/[。！？.!?\n]/u).some(line=>foodTiming[lang]?.test(line) && !(lang==='ja' && /(?:会計|レジ|席が空く|入店|受付).{0,12}待/u.test(line))))return true;
 const forms=[label,lang==='ja'?politeJa[label]:internationalForms[lang]?.[group]?.[i]].filter(Boolean);
 const chunks=free.split(/[。！？.!?\n]+/u).filter(Boolean);
 return chunks.some(line=>forms.some(form=>compact(line).includes(compact(form)) || lang==='ja' && jaKey(line)===jaKey(form)) || lang==='ja' && topics[label]?.test(line));
}
export async function composeReview(selected,free,language,complete,group,recent,reserve) {
  const result = await composeRawReview(selected.filter(label=>!overlaps(label,free,language,group)),free,language,complete,group,recent,reserve);
  return {...result, content:sentenceLines(result.content)};
}
async function composeRawReview(selected,free,language,complete,group,recent,reserve) {
  if (!selected.length) return {content:free,source:'original'};
  if(language==='ja') return japaneseParagraph(selected,free,complete,recent,reserve);
  const stop = ['ja','zh'].includes(language) ? '。' : '.';
  const options=selected.map(label=>{
    const index=choices[group][language].indexOf(label);
    const key=choices[group].ja[index];
    const original=internationalForms[language][group][index];
    return internationalVariants(key,language,original,label).map(form=>form+stop);
  });
  const pool=[];
  for(let seed=0;seed<9;seed++){
    const parts=options.map((forms,i)=>forms[Math.floor(seed/(i%2===0?1:2))%forms.length]);
    const sentence=parts.join(language==='zh'?'':' ');
    if(!pool.includes(sentence))pool.push(sentence);
  }
  return chooseWording(pool,free,complete,recent,reserve);
}

async function allowRequest(req,store) {
  const {url,token}=getKV();
  const ip=req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'anonymous';
  const fingerprint=createHash('sha256').update(String(ip)).digest('hex').slice(0,24);
  const script="local a=redis.call('INCR',KEYS[1]);if a==1 then redis.call('EXPIRE',KEYS[1],300) end;local b=redis.call('INCR',KEYS[2]);if b==1 then redis.call('EXPIRE',KEYS[2],300) end;return (a<=25 and b<=250) and 1 or 0";
  const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),body:JSON.stringify(['EVAL',script,2,'review-limit:ip:'+fingerprint,'review-limit:store:'+store])});
  if(!response.ok)throw new Error('保存先に接続できません');
  const data=await response.json();if(data.error||![0,1].includes(data.result))throw new Error('受付状況を確認できません');
  return data.result===1;
}
// どちらを体験したか、入力から決められない場合はお客様に選んでもらう。
const oppositePoints={
 food:['提供が早い','料理が出るまで待った'],
 relax:['力加減がちょうど良い','力加減が合わなかった']
};
function unresolvedOpposites(selected,free,language,group){
 const pair=oppositePoints[group];
 if(!pair)return false;
 return pair.every(key=>{
   const index=choices[group].ja.indexOf(key);
   const label=choices[group][language][index];
   return selected.includes(label) && !overlaps(label,free,language,group);
 });
}
export async function publicReview(req,res,complete,readSurvey=kvGet,allow=allowRequest) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'||!sameOrigin(req))return res.status(403).json({error:'口コミページから操作してください'});
  const {locationId,selected,free='',language='ja',qrToken=''}=req.body;
  if(!Object.hasOwn(storeGroups,locationId)||!['ja','en','zh','ko'].includes(language))return res.status(400).json({error:'店舗または言語を確認してください'});
  const {recentVariants}=req.body;
  if(recentVariants!==undefined && (!Array.isArray(recentVariants)||recentVariants.length>8||!recentVariants.every(i=>Number.isInteger(i)&&i>=0&&i<512)))return res.status(400).json({error:'候補番号を確認してください'});
  const labels=choices[storeGroups[locationId]][language];
  if(!Array.isArray(selected)||selected.length>labels.length||!selected.every(s=>labels.includes(s))||new Set(selected).size!==selected.length||typeof free!=='string'||free.length>1500||(!free.trim()&&!selected.length))return res.status(400).json({error:'入力を確認してください'});
  try {
    const survey=await readSurvey('survey_'+locationId);
    if(survey?.qrEnabled===false || (survey?.qrToken && survey.qrToken!==qrToken))return res.status(403).json({error:'このQRは現在ご利用いただけません'});
    if(unresolvedOpposites(selected,free,language,storeGroups[locationId])){
      return res.status(422).json({error:'oppositePoints',pair:oppositePoints[storeGroups[locationId]].map(key=>labels[choices[storeGroups[locationId]].ja.indexOf(key)])});
    }
    if(!await allow(req,locationId))return res.status(429).json({error:'少し時間をおいてお試しください'});
    return res.json(await composeReview(selected,free.trim(),language,complete,storeGroups[locationId],recentVariants,candidates=>reserveSharedWording(storeGroups[locationId],language,candidates)));
  } catch {return res.status(503).json({error:'受付状況を確認できません'});}
}
