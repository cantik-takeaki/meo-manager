import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {makeTenant,mutate,view,compare,Fault,publicUrl,contractEnd} from '../lib/workspace.js';
import {createHandler} from '../lib/workspace-service.js';
const actor={email:'owner@example.test'};
const expiry=()=>new Date(Date.now()+86400000).toISOString();
function fixture(){let t=makeTenant({name:'検証用代理店',owner:{...actor,name:'責任者'},kind:'agency',storeLimit:2,endsAt:expiry()});t=mutate(t,actor,'store-add',{version:t.version,name:'検証用店舗A'});t=mutate(t,actor,'store-add',{version:t.version,name:'検証用店舗B'});return t;}
function issue(t){return mutate(t,actor,'issue-add',{version:t.version,storeId:t.stores[0].id,field:'住所',left:{media:'Google',value:'南台5-21-17セレス南台203号',url:'https://example.com/a',observedAt:new Date().toISOString(),evidence:'公開表示を確認'},right:{media:'公式',value:'南台5-21-17 セレス南台203号',url:'https://example.com/b',observedAt:new Date().toISOString(),evidence:'会社概要を確認'}});}
function transition(t,command,extra={}){return mutate(t,actor,command,{version:t.version,storeId:t.stores[0].id,id:t.issues[0].id,evidence:'検証用の確認記録',...extra});}
test('空白と全角のみを表記差として扱い、階数・濁点を落とさない',()=>{assert.equal(compare('南台５−２１','南台5-21'),'表記差');assert.equal(compare('バーク201','パーク201'),'内容差');assert.equal(compare('1階','2階'),'内容差');assert.equal(compare(null,'住所'),'未取得');});
test('認証情報・内部ネットワークを含む出典を拒否',()=>{for(const u of ['javascript:alert(1)','http://127.0.0.1/a','https://example.com/?token=x','https://u:p@example.com'])assert.throws(()=>publicUrl(u));});
test('別組織の利用者は取得できない',()=>{assert.throws(()=>view(fixture(),{email:'outsider@example.test'}),e=>e.status===403);});
test('担当店舗だけを返す',()=>{const t=issue(fixture());t.members.push({email:'staff@example.test',role:'store',storeIds:[t.stores[1].id]});const v=view(t,{email:'staff@example.test'});assert.equal(v.stores.length,1);assert.equal(v.issues.length,0);assert.equal(v.members.length,0);});
test('担当外店舗へ回答できない',()=>{const t=issue(fixture());t.members.push({email:'staff@example.test',role:'store',storeIds:[t.stores[1].id]});assert.throws(()=>mutate(t,{email:'staff@example.test'},'issue-answer',{version:t.version,storeId:t.stores[0].id,id:t.issues[0].id,value:'値',evidence:'記録',respondent:'店舗'}),e=>e.status===403);});
test('古い版の更新を拒否',()=>{const t=fixture();assert.throws(()=>mutate(t,actor,'store-add',{version:1,name:'店舗'}),e=>e.status===409);});
test('契約上限をサーバー側で拒否',()=>{const t=fixture();assert.throws(()=>mutate(t,actor,'store-add',{version:t.version,name:'店舗C'}),e=>e.status===403);});
test('利用停止中は書き込めない',()=>{const t=fixture();t.contract.status='suspended';assert.throws(()=>issue(t),e=>e.status===403);});
test('閲覧者は書き込めない',()=>{const t=fixture();t.members.push({email:'viewer@example.test',role:'viewer',storeIds:[t.stores[0].id]});assert.throws(()=>mutate(t,{email:'viewer@example.test'},'issue-add',{version:t.version,storeId:t.stores[0].id}),e=>e.status===403);});
test('承認なしで申請へ進めない',()=>{const t=issue(fixture());assert.throws(()=>transition(t,'issue-submit',{receipt:'受付'}),e=>e.status===409);});
test('質問・回答・承認・申請・公開確認を完走し、公開不一致を拒否',()=>{let t=issue(fixture());t=transition(t,'issue-question',{question:'正式住所を教えてください'});t=transition(t,'issue-answer',{value:'正式住所203号',respondent:'店舗責任者'});const revision=t.issues[0].revision;assert.throws(()=>transition(t,'issue-approve',{revision:revision-1}));t=transition(t,'issue-approve',{revision});t=transition(t,'issue-submit',{receipt:'受付番号1'});assert.throws(()=>transition(t,'issue-verify',{value:'正式住所201号',evidenceUrl:'https://example.com/public'}));t=transition(t,'issue-verify',{value:'正式住所203号',evidenceUrl:'https://example.com/public',observedAt:new Date(Date.now()+1000).toISOString()});assert.equal(t.issues[0].status,'公開確認済み');});
test('公開確認には申請後の日時が必要',()=>{let t=issue(fixture());t=transition(t,'issue-answer',{value:'住所',respondent:'店舗'});t=transition(t,'issue-approve',{revision:t.issues[0].revision});t=transition(t,'issue-submit',{receipt:'受付'});assert.throws(()=>transition(t,'issue-verify',{value:'住所',evidenceUrl:'https://example.com/public',observedAt:'2026-01-01'}));});
test('根拠を差し戻した原稿は承認できない',()=>{let t=issue(fixture());t=transition(t,'issue-answer',{value:'住所',respondent:'店舗'});t=transition(t,'issue-approve',{revision:t.issues[0].revision});t=mutate(t,actor,'content-add',{version:t.version,storeId:t.stores[0].id,body:'入口の看板をご覧ください。',cta:'https://example.com/book',factIds:[t.issues[0].id]});t=transition(t,'issue-reopen');assert.throws(()=>mutate(t,actor,'content-approve',{version:t.version,storeId:t.stores[0].id,id:t.contents[0].id,evidence:'原稿確認'}));});
test('同期間指標の二重登録を拒否し未取得を保持',()=>{let t=fixture();const b={storeId:t.stores[0].id,metric:'予約完了',start:'2026-01-01',end:'2026-01-31',value:null,source:'https://example.com/report',observedAt:'2026-02-01',note:'予約サービス未接続'};t=mutate(t,actor,'metric-add',{...b,version:t.version});assert.equal(t.metrics[0].value,null);assert.throws(()=>mutate(t,actor,'metric-add',{...b,version:t.version}),e=>e.status===409);});
function harness(extra={}){let data={version:0,tenants:[],users:[],sessions:[]};const repo={read:async()=>structuredClone(data),save:async(d,v)=>{if(v!==data.version)throw new Fault(409,'競合');data={...structuredClone(d),version:v+1};},limit:async()=>{}};const handler=createHandler({...extra,repo,staffResolver:async req=>req.headers.testoperator?{email:'operator@example.test',role:'super_admin'}:null});return {get data(){return data;},async call(action,body={},headers={},method='POST',tenant,query={}){const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.statusCode=n;return this;},end(){return this;},json(x){this.body=x;return this;}};await handler({method,query:{action,tenant,...query},body,headers:{host:'localhost:4177',...headers}},res);return res;}};}
test('HTTP経由の契約作成・顧客ログイン・セッション検証',async()=>{const h=harness(),pass=crypto.randomBytes(18).toString('hex');const c=await h.call('tenant-create',{name:'代理店',ownerName:'責任者',email:actor.email,password:pass,kind:'agency',storeLimit:2,endsAt:expiry()},{testoperator:'yes'});assert.equal(c.statusCode,200);assert.notEqual(h.data.users[0].hash,pass);const l=await h.call('login',{email:actor.email,password:pass});assert.equal(l.statusCode,200);const cookie=l.headers['Set-Cookie'].split(';')[0];const read=await h.call('state',{}, {cookie},'GET');assert.equal(read.body.workspace.name,'代理店');assert.equal(JSON.stringify(read.body).includes('hash'),false);const forged=await h.call('state',{}, {cookie:'workspace_session=forged;pw_session=forged'},'GET');assert.equal(forged.statusCode,401);await h.call('logout',{}, {cookie});assert.equal((await h.call('state',{}, {cookie},'GET')).statusCode,401);});
test('別組織のIDを指定しても取得・書込できない',async()=>{const h=harness(),pass=crypto.randomBytes(18).toString('hex');const ids=[];for(let n=0;n<2;n++){const c=await h.call('tenant-create',{name:'組織'+n,ownerName:'責任者',email:`user${n}@example.test`,password:pass,storeLimit:1,endsAt:expiry()},{testoperator:'yes'});ids.push(c.body.tenantId);}const l=await h.call('login',{email:'user0@example.test',password:pass});const cookie=l.headers['Set-Cookie'].split(';')[0];assert.equal((await h.call('state',{}, {cookie},'GET',ids[1])).statusCode,403);assert.equal((await h.call('store-add',{tenant:ids[1],version:1,name:'越境'}, {cookie})).statusCode,403);});
test('別サイトからの書込を拒否',async()=>{const h=harness();const r=await h.call('tenant-create',{}, {testoperator:'yes',origin:'https://attacker.example'});assert.equal(r.statusCode,403);});

