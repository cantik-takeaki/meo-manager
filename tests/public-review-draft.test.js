import test from 'node:test';
import assert from 'node:assert/strict';
import {publicReview,composeReview} from '../lib/public-review-draft.js';
import {choices,storeGroups} from '../lib/review-catalog.js';
const formattedNote='説明は分かりやすかった。\n予約時間から15分待った。';
const hoshino='locations_2965085144069334569';
const note='説明は分かりやすかった。予約時間から15分待った。';
async function call(body,settings={},allowed=true,origin='https://example.test') {
  const response={code:200,setHeader(){},status(n){this.code=n;return this;},json(v){this.data=v;return this;}};
  await publicReview({method:'POST',headers:{host:'example.test',origin},body},response,async()=>'長年の不調が改善しました。',async()=>settings,async()=>allowed);
  return response;
}
test('17店舗×4言語。ログイン情報を持たないリクエストで、選択と原文だけを返す',async()=>{
  for(const [id,group] of Object.entries(storeGroups)) for(const language of ['ja','en','zh','ko']){
    const selected=choices[group][language].slice(0,2);
    const r=await call({locationId:id,language,selected,free:note});
    assert.equal(r.code,200);assert.ok(r.data.content.endsWith(formattedNote));assert.ok(!r.data.content.includes('改善しました'));
  }
});
test('自由記述だけのときは、否定、数字、改行を維持してモデルへ送信しない',async()=>{
  const free='安心できなかった。\n15分待った。';
  assert.deepEqual(await composeReview([],free,'ja',()=>{throw Error('called')}),{content:free,source:'original'});
});
test('無効なQR、受付停止、過剰な呼出し、別業種の選択、別サイトからの送信は拒否する',async()=>{
  const base={locationId:hoshino,selected:[],free:note};
  assert.equal((await call(base,{qrEnabled:false})).code,403);
  assert.equal((await call(base,{qrToken:'rotated'})).code,403);
  assert.equal((await call(base,{},false)).code,429);
  assert.equal((await call({...base,selected:['料理がおいしい']})).code,400);
  assert.equal((await call(base,{},true,'https://elsewhere.test')).code,403);
});
test('公開入口からCookieなしで生成。管理用の生成は引き続きログイン必須',async()=>{
  const handler=(await import('../api/generate-content.js')).default;
  const original=global.fetch;
  const previous=[process.env.KV_REST_API_URL,process.env.KV_REST_API_TOKEN];
  process.env.KV_REST_API_URL='https://kv.test';process.env.KV_REST_API_TOKEN='fixture';
  global.fetch=async url=>new Response(JSON.stringify({result:String(url).includes('/get/')?null:1}));
  function response(){return {code:200,setHeader(){},status(n){this.code=n;return this;},json(v){this.data=v;return this;}};}
  try{
    const req={method:'POST',headers:{host:'example.test',origin:'https://example.test'},socket:{remoteAddress:'127.0.0.1'},body:{type:'public_review_draft',locationId:hoshino,language:'ja',selected:[],free:note}};
    const guest=response();await handler(req,guest);assert.equal(guest.code,200);assert.equal(guest.data.content,formattedNote);
    const staff=response();await handler({...req,body:{...req.body,type:'post'}},staff);assert.equal(staff.code,401);
  }finally{
    global.fetch=original;
    for(const [i,k] of ['KV_REST_API_URL','KV_REST_API_TOKEN'].entries())if(previous[i]===undefined)delete process.env[k];else process.env[k]=previous[i];
  }
});

test('モデルの候補選択と代替文を別々に記録する',async()=>{
  const args=[['料理がおいしい'],'注文から20分待った。','ja'];
  const ai=await composeReview(...args,async()=>'[1]','food');
  assert.equal(ai.source,'ai');
  assert.equal(ai.content,'料理が美味しかったです。\n注文から20分待った。');
  const invalid=await composeReview(...args,async()=>'[8]','food');
  assert.equal(invalid.source,'template');
});
test('美名家の選択項目と手書きの清潔さを分けて、未入力の品名や地名を添えない',async()=>{
 const selected=['料理がおいしい','雰囲気が良い','提供が早い','コスパが良い','おすすめしたい'];
 const draft=await composeReview(selected,'店が綺麗だった','ja',async()=>'{"choices":[0]}','food');
 assert.equal(draft.source,'ai');
 assert.equal(draft.content,'注文した料理はすぐに出てきて、美味しくいただきました。\nお店の雰囲気が気に入りました。\n値段にも満足でき、人にも勧めたいと思いました。\n店が綺麗だった');
 const negative='店が綺麗だったとは思わない。18分待った。';
 const fallback=await composeReview(selected,negative,'ja',async()=>'架空の体験','food');
 assert.ok(fallback.content.endsWith('店が綺麗だったとは思わない。\n18分待った。'));
 assert.ok(!fallback.content.includes('店内は綺麗で'));
});
test('全業種の日本語選択肢で生成した文の表記と「です」の回数を検査する',async()=>{
 for(const [group,labels] of Object.entries(choices)){
  for(const selected of [...labels.ja.map(key=>[key]),labels.ja]){
   for(const choose of [async()=>'{"choices":[0]}',async()=>'形式エラー']){
    const {content}=await composeReview(selected,'','ja',choose,group);
    assert.doesNotMatch(content,/きれい|おいし[いくか]|人にもすすめたい/u);
    assert.ok((content.match(/です。/gu)||[]).length<=1,content);
   }
  }
 }
});

