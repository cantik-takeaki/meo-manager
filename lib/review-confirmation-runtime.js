import {confirmationScope,cardInScope,confirmationRevision,confirmationEditKey} from './review-confirmation.js';

const prefix='rv_pending_';
const message=text=>({text,messages:[{type:'text',text}]});
const active=p=>p&&['pending','held','blocked','failed'].includes(p.status);

// 全ての変更は表示された版と保存中の版を照合してから一度だけ確定する。
// 依存処理を分離し、試験ではGoogleへの通信そのものを禁止できるようにする。
export async function confirmationAction(input,deps){
 const {get,getMany,set,cas,config,central,excluded,bubble,publish,now=()=>new Date().toISOString()}=deps;
 const scope=input.emailScope||confirmationScope(input,central,config);
 if(!scope)return message('このトークでは口コミの確認操作をご利用いただけません。');
 const visible=p=>cardInScope(p,scope)&&!excluded(p);
 const text=String(input.text||'').trim();
 const editKey=confirmationEditKey(input);
 if(input.action==='read'||input.action==='text'){
  if(/^(一覧|いちらん|リスト|次|つぎ|次へ)$/.test(text)){
   const ids=await get('rv_queue')||[],rows=[];
   for(let i=0;i<ids.length;i+=100){const keys=ids.slice(i,i+100).map(id=>prefix+id);const records=getMany?await getMany(keys):await Promise.all(keys.map(get));for(const p of records)if(visible(p)&&active(p)&&!p.controlTest)rows.push(p);}
   rows.sort((a,b)=>(a.status==='held')-(b.status==='held'));
   if(!rows.length)return message('確認待ちの口コミはありません。');
   if(/^(次|つぎ|次へ)$/.test(text))return {messages:[{type:'text',text:`確認待ち ${rows.length}件です。`},{type:'flex',altText:'口コミの確認：'+rows[0].store,contents:await bubble(rows[0])}]};
   let output=`確認待ち ${rows.length}件\n\n`;
   for(const p of rows){const line=`${p.store} ★${p.star} ${p.name||'投稿者名なし'}　番号 ${p.id}${p.status==='held'?'（保留）':p.status==='blocked'?'（要修正）':p.status==='failed'?'（再確認）':''}\n`;if(output.length+line.length>4500)break;output+=line;}
   return message(output+'\n「確認 番号」で原文と返信案を表示します。');
  }
  const read=text.match(/^(原文|返信文|確認)\s*([0-9a-f]{10})$/);
  if(read){const p=await get(prefix+read[2]);if(!visible(p))return message('この店舗の確認対象が見つかりません。');
   if(read[1]==='確認')return {messages:[{type:'flex',altText:'口コミの確認：'+p.store,contents:await bubble(p)}]};
   return message(String(read[1]==='原文'?p.review||'（本文なし・星のみ）':p.reply||'返信案は未作成です。'));
  }
 }
 let id=input.id,revision=input.revision,decision=input.decision,reply=input.reply;
 if(input.action==='text'){
  const slot=await get(editKey);
  if(!slot||Date.parse(now())-Date.parse(slot.at)>900000)return {ignore:true};
  id=slot.id;revision=slot.revision;decision='save';reply=text;
 }
 if(!/^[0-9a-f]{10}$/.test(id||''))return message('確認番号が正しくありません。');
 const key=prefix+id,p=await get(key);
 if(!visible(p))return message('この店舗の確認対象が見つかりません。');
 if(!active(p))return message('この確認は処理済みです。\n最新の一覧をご確認ください。');
 if(revision!==confirmationRevision(p))return message('返信案が更新されています。\n最新の確認カードから操作してください。');
 if(!input.userId&&!input.emailScope)return message('操作した方を確認できませんでした。');
 const at=now(),by=input.userId||'メール確認';
 if(decision==='edit'){
  await set(editKey,{id,revision,at});
  return message(`返信の文を直します。\n下の文をコピーして修正し、このトークに15分以内にお送りください。\n修正しただけではGoogleに公開されません。\n\n${p.reply||''}`);
 }
 let next;
 if(decision==='save'){
  const clean=String(reply||'').trim();
  if(!clean||clean.length>4000)return message('返信案を1文字以上4,000文字以内で入力してください。');
  if(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(clean))return message('絵文字を除いてからもう一度お送りください。');
  next={...p,reply:clean,status:'pending',humanEdited:true,editedBy:by,editedAt:at};
 }else if(decision==='later')next={...p,status:'held',heldAt:at,by};
 else if(decision==='ng')next={...p,status:'rejected',at,by};
 else if(decision==='ok'){
  if(!String(p.reply||'').trim())return message('返信案が空のため承認できません。');
  if(p.controlTest){
   if(p.reviewId||p.locationName)return message('試験カードの識別情報に問題があるため停止しました。');
   next={...p,status:'demo_approved',at,by};
  }else next={...p,status:'sending',at,by};
 }else return message('操作を確認できませんでした。');
 if(!await cas(key,p,next))return message('別の操作が先に反映されました。最新の一覧をご確認ください。');
 if(decision==='save'){
  await set(editKey,null);
  return {messages:[{type:'text',text:'返信案を修正しました。\n内容を確認してから承認してください。\nGoogleにはまだ送信していません。'},{type:'flex',altText:'修正後の返信案：'+next.store,contents:await bubble(next)}]};
 }
 if(decision==='later')return message('保留にしました。\n口コミと返信案を残しています。\nGoogleには送信していません。');
 if(decision==='ng')return message('返信案を取り下げました。\nお客様の口コミは削除していません。');
 if(p.controlTest)return message('デモの承認を受け付けました。\nGoogleには送信していません。');
 let result;
 try{result=await publish(p);}catch{result={status:'needs_check',text:'送信結果を確認できませんでした。重複を防ぐため自動再送は行いません。'};}
 await cas(key,next,{...next,status:result.status,resultText:result.text,doneAt:now()});
 return message(result.text);
}
