import { formatOwnerReply } from './review-format.js';
import { randomUUID } from 'node:crypto';
import { acquireReviewLock, releaseReviewLock, kvGet, kvSet } from '../api/_kv.js';
import { getMasterToken, getAccessToken } from '../api/_tokens.js';
import { pushReviewAlerts } from '../api/_review_line.js';
import { llmComplete } from '../api/generate-content.js';
import { propose, reviewStars, since, slots } from './review-routing.js';

function lid(m){return String(m.locationName||m.locId||'').match(/locations[\/_](\d+)/)?.[1]||'';}
function expired(m){return /羊大厨|麻辣王酒場/.test(m.title||'');}
async function google(path,token,options={}) {
  const res=await fetch('https://mybusiness.googleapis.com/v4/'+path,{...options,signal:AbortSignal.timeout(7000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
  if(!res.ok) throw new Error('Google HTTP '+res.status);
  return res.json();
}
async function generate(rv,past){
  let timer;
  try{return await Promise.race([propose(rv,past,llmComplete),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('生成タイムアウト')),15000)})]);}
  finally{clearTimeout(timer);}
}
export async function reviewInventory(req,res) {
  const managed = (await kvGet('managed_locations') || []).filter(m=>m.locationName && lid(m));
  const stores = [...new Map(managed.map(m=>[lid(m),m])).values()];
  const paused = new Set((await kvGet('meo_paused_stores')||[]).map(x=>String(x.lid)));
  if (!req.query.store) return res.json({mode:await kvGet('review_autoreply_mode')||'draft', stores:stores.map(m=>({id:lid(m),name:m.title,paused:paused.has(lid(m)),expired:expired(m)}))});
  const m = stores.find(m=>lid(m)===req.query.store);
  if(!m) return res.status(404).json({error:'登録店舗が見つかりません'});
  const token = (m.storeId && await getAccessToken(m.storeId)) || await getMasterToken();
  const params = new URLSearchParams({pageSize:'50',orderBy:'updateTime desc'});
  if(req.query.cursor) params.set('pageToken',req.query.cursor);
  const page=await google(m.locationName+'/reviews?'+params,token);
  return res.json({total:page.totalReviewCount,next:page.nextPageToken||'',rows:(page.reviews||[]).map(rv=>({id:rv.reviewId,date:rv.createTime,star:reviewStars(rv),replied:!!rv.reviewReply?.comment?.trim()}))});
}

export async function previewReview(req,res) {
  const b=req.body||{};
  const m=(await kvGet('managed_locations')||[]).find(m=>lid(m)===b.store);
  if(!m || typeof b.reply!=='string' || b.reply.length>1000 || !b.reviewId) return res.status(400).json({error:'店舗・口コミ・返信案を指定してください'});
  const token=(m.storeId && await getAccessToken(m.storeId)) || await getMasterToken();
  const rv=await google(m.locationName+'/reviews/'+encodeURIComponent(b.reviewId),token);
  if(rv.reviewReply?.comment || !rv.comment)return res.status(409).json({error:'返信済みまたは本文のない口コミです'});
  const {sendReviewPreview}=await import('../api/_review_line.js');
  return res.json(await sendReviewPreview({store:m.title,reviewId:rv.reviewId,review:rv.comment,star:reviewStars(rv),name:rv.reviewer?.displayName,reply:b.reply,date:rv.createTime?.slice(0,10)},'confirmation-v1'));
}

