import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationAction} from '../lib/review-confirmation-runtime.js';
import {confirmationRevision} from '../lib/review-confirmation.js';
import {deliverConfirmations,sendLineConfirmation} from '../lib/review-confirmation-delivery.js';
import {signEmailAccess,verifyEmailAccess} from '../lib/review-confirmation-mail.js';
const group='C'+'a'.repeat(32),other='C'+'b'.repeat(32);
const config={version:1,enabled:true,routes:[{storeId:'123',channel:'line',to:group,verified:true,source:'照合済み',verifiedAt:'2026-11-17T00:00:00Z'},{storeId:'456',channel:'line',to:other,verified:true,source:'照合済み',verifiedAt:'2026-11-17T00:00:00Z'}]};
function fixture(){
 const p={id:'abc1234567',sid:'locations_123',store:'試験店',status:'pending',review:'丁寧でした。',reply:'ご来店いただきありがとうございます。\n\nこの度は誠にありがとうございました。\n-試験店-',reviewId:'fake-review',locationName:'locations/123',reviewUpdateTime:'2026-11-17'};
 const map=new Map([['rv_pending_'+p.id,p],['rv_queue',[p.id]]]);let calls=0;
 const deps={get:async k=>map.get(k)??null,set:async(k,v)=>map.set(k,v),cas:async(k,old,next)=>{if(JSON.stringify(map.get(k)??null)!==JSON.stringify(old))return false;map.set(k,next);return true;},config,central:{group:'C'+'c'.repeat(32)},excluded:p=>p?.sid==='locations_999',bubble:async p=>({type:'bubble',reply:p.reply}),publish:async()=>{calls++;return {status:'sent',text:'検証済み'};}};
 const input={action:'decision',sourceType:'group',groupId:group,userId:'user',id:p.id,revision:confirmationRevision(p)};
 return {p,map,deps,input,calls:()=>calls};
}
test('別店舗から原文の閲覧・修正・承認をできない',async()=>{
 const f=fixture();
 for(const decision of ['ok','edit','later','ng'])await confirmationAction({...f.input,groupId:other,decision},f.deps);
 const read=await confirmationAction({...f.input,groupId:other,action:'text',text:'原文 '+f.p.id},f.deps);
 assert.doesNotMatch(JSON.stringify(read),/丁寧でした/);assert.equal(f.calls(),0);assert.equal(f.map.get('rv_pending_'+f.p.id).status,'pending');
});
test('承認の同時押しでも公開処理は一度だけ',async()=>{
 const f=fixture();await Promise.all(Array.from({length:8},()=>confirmationAction({...f.input,decision:'ok'},f.deps)));
 assert.equal(f.calls(),1);assert.equal(f.map.get('rv_pending_'+f.p.id).status,'sent');
});
test('修正は未公開で新しい案になり旧カードの承認は拒否する',async()=>{
 const f=fixture();await confirmationAction({...f.input,decision:'edit'},f.deps);
 await confirmationAction({...f.input,action:'text',text:'ご来店いただきありがとうございます。\n\n修正した返信です。'},f.deps);
 await confirmationAction({...f.input,decision:'ok'},f.deps);
 const p=f.map.get('rv_pending_'+f.p.id);assert.equal(p.status,'pending');assert.match(p.reply,/修正した返信/);assert.equal(f.calls(),0);
});
test('同じ担当者が別グループへ送った文では修正しない',async()=>{
 const f=fixture();await confirmationAction({...f.input,decision:'edit'},f.deps);
 const result=await confirmationAction({...f.input,groupId:other,action:'text',text:'別の店舗の話です。'},f.deps);
 assert.equal(result.ignore,true);assert.equal(f.map.get('rv_pending_'+f.p.id).reply,f.p.reply);
});
test('保留は原文を残し、一覧と再承認の対象になる',async()=>{
 const f=fixture();await confirmationAction({...f.input,decision:'later'},f.deps);
 assert.equal(f.map.get('rv_pending_'+f.p.id).status,'held');assert.equal(f.calls(),0);
 const list=await confirmationAction({...f.input,action:'text',text:'一覧'},f.deps);assert.match(list.text,/保留/);
 await confirmationAction({...f.input,decision:'ok'},f.deps);assert.equal(f.calls(),1);
});
test('架空カードは承認してもGoogle処理へ一切渡さない',async()=>{
 const f=fixture();const p={...f.p,controlTest:true,demoStoreId:'123'};delete p.locationName;delete p.reviewId;
 f.map.set('rv_pending_'+p.id,p);
 const result=await confirmationAction({...f.input,revision:confirmationRevision(p),decision:'ok'},f.deps);
 assert.equal(f.calls(),0);assert.equal(f.map.get('rv_pending_'+p.id).status,'demo_approved');assert.match(result.text,/Googleには送信していません/);
});
test('公開通信の結果不明を成功扱いせず再実行もしない',async()=>{
 const f=fixture();let calls=0;f.deps.publish=async()=>{calls++;throw new Error('timeout');};
 await confirmationAction({...f.input,decision:'ok'},f.deps);await confirmationAction({...f.input,decision:'ok'},f.deps);
 assert.equal(calls,1);assert.equal(f.map.get('rv_pending_'+f.p.id).status,'needs_check');
});
test('通知を店舗別に送り、受付済みの同じ版を再送しない',async()=>{
 const f=fixture(),sent=[];const deps={...f.deps,line:async(p,key)=>{sent.push([p.to,key]);return {accepted:true};}};
 const a=await deliverConfirmations([f.p],config,deps);const b=await deliverConfirmations([f.p],config,deps);
 assert.equal(a.sent,1);assert.equal(b.sent,0);assert.equal(sent.length,1);assert.equal(sent[0][0],group);assert.deepEqual(b.deliveredReviewIds,[f.p.reviewId]);
});
test('無料枠が足りない場合はLINEへ送信しない',async()=>{
 const calls=[];
 const request=async(url,options)=>{calls.push([url,options]);return {ok:true,json:async()=>url.endsWith('/quota')?{type:'limited',value:200}:url.endsWith('/consumption')?{totalUsage:199}:{count:4}};};
 const result=await sendLineConfirmation({to:group,record:{},store:'試験'},'key',{token:'test',bubble:async()=>({}),request});
 assert.equal(result.accepted,false);assert.equal(result.notSent,true);assert.ok(calls.every(([u])=>!u.endsWith('/push')));
});
test('メール確認リンクは改変・期限切れを拒否する',()=>{
 const f=fixture(),route={storeId:'123',channel:'email',to:'test@example.com',verified:true};
 const token=signEmailAccess(f.p,route,'test-secret',1000);
 assert.equal(verifyEmailAccess(token,'test-secret',1001).id,f.p.id);
 assert.equal(verifyEmailAccess(token+'x','test-secret',1001),null);
 assert.equal(verifyEmailAccess(token,'test-secret',8*86400000),null);
 assert.equal(verifyEmailAccess(token,'different',1001),null);
});

