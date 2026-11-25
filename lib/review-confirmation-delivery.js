import crypto from 'node:crypto';
import {confirmationPlan,confirmationRevision} from './review-confirmation.js';

export function deliveryKey(p,route){return 'rv_delivery_'+crypto.createHash('sha256').update(JSON.stringify([p.id,confirmationRevision(p),route.channel,route.to])).digest('hex');}
export function retryKey(key){const h=crypto.createHash('sha256').update(key).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;}

export async function deliverConfirmations(records,config,deps){
 const result={sent:0,failed:[],deliveredReviewIds:[],ids:[],items:records.length};
 if(!config?.enabled)return {...result,skipped:'店舗別通知は無効です。'};
 const plans=confirmationPlan(records,config,deps.excluded);
 const deadline=Date.now()+20000;
 for(const plan of plans){
  if(Date.now()>deadline){result.failed.push([plan.store,'実行時間の上限に近いため次回に回します。']);continue;}
  if(plan.status==='blocked'){result.failed.push([plan.store,plan.reason]);continue;}
  const key=deliveryKey(plan.record,plan),old=await deps.get(key);
  if(old?.status==='accepted'){result.deliveredReviewIds.push(plan.record.reviewId);continue;}
  // 通信結果が不明な場合に別のキーで再送しない。履歴照合後にのみ再開する。
  if(old&&old.status!=='not_sent'){result.failed.push([plan.store,'前回の送信結果を確認してください。']);continue;}
  const transport=deps[plan.channel];
  if(!transport){result.failed.push([plan.store,'送信経路が未設定です。']);continue;}
  const lease={status:'sending',at:new Date().toISOString(),channel:plan.channel,storeId:plan.storeId};
  if(!await deps.cas(key,old||null,lease)){result.failed.push([plan.store,'別の送信処理が進行中です。']);continue;}
  let receipt;
  try{receipt=await transport(plan,retryKey(key));}catch{receipt={accepted:false,reason:'通信結果を確認できませんでした。'};}
  await deps.cas(key,lease,{...lease,status:receipt.accepted?'accepted':receipt.notSent?'not_sent':'needs_check',receipt});
  if(receipt.accepted){result.sent++;result.ids.push(plan.id);result.deliveredReviewIds.push(plan.record.reviewId);}
  else result.failed.push([plan.store,receipt.reason||'送信結果の確認待ち']);
 }
 return result;
}

export async function sendLineConfirmation(plan,key,{token,bubble,request=fetch,includedLimit=200}){
 const get=async path=>{const r=await request('https://api.line.me/v2/bot/'+path,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(7000)});if(!r.ok)throw new Error('LINE情報を取得できません。');return r.json();};
 const [quota,usage,members]=await Promise.all([get('message/quota'),get('message/quota/consumption'),get('group/'+plan.to+'/members/count')]);
 if(![200,5000].includes(includedLimit)||quota.type!=='limited'||quota.value!==includedLimit||!Number.isInteger(usage.totalUsage)||usage.totalUsage<0||!Number.isInteger(members.count)||members.count<1||usage.totalUsage+members.count>includedLimit)return {accepted:false,notSent:true,reason:'LINEの契約枠と通知上限が一致しないか残数が足りないため保留しました。'};
 const contents=await bubble(plan.record);
 const r=await request('https://api.line.me/v2/bot/message/push',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Line-Retry-Key':key},body:JSON.stringify({to:plan.to,messages:[{type:'flex',altText:'口コミの確認：'+plan.store,contents}]}),signal:AbortSignal.timeout(10000)});
 return {accepted:r.ok||r.status===409&&!!r.headers.get('x-line-accepted-request-id'),http:r.status,requestId:r.headers.get('x-line-accepted-request-id')||r.headers.get('x-line-request-id')};
}