export async function runReviews(req,res) {
  const slot=Number(req.query.slot??new Date().getUTCHours());
  if(!Number.isInteger(slot)||slot<0||slot>=slots)return res.status(400).json({error:'実行枠が無効です'});
  const stores=(await kvGet('managed_locations')||[]).filter(m=>m.locationName&&lid(m)).sort((a,b)=>lid(a).localeCompare(lid(b)));
  const active=[...new Map(stores.map(m=>[lid(m),m])).values()].filter(m=>!expired(m));
  const batch=active.filter((_,index)=>index%slots===slot);
  const mode=await kvGet('review_autoreply_mode')||'draft';
  const summary={at:new Date().toISOString(),slot,mode,stores:batch.map(m=>m.title),checked:0,sent:0,drafted:0,skipped:0,failed:[],paused:[],deferred:0};
  if(req.query.inspect==='1')return res.json({mode,slot,stores:summary.stores,last:await kvGet('review_slot_'+slot)});
  if(mode==='off'||(req.query.draftOnly==='1'&&mode!=='draft'))return res.json({...summary,disabled:true});
  const owner=randomUUID();
  if(!await acquireReviewLock(owner))return res.status(409).json({error:'別の口コミ点検が実行中です'});
  const deadline=Date.now()+40000;
  try {
    const paused=new Set((await kvGet('meo_paused_stores')||[]).map(p=>String(p.lid)));
    const alerted=new Set(await kvGet('review_line_alerted')||[]);
    const companies=await kvGet('store_company')||{};
    const queue=[];
    const sentPreviously=new Set(await kvGet('review_reply_sent')||[]);
    for(const m of batch){
      if(paused.has(lid(m))){summary.paused.push(m.title);continue}
      const sid=String(m.locId||m.locationName).replace(/\//g,'_');
      try{
        const token=(m.storeId&&await getAccessToken(m.storeId))||await getMasterToken();
        if(!token)throw new Error('Google連携が利用できません');
        const key='review_draft_'+sid, drafts=await kvGet(key)||[];
        const rvList=[];let next='';
        do{
          const data=await google(m.locationName+'/reviews?'+new URLSearchParams({pageSize:'50',orderBy:'updateTime desc',...(next?{pageToken:next}:{})}),token);
          const page=data.reviews||[];rvList.push(...page);
          next=page.length&&Date.parse(page.at(-1).updateTime||page.at(-1).createTime)>=since?data.nextPageToken:'';
        }while(next&&Date.now()<deadline-18000);
        const past=rvList.filter(rv=>rv.reviewReply?.comment).slice(0,8).map(rv=>rv.reviewReply.comment);
        for(const rv of rvList) {
          if(rv.reviewReply||sentPreviously.has(rv.reviewId)||Date.parse(rv.updateTime||rv.createTime)<since)continue;
          const existing=drafts.find(x=>x.reviewId===rv.reviewId);
          if(existing?.reply || alerted.has(rv.reviewId)){summary.skipped++;continue}
          if(Date.now()>deadline-12000){summary.deferred++;continue}
          summary.checked++;
          let proposal;
          try { proposal=await generate(rv,past); proposal.reply=formatOwnerReply(proposal.reply,m.title); }
          catch { proposal={reply:'',approved:false}; }
          if(!proposal.reply) {
            summary.failed.push([m.title,'返信案を生成できませんでした']);
            // An empty draft still exposes Edit to the reviewer. Approval cannot send empty text.
            proposal={reply:'',approved:false,reason:'返信案を手動で入力してください'};
          }
          const storePaused=(await kvGet('meo_paused_stores')||[]).some(x=>String(x.lid)===lid(m));
          if(storePaused){summary.paused.push(m.title);break}
          const currentMode=await kvGet('review_autoreply_mode')||'draft';
          if(currentMode==='off')break;
          if(!proposal.approved||mode!=='auto'||currentMode!=='auto'){
            const rec={reviewId:rv.reviewId,star:reviewStars(rv),name:rv.reviewer?.displayName||'',review:rv.comment||'',reply:proposal.reply,reason:proposal.reason||'下書きモード',at:new Date().toISOString(),reviewUpdateTime:rv.updateTime||rv.createTime};
            if(existing)Object.assign(existing,rec);else drafts.unshift(rec);
            await kvSet(key,drafts);
            queue.push({...rec,store:m.title,locationName:m.locationName,sid,company:companies[lid(m)]||'',date:String(rv.createTime||'').slice(0,10)});
            summary.drafted++;continue;
          }
          const url=m.locationName+'/reviews/'+encodeURIComponent(rv.reviewId);
          const live=await google(url,token);
          if(live.reviewReply||live.starRating!==rv.starRating||String(live.comment||'')!==String(rv.comment||'')){summary.skipped++;continue}
          await google(url+'/reply',token,{method:'PUT',body:JSON.stringify({comment:proposal.reply})});
          sentPreviously.add(rv.reviewId);await kvSet('review_reply_sent',[...sentPreviously].slice(-2000));summary.sent++;past.unshift(proposal.reply);
          const log=await kvGet('review_reply_log')||[];
          await kvSet('review_reply_log',[{at:new Date().toISOString(),store:m.title,reviewId:rv.reviewId,star:reviewStars(rv),reply:proposal.reply},...log].slice(0,200));
        }
        // Retry delivery of existing drafts if the confirmation group was not configured on their first run.
        for(const x of drafts)if(x.reviewUpdateTime&&!alerted.has(x.reviewId)&&!queue.some(q=>q.reviewId===x.reviewId)&&rvList.some(r=>r.reviewId===x.reviewId&&!r.reviewReply))
          queue.push({...x,store:m.title,locationName:m.locationName,sid,company:companies[lid(m)]||''});
      }catch(e){summary.failed.push([m.title,e.message])}
    }
    if(queue.length){
      const result=await pushReviewAlerts(queue);
      summary.confirmation={sent:result.sent||0,pending:result.items||0,error:result.skipped||result.failed?.length||null};
      // Pending IDs are retained even if push delivery failed. They remain available in the approval queue.
      if(result.sent && !result.failed?.length){for(const q of queue)alerted.add(q.reviewId);await kvSet('review_line_alerted',[...alerted].slice(-2000))}
    }
    return res.json(summary);
  }finally{
    try{await kvSet('review_slot_'+slot,summary);await kvSet('cron_review_reply_last',summary)}finally{await releaseReviewLock(owner)}
  }
}
