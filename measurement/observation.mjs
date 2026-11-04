// 計測の成功・失敗・観測範囲を分離して保存。通信失敗を圏外へ変換しない。
export function observation(row, {device,zoom,at=new Date().toISOString()}={}) {
  const valid=Number.isInteger(row.rank)&&row.rank>0;
  const status=row.blocked?'blocked':row.error?'error':valid?'ranked':row.complete?'not_found':'partial';
  return {status,rank:status==='ranked'?row.rank:null,observedAt:row.observedAt||at,
    point:{lat:row.lat,lng:row.lng},device,zoom,source:'local-chrome',
    observedLimit:Number.isInteger(row.total)?row.total:null,complete:!!row.complete,
    matched:row.matched||null,matchedBy:row.matchedBy||null,placeId:row.matchedPid||null,
    error:row.blocked?'アクセス制限':row.error?'計測失敗':null};
}
export function recordObservation(entry, row, index, method) {
  const current=observation(row,method);
  entry.observations??={};entry.lastSuccessful??={};
  const prior=entry.observations[row.kw];
  if(prior?.status==='ranked'||prior?.status==='not_found')entry.lastSuccessful[row.kw]=prior;
  entry.observations[row.kw]=current;
  if(current.status==='ranked'||current.status==='not_found')entry.lastSuccessful[row.kw]=current;
  // 旧形式の成功値も時刻を添えて保持。現在値に流用しない。
  if(!prior && Number.isInteger(entry.rankings[index]) && entry.rankings[index]>0 && current.status!=='ranked')
    entry.lastSuccessful[row.kw]={status:'ranked',rank:entry.rankings[index],observedAt:entry.recordedAt||null,legacy:true};
  entry.rankings[index]=current.rank;
  entry.solo[index]=current.status==='ranked'&&!!row.solo;
  return current;
}