test('契約終了日は日本時間の当日末まで有効',()=>{assert.equal(contractEnd('2026-12-31'),'2026-12-31T14:59:59.999Z');});
test('空欄や文字列を実績ゼロに変換しない',()=>{const t=fixture();for(const value of ['',false,'0',undefined])assert.throws(()=>mutate(t,actor,'metric-add',{version:t.version,storeId:t.stores[0].id,metric:'予約',start:'2026-01-01',end:'2026-01-02',value,source:'https://example.com/report',observedAt:'2026-02-01',note:'検証'}));});
test('パスワード変更は旧セッションを失効し新しい認証だけを許可',async()=>{const h=harness(),pass=crypto.randomBytes(18).toString('hex'),next=crypto.randomBytes(18).toString('hex');await h.call('tenant-create',{name:'店舗契約',ownerName:'責任者',email:actor.email,password:pass,storeLimit:1,endsAt:expiry()},{testoperator:'yes'});const l=await h.call('login',{email:actor.email,password:pass}),cookie=l.headers['Set-Cookie'].split(';')[0];assert.equal((await h.call('password-change',{currentPassword:pass,newPassword:next},{cookie})).statusCode,200);assert.equal((await h.call('state',{}, {cookie},'GET')).statusCode,401);assert.equal((await h.call('login',{email:actor.email,password:pass})).statusCode,401);assert.equal((await h.call('login',{email:actor.email,password:next})).statusCode,200);});
test('利用停止の直後から既存セッションによる店舗取得を拒否',async()=>{const h=harness(),pass=crypto.randomBytes(18).toString('hex');const c=await h.call('tenant-create',{name:'代理店',ownerName:'責任者',email:actor.email,password:pass,storeLimit:1,endsAt:expiry()},{testoperator:'yes'}),tenant=c.body.tenantId;let t=h.data.tenants[0];let r=await h.call('store-add',{tenant,version:t.version,name:'対象店舗'},{testoperator:'yes'});t=r.body.workspace;r=await h.call('member-add',{tenant,version:t.version,email:'member@example.test',name:'店舗担当',password:pass,role:'store',storeIds:[t.stores[0].id]},{testoperator:'yes'});t=r.body.workspace;const l=await h.call('login',{email:'member@example.test',password:pass}),cookie=l.headers['Set-Cookie'].split(';')[0];assert.equal((await h.call('state',{}, {cookie},'GET',tenant)).statusCode,200);await h.call('member-update',{tenant,version:t.version,email:'member@example.test',role:'store',storeIds:[t.stores[0].id],active:false},{testoperator:'yes'});assert.equal((await h.call('state',{}, {cookie},'GET',tenant)).statusCode,403);});

