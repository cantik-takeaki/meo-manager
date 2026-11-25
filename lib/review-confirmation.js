import crypto from 'node:crypto';

export const CONFIRMATION_ROUTES_KEY='review_confirmation_routes';
export const CONFIRMATION_OUTBOX_PREFIX='review_confirmation_email_';
export const confirmationStoreId=p=>String(p?.sid||p?.locationName||p?.storeId||'').match(/(?:^|[_/])(\d+)$/)?.[1]||'';
export const confirmationRevision=p=>crypto.createHash('sha256').update(JSON.stringify([p.id,p.sid,p.locationName,p.demoStoreId,p.store,p.star,p.name,p.reviewId,p.reviewUpdateTime,p.review,p.reply])).digest('hex').slice(0,16);
const email=/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export function validateConfirmationRoutes(config){
 if(config?.version!==1||typeof config.enabled!=='boolean'||!Array.isArray(config.routes)||config.routes.length>300)throw new Error('店舗別の確認先の形式を確認してください。');
 const ids=new Set();
 for(const r of config.routes){
  if(!/^\d+$/.test(r.storeId)||ids.has(r.storeId)||!['line','email'].includes(r.channel)||typeof r.verified!=='boolean'||typeof r.source!=='string'||!r.source.trim())throw new Error('店舗ごとに確認先と出典を1つずつ登録してください。');
  ids.add(r.storeId);
  if(r.channel==='line'?!/^C[0-9a-f]{30,32}$/.test(r.to):!email.test(r.to))throw new Error('グループの識別番号またはメールアドレスを確認してください。');
  if(config.enabled&&(!r.verified||!Number.isFinite(Date.parse(r.verifiedAt))))throw new Error('未確認の宛先があるため送信を有効にできません。');
 }
 return config;
}
export function confirmationScope(source,central,config){
 const group=source.sourceType==='group'&&source.groupId;
 if(group&&group===central?.group||source.sourceType==='user'&&source.userId&&central?.to?.includes(source.userId))return {kind:'staff',storeIds:null};
 if(!group||!config?.enabled)return null;
 const ids=config.routes.filter(r=>r.channel==='line'&&r.to===group&&r.verified&&Number.isFinite(Date.parse(r.verifiedAt))).map(r=>r.storeId);
 return ids.length?{kind:'store',storeIds:ids}:null;
}
export function cardInScope(p,scope){
 return !!p&&!!scope&&(scope.kind==='staff'||scope.storeIds.includes(p.controlTest&&!p.reviewId&&!p.locationName?p.demoStoreId:!p.controlTest?confirmationStoreId(p):''));
}
export function confirmationEditKey(source){
 return 'rv_edit_state_scoped_'+crypto.createHash('sha256').update(JSON.stringify([source.sourceType,source.groupId||'',source.userId||''])).digest('hex');
}
const escape=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function confirmationEmail(record,route){
 const revision=confirmationRevision(record),reference=`${record.id}/${revision}`;
 const subject=`【口コミ返信の確認】${record.store}／番号 ${record.id}`;
 const introduction='お世話になっております。\nGoogleの口コミと返信案をご確認ください。\nGoogleにはまだ返信しておりません。';
 const original=String(record.review||'（本文なし・星のみ）');
 const text=[introduction,`店舗：${record.store}\n投稿者：${record.name||'不明'}\n評価：${record.star}\n確認番号：${reference}`,'【口コミ原文】\n'+original,...(record.summary?['【保存済みの日本語要旨】\n'+record.summary]:[]),'【返信案】\n'+record.reply,
  'この文面でよければ「返信してよい」とご返信ください。\n修正をご希望の場合は変更したい箇所か修正版の全文をお送りください。\n確認番号を残してご返信をお願いいたします。\n内容の照合後に対応します。','株式会社cantik\ninfo@cantik.co.jp'].join('\n\n');
 const replyLink=decision=>'mailto:info@cantik.co.jp?'+new URLSearchParams({subject:`Re: ${subject}`,body:`確認番号：${reference}\n${decision}\n\n`}).toString();
 const html='<div lang="ja" style="font-family:sans-serif;line-height:1.8;color:#173d70"><p style="white-space:pre-wrap">'+escape(text)+'</p><p><a href="'+escape(replyLink('返信してよい'))+'">この文面で返信してよい</a></p><p><a href="'+escape(replyLink('修正希望：'))+'">修正内容を伝える</a></p><p>ボタンはメールの返信画面を開きます。押しただけでGoogleには公開されません。</p></div>';
 return {from:'info@cantik.co.jp',to:route.to,subject,text,html,reference,revision,storeId:route.storeId,reviewId:record.reviewId,confirmationId:record.id,status:'draft',googlePublication:false};
}
export function confirmationPlan(records,config,excluded=()=>false){
 validateConfirmationRoutes(config);
 return records.filter(p=>p.status==='pending'&&!p.controlTest&&!excluded(p)).map(p=>{
  const storeId=confirmationStoreId(p),route=config.routes.find(r=>r.storeId===storeId);
  if(!route||!route.verified||!Number.isFinite(Date.parse(route.verifiedAt)))return {id:p.id,storeId,store:p.store,status:'blocked',reason:'店舗と送付先の照合待ち'};
  return {id:p.id,storeId,store:p.store,channel:route.channel,to:route.to,status:'draft',revision:confirmationRevision(p),...(route.channel==='email'?{email:confirmationEmail(p,route)}:{}),record:p};
 });
}
export function confirmationEml(mail){
 if(mail.from!=='info@cantik.co.jp'||!email.test(mail.to)||/[\r\n]/.test(mail.subject))throw new Error('メールの差出人と宛先を確認してください。');
 const b64=s=>Buffer.from(s).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
 const boundary='meo_'+mail.revision;
 return ['From: info@cantik.co.jp','To: '+mail.to,'Subject: =?UTF-8?B?'+Buffer.from(mail.subject).toString('base64')+'?=','MIME-Version: 1.0','X-Unsent: 1','Content-Type: multipart/alternative; boundary="'+boundary+'"','',...['plain','html'].flatMap(type=>['--'+boundary,'Content-Type: text/'+type+'; charset=UTF-8','Content-Transfer-Encoding: base64','',b64(type==='plain'?mail.text:mail.html)]),'--'+boundary+'--',''].join('\r\n');
}
