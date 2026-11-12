export async function chooseWording(pool,free,complete,recent,reserve,flows){
  const body=text=>text.replace(/(?:どうもありがとうございました。|ありがとうございました。|ありがとうございます。)$/u,'')||text;
  const opening=text=>(text.split(/[、。！？,.!?]/u)[0]||text).trim();
  const ending=text=>text.split(/[。！？.!?]/u).filter(Boolean).at(-1)?.trim()||text;
  let ids=pool.map((_,i)=>i);
  if(Array.isArray(recent)){
    const unseen=ids.filter(i=>!recent.includes(i));
    ids=unseen.length?unseen:[recent.find(i=>ids.includes(i))];
    if(flows){
      const lastFlow=id=>recent.findLastIndex(i=>flows[i]===flows[id]);
      const oldest=Math.min(...ids.map(lastFlow));
      ids=ids.filter(id=>lastFlow(id)===oldest);
    }
    // 同じ感謝の一文を冒頭から末尾に移しただけの案も重複として扱う。
    const gratitude=text=>text.split(/[。！？.!?]/u).filter(line=>/ありがと|ありがた|ごちそう|感謝|thank|appreciat|谢谢|感谢|감사|고맙/iu.test(line));
    const previousThanks=recent.map(i=>pool[i]?gratitude(pool[i]):[]);
    const lastThanks=id=>previousThanks.findLastIndex(lines=>gratitude(pool[id]).some(line=>lines.includes(line)));
    const oldestThanks=Math.min(...ids.map(lastThanks));
    ids=ids.filter(id=>lastThanks(id)===oldestThanks);
    const lastOpening=id=>recent.findLastIndex(i=>pool[i] && opening(pool[i])===opening(pool[id]));
    const oldestOpening=Math.min(...ids.map(lastOpening));
    ids=ids.filter(id=>lastOpening(id)===oldestOpening);
    const lastEnding=id=>recent.findLastIndex(i=>pool[i] && ending(pool[i])===ending(pool[id]));
    const oldestEnding=Math.min(...ids.map(lastEnding));
    ids=ids.filter(id=>lastEnding(id)===oldestEnding);
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
      const picked=await reserve(ordered.map(i=>({text:pool[i],body:body(pool[i]),opening:opening(pool[i]),ending:ending(pool[i])})));
      if(picked!==0)source='template';
      id=ordered[picked];
      sharedHistory=true;
    }catch{/* 履歴サービスが一時停止しても本人の入力だけで下書きを返す。 */}
  }
  return {content:[pool[id],free].filter(Boolean).join('\n'),source,variant:id,...(reserve?{sharedHistory}:{})};
}