test('写真は問題点に応じた撮り直し案を残し担当外へ開示しない',()=>{let t=fixture();t=mutate(t,actor,'photo-review',{version:t.version,storeId:t.stores[0].id,url:'https://example.com/product.jpg',subject:'実際の商品',purpose:'料理の量が伝わる写真',observedAt:new Date().toISOString(),evidence:'掲載許可は未確認、暗い写真',matchesReality:true,permission:false,clear:false,current:true,noPrivateInfo:true});assert.equal(t.photos[0].status,'要対応');assert.equal(t.photos[0].suggestions.length,2);t.members.push({email:'viewer@example.test',role:'viewer',storeIds:[t.stores[1].id]});assert.equal(view(t,{email:'viewer@example.test'}).photos.length,0);});
test('確認していない写真は原稿に登録できない',()=>{let t=issue(fixture());t=transition(t,'issue-answer',{value:'住所',respondent:'店舗'});t=transition(t,'issue-approve',{revision:t.issues[0].revision});assert.throws(()=>mutate(t,actor,'content-add',{version:t.version,storeId:t.stores[0].id,body:'店内をご案内します。',cta:'https://example.com/book',factIds:[t.issues[0].id],photoUrl:'https://example.com/unreviewed.jpg',photoPermission:'未確認'}));});

