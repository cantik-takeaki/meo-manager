// 欠測を0にせず、同じ観測対象だけを比較する共通部品。
export function rankNumber(v) {
  if (typeof v !== 'number' && !(typeof v === 'string' && /^\d+$/.test(v))) return null;
  const n = Number(v); return Number.isSafeInteger(n) && n >= 1 ? n : null;
}
export function rankSummary(kws = [], arr = []) {
  const values = kws.map((_, i) => rankNumber(arr[i]));
  const ranked = values.filter(v => v !== null);
  return { avgRank: ranked.length ? Math.round(ranked.reduce((a,b)=>a+b,0)/ranked.length*10)/10 : null,
    top3: ranked.filter(v=>v<=3).length, top10: ranked.filter(v=>v<=10).length,
    out: ranked.filter(v=>v>20).length, unknown: values.length-ranked.length, measured: ranked.length,
    total: values.length };
}
export function compareRanks(kws, before, after) {
  const common = [...new Set(kws)].filter(k=>Object.hasOwn(before,k)&&Object.hasOwn(after,k));
  const base = rankSummary(common,common.map(k=>before[k])), cur = rankSummary(common,common.map(k=>after[k]));
  const comparable = common.length > 0 && common.length === new Set(kws).size && !base.unknown && !cur.unknown;
  // 一部だけの好転を店舗全体の改善にしない。欠測を含む比較の集計値は公開しない。
  if (!comparable) for (const s of [base,cur]) { s.avgRank=null; s.top3=null; s.top10=null; }
  return {common:common.length,total:new Set(kws).size,comparable,base,cur};
}
export const jstMonth = (now = new Date()) => new Date(+now+9*3600000).toISOString().slice(0,7);
export function previousMonth(ym) { const [y,m]=ym.split('-').map(Number); return new Date(Date.UTC(y,m-2,1)).toISOString().slice(0,7); }
export function isDemo(store) { return store.isDemo === true || store.demo === true || store.type === 'demo' || /^【デモ】/.test(store.title || store.storeName || ''); }
export function comparisonPeriods(now = new Date()) {
  const day = new Date(new Date(+now+9*3600000).toISOString().slice(0,10)+'T00:00:00Z');
  const start=new Date(+day-74*86400000),end=new Date(+day-14*86400000);
  const prevEnd=new Date(end); prevEnd.setUTCFullYear(end.getUTCFullYear()-1);
  // 同日数を比較。閏年も61日と61日に固定。
  return {start:start.toISOString().slice(0,10),end:end.toISOString().slice(0,10),
    previousStart:new Date(+prevEnd-60*86400000).toISOString().slice(0,10),previousEnd:prevEnd.toISOString().slice(0,10),days:61};
}
export function coveredTotal(daily,start,end,keys) {
  let total=0, present=0, expected=0;
  for(let t=Date.parse(start);t<=Date.parse(end);t+=86400000){
    const row=daily?.[new Date(t).toISOString().slice(0,10)];
    for(const k of keys){expected++;const v=row?.[k];if(typeof v==='number'&&Number.isFinite(v)&&v>=0){present++;total+=v;}}
  }
  return {total:present===expected&&expected>0?total:null,present,expected,complete:present===expected&&expected>0};
}
export function keywordValue(value = {}) {
  if (value.value != null && /^\d+$/.test(String(value.value))) return {value:Number(value.value),threshold:null};
  if (value.threshold != null && /^\d+$/.test(String(value.threshold))) return {value:null,threshold:Number(value.threshold)};
  return {value:null,threshold:null};
}

// キーワードの並びが変わっても過去値を別の語へ転用しない。
export function historyRank(entry, keyword) {
  if (!entry) return null;
  if (entry.ranksByKw && Object.hasOwn(entry.ranksByKw, keyword)) return rankNumber(entry.ranksByKw[keyword]);
  const i = entry.keywords?.indexOf(keyword) ?? -1;
  return i >= 0 ? rankNumber(entry.rankings?.[i]) : null;
}
export function rankingReport(data = {}) {
  const history = [...(data.history || [])].sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  const latest=history.at(-1), previous=history.at(-2);
  return (data.keywords || []).map((keyword,i)=>{
    // 最新の旧形式だけは現在のキーワード一覧との対応を維持。過去比較は保留。
    const current = latest?.ranksByKw || latest?.keywords ? historyRank(latest,keyword) : rankNumber(latest?.rankings?.[i]);
    const prev = historyRank(previous,keyword);
    return {keyword,current,prev,change:current!==null&&prev!==null&&sameMeasurement(previous?.observations?.[keyword],latest?.observations?.[keyword])?prev-current:null,
      history:history.map(h=>({date:h.date,rank:historyRank(h,keyword)}))};
  });
}

export function sameMeasurement(a,b){
 if(!a||!b||a.status!=='ranked'||b.status!=='ranked')return false;
 if(!a.source||!a.device||!a.point||!b.point)return false;
 if(![a.point.lat,a.point.lng,b.point.lat,b.point.lng].every(Number.isFinite))return false;
 return a.source===b.source&&a.device===b.device&&a.zoom===b.zoom&&a.point.lat===b.point.lat&&a.point.lng===b.point.lng;
}
export function compareRankEntries(kws,before,after){
 const mapping=e=>e?.ranksByKw||(Array.isArray(e?.keywords)?Object.fromEntries(e.keywords.map((k,i)=>[k,e.rankings?.[i]])):{});
 const result=compareRanks(kws,mapping(before),mapping(after));
 if(!kws.every(k=>sameMeasurement(before?.observations?.[k],after?.observations?.[k]))){
  result.comparable=false;result.reason='計測地点・端末・方式が一致する証拠が不足';
  for(const value of [result.base,result.cur]){value.avgRank=null;value.top3=null;value.top10=null;}
 }
 return result;
}
