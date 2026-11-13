import test from 'node:test';
import assert from 'node:assert/strict';
import {propose,parseProposal,validateReply} from '../lib/review-routing.js';
const rv=(starRating,comment)=>({starRating,comment,reviewId:'example'});
const text='温かいうちに楽しんでいただけてうれしいです。';
function positive(){return JSON.stringify({intent:'positive',reply:text});}
for(const [rating,review] of [['THREE','おいしかった'],['FIVE','店員さんの対応が残念でした'],['FOUR','The staff was rude']]){
 test('確認待ち '+rating+' '+review, async()=>{const p=await propose(rv(rating,review),[],async()=>positive());assert.equal(p.approved,false);});
}
test('好意的な高評価は生成・二次検査の両方を通す',async()=>{
 let calls=0;assert.equal((await propose(rv('FIVE','温かくておいしかった'),[],async()=>calls++?'PASS':positive())).approved,true);assert.equal(calls,2);
});
test('苦情・皮肉の可能性を二次検査が指摘すれば保留',async()=>{
 let calls=0;assert.equal((await propose(rv('FIVE','Perfect, another hour in line.'),[],async()=>calls++?'CHECK':positive())).approved,false);
});
test('壊れた生成結果・判定欠落・既出文は送らない',async()=>{
 assert.equal(parseProposal('{"reply":"返事だけ"}').reply,'');
 assert.equal((await propose(rv('FIVE','good'),[],async()=>null)).approved,false);
 assert.equal(validateReply(rv('FIVE','温かかった'),text,[text]),false);
});
test('星だけの高評価は事実を補わず、低評価は確認待ち',async()=>{
 const high=await propose(rv('FOUR',''),[],()=>{throw Error('unexpected')});assert.equal(high.approved,true);
 assert.equal((await propose(rv('TWO',''),[],async()=>positive())).approved,false);
});
test('英語の口コミに日本語の返信を自動送信しない',async()=>{
 assert.equal(validateReply(rv('FIVE','Lovely coffee.'),'コーヒーを楽しんでいただけてうれしいです。',[]),false);
});
test('自動翻訳付き口コミは原語で照合し、硬い定型句を一度書き直す',async()=>{
 const values=[JSON.stringify({intent:'positive',reply:'喜んでいただけて何よりです。'}),positive(),'PASS'];
 const result=await propose(rv('FIVE','温かくてよかった。\n(Translated by Google)\nIt was warm.'),[],async()=>values.shift());assert.equal(result.approved,true);
});
test('春夏冬の星5で要望だけの案を落とし、良かった点と要望を扱った案は確認待ちにする',async()=>{
 const review=rv('FIVE','玉子はふわふわで美味い。スープはもう少し熱いと嬉しい。');
 const first='スープの温度について、貴重なご意見をありがとうございます。今後の参考にさせていただきます。';
 const second='玉子炒めのふわふわした食感を喜んでいただけて嬉しいです。スープの温度についてもご感想をありがとうございます。';
 const responses=[JSON.stringify({intent:'check',reply:first}),JSON.stringify({intent:'check',reply:second}),'PASS'];
 const p=await propose(review,[],async()=>responses.shift());
 assert.equal(p.reply,second);assert.equal(p.approved,false);assert.equal(responses.length,0);
});
test('言い換えた要望だけの返信も再検査に落ちたらLINE下書きに残さない',async()=>{
 const draft=JSON.stringify({intent:'check',reply:'スープの温度のご感想をありがとうございます。'});
 const responses=[draft,'CHECK',draft,'CHECK'];
 const p=await propose(rv('FIVE','玉子が美味しい。スープはもう少し熱いと嬉しい。'),[],async()=>responses.shift());
 assert.equal(p.reply,'');assert.equal(p.approved,false);
});
