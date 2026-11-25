import test from 'node:test';
import assert from 'node:assert/strict';
import {confirmationScope,cardInScope,confirmationEditKey,confirmationPlan,confirmationRevision,confirmationEml,validateConfirmationRoutes} from '../lib/review-confirmation.js';
import {prepareConfirmationPreview} from '../lib/review-confirmation-preview.js';
const group='C'+'a'.repeat(32),other='C'+'b'.repeat(32);
const config={version:1,enabled:false,routes:[{storeId:'123',channel:'line',to:group,source:'確認台帳',verified:true,verifiedAt:'2026-11-16T00:00:00Z'},{storeId:'456',channel:'email',to:'store@example.com',source:'店舗返信',verified:true,verifiedAt:'2026-11-16T00:00:00Z'}]};
const record=(id,sid)=>({id,reviewId:'review-'+id,sid:'locations_'+sid,status:'pending',store:'確認用店舗'+sid,name:'投稿者',star:5,review:'丁寧に対応していただきました。',reply:'ご来店いただきありがとうございます。\n\n接客へのお言葉をありがとうございます。\n\nこの度は誠にありがとうございました。\n-確認用店舗-'});
test('店舗ごとの確認先を混ぜず、不明な店は送付不可にする',()=>{
 const plans=confirmationPlan([record('a','123'),record('b','456'),record('c','789')],config);
 assert.equal(plans[0].to,group);assert.equal(plans[1].to,'store@example.com');assert.equal(plans[2].status,'blocked');
 assert.throws(()=>validateConfirmationRoutes({...config,routes:[...config.routes,config.routes[0]]}));
 assert.throws(()=>validateConfirmationRoutes({...config,routes:[{...config.routes[1],to:'a@example.com\r\nBcc: secret@example.com'}]}));
 assert.throws(()=>validateConfirmationRoutes({...config,enabled:true,routes:[{...config.routes[0],verified:false}]}));
});
test('メールに原文と空行付き返信案を保持し、承認は返信メールを開くだけ',()=>{
 const p=record('abcdef1234','456');p.review='<img src=x onerror=alert(1)> 良かったです。';
 const mail=confirmationPlan([p],config)[0].email;
 assert.equal(mail.from,'info@cantik.co.jp');assert.ok(mail.text.includes(p.reply));assert.ok(mail.text.includes(p.review));
 assert.match(mail.html,/&lt;img/);assert.doesNotMatch(mail.html,/<img/);assert.match(mail.html,/mailto:info@cantik.co.jp/);assert.doesNotMatch(mail.html,/https:\/\/.*approve/);
 const eml=confirmationEml(mail);assert.match(eml,/X-Unsent: 1/);assert.match(eml,/To: store@example.com/);assert.equal(mail.googlePublication,false);
 assert.notEqual(confirmationRevision(p),confirmationRevision({...p,reply:p.reply+'変更'}));
});
test('店舗グループの範囲と修正待ちの識別子を分離する',()=>{
 const source={sourceType:'group',groupId:group,userId:'same'},scope=confirmationScope(source,{group:other},{...config,enabled:true});
 assert.equal(cardInScope(record('a','123'),scope),true);assert.equal(cardInScope(record('b','456'),scope),false);assert.equal(cardInScope({...record('a','123'),controlTest:true},scope),false);
 assert.equal(confirmationScope(source,{group:other},config),null);
 assert.notEqual(confirmationEditKey(source),confirmationEditKey({...source,groupId:other}));
});
test('確認内容の作成は読み取りだけで、停止店と架空カードを含めない',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('外部通信は禁止');});
 const records=[record('a','123'),record('b','456'),record('c','12710891692154182344'),{...record('d','123'),controlTest:true},record('e','777')];
 const out=await prepareConfirmationPreview({config,ids:records.map(r=>r.id),readRecord:async id=>records.find(r=>r.id===id),paused:[{lid:'777'}]});
 assert.equal(out.plans.length,2);assert.equal(out.sent,0);assert.equal(out.published,0);assert.match(out.plans[1].email.eml,/X-Unsent/);
});
test('100件を超えた確認待ちも次のページを返す',async()=>{
 const records=Array.from({length:101},(_,i)=>record(String(i),'123'));
 const args={config,ids:records.map(r=>r.id),readRecord:async id=>records[Number(id)]};
 const first=await prepareConfirmationPreview(args),next=await prepareConfirmationPreview({...args,cursor:first.next});
 assert.equal(first.plans.length,100);assert.equal(first.next,100);assert.equal(next.plans.length,1);assert.equal(next.next,null);
});
