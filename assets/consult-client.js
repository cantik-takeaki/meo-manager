import {insightWindow} from '/lib/consult-evidence.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function read(url){try{const r=await fetch(url);const d=await r.json();return r.ok&&!d.error&&!d.pending?d:{error:'取得できませんでした。'};}catch{return {error:'通信を確認できませんでした。'};}}
let generation=0;
window.runAiConsul=async function(){
 const ticket=++generation,idx=Number(document.getElementById('consulSelect').value),loc=window._locations?.[idx];
 if(!document.getElementById('consulSelect').value||!loc)return window.showToast('対象店舗を選択してください','error');
 const sid=loc.storeId||(loc.name||'').replace(/\//g,'_'),id=encodeURIComponent(sid),box=document.getElementById('consulResult');
 document.getElementById('consulIntro').style.display='none';box.style.display='';box.textContent='実測データと取得期間を確認しています。';
 const connected=loc._type==='gbp'||loc.gbpConnected,params=new URLSearchParams({locationName:loc.name||'',...(loc.storeId?{storeId:loc.storeId}:{})}),windows=insightWindow();
 const perf=w=>connected&&loc.name?read('/api/locations?action=insights&'+params+'&'+new URLSearchParams({start:windows[w].start,end:windows[w].end})):Promise.resolve({error:'未連携'});
 try{
  const [k,rv,rk,ph,cur,prev]=await Promise.all([read('/api/admin?action=knowledge&locationId='+id),connected&&loc.name?read('/api/reviews?'+params):Promise.resolve({error:'未連携'}),read('/api/admin?action=rankings&storeId='+id),connected&&loc.name?read('/api/posts?action=gbp-photo&'+params):Promise.resolve({error:'未連携'}),perf('current'),perf('previous')]);
  const diagnostic=window.meoDiagnostic(k,rk,rv.stats||{},connected,loc,ph.error?null:{photoCount:Number.isFinite(ph.count)?ph.count:null});
  const r=await fetch('/api/generate-content',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locationId:sid,type:'weekly_tasks',consul:{diagnostic,reviews:rv,insights:{current:cur,previous:prev}}})});
  const response=await r.json();if(!r.ok||response.error)throw new Error(response.error||'分析できませんでした。');
  const result=JSON.parse(response.content);if(ticket!==generation)return;
  const status={known:'確認済み',unknown:'未取得・判定保留',stale:'古い記録'};
  const evidence=new Map(result.evidence.map(e=>[e.id,e]));
  box.innerHTML=`<h3>${esc(loc.title)}の運用分析</h3><p>分析日時：${esc(new Date(result.generatedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo'}))}</p><p>${esc(result.summary).replace(/\n/g,'<br>')}</p><p>運用準備：${result.readiness.score===null?'判定保留':esc(result.readiness.score)+'点'}／確認率：${result.readiness.coverage===null?'未取得':esc(result.readiness.coverage)+'％'}。Googleの評価や順位予測ではありません。</p><p>${result.aiSelected?'AIが確認済みの改善候補から優先項目を選びました。':'AIの選定結果を取得できないため、根拠と優先度から改善項目を表示しています。'}</p><h3>今週の改善と確認指標</h3><ol>${result.tasks.map(t=>`<li><h4>${esc(t.name)}</h4><p>${esc(t.reason)}</p><p>確認指標：${esc(t.metric)}</p><p>優先度：${t.priority==='high'?'高':'中'}。${esc(t.hypothesis)}</p><details><summary>この提案の根拠</summary>${t.evidenceIds.map(id=>{const e=evidence.get(id);return e?`<p>${esc(e.source)}／${esc(e.period)}<br>${esc(e.detail)}</p>`:'';}).join('')}</details><button class="btn btn-outline btn-sm" data-consul-panel="${esc(t.panel)}">対象画面を開く</button><label><input type="checkbox" data-consul-done="${esc(t.id)}">今週の確認を完了</label></li>`).join('')}</ol><h3>来月の方針</h3><p>${esc(result.forecast.comment).replace(/\n/g,'<br>')}</p><ul>${result.forecast.priorityActions.map(x=>'<li>'+esc(x)+'</li>').join('')}</ul><details><summary>全ての根拠・期間・未取得項目</summary>${result.evidence.map(e=>`<h4>${esc(e.source)}：${status[e.status]||'未取得'}</h4><p>${esc(e.period)}<br>${esc(e.detail)}</p>`).join('')}</details>`;
  for(const el of box.querySelectorAll('[data-consul-panel]'))el.addEventListener('click',()=>{window.selectLocation(idx);window.showPanel(el.dataset.consulPanel);});
  const week=typeof window._isoWeek==='function'?window._isoWeek():new Date().toISOString().slice(0,10);
  const doneUrl='/api/admin?action=consul-done&storeId='+id+'&week='+encodeURIComponent(week);
  const doneData=await read(doneUrl),done=new Set(Array.isArray(doneData.done)?doneData.done:[]);let saving=Promise.resolve();
  for(const el of box.querySelectorAll('[data-consul-done]')){const key='ev_'+el.dataset.consulDone;el.checked=done.has(key);el.disabled=!!doneData.error;el.addEventListener('change',()=>{const checked=el.checked;el.disabled=true;saving=saving.then(async()=>{const next=new Set(done);checked?next.add(key):next.delete(key);try{const r=await fetch(doneUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({done:[...next]})});if(!r.ok)throw Error();done.clear();for(const x of next)done.add(x);}catch{el.checked=done.has(key);window.showToast?.('完了状態を保存できませんでした。','error');}finally{el.disabled=false;}});});}
  // 店舗をまたぐ取り違えを避け、現行の提案履歴へ保存する。
  const saved=await fetch('/api/admin?action=consul-log&storeId='+id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({score:result.readiness.score,grade:result.readiness.grade,tasks:result.tasks.map(t=>t.name.replace('（実施後の確認）',''))})});
  if(!saved.ok&&ticket===generation){const p=document.createElement('p');p.textContent='提案履歴の保存に失敗しました。今回の分析は表示できます。';box.append(p);}
 }catch(e){if(ticket===generation)box.textContent='分析を完了できませんでした。'+e.message;}
};
