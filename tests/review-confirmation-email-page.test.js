import test from 'node:test';
import assert from 'node:assert/strict';
import {emailConfirmationPage} from '../lib/review-confirmation-email-page.js';
import {signEmailAccess} from '../lib/review-confirmation-mail.js';
const route={channel:'email',verified:true,storeId:'123',to:'test@example.invalid'};
function setup(){
 let p={id:'123456789a',controlTest:true,demoStoreId:'123',store:'試験用',star:5,name:'試験',review:'丁寧でした。',reply:'ご来店ありがとうございます。',status:'pending'},published=0;
 const config={enabled:true,routes:[route]},secret='fixture';
 const deps={config,get:async k=>k==='review_approve_secret'?secret:p,set:async()=>{},cas:async(k,old,next)=>{assert.deepEqual(old,p);p=next;return true},excluded:()=>false,bubble:async()=>({}),publish:async()=>{published++;throw Error('Googleは禁止')}};
 const call=async(method,body,access=signEmailAccess(p,route,secret),origin='https://meo.cantik.co.jp')=>{let status=200,html='';await emailConfirmationPage({method,query:{access},body,headers:{origin}},{setHeader(){},status(v){status=v;return this},send(v){html=v;return this},end(){}},deps);return {status,html}};
 return {call,deps,get:()=>p,published:()=>published,secret};
}
test('メールのリンクを開くだけでは承認せず原文と返信案が読める',async()=>{const s=setup(),r=await s.call('GET');assert.equal(r.status,200);assert.match(r.html,/丁寧でした。/);assert.match(r.html,/ご来店ありがとうございます。/);assert.equal(s.get().status,'pending');assert.equal(s.published(),0)});
test('メールのデモ承認と保留はGoogleに送らない',async()=>{for(const decision of ['ok','later']){const s=setup(),r=await s.call('POST',{confirm:'yes',decision,reply:s.get().reply});assert.equal(r.status,200);assert.equal(s.get().status,decision==='ok'?'demo_approved':'held');assert.equal(s.published(),0)}});
test('メールの本文修正は保存後に新しい確認が必要',async()=>{const s=setup(),old=signEmailAccess(s.get(),route,s.secret);const r=await s.call('POST',{confirm:'yes',decision:'ok',reply:'別の文です。'});assert.equal(r.status,409);assert.equal(s.get().status,'pending');const saved=await s.call('POST',{confirm:'yes',decision:'save',reply:'別の文です。'});assert.match(saved.html,/修正後の返信案を確認/);assert.equal(s.get().reply,'別の文です。');assert.equal((await s.call('GET',null,old)).status,403);assert.equal(s.published(),0)});
test('メールの別店舗・別サイトからの操作を拒否',async()=>{const s=setup();const wrong=signEmailAccess({...s.get(),demoStoreId:'456'},route,s.secret);assert.equal((await s.call('GET',null,wrong)).status,403);assert.equal((await s.call('POST',{confirm:'yes',decision:'ok'},undefined,'https://example.invalid')).status,403);assert.equal(s.get().status,'pending')});