test('自由記述・既存の改行・引用の句点・末尾の句点を保持する',async()=>{
 const input='「綺麗でした。」次の店では18分待った。\n味は良かった。';
 const expect='「綺麗でした。」\n次の店では18分待った。\n味は良かった。';
 const {content}=await composeReview([],input,'ja',()=>{throw Error()},'food');
 assert.equal(content,expect);
});

test('自由入力と重なる選択肢だけを外し、待ち時間や否定をそのまま残す',async()=>{
 for(const free of ['説明は分かりやすかった。予約時間から18分待った。','説明は分かりにくかった。予約時間から18分待った。']){
 const r=await composeReview(['説明が分かりやすかった','予約時間から待った'],free,'ja',()=>{throw Error()},'clinic');
 assert.equal(r.source,'original');assert.equal(r.content,free.replace('。予約','。\n予約'));
 }
});

test('美名家で料理の待ち時間と接客を自分で書いた場合、早い提供や二重の接客を追加しない',async()=>{
 const free='スタッフの方が丁寧でした。料理は18分待った。';
 for(const choose of [async()=>'{"choices":[0]}',async()=>'{"choices":[1]}',async()=>{throw Error()}]){
  const r=await composeReview(['スタッフが丁寧','提供が早い','料理がおいしい'],free,'ja',choose,'food');
  assert.ok(r.content.includes('美味し'));assert.doesNotMatch(r.content,/早|すぐ/);
  assert.equal(r.content.match(/丁寧/gu).length,1);assert.ok(r.content.endsWith('料理は18分待った。'));
 }
 const other=await composeReview(['提供が早い'],'会計で18分待った。','ja',async()=>'[0]','food');
 assert.match(other.content,/注文した料理はすぐ/);
});
test('美名家の接客・雰囲気・再訪・推薦は二文で述べ、未入力の料理は足さない',async()=>{
 for(const pick of [0,1]){
 const {content}=await composeReview(['雰囲気が良い','また来たい','おすすめしたい','スタッフが丁寧'],'','ja',async()=>JSON.stringify({choices:[pick]}),'food');
 assert.equal(content.split('。').length,3);assert.match(content,/丁寧/);assert.match(content,/雰囲気/);assert.match(content,/勧めたい/);assert.match(content,/また来/);
 assert.doesNotMatch(content,/料理|と思いまた|です。\n.*です。/u);
 }
});

test('施術・予約・設備の自由入力を、同じ話題の選択項目で上書きしない',async()=>{
 const cases=[
  ['relax','力加減がちょうど良い','私には少し強かったです。'],
  ['relax','予約が取りやすい','予約が取りづらかったです。'],
  ['gym','設備が清潔','設備に汚れがありました。'],
  ['food','雰囲気が良い','お店の雰囲気が好きでした。']
 ];
 for(const [group,label,free] of cases){
  const r=await composeReview([label],free,'ja',()=>{throw Error('選択文を足さない')},group);
  assert.equal(r.content,free);assert.equal(r.source,'original');
 }
 for(const [group,label,free] of [
  ['relax','力加減がちょうど良い','香りは少し強かったです。'],
  ['relax','予約が取りやすい','予約時間から15分待った。'],
  ['gym','設備が清潔','服に汚れがありました。'],
  ['food','提供が早い','料理は美味しかった。会計で待った。']
 ]){
  const r=await composeReview([label],free,'ja',async()=>'[0]',group);
  assert.equal(r.source,'ai');assert.ok(r.content.endsWith(free.replace('。会計','。\n会計')));
 }
});
test('提供や力加減の反対の項目は勝手に決めず、場面が書かれた場合は自由入力を使う',async()=>{
 const scenarios=[
  ['food',['提供が早い','料理が出るまで待った'],'前菜はすぐに届きました。次の料理は15分待ちました。'],
  ['relax',['力加減がちょうど良い','力加減が合わなかった'],'肩の力加減はちょうど良く、背中は強すぎました。']
 ];
 for(const [group,selected,free] of scenarios){
  const locationId=Object.keys(storeGroups).find(id=>storeGroups[id]===group);
  const conflict=await call({locationId,language:'ja',selected,free:''});
  assert.equal(conflict.code,422);assert.deepEqual(conflict.data.pair,selected);
  const ok=await call({locationId,language:'ja',selected,free});
  assert.equal(ok.code,200);assert.equal(ok.data.content.replaceAll('\n',''),free);
 }
});