test('招待は本人メール・期限・一度限りを検証し秘密を保存しない',async()=>{
 const h=harness(),pass=crypto.randomBytes(18).toString('hex');
 const r=await h.call('tenant-create',{name:'招待契約',ownerName:'責任者',email:actor.email,invite:true,storeLimit:1,endsAt:expiry()},{testoperator:'yes'});
 assert.equal(r.statusCode,200);assert.ok(r.body.accessToken);assert.equal(JSON.stringify(h.data).includes(r.body.accessToken),false);
 assert.equal((await h.call('login',{email:actor.email,password:pass})).statusCode,401);
 assert.equal((await h.call('access-accept',{email:'wrong@example.test',token:r.body.accessToken,password:pass})).statusCode,400);
 assert.equal((await h.call('access-accept',{email:actor.email,token:r.body.accessToken,password:pass})).statusCode,200);
 assert.equal((await h.call('access-accept',{email:actor.email,token:r.body.accessToken,password:pass})).statusCode,400);
 assert.equal((await h.call('login',{email:actor.email,password:pass})).statusCode,200);
});
test('再設定は再発行時に旧リンクを無効化し利用時に旧セッションを失効',async()=>{
 const h=harness(),pass=crypto.randomBytes(18).toString('hex'),next=crypto.randomBytes(18).toString('hex');
 const c=await h.call('tenant-create',{name:'再設定契約',ownerName:'責任者',email:actor.email,password:pass,storeLimit:1,endsAt:expiry()},{testoperator:'yes'});
 const l=await h.call('login',{email:actor.email,password:pass}),cookie=l.headers['Set-Cookie'].split(';')[0];
 const grant=()=>h.call('access-link',{tenant:c.body.tenantId,version:h.data.tenants[0].version,email:actor.email,evidence:'契約窓口と本人を照合'},{testoperator:'yes'});
 const a=await grant(),b=await grant();assert.equal(a.statusCode,200);assert.equal(b.statusCode,200);
 assert.equal((await h.call('access-accept',{email:actor.email,token:a.body.accessToken,password:next})).statusCode,400);
 assert.equal((await h.call('access-accept',{email:actor.email,token:b.body.accessToken,password:next})).statusCode,200);
 assert.equal((await h.call('state',{}, {cookie},'GET')).statusCode,401);
 assert.equal((await h.call('login',{email:actor.email,password:pass})).statusCode,401);
});
test('期限切れ・停止契約・無権限の再設定を拒否',async()=>{
 const h=harness();const c=await h.call('tenant-create',{name:'期限検証',ownerName:'責任者',email:actor.email,invite:true,storeLimit:1,endsAt:expiry()},{testoperator:'yes'});
 const token=c.body.accessToken,pass=crypto.randomBytes(18).toString('hex');
 h.data.grants[0].expires=Date.now()-1;
 assert.equal((await h.call('access-accept',{email:actor.email,token,password:pass})).statusCode,400);
 h.data.grants[0].expires=Date.now()+10000;h.data.tenants[0].contract.status='suspended';
 assert.equal((await h.call('access-accept',{email:actor.email,token,password:pass})).statusCode,403);
 assert.equal((await h.call('access-link',{tenant:c.body.tenantId,email:actor.email,evidence:'未認証'})).statusCode,401);
});

