import test from 'node:test';
import assert from 'node:assert/strict';
import {formatBubble} from '../api/_review_line.js';
test('過去口コミは確認済みの日本語要旨を使い、翻訳先に原文を送らない',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=()=>{throw new Error('外部通信禁止');};
 try{
  const b=await formatBubble({localHistory:true,id:'1234567890',store:'店舗',star:4,review:'The coffee was good.',summary:'コーヒーがおいしかった。',reply:'ご来店ありがとうございます。'});
  assert.ok(b.body.contents.some(x=>x.text==='コーヒーがおいしかった。'));
  assert.ok(b.footer.contents.some(x=>x.action?.label==='口コミ原文を見る'));
 }finally{globalThis.fetch=old;}
});
