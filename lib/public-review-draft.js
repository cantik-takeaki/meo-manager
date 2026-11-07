import sentenceLines from '../assets/review-common/sentence-lines.js';
import {reviewSpelling} from './review-wording.js';
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
export async function composeReview(selected,free,language,complete,group) {
  const result = await composeRawReview(selected,free,language,complete,group);
  return {...result, content:sentenceLines(result.content)};
}
async function composeRawReview(selected,free,language,complete,group) {
  if (!selected.length) return {content:free,source:'original'};
  if(language==='ja' && selected.length>1 || language==='ja' && /^(?:店|店内|お店)が(?:綺麗|きれい)だった[。！]?$/.test(free)&&group==='food') return japaneseParagraph(selected,free,complete,group);
  const stop = ['ja','zh'].includes(language) ? '。' : '.';
  const options=selected.map(label=>{
    const exact=label.replace(/[.。]$/u,'')+stop;
    const index=choices[group]?.[language]?.indexOf(label);
    const phrase=language==='ja' ? politeJa[label] : internationalForms[language]?.[group]?.[index];
    const variants=phrase ? [phrase+stop,exact] : [exact];
    return language==='ja'?variants.map(reviewSpelling):variants;
  });
  let indexes=options.map(()=>0);
  let source='template';
  let fallbackReason;
  if (options.some(forms=>forms.length>1)) {
    try {
      const result=await complete('選択された項目ごとに、最も自然な表現を1つ選んでください。JSONオブジェクトのchoicesに、各項目で選んだ候補番号（0始まり）を入力順に入れて返してください。項目数は'+options.length+'。文章候補：'+JSON.stringify(options),{maxTokens:400,temperature:0,reviewChoices:true});
      fallbackReason=result?'indices_invalid':'provider_empty';
      const match=String(result||'').match(/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/g);
      const candidate=match?.map(item=>JSON.parse(item)).filter(row=>row.length===options.length&&row.every((v,i)=>v<options[i].length)).at(-1);
      if(Array.isArray(candidate)&&candidate.length===options.length&&candidate.every((v,i)=>Number.isInteger(v)&&v>=0&&v<options[i].length)) { indexes=candidate; source='ai'; }
    } catch { fallbackReason='unavailable'; }
  }
  const sentence=options.map((forms,i)=>forms[indexes[i]]).join(['ja','zh'].includes(language)?'':' ');
  return {content:[sentence,free].filter(Boolean).join('\n'),source,...(source==='template'&&fallbackReason?{fallbackReason}:{})};
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
export async function publicReview(req,res,complete,readSurvey=kvGet,allow=allowRequest) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST'||!sameOrigin(req))return res.status(403).json({error:'口コミページから操作してください'});
  const {locationId,selected,free='',language='ja',qrToken=''}=req.body;
  if(!Object.hasOwn(storeGroups,locationId)||!['ja','en','zh','ko'].includes(language))return res.status(400).json({error:'店舗または言語を確認してください'});
  const labels=choices[storeGroups[locationId]][language];
  if(!Array.isArray(selected)||selected.length>labels.length||!selected.every(s=>labels.includes(s))||new Set(selected).size!==selected.length||typeof free!=='string'||free.length>1500||(!free.trim()&&!selected.length))return res.status(400).json({error:'入力を確認してください'});
  try {
    const survey=await readSurvey('survey_'+locationId);
    if(survey?.qrEnabled===false || (survey?.qrToken && survey.qrToken!==qrToken))return res.status(403).json({error:'このQRは現在ご利用いただけません'});
    if(!await allow(req,locationId))return res.status(429).json({error:'少し時間をおいてお試しください'});
    return res.json(await composeReview(selected,free.trim(),language,complete,storeGroups[locationId]));
  } catch {return res.status(503).json({error:'受付状況を確認できません'});}
}
