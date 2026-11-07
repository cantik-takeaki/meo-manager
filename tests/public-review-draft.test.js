import test from 'node:test';
import assert from 'node:assert/strict';
import {publicReview,composeReview} from '../lib/public-review-draft.js';
import {choices,storeGroups} from '../lib/review-catalog.js';
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
    assert.equal(r.code,200);assert.ok(r.data.content.endsWith(note));assert.ok(!r.data.content.includes('改善しました'));
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
    const guest=response();await handler(req,guest);assert.equal(guest.code,200);assert.equal(guest.data.content,note);
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
  assert.equal(ai.content,'料理がおいしい。\n注文から20分待った。');
  const invalid=await composeReview(...args,async()=>'[8]','food');
  assert.equal(invalid.source,'template');
});
test('美名家の5項目と店の清潔さを3文につなぎ、未入力の品名や地名を添えない',async()=>{
 const selected=['料理がおいしい','雰囲気が良い','提供が早い','コスパが良い','おすすめしたい'];
 const draft=await composeReview(selected,'店が綺麗だった','ja',async()=>'{"choices":[0]}','food');
 assert.equal(draft.source,'ai');
 assert.equal(draft.content,'店内はきれいで、雰囲気も良かったです。料理は出てくるのが早くて、おいしかったです。コスパも良く、人にもすすめたいと思います。');
 const negative='店が綺麗だったとは思わない。18分待った。';
 const fallback=await composeReview(selected,negative,'ja',async()=>'架空の体験','food');
 assert.ok(fallback.content.endsWith(negative));
 assert.ok(!fallback.content.includes('店内はきれいで'));
});
