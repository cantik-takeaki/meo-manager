import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { Fault, fail, text, id, now, makeTenant, mutate, view, scope, activePlan, question, roles, appendAudit, contractEnd } from './workspace.js';
import { parseCookies } from '../api/_session.js';
import { sameOrigin, sameSecret } from '../api/_auth.js';
const staffCookies=['pw_session','team_user','access_token','refresh_token','user_email','user_name','user_picture'];
const clearStaff=c=>staffCookies.filter(k=>Object.hasOwn(c,k)).map(k=>k+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0');
const scrypt=promisify(crypto.scrypt);
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
function grantAccess(d,t,u,actor){
 const token=crypto.randomBytes(32).toString('hex');
 d.grants=(d.grants||[]).filter(x=>x.expires>Date.now()&&x.email!==u.email);
 d.grants.push({hash:digest(token),email:u.email,tenant:t.id,expires:Date.now()+86400000,passwordVersion:u.passwordVersion});
 appendAudit(t,{at:now(),actor:actor.email,command:'access-link',email:u.email,version:t.version});
 return {accessToken:token,expiresAt:new Date(Date.now()+86400000).toISOString()};
}
const mail=s=>{const v=text(s,254).toLowerCase();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))fail('メールアドレスを確認してください');return v;};
async function password(pass,salt){if(typeof pass!=='string'||pass.length<12||pass.length>200)fail('パスワードは12〜200文字で入力してください');return (await scrypt(pass,salt,64)).toString('hex');}
export function createHandler({repo,staffResolver,legacyLoader=async()=>[],clientResolver=async()=>null,clientLogout=async()=>{},legacyInspect=null,generate=async()=>null,google=null}){return async function handler(req,res){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({error:'未対応の操作です'});
  if(!sameOrigin(req))fail('同じサイトから操作してください',403);
  const action=req.query.action||'state',b=req.body||{};
  if(JSON.stringify(b).length>60000)fail('入力が長すぎます',413);
  const d=await repo.read();const cookies=parseCookies(req);
  if(action==='access-accept'&&req.method==='POST'){
   await repo.limit(digest('access:'+String(b.email||'')),digest(String(req.headers['x-forwarded-for']||'unknown')));
   const grant=(d.grants||[]).find(x=>x.hash===digest(String(b.token||''))&&x.expires>Date.now());
   const u=grant&&d.users.find(x=>x.email===grant.email&&x.active!==false&&x.passwordVersion===grant.passwordVersion);
   const tenant=grant&&d.tenants.find(x=>x.id===grant.tenant);
   if(!u||!tenant||!tenant.members.some(x=>x.email===u.email&&x.active!==false)||mail(b.email)!==u.email)fail('リンクが無効か期限切れです。管理者に再発行を依頼してください',400);
   activePlan(tenant);
   const salt=crypto.randomBytes(16).toString('hex');u.hash=await password(b.password,salt);u.salt=salt;u.passwordVersion++;
   d.grants=d.grants.filter(x=>x.email!==u.email);d.sessions=d.sessions.filter(x=>x.email!==u.email);
   tenant.version++;appendAudit(tenant,{at:now(),actor:u.email,command:'access-accept',version:tenant.version});
   await repo.save(d,d.version);res.setHeader('Set-Cookie',[...clearStaff(cookies),'workspace_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0','client_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']);return res.json({ok:true,relogin:true});
  }
  if(action==='login'&&req.method==='POST'){
   const email=mail(b.email);await repo.limit(digest(email),digest(String(req.headers['x-forwarded-for']||'unknown')));
   const u=d.users.find(x=>x.email===email&&x.active!==false);
   const hash=await password(b.password,u?.salt||'invalid-account-timing');
   if(!u?.hash||!sameSecret(hash,u.hash))fail('メールアドレスまたはパスワードが違います',401);
   const token=crypto.randomBytes(32).toString('hex');d.sessions=d.sessions.filter(x=>x.expires>Date.now()&&x.email!==email);d.sessions.push({hash:digest(token),email,expires:Date.now()+43200000,passwordVersion:u.passwordVersion});await repo.save(d,d.version);
   const sessionCookie=`workspace_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=43200`,clear=clearStaff(cookies);
   res.setHeader('Set-Cookie',clear.length?[sessionCookie,...clear]:sessionCookie);return res.json({ok:true});
  }
  if(action==='logout'&&req.method==='POST'){
   await clientLogout(req);
   for(let attempt=0;attempt<3;attempt++){
    const current=attempt?await repo.read():d;
    current.sessions=current.sessions.filter(x=>x.hash!==digest(cookies.workspace_session||''));
    try {await repo.save(current,current.version);break;}catch(e){if(e.status!==409||attempt===2)throw e;}
   }
   res.setHeader('Set-Cookie',[...clearStaff(cookies),'workspace_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0','client_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0']);return res.json({ok:true});
  }
  const staff=(cookies.workspace_session||cookies.client_session)?null:await staffResolver(req);let actor;
  if(staff&&['super_admin','admin'].includes(staff.role))actor={email:staff.email,operator:true,primary:staff.role==='super_admin'};
  else{
   const session=d.sessions.find(x=>x.hash===digest(cookies.workspace_session||'')&&x.expires>Date.now());
   const u=session&&d.users.find(x=>x.email===session.email&&x.active!==false&&x.passwordVersion===session.passwordVersion);
   const legacy=!u?await clientResolver(req):null;
   if(!u&&!legacy)fail('ログインが必要です',401);actor=u?{email:u.email,name:u.name,operator:false}:{email:'legacy:'+legacy.storeId,legacyStoreId:legacy.storeId,operator:false};
  }
  if(action==='google-callback'&&req.method==='GET'){
   const pending=(d.oauth||[]).find(x=>x.hash===digest(String(req.query.state||''))&&x.expires>Date.now()&&x.actor===actor.email&&x.browser===digest(cookies.workspace_oauth||''));
   if(!pending)fail('Google連携の確認が期限切れです。設定画面からやり直してください',400);
   const tenant=d.tenants.find(x=>x.id===pending.tenant);const member=scope(tenant,actor);activePlan(tenant);
   if(!['owner','admin'].includes(member.role))fail('管理者権限が必要です',403);
   d.oauth=d.oauth.filter(x=>x!==pending);await repo.save(d,d.version);
   if(req.query.error)fail('Google連携がキャンセルされました',400);
   if(!google||!req.query.code)fail('Google連携を開始し直してください',400);
   const encrypted=await google.exchange(req.query.code,pending.verifier,tenant.id);
   const fresh=await repo.read(),current=fresh.tenants.find(x=>x.id===tenant.id);activePlan(current);const still=scope(current,actor);
   if(!['owner','admin'].includes(still.role))fail('管理者権限が必要です',403);
   current.googleConnection={encrypted,connectedAt:now(),connectedBy:actor.email};current.version++;
   appendAudit(current,{at:now(),actor:actor.email,command:'google-connect',version:current.version});await repo.save(fresh,fresh.version);
   res.setHeader('Set-Cookie','workspace_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');res.setHeader('Location','/operations.html');return res.status(303).end();
  }
  if(action==='state'&&req.method==='GET'){
   const available=d.tenants.filter(t=>actor.operator||(actor.legacyStoreId&&t.internal===true&&t.stores.some(s=>s.legacyClientId===actor.legacyStoreId))||t.members.some(x=>x.email===actor.email&&x.active!==false));
   const requested=req.query.tenant;const t=requested?available.find(x=>x.id===requested):available[0];
   if(requested&&!t)fail('アクセスできません',403);
   return res.json({actor,tenants:available.map(t=>({id:t.id,name:t.name})),workspace:t?view(t,actor):null});
  }
  if(action==='password-change'&&req.method==='POST'){
   if(actor.operator||actor.legacyStoreId)fail('既存アカウントは運営担当へ変更を依頼してください');
   const u=d.users.find(x=>x.email===actor.email);const old=await password(b.currentPassword,u.salt);
   if(!sameSecret(old,u.hash))fail('現在のパスワードが違います',401);
   const salt=crypto.randomBytes(16).toString('hex');u.hash=await password(b.newPassword,salt);u.salt=salt;u.passwordVersion++;
   d.sessions=d.sessions.filter(x=>x.email!==actor.email);await repo.save(d,d.version);
   res.setHeader('Set-Cookie','workspace_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');return res.json({ok:true,relogin:true});
  }
  if(action==='import-managed'&&req.method==='POST'){
   if(!actor.primary)fail('運営責任者のみ取り込めます',403);
   let t=d.tenants.find(x=>x.internal===true);
   if(!t){t=makeTenant({name:'cantik 管理店舗',owner:{email:actor.email,name:'運営責任者'},kind:'agency',storeLimit:500,endsAt:'2099-12-31'});t.internal=true;d.tenants.push(t);}
   const list=await legacyLoader();let added=0;
   for(const x of list){if(!x.locId||!x.title||x.active===false||x.archived||x.isDemo)continue;
    let store=t.stores.find(s=>s.legacyLocationId===x.locId);
    if(!store){store={id:id(),name:x.title,address:typeof x.address==='string'?x.address:'',legacyLocationId:x.locId,locationName:x.locationName||'',createdAt:now()};t.stores.push(store);added++;}
    if(x.legacyClientId)store.legacyClientId=x.legacyClientId;
   }

   t.version++;appendAudit(t,{at:now(),actor:actor.email,command:'import-managed',added,version:t.version});await repo.save(d,d.version);return res.json({tenantId:t.id,added});
  }
  if(action==='tenant-create'&&req.method==='POST'){
   if(!actor.primary)fail('運営責任者のみ登録できます',403);
   const email=mail(b.email);if(d.users.some(x=>x.email===email))fail('このメールアドレスは登録済みです',409);
   const salt=crypto.randomBytes(16).toString('hex');const hash=b.invite===true?null:await password(b.password,salt);const owner={email,name:text(b.ownerName,100)};
   const t=makeTenant({...b,owner});
   const requested=b.googleLocations??[];
   if(!Array.isArray(requested)||requested.length>t.contract.storeLimit||requested.some(x=>typeof x!=='string'||!/^locations\/[0-9]+$/.test(x)))fail('契約対象のGoogle店舗IDを確認してください');
   t.googleLocations=[...new Set(requested)];d.tenants.push(t);const u={...owner,salt,hash,passwordVersion:1,active:true};d.users.push(u);const access=b.invite===true?grantAccess(d,t,u,actor):{};await repo.save(d,d.version);return res.json({tenantId:t.id,...access});
  }
  const t=d.tenants.find(x=>x.id===b.tenant);if(!t)fail('アクセスできません',403);const m=scope(t,actor);
  if(action==='google-start'&&req.method==='POST'){
   activePlan(t);if(!['owner','admin'].includes(m.role))fail('管理者権限が必要です',403);
   if(!google)fail('Google連携の設定が必要です',503);
   const nonce='workspace_'+crypto.randomBytes(32).toString('hex'),browser=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(48).toString('base64url');
   const url=google.start(nonce,verifier);
   d.oauth=(d.oauth||[]).filter(x=>x.expires>Date.now()&&x.actor!==actor.email);d.oauth.push({hash:digest(nonce),browser:digest(browser),actor:actor.email,tenant:t.id,verifier,expires:Date.now()+600000});
   await repo.save(d,d.version);res.setHeader('Set-Cookie',`workspace_oauth=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);return res.json({authorizationUrl:url});
  }
  if(action==='google-inspect'&&req.method==='POST'){
   activePlan(t);const member=scope(t,actor,b.storeId,true);
   if(!['owner','admin','editor'].includes(member.role))fail('運用担当者の操作が必要です',403);
   if(b.version!==t.version)fail('再読み込みしてください',409);
   const store=t.stores.find(x=>x.id===b.storeId);
   const internal=t.internal===true&&actor.operator&&legacyInspect;
   if(!store||(!internal&&(!t.googleConnection||!google?.inspect)))fail('先にGoogleの店舗情報を取得してください',400);
   const result=internal?await legacyInspect(store):await google.inspect(t.googleConnection.encrypted,t.id,store);
   const fresh=await repo.read(),current=fresh.tenants.find(x=>x.id===t.id);activePlan(current);const freshMember=scope(current,actor,b.storeId,true);if(!['owner','admin','editor'].includes(freshMember.role))fail('運用担当者の操作が必要です',403);
   if(current.version!==b.version)fail('取得中に更新されました。再読み込みしてください',409);
   current.stores.find(x=>x.id===b.storeId).googleDiagnostic={...result,observedAt:now()};
   current.version++;appendAudit(current,{at:now(),actor:actor.email,command:'google-inspect',storeId:b.storeId,version:current.version});
   await repo.save(fresh,fresh.version);return res.json({workspace:view(current,actor)});
  }
  if(action==='google-import'&&req.method==='POST'){
   activePlan(t);if(!['owner','admin'].includes(m.role))fail('管理者権限が必要です',403);
   if(!t.googleConnection||!google)fail('先にGoogleへ連携してください',400);
   if(b.version!==t.version)fail('再読み込みしてください',409);
   const allowed=new Set(t.googleLocations??t.stores.map(x=>x.locationName).filter(Boolean));
   if(!allowed.size)fail('この契約にはGoogle店舗IDが登録されていません。運営担当にお問い合わせください',403);
   const locations=(await google.locations(t.googleConnection.encrypted,t.id)).filter(x=>allowed.has(x.name));
   if(!locations.length)fail('契約対象の店舗が連携したGoogleアカウントに見つかりません',403);
   const known=new Set(t.stores.map(x=>x.locationName));
   const additions=locations.filter(x=>!known.has(x.name));
   if(t.stores.length+additions.length>t.contract.storeLimit)fail('Google店舗数が契約上限を超えています。上限の変更を運営担当へ依頼してください',403);
   for(const loc of locations){let store=t.stores.find(x=>x.locationName===loc.name);if(!store){store={id:id(),name:loc.title,address:loc.storefrontAddress?.addressLines?.join(' ')||'',locationName:loc.name,createdAt:now()};t.stores.push(store);}store.googleSnapshot={...loc,observedAt:now()};}
   t.version++;appendAudit(t,{at:now(),actor:actor.email,command:'google-import',added:additions.length,version:t.version});await repo.save(d,d.version);return res.json({workspace:view(t,actor)});
  }
  if(action==='access-link'&&req.method==='POST'){
   activePlan(t);if(b.version!==t.version)fail('再読み込みしてください',409);
   const email=mail(b.email),target=t.members.find(x=>x.email===email&&x.active!==false);
   if(!target||(!actor.primary&&(m.role!=='owner'||target.role==='owner')))fail('契約責任者または運営責任者の操作が必要です',403);
   if(!text(b.evidence,1000))fail('本人確認の記録が必要です');
   const u=d.users.find(x=>x.email===email&&x.active!==false);if(!u)fail('利用者が見つかりません',404);
   if(d.tenants.some(x=>x.id!==t.id&&x.members.some(v=>v.email===email&&v.active!==false))&&!actor.primary)fail('複数契約の利用者は運営責任者へ依頼してください',403);
   t.version++;const access=grantAccess(d,t,u,actor);
   appendAudit(t,{at:now(),actor:actor.email,command:'access-identity-check',email,evidence:text(b.evidence,1000),version:t.version});
   await repo.save(d,d.version);return res.json({workspace:view(t,actor),...access});
  }
  if(action==='member-add'&&req.method==='POST'){
   activePlan(t);if(!['owner','admin'].includes(m.role))fail('管理者権限が必要です',403);
   if(b.version!==t.version)fail('再読み込みしてください',409);
   const email=mail(b.email);if(d.users.some(x=>x.email===email))fail('登録済みのメールアドレスです。運営担当へお問い合わせください',409);
   if(!roles.includes(b.role)||b.role==='owner'||!Array.isArray(b.storeIds)||b.storeIds.some(x=>!t.stores.some(s=>s.id===x)))fail('店舗と役割を確認してください');
   const salt=crypto.randomBytes(16).toString('hex');const hash=b.invite===true?null:await password(b.password,salt);
   const u={email,name:text(b.name,100),salt,hash,passwordVersion:1,active:true};d.users.push(u);t.members.push({email,name:b.name,role:b.role,storeIds:b.storeIds,active:true});t.version++;appendAudit(t,{at:now(),actor:actor.email,command:'member-add',email,version:t.version});const access=b.invite===true?grantAccess(d,t,u,actor):{};await repo.save(d,d.version);return res.json({workspace:view(t,actor),...access});
  }
  if(action==='contract-update'&&req.method==='POST'){
   if(!actor.primary)fail('運営責任者のみ変更できます',403);
   if(b.version!==t.version)fail('再読み込みしてください',409);
   if(!['active','suspended'].includes(b.status)||!Number.isInteger(b.storeLimit)||b.storeLimit<t.stores.length||b.storeLimit>500||!Number.isFinite(Date.parse(b.endsAt)))fail('契約条件を確認してください');
   t.contract={...t.contract,status:b.status,storeLimit:b.storeLimit,endsAt:contractEnd(b.endsAt)};t.version++;appendAudit(t,{at:now(),actor:actor.email,command:'contract-update',version:t.version});await repo.save(d,d.version);return res.json({workspace:view(t,actor)});
  }
  if(action==='content-publish'&&req.method==='POST'){
   activePlan(t);const member=scope(t,actor,b.storeId,true);if(!['owner','admin','editor'].includes(member.role))fail('運用担当者の操作が必要です',403);
   if(b.version!==t.version)fail('再読み込みしてください',409);
   const content=t.contents.find(x=>x.id===b.id&&x.storeId===b.storeId),store=t.stores.find(x=>x.id===b.storeId);
   if(!content||content.status!=='承認済み'||content.publication)fail('承認済みで未送信の原稿だけ公開できます',409);
   if(b.confirm!==true||b.approvedAt!==content.approval?.at)fail('表示されている承認原稿の公開確認が必要です',400);
   if(content.factVersions.some(v=>!t.issues.some(x=>x.id===v.id&&x.revision===v.revision&&['承認済み','審査待ち','公開確認済み'].includes(x.status))))fail('根拠が変わっています。原稿を作り直してください',409);
   if(content.photoUrl&&[...(t.photos||[])].reverse().find(x=>x.storeId===b.storeId&&x.url===content.photoUrl)?.status!=='使用候補')fail('写真を再確認してください',409);
   if(!google?.publish||!t.googleConnection)fail('Google連携が必要です',400);
   const operation=id();content.publication={operation,status:'送信結果の照合待ち',startedAt:now(),by:actor.email};t.version++;
   appendAudit(t,{at:now(),actor:actor.email,command:'content-publish-start',storeId:b.storeId,targetId:content.id,version:t.version});await repo.save(d,d.version);
   // 外部APIがタイムアウトした場合も自動再送しない。受理された可能性があるため。
   let receipt;try{receipt=await google.publish(t.googleConnection.encrypted,t.id,store,content);}catch{fail('送信結果を確定できません。重複を防ぐため再送せず、Google側の投稿を確認してください',502);}
   const fresh=await repo.read(),tenant=fresh.tenants.find(x=>x.id===t.id),saved=tenant?.contents.find(x=>x.id===content.id);
   if(saved?.publication?.operation!==operation)fail('Googleの受付後に保存状態が変わりました。運営担当へお問い合わせください',409);
   saved.publication={...saved.publication,status:'Google受付済み',receipt,acceptedAt:now()};tenant.version++;
   appendAudit(tenant,{at:now(),actor:actor.email,command:'content-publish-receipt',storeId:b.storeId,targetId:content.id,version:tenant.version});await repo.save(fresh,fresh.version);return res.json({workspace:view(tenant,actor)});
  }
  if(action==='content-generate'&&req.method==='POST'){
   activePlan(t);const member=scope(t,actor,b.storeId,true);if(member.role==='store')fail('運用担当者の操作が必要です',403);
   if(b.version!==t.version)fail('再読み込みしてください',409);
   const facts=t.issues.filter(x=>x.storeId===b.storeId&&Array.isArray(b.factIds)&&b.factIds.includes(x.id)&&['承認済み','審査待ち','公開確認済み'].includes(x.status));
   if(!facts.length||facts.length!==b.factIds.length)fail('承認済みの根拠を選択してください');
   const month=now().slice(0,7);if(t.generationUsage?.month!==month)t.generationUsage={month,count:0};
   const limit=t.contract.generationLimit||100;if(t.generationUsage.count>=limit)fail('今月の生成上限に達しました',429);
   t.generationUsage.count++;t.version++;await repo.save(d,d.version);
   const body=await generate({store:t.stores.find(x=>x.id===b.storeId).name,facts:facts.map(x=>({field:x.field,value:x.canonical})),purpose:text(b.purpose,300)});
   if(!body)fail('文章生成に接続できませんでした。手入力で原稿を登録できます',503);
   const allowedNumbers=JSON.stringify(facts.map(x=>x.canonical)).normalize('NFKC').match(/\d+(?:[.,]\d+)*/g)||[];
   if((body.normalize('NFKC').match(/\d+(?:[.,]\d+)*/g)||[]).some(n=>!allowedNumbers.includes(n)))fail('根拠にない数値が含まれたため、生成案を採用しませんでした',422);
   return res.json({body,needsReview:true,version:t.version});
  }
  if(action==='export'&&req.method==='POST')return res.json({exportedAt:now(),workspace:view(t,actor)});
  if(action==='question'&&req.method==='POST'){
   scope(t,actor,b.storeId);const issue=t.issues.find(x=>x.id===b.id&&x.storeId===b.storeId);if(!issue)fail('確認事項が見つかりません',404);return res.json({text:question(issue,t.stores.find(x=>x.id===b.storeId))});
  }
  if(req.method!=='POST')fail('未対応の操作です',405);
  const changed=mutate(t,actor,action,b);d.tenants[d.tenants.indexOf(t)]=changed;await repo.save(d,d.version);return res.json({workspace:view(changed,actor)});
 }catch(e){return res.status(e instanceof Fault?e.status:503).json({error:e instanceof Fault?e.message:'処理できませんでした。保存状況を再確認してください'});}
};}
