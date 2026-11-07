export async function chooseWording(pool,free,complete,recent,reserve){
  const body=text=>text.replace(/(?:どうもありがとうございました。|ありがとうございました。|ありがとうございます。)$/u,'')||text;
  let ids=pool.map((_,i)=>i);
  if(Array.isArray(recent)){
    const unseen=ids.filter(i=>!recent.includes(i));
    ids=unseen.length?unseen:[recent.find(i=>ids.includes(i))];
    // 感謝だけの差し替えが続かないよう、本文の異なる候補を先に使う。
    const age=id=>recent.findLastIndex(i=>pool[i]!==undefined && body(pool[i])===body(pool[id]));
    const oldest=Math.min(...ids.map(age));
    ids=ids.filter(id=>age(id)===oldest);
    const offset=Math.floor(Math.random()*ids.length);
    ids=[...ids.slice(offset),...ids.slice(0,offset)];
  }
  const drafts=ids.slice(0,2).map(i=>pool[i]);
  let index=0,source='template';
  try{
    const raw=await complete('実体験に基づく口コミの候補です。選択にない情報は加えず、最も自然に読める文章の番号をJSONのchoices配列で一つ返してください。'+JSON.stringify(drafts),{maxTokens:100,temperature:0,reviewChoices:true});
    const data=JSON.parse(raw);
    const pick=Array.isArray(data)?data:data?.choices;
    if(pick?.length===1 && Number.isInteger(pick[0]) && drafts[pick[0]]!==undefined){index=pick[0];source='ai';}
  }catch{/* 利用できないときも選択された事実のみを返す。 */}
  let id=ids[index];
  let sharedHistory=false;
  if(reserve){
    const ordered=[id,...ids.filter(other=>other!==id)];
    try{
      const picked=await reserve(ordered.map(i=>({text:pool[i],body:body(pool[i])})));
      if(picked!==0)source='template';
      id=ordered[picked];
      sharedHistory=true;
    }catch{/* 履歴サービスが一時停止しても本人の入力だけで下書きを返す。 */}
  }
  return {content:[pool[id],free].filter(Boolean).join('\n'),source,variant:id,...(reserve?{sharedHistory}:{})};
}