test('全店舗で同じ項目を3回選び直しても違う文を返し、自由入力の感謝は重ねない',async()=>{
 for(const [locationId,group] of Object.entries(storeGroups)){
  const recentVariants=[],drafts=new Set();
  for(let i=0;i<3;i++){
   const {data}=await call({locationId,selected:[choices[group].ja[0],'また来たい','感謝を伝えたい'],recentVariants});
   assert.match(data.content,/また|次も|次に|もう一度|次の機会/);assert.match(data.content,/ありがと|感謝/);
   assert.ok(!drafts.has(data.content));drafts.add(data.content);recentVariants.push(data.variant);
  }
  const only=await call({locationId,selected:[choices[group].ja[0]]});
  assert.doesNotMatch(only.data.content,/ありがと|感謝|また/);
  const own=await call({locationId,selected:['感謝を伝えたい','また来たい'],free:'ありがとうございました。また行きたいです。'});
  assert.equal(own.data.content,'ありがとうございました。\nまた行きたいです。');
 }
});

test('英中韓の任意項目も選んだときだけ入り、再訪を断る原文は優先する',async()=>{
 for(const group of Object.keys(choices))for(const lang of ['en','zh','ko']){
  const labels=choices[group][lang], thank=labels[choices[group].ja.indexOf('感謝を伝えたい')];
  const history=[],sentences=new Set();
  for(let i=0;i<3;i++){
   const draft=await composeReview([thank],'',lang,async()=>'[0]',group,history);
   history.push(draft.variant);sentences.add(draft.content);
  }
  assert.equal(sentences.size,3);
  for(const label of labels){
   const result=await composeReview([label],'',lang,async()=>'[0]',group,[]);
   assert.ok(result.content);assert.doesNotMatch(result.content,/undefined/);
  }
 }
 const result=await composeReview(['また来たい'],'もう行きたくありません。','ja',async()=>'[0]','food',[]);
 assert.equal(result.content,'もう行きたくありません。');
});

test('同業種で同じ3項目を選んだ17店舗に、感謝の結びを除いても異なる本文を割り当てる',async()=>{
 const seen=new Map();
 for(const group of Object.values(storeGroups)){
  if(!seen.has(group))seen.set(group,new Set());
  const used=seen.get(group),recent=[];
  const select=[choices[group].ja[0],'また来たい','感謝を伝えたい'];
  for(let i=0;i<3;i++){
    const result=await composeReview(select,'','ja',async()=>'[0]',group,recent,async forms=>{
      const n=forms.findIndex(x=>!used.has(x.body));
      assert.notEqual(n,-1);
      used.add(forms[n].body);return n;
    });
    assert.ok(result.sharedHistory);
    assert.doesNotMatch(result.content,/感謝しています/);
    assert.match(result.content,/ありがとう/);
    recent.push(result.variant);
  }
 }
});

test('店舗を越えて冒頭の句を重ねず、同じ体験から3種類の流れで書き出す',async()=>{
 const {returnPassages}=await import('../lib/review-passages.js');
 const usedByGroup=new Map();
 for(const group of Object.values(storeGroups)){
  if(!usedByGroup.has(group))usedByGroup.set(group,new Set());
  const used=usedByGroup.get(group),recent=[],seenFlows=new Set(),fact=choices[group].ja[0];
  for(let i=0;i<3;i++){
   const r=await composeReview([fact,'また来たい','感謝を伝えたい'],'','ja',async()=>'[0]',group,recent,async options=>{
     const index=options.findIndex(c=>!used.has(c.opening));
     assert.notEqual(index,-1);
     used.add(options[index].opening);
     seenFlows.add(returnPassages(fact).findIndex(forms=>forms.includes(options[index].body)));
     return index;
   });
   assert.ok(r.sharedHistory);recent.push(r.variant);
  }
  assert.deepEqual([...seenFlows].sort(),[0,1,2]);
 }
});