test('Google認証の戻りは開始したブラウザと利用者に限り一度だけ受理',async()=>{
 let exchanged=0;const h=harness({google:{start:state=>'https://accounts.google.com/o/oauth2/v2/auth?state='+state,exchange:async()=>{exchanged++;return {data:'暗号化済み検証値'};}}});
 const c=await h.call('tenant-create',{name:'連携契約',ownerName:'責任者',email:actor.email,invite:true,storeLimit:1,endsAt:expiry()},{testoperator:'yes'});
 const start=await h.call('google-start',{tenant:c.body.tenantId},{testoperator:'yes'});assert.equal(start.statusCode,200);
 const state=new URL(start.body.authorizationUrl).searchParams.get('state'),cookie=start.headers['Set-Cookie'].split(';')[0];
 assert.match(state,/^workspace_[a-f0-9]{64}$/);
 assert.equal((await h.call('google-callback',{}, {testoperator:'yes'},'GET',null,{state,code:'検証'})).statusCode,400);
 assert.equal(exchanged,0);
 const result=await h.call('google-callback',{}, {testoperator:'yes',cookie},'GET',null,{state,code:'検証'});assert.equal(result.statusCode,303);assert.equal(exchanged,1);
 assert.equal((await h.call('google-callback',{}, {testoperator:'yes',cookie},'GET',null,{state,code:'検証'})).statusCode,400);
 const visible=await h.call('state',{}, {testoperator:'yes'},'GET');assert.equal(JSON.stringify(visible.body).includes('暗号化済み検証値'),false);
});
function publicationFixture(h){let t=issue(fixture());t=transition(t,'issue-answer',{value:'正式住所',respondent:'店舗責任者'});t=transition(t,'issue-approve',{revision:t.issues[0].revision});t=mutate(t,actor,'content-add',{version:t.version,storeId:t.stores[0].id,body:'ご来店の際は入口の看板をご確認ください。',cta:'https://example.com/book',factIds:[t.issues[0].id]});t=mutate(t,actor,'content-approve',{version:t.version,storeId:t.stores[0].id,id:t.contents[0].id,evidence:'本文と予約先を確認'});t.googleConnection={encrypted:{test:true}};h.data.tenants.push(t);return t;}
test('Google投稿は承認版の確認を要求し同じ原稿を二重送信しない',async()=>{let sends=0;const h=harness({google:{publish:async()=>{sends++;return {name:'accounts/1/locations/1/localPosts/1',state:'PROCESSING'};}}}),t=publicationFixture(h);const body={tenant:t.id,version:t.version,storeId:t.stores[0].id,id:t.contents[0].id,approvedAt:t.contents[0].approval.at};assert.equal((await h.call('content-publish',body,{testoperator:'yes'})).statusCode,400);assert.equal(sends,0);const sent=await h.call('content-publish',{...body,confirm:true},{testoperator:'yes'});assert.equal(sent.statusCode,200);assert.equal(sent.body.workspace.contents[0].publication.status,'Google受付済み');assert.equal((await h.call('content-publish',{...body,version:h.data.tenants[0].version,confirm:true},{testoperator:'yes'})).statusCode,409);assert.equal(sends,1);});
test('Google投稿がタイムアウトした場合は受理不明として再送を防ぐ',async()=>{let sends=0;const h=harness({google:{publish:async()=>{sends++;throw new Error('検証用の通信切断');}}}),t=publicationFixture(h);const body={tenant:t.id,version:t.version,storeId:t.stores[0].id,id:t.contents[0].id,approvedAt:t.contents[0].approval.at,confirm:true};assert.equal((await h.call('content-publish',body,{testoperator:'yes'})).statusCode,502);assert.equal((await h.call('content-publish',{...body,version:h.data.tenants[0].version},{testoperator:'yes'})).statusCode,409);assert.equal(sends,1);assert.equal(h.data.tenants[0].contents[0].publication.status,'送信結果の照合待ち');});
test('投稿の受付と公開を分け、公開本文・確認時刻の不一致を拒否',async()=>{const h=harness({google:{publish:async()=>({name:'accounts/1/locations/1/localPosts/1'})}}),t=publicationFixture(h),content=t.contents[0];await h.call('content-publish',{tenant:t.id,version:t.version,storeId:content.storeId,id:content.id,approvedAt:content.approval.at,confirm:true},{testoperator:'yes'});const body={tenant:t.id,version:h.data.tenants[0].version,storeId:content.storeId,id:content.id,value:content.body,evidence:'公開ページの本文を確認',evidenceUrl:'https://www.google.com/maps',observedAt:new Date(Date.now()+100).toISOString()};assert.equal((await h.call('content-verify',{...body,value:'別の原稿'},{testoperator:'yes'})).statusCode,409);assert.equal((await h.call('content-verify',{...body,observedAt:'2026-01-01'},{testoperator:'yes'})).statusCode,400);const result=await h.call('content-verify',body,{testoperator:'yes'});assert.equal(result.statusCode,200);assert.equal(result.body.workspace.contents[0].publication.status,'公開確認済み');});

