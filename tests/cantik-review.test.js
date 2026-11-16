import test from 'node:test';
import assert from 'node:assert/strict';
import {publicReview,composeReview} from '../lib/public-review-draft.js';
import choices from '../lib/review-business-choices.js';
test('cantikの公開生成は4言語で選択した事実だけを返す',async()=>{
 for(const language of Object.keys(choices)){
  const req={method:'POST',headers:{host:'example.test',origin:'https://example.test'},body:{locationId:'locations_8497304576012289251',language,selected:choices[language].slice(0,2),free:''}};
  const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(x){this.data=x;return this;}};
  await publicReview(req,res,async()=>'架空の実績',async()=>({qrEnabled:true}),async()=>true);
  assert.equal(res.code,200);assert.ok(res.data.content);assert.ok(!res.data.content.includes('架空'));
  for(const label of choices[language])assert.ok((await composeReview([label],'',language,async()=>'{}','business')).content);
 }
});
test('自分で書いた対応の感想を選択肢より優先する',async()=>{
 const r=await composeReview(['対応が丁寧'],'対応が雑でした。','ja',async()=>'{}','business');assert.equal(r.content,'対応が雑でした。');
});