test('公開前の表現確認で止めた返信案は修正して再確認できる',async()=>{
 const f=fixture();f.map.set('rv_pending_'+f.p.id,{...f.p,status:'blocked'});
 const result=await confirmationAction({...f.input,decision:'edit'},f.deps);
 assert.match(result.text,/返信の文を直します/);
 await confirmationAction({...f.input,action:'text',text:'ご来店いただきありがとうございます。\n\n修正版です。'},f.deps);
 assert.equal(f.map.get('rv_pending_'+f.p.id).status,'pending');assert.equal(f.calls(),0);
});


test('ライト契約の明示設定がある場合だけ契約枠内で送る',async()=>{
 for(const [includedLimit,usage,expected] of [[undefined,200,false],[5000,200,true],[5000,4997,false],[5000,-1,false],[5000,1.5,false],[30000,200,false]]){
  let pushes=0;
  const request=async(url,options)=>{
   if(url.endsWith('/push')){pushes++;return {ok:true,status:200,headers:new Headers()};}
   return {ok:true,json:async()=>url.endsWith('/quota')?{type:'limited',value:5000}:url.endsWith('/consumption')?{totalUsage:usage}:{count:4}};
  };
  const result=await sendLineConfirmation({to:group,record:{},store:'試験'},'key',{token:'test',bubble:async()=>({}),request,...(includedLimit===undefined?{}:{includedLimit})});
  assert.equal(result.accepted,expected);assert.equal(pushes,expected?1:0);
 }
});

test('ライト設定だけを先に入れても無料契約のままなら送らない',async()=>{
 let pushes=0;
 const request=async(url)=>{
  if(url.endsWith('/push'))pushes++;
  return {ok:true,json:async()=>url.endsWith('/quota')?{type:'limited',value:200}:url.endsWith('/consumption')?{totalUsage:0}:{count:4}};
 };
 const result=await sendLineConfirmation({to:group,record:{},store:'試験'},'key',{token:'test',bubble:async()=>({}),request,includedLimit:5000});
 assert.equal(result.notSent,true);assert.equal(pushes,0);
});