test('既存店舗の認証で見えるのは対応付け済みの自店舗だけ',()=>{
 const t=fixture();t.internal=true;t.stores[0].legacyClientId='client-a';t.stores[1].legacyClientId='client-b';
 const a={email:'legacy:client-a',legacyStoreId:'client-a'};
 assert.equal(view(t,a).stores.length,1);assert.equal(view(t,a).role,'store');
 assert.throws(()=>mutate(t,a,'issue-add',{version:t.version,storeId:t.stores[1].id}),e=>e.status===403);
 t.internal=false;assert.throws(()=>view(t,a),e=>e.status===403);
});
test('既存店舗取り込みは停止・デモを除外し同じ店舗を二重登録しない',async()=>{
 const h=harness({legacyLoader:async()=>[{locId:'1',title:'利用中',legacyClientId:'a'},{locId:'2',title:'停止',active:false},{locId:'3',title:'デモ',isDemo:true}]});
 let r=await h.call('import-managed',{}, {testoperator:'yes'});assert.equal(r.body.added,1);
 r=await h.call('import-managed',{}, {testoperator:'yes'});assert.equal(r.body.added,0);assert.equal(h.data.tenants[0].stores.length,1);assert.equal(h.data.tenants[0].stores[0].legacyClientId,'a');
});

test('同時保存と競合してもログアウトは再読込してセッションを失効する',async()=>{
 const session='test-session';let data={version:0,tenants:[],users:[],sessions:[{hash:crypto.createHash('sha256').update(session).digest('hex')}]},attempts=0;
 const repo={read:async()=>structuredClone(data),save:async(d,v)=>{if(++attempts===1){data.version=1;throw new Fault(409,'競合');}assert.equal(v,1);data=d;},limit:async()=>{}};
 let revoked=0;const handler=createHandler({repo,staffResolver:async()=>null,clientLogout:async()=>{revoked++;}});
 const res={statusCode:200,setHeader(){},status(n){this.statusCode=n;return this;},json(b){this.body=b;return this;}};
 await handler({method:'POST',query:{action:'logout'},headers:{cookie:'workspace_session='+session},body:{}},res);
 assert.equal(res.statusCode,200);assert.equal(data.sessions.length,0);assert.equal(attempts,2);assert.equal(revoked,1);
});
