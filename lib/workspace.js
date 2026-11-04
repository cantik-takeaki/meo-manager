import crypto from 'node:crypto';
export class Fault extends Error { constructor(status,message){super(message);this.status=status;} }
export const fail=(message,status=400)=>{throw new Fault(status,message);};
export const id=()=>crypto.randomUUID();
export const now=()=>new Date().toISOString();
export function text(value,max=2000){if(typeof value!=='string'||!value.trim()||value.length>max)fail('入力内容を確認してください');return value.trim();}
export function publicUrl(value){
 const s=text(value,2000);let u;try{u=new URL(s);}catch{fail('出典URLを確認してください');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!u.hostname.includes('.')||/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)/i.test(u.hostname)||/^172\.(1[6-9]|2\d|3[01])\./.test(u.hostname))fail('公開ページのURLを入力してください');
 for(const key of u.searchParams.keys())if(/token|password|secret|api.?key|auth/i.test(key))fail('認証情報を含むURLは保存できません');
 return u.href;
}
export function compare(a,b){
 if(a==null||b==null||a===''||b==='')return '未取得';
 if(a===b)return '一致';
 const n=s=>String(s).normalize('NFKC').replace(/[\s\u3000]+/g,'').replace(/[‐‑‒–—−]/g,'-');
 return n(a)===n(b)?'表記差':'内容差';
}
export const roles=['owner','admin','editor','store','viewer'];
export function memberOf(tenant,email){return tenant.members.find(m=>m.email===email&&m.active!==false);}
export function scope(tenant,actor,storeId,write=false){
 const legacy=actor.legacyStoreId&&tenant.internal===true?tenant.stores.filter(s=>s.legacyClientId===actor.legacyStoreId):[];
 const m=actor.operator?{role:'owner',storeIds:['*']}:legacy.length?{role:'store',storeIds:legacy.map(s=>s.id)}:memberOf(tenant,actor.email);
 if(!m)fail('アクセスできません',403);
 if(write && m.role==='viewer')fail('閲覧専用です',403);
 if(storeId && !tenant.stores.some(s=>s.id===storeId))fail('店舗が見つかりません',404);
 if(storeId && !['owner','admin'].includes(m.role) && !(m.storeIds||[]).includes(storeId))fail('この店舗への権限がありません',403);
 return m;
}
export function activePlan(t){if(t.contract.status!=='active'||Date.parse(t.contract.endsAt)<=Date.now())fail('利用契約の有効期限を確認してください',403);}
export function view(t,actor){
 const m=scope(t,actor);const all=['owner','admin'].includes(m.role);const stores=t.stores.filter(s=>all||(m.storeIds||[]).includes(s.id));const ids=new Set(stores.map(s=>s.id));
 return {id:t.id,name:t.name,version:t.version,internal:t.internal===true,role:m.role,contract:t.contract,googleConnection:t.googleConnection?{connectedAt:t.googleConnection.connectedAt}:null,stores,issues:t.issues.filter(x=>ids.has(x.storeId)),photos:(t.photos||[]).filter(x=>ids.has(x.storeId)),contents:t.contents.filter(x=>ids.has(x.storeId)),metrics:t.metrics.filter(x=>ids.has(x.storeId)),members:all?t.members.map(({email,name,role,storeIds,active})=>({email,name,role,storeIds,active})):[],audit:t.audit.filter(x=>all||ids.has(x.storeId))};
}
export function contractEnd(value){
 const input=/^\d{4}-\d{2}-\d{2}$/.test(value)?value+'T23:59:59.999+09:00':value;
 if(!Number.isFinite(Date.parse(input)))fail('契約終了日を確認してください');
 return new Date(input).toISOString();
}
export function appendAudit(t,entry){
 const record={...entry,previous:t.audit.at(-1)?.hash||''};
 record.hash=crypto.createHash('sha256').update(JSON.stringify(record)).digest('hex');t.audit.push(record);
}
export function makeTenant({name,owner,kind='store',storeLimit=1,endsAt}){
 if(!['store','agency'].includes(kind)||!Number.isInteger(storeLimit)||storeLimit<1||storeLimit>500||!(Date.parse(contractEnd(endsAt))>Date.now()))fail('契約条件を確認してください');
 return {id:id(),name:text(name,100),version:1,contract:{kind,storeLimit,status:'active',endsAt:contractEnd(endsAt),billing:'invoice'},members:[{email:owner.email,name:owner.name,role:'owner',storeIds:['*'],active:true}],stores:[],issues:[],photos:[],contents:[],metrics:[],audit:[]};
}
function source(s){return {media:text(s.media,80),value:text(s.value),url:publicUrl(s.url),observedAt:date(s.observedAt),evidence:text(s.evidence,1000)};}
function date(v){if(!Number.isFinite(Date.parse(v))||Date.parse(v)>Date.now()+60000)fail('確認日時を確認してください');return new Date(v).toISOString();}
function evidence(b){return {note:text(b.evidence,2000),at:date(b.observedAt||now()),url:b.evidenceUrl?publicUrl(b.evidenceUrl):null};}
export function mutate(original,actor,command,b){
 const t=structuredClone(original);if(b.version!==t.version)fail('他の担当者が更新しました。再読み込みしてください',409);
 const m=scope(t,actor,b.storeId,true);activePlan(t);
 const admin=['owner','admin'].includes(m.role);let target=null;
 if(command==='store-add'){
  if(!admin)fail('管理者権限が必要です',403);
  if(t.stores.length>=t.contract.storeLimit)fail('契約の店舗数上限です',403);
  target={id:id(),name:text(b.name,100),address:b.address?text(b.address,200):'',website:b.website?publicUrl(b.website):'',createdAt:now()};t.stores.push(target);
 }else if(command==='member-update'){
  if(!admin)fail('管理者権限が必要です',403);
  const u=t.members.find(x=>x.email===b.email);if(!u)fail('利用者が見つかりません',404);
  if(u.role==='owner'||b.role==='owner')fail('契約責任者は変更できません',403);
  if(!roles.includes(b.role)||!Array.isArray(b.storeIds)||b.storeIds.some(x=>!t.stores.some(s=>s.id===x)))fail('権限設定を確認してください');
  Object.assign(u,{role:b.role,storeIds:b.storeIds,active:b.active!==false});target=u;
 }else if(command==='wordpress-import'){
  if(!admin||!b.storeId)fail('管理者が店舗を選択してください',403);
  const report=b.report,store=t.stores.find(x=>x.id===b.storeId);
  if(!report||report.schema!=='rakuraku-meo-wordpress/v1'||!report.profile||typeof report.profile!=='object')fail('ラクラクMEOの書き出しデータを選択してください');
  const siteUrl=publicUrl(report.siteUrl),observedAt=date(report.observedAt);
  if(!store.website||new URL(store.website).origin!==new URL(siteUrl).origin)fail('店舗に登録した公式サイトと書き出し元が一致しません');
  const fields={name:'店舗名',address:'住所',telephone:'電話番号',hours:'営業時間・定休日',reservationUrl:'予約URL'};
  const profile={};for(const key of Object.keys(fields)){const v=report.profile[key];if(typeof v!=='string'||v.length>2000)fail('店舗情報の形式を確認してください');profile[key]=v;}
  const hash=crypto.createHash('sha256').update(JSON.stringify({siteUrl,profile,published:report.published===true})).digest('hex');
  if(store.wordpressSnapshot?.hash===hash)fail('同じ店舗情報は取り込み済みです',409);
  store.wordpressSnapshot={siteUrl,profile,observedAt,importedAt:now(),published:report.published===true,hash};
  const snapshot=store.googleSnapshot;
  const current={name:snapshot?.title,address:snapshot?.storefrontAddress?.addressLines?.join(' '),telephone:snapshot?.phoneNumbers?.primaryPhone,hours:snapshot?.regularHours?JSON.stringify(snapshot.regularHours):null,reservationUrl:null};
  const changes=Object.keys(fields).filter(k=>profile[k]);if(t.issues.length+changes.length>2000)fail('確認事項の保存上限に達しました',413);
  for(const key of changes){
   const at=now();t.issues.push({id:id(),storeId:b.storeId,field:fields[key],
    left:{media:'WordPress登録情報',value:profile[key],url:siteUrl,observedAt,evidence:'管理者による書き出し。公開表示と正式情報の確認は別途必要。'},
    right:{media:'Google取得情報',value:current[key]||'未取得',url:'https://www.google.com/maps',observedAt:snapshot?.observedAt||at,evidence:current[key]?'Google連携で取得した登録値。':'未取得。Googleの実値を取得してから比較してください。'},
    comparison:current[key]?compare(profile[key],current[key]):'未取得',status:'未確認',revision:1,createdAt:at,updatedAt:at});
  }
  target=store;
 }else if(command==='issue-add'){
  if(!b.storeId)fail('店舗を選択してください');
  if(m.role==='store')fail('担当者へ掲載調査を依頼してください',403);
  if(t.issues.length>=2000)fail('確認事項の保存上限に達しました',413);
  const a=source(b.left),c=source(b.right);
  target={id:id(),storeId:b.storeId,field:text(b.field,80),left:a,right:c,comparison:compare(a.value,c.value),status:'未確認',revision:1,createdAt:now(),updatedAt:now()};t.issues.push(target);
 }else if(command.startsWith('issue-')){
  target=t.issues.find(x=>x.id===b.id&&x.storeId===b.storeId);if(!target)fail('確認事項が見つかりません',404);
  const before=structuredClone(target);delete before.history;target.history=[...(target.history||[]),{at:now(),actor:actor.email,action:command,before}];
  const e=evidence(b);const st=target.status;
  if(command==='issue-question'){
   if(st!=='未確認'||m.role==='store')fail('質問の状態を確認してください',409);
   target.question=text(b.question,4000);target.delivery=e;target.status='回答待ち';
  }else if(command==='issue-answer'){
   if(!['未確認','回答待ち','修正案作成済み'].includes(st))fail('差し戻してから回答を変更してください',409);
   target.canonical=text(b.value);target.answer={...e,respondent:text(b.respondent,100)};target.revision++;target.status='修正案作成済み';
  }else if(command==='issue-approve'){
   if(!admin&&m.role!=='store')fail('承認権限がありません',403);
   if(st!=='修正案作成済み'||b.revision!==target.revision)fail('承認対象の版が変わりました',409);
   target.approval={...e,revision:target.revision,by:actor.email};target.status='承認済み';
  }else if(command==='issue-submit'){
   if(m.role==='store'||st!=='承認済み'||target.approval.revision!==target.revision)fail('有効な承認が必要です',409);
   target.submission={...e,revision:target.revision,receipt:text(b.receipt,500),at:now()};target.status='審査待ち';
  }else if(command==='issue-verify'){
   if(m.role==='store'||st!=='審査待ち'||target.canonical!==b.value||!e.url||Date.parse(e.at)<Date.parse(target.submission.at))fail('申請後の公開値・URL・確認日時を確認してください',409);
   target.verification={...e,value:b.value};target.status='公開確認済み';
  }else if(command==='issue-reopen'){
   if(!admin)fail('管理者権限が必要です',403);
   target.status='未確認';delete target.approval;delete target.submission;delete target.verification;target.revision++;
  }else fail('操作が見つかりません',404);
  target.updatedAt=now();
 }else if(command==='photo-review'){
  if(!b.storeId||m.role==='store')fail('運用担当者の確認が必要です',403);
  const checks=['matchesReality','permission','clear','current','noPrivateInfo'];
  if(checks.some(k=>typeof b[k]!=='boolean'))fail('写真の確認項目をすべて回答してください');
  const tips={matchesReality:'現在提供している実物を、量・色・付属品が分かる構図で撮り直してください。',permission:'撮影者・写っている方の掲載許可を確認してください。',clear:'自然光や照明を使い、手ぶれ・ピンぼけ・暗さを解消して撮影してください。',current:'現在の外観・店内・メニューと一致する写真に差し替えてください。',noPrivateInfo:'お客様の顔、伝票、氏名、車の番号などが写らない構図で撮影してください。'};
  target={id:id(),storeId:b.storeId,url:publicUrl(b.url),subject:text(b.subject,200),purpose:text(b.purpose,300),checks:Object.fromEntries(checks.map(k=>[k,b[k]])),evidence:text(b.evidence,2000),reviewer:actor.email,observedAt:date(b.observedAt),status:checks.every(k=>b[k])?'使用候補':'要対応',suggestions:checks.filter(k=>!b[k]).map(k=>tips[k]),createdAt:now()};
  t.photos=t.photos||[];t.photos.push(target);
 }else if(command==='content-add'){
  if(!b.storeId||m.role==='store')fail('投稿担当者の権限が必要です',403);
  const facts=t.issues.filter(x=>x.storeId===b.storeId&&['承認済み','審査待ち','公開確認済み'].includes(x.status));
  if(!Array.isArray(b.factIds)||!b.factIds.length||b.factIds.some(x=>!facts.some(f=>f.id===x)))fail('承認済みの根拠を選択してください');
  if(b.photoUrl&&[...(t.photos||[])].reverse().find(p=>p.storeId===b.storeId&&p.url===publicUrl(b.photoUrl))?.status!=='使用候補')fail('先に写真の確認結果を登録し、問題を解消してください');
  const body=text(b.body,1500);if(/必ず.*(上位|治る)|口コミ.*(割引|特典)|[\p{Extended_Pictographic}]/u.test(body))fail('投稿文の表現を見直してください');
  target={id:id(),storeId:b.storeId,body,cta:publicUrl(b.cta),factIds:b.factIds,factVersions:b.factIds.map(x=>({id:x,revision:facts.find(f=>f.id===x).revision})),photoUrl:b.photoUrl?publicUrl(b.photoUrl):null,photoPermission:b.photoUrl?text(b.photoPermission,500):null,status:'下書き',createdAt:now()};t.contents.push(target);
 }else if(command==='content-approve'){
  if(!admin&&m.role!=='store')fail('承認権限がありません',403);
  target=t.contents.find(x=>x.id===b.id&&x.storeId===b.storeId);if(!target)fail('原稿が見つかりません',404);
  if(target.publication)fail('送信済み原稿は再承認できません',409);
  if(target.photoUrl&&[...(t.photos||[])].reverse().find(p=>p.storeId===b.storeId&&p.url===target.photoUrl)?.status!=='使用候補')fail('写真の確認結果が変わっています。差し替えてください',409);
  if(target.factVersions.some(v=>!t.issues.some(x=>x.id===v.id&&x.revision===v.revision&&['承認済み','審査待ち','公開確認済み'].includes(x.status))))fail('根拠が変わっています。原稿を作り直してください',409);
  target.approval={...evidence(b),by:actor.email};target.status='承認済み';
 }else if(command==='content-verify'){
  if(!admin&&m.role!=='editor')fail('運用担当者の操作が必要です',403);
  target=t.contents.find(x=>x.id===b.id&&x.storeId===b.storeId);
  if(!target||target.publication?.status!=='Google受付済み')fail('Googleの受付記録を確認してください',409);
  if(b.value!==target.body)fail('公開文が承認原稿と一致しません',409);
  const checked=evidence(b);if(!checked.url||Date.parse(checked.at)<Date.parse(target.publication.acceptedAt))fail('受付以降の公開URLと確認日時が必要です');
  target.publication={...target.publication,status:'公開確認済み',verification:{...checked,by:actor.email}};
 }else if(command==='metric-add'){
  if(!b.storeId||m.role==='store')fail('計測担当者の権限が必要です',403);
  const metric=text(b.metric,80),start=date(b.start),end=date(b.end);if(end<start)fail('期間を確認してください');
  if(b.value!==null&&(typeof b.value!=='number'||!Number.isFinite(b.value)))fail('数値または未取得を指定してください');
  const value=b.value;if(value!==null&&(!Number.isFinite(value)||value<0))fail('数値を確認してください');
  if(t.metrics.some(x=>x.storeId===b.storeId&&x.metric===metric&&x.start===start&&x.end===end))fail('同じ指標と期間は登録済みです',409);
  target={id:id(),storeId:b.storeId,metric,start,end,value,source:publicUrl(b.source),observedAt:date(b.observedAt),note:text(b.note,1000),createdAt:now()};t.metrics.push(target);
 }else fail('操作が見つかりません',404);
 t.version++;appendAudit(t,{at:now(),actor:actor.email,command,storeId:b.storeId||target?.id||null,targetId:target?.id||null,version:t.version});return t;
}
export function question(issue,store){return `${store.name}様\nお世話になります。\n掲載情報の「${issue.field}」について確認をお願いいたします。\n\n${issue.left.media}：${issue.left.value}\n${issue.left.url}\n確認日時：${issue.left.observedAt}\n\n${issue.right.media}：${issue.right.value}\n${issue.right.url}\n確認日時：${issue.right.observedAt}\n\n現在の正式な内容を教えていただけますでしょうか。利用条件や期間が異なる場合は、その条件もお知らせください。\nご回答をもとに修正案を作成します。`;}
