export async function chooseWording(pool,free,complete,recent){
  let ids=pool.map((_,i)=>i);
  if(Array.isArray(recent)){
    const unseen=ids.filter(i=>!recent.includes(i));
    ids=unseen.length?unseen:[recent.find(i=>ids.includes(i))];
    const offset=Math.floor(Math.random()*ids.length);
    ids=[...ids.slice(offset),...ids.slice(0,offset)].slice(0,2);
  }
  const drafts=ids.map(i=>pool[i]);
  let index=0,source='template';
  try{
    const raw=await complete('実体験に基づく口コミの候補です。選択にない情報は加えず、最も自然に読める文章の番号をJSONのchoices配列で一つ返してください。'+JSON.stringify(drafts),{maxTokens:100,temperature:0,reviewChoices:true});
    const data=JSON.parse(raw);
    const pick=Array.isArray(data)?data:data?.choices;
    if(pick?.length===1 && Number.isInteger(pick[0]) && drafts[pick[0]]!==undefined){index=pick[0];source='ai';}
  }catch{/* 利用できないときも選択された事実のみを返す。 */}
  return {content:[drafts[index],free].filter(Boolean).join('\n'),source,variant:ids[index]};
}
