import {createHash} from 'node:crypto';
import {kvGet, kvSet} from '../api/_kv.js';
import {getMasterToken,getAccessToken} from '../api/_tokens.js';
import {unavailableCard,formatBubble,PENDING_PREFIX} from '../api/_review_line.js';
import {originalComment} from './review-routing.js';

const historyKey = 'review_history_20261108';
export async function saveReviewHistory(req,res) {
  const locations = ((await kvGet('managed_locations')) || []).filter(m=>!unavailableCard(m));
  const {store,rows}=req.body || {};
  const m=locations.find(m=>String(m.locId).split('/').pop()===store);
  if (!m || !rows || typeof rows!=='object' || Array.isArray(rows) || !Object.keys(rows).length ||
    Object.entries(rows).some(([n,r])=>!/^\d{3}$/.test(n)||!r.reviewId||typeof r.review!=='string'||!r.reply?.includes('\n\nこの度は誠にありがとうございました。\n-'))) return res.status(400).json({error:'店舗または書式を確認してください'});
  // Store-specific immutable snapshots avoid concurrent imports overwriting another store.
  await kvSet(historyKey+'_'+store,{store:m.title,items:rows});
  return res.json({store:m.title,count:Object.keys(rows).length});
}

export async function historicalMessages(command) {
  const match=String(command).trim().match(/^過去(?:の口コミ)?\s*(一覧|\d{1,3})$/);
  if (!match) return null;
  const text=value=>[{type:'text',text:value}];
  const locations=((await kvGet('managed_locations'))||[]).filter(m=>!unavailableCard(m));
  const groups=(await Promise.all(locations.map(async m=>({m,data:await kvGet(historyKey+'_'+String(m.locId).split('/').pop())})))).filter(g=>g.data);
  if(match[1]==='一覧'){
    const list=groups.map(({data})=>{const keys=Object.keys(data.items).sort();return data.store+'　'+keys[0]+'～'+keys.at(-1);});
    return text('過去の未返信口コミの確認番号です。\n'+list.join('\n')+'\n\n「過去 001」のように送ると1件を開けます。');
  }
  const number=match[1].padStart(3,'0'),group=groups.find(g=>g.data.items[number]);
  if(!group)return text('該当する確認番号がありません。');
  const {m,data}=group,r=data.items[number],sid=String(m.locId).replace(/\//g,'_');
  if(r.statusNote==='掲載先照合')return text('確認番号 '+number+'　'+data.store+'\n店舗の取り違え・来店の有無を先にご確認ください。\n'+(r.summary||originalComment(r.review)).slice(0,3500));
  const token=(m.storeId && await getAccessToken(m.storeId))||await getMasterToken();
  const resp=await fetch('https://mybusiness.googleapis.com/v4/'+m.locationName+'/reviews/'+encodeURIComponent(r.reviewId),{headers:{Authorization:'Bearer '+token}});
  if(!resp.ok)return text('Googleの現在の口コミを照合できませんでした。');
  const live=await resp.json();
  if(live.reviewReply?.comment)return text(data.store+'　この口コミはすでに返信済みです。');
  if((live.comment||'')!==r.review)return text('口コミが変更されています。新しい原文をご確認ください。');
  const id=createHash('sha256').update(historyKey+sid+r.reviewId+r.reply).digest('hex').slice(0,10);
  const latest=await kvGet('rv_latest_'+r.reviewId);
  const previous=await kvGet(PENDING_PREFIX+(latest||id));
  if(previous&&previous.status!=='pending')return text('この口コミには対応記録があります。再送する前に管理画面をご確認ください。');
  const record=previous||{...r,localHistory:true,id,status:'pending',store:data.store,sid,locationName:m.locationName,reviewUpdateTime:live.updateTime||live.createTime};
  if(!previous){await kvSet(PENDING_PREFIX+id,record);await kvSet('rv_latest_'+r.reviewId,id);}
  const bubble=await formatBubble({...record,localHistory:true,summary:r.summary||''});
  return [{type:'text',text:'確認番号 '+number+'　'+r.statusNote+'\n'+r.notes},{type:'flex',altText:'過去の口コミ：'+data.store,contents:bubble}];
}
