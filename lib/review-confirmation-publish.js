import {kvGet,kvSet} from '../api/_kv.js';
import {getAccessToken,getMasterToken} from '../api/_tokens.js';
import {unavailableCard} from '../api/_review_line.js';
import {findAffirm,findUnsupported,findEffectClaims,findRebuttal} from '../api/_review_safety.js';

export async function publishConfirmedReview(p){
 if(p.controlTest||!p.reviewId||!p.locationName)return {status:'blocked',text:'試験カードはGoogleへ送信できません。'};
 if(unavailableCard(p,await kvGet('meo_paused_stores')||[]))return {status:'blocked',text:'運用停止中の店舗のため送信しませんでした。'};
 const latest=await kvGet('rv_latest_'+p.reviewId);
 if(latest&&latest!==p.id)return {status:'superseded',text:'最新の返信案を確認してください。旧版は送信していません。'};
 const af=findAffirm(p.reply,p.review),un=findUnsupported(p.reply,p.review);
 const risks=[...af.affirm,...af.restated,...un.storeInfo,...un.visit,...findEffectClaims(p.reply),...findRebuttal(p.reply)];
 if(risks.length||!p.reply?.trim()||p.reply.length>4000)return {status:'blocked',text:'返信案に確認が必要な表現があるため公開を止めました。内容を見直してください。'};
 const managed=await kvGet('managed_locations')||[];
 const m=managed.find(m=>m.locationName===p.locationName);
 if(!m)return {status:'blocked',text:'契約店舗を照合できないため送信しませんでした。'};
 const token=m.storeId?(await getAccessToken(m.storeId))||await getMasterToken():await getMasterToken();
 const url='https://mybusiness.googleapis.com/v4/'+p.locationName+'/reviews/'+encodeURIComponent(p.reviewId);
 const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const live=await fetch(url,{headers,signal:AbortSignal.timeout(7000)});
 if(!live.ok)return {status:'failed',text:'Googleの口コミを取得できないため送信しませんでした。'};
 const cur=await live.json();
 if(!p.reviewUpdateTime||p.reviewUpdateTime!==(cur.updateTime||cur.createTime)||(cur.comment||'')!==(p.review||''))return {status:'skipped_changed',text:'口コミが更新されているため送信しませんでした。最新の原文で返信案を作り直します。'};
 if(cur.reviewReply?.comment)return {status:'skipped_replied',text:'Googleですでに返信済みでした。上書きはしていません。'};
 if(unavailableCard(p,await kvGet('meo_paused_stores')||[]))return {status:'blocked',text:'運用停止を確認したため送信しませんでした。'};
 const result=await fetch(url+'/reply',{method:'PUT',headers,body:JSON.stringify({comment:p.reply}),signal:AbortSignal.timeout(10000)});
 if(!result.ok)return {status:'needs_check',text:'Googleへの送信結果を確認する必要があります。重複を防ぐため自動再送は行いません。'};
 const verify=await fetch(url,{headers,signal:AbortSignal.timeout(7000)});
 if(!verify.ok||(await verify.json()).reviewReply?.comment!==p.reply)return {status:'needs_check',text:'Googleが返信を受け付けました。本文の反映確認はまだ完了していません。'};
 const sent=new Set(await kvGet('review_reply_sent')||[]);sent.add(p.reviewId);await kvSet('review_reply_sent',[...sent].slice(-2000));
 const log=await kvGet('review_reply_log')||[];
 await kvSet('review_reply_log',[{at:new Date().toISOString(),store:p.store,reviewId:p.reviewId,reply:p.reply,via:'店舗別承認'},...log].slice(0,200));
 return {status:'sent',text:`口コミへの返信が完了しました。\n${p.store}\nGoogleから返信を読み返し、承認された本文との一致を確認しました。`};
}
