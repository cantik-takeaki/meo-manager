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
