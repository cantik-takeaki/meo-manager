import {thanksFor,gratefulPassages} from './review-thanks.js';
import {returnPassages} from './review-passages.js';
import {chooseWording} from './review-variants.js';
// 文の途中を機械的に連結しない。各候補は選択された事実だけを含む完結した文章。
const singles = {
  '感謝を伝えたい':['ありがとうございました。','ありがとうございます。','どうもありがとうございました。'],
  '料理がおいしい': ['料理を美味しくいただきました。','料理が美味しかったです。','料理の味が良かったです。'],
  '提供が早い': ['注文した料理はすぐに出てきました。','注文してから料理が届くまでが早かったです。','料理が出てくるのが早く感じられました。'],
  'スタッフが丁寧': ['スタッフの方が丁寧に対応してくれました。','接客が丁寧でした。','丁寧に接客していただきました。'],
  '雰囲気が良い': ['お店の雰囲気が気に入りました。','店内の雰囲気が良かったです。','店内の雰囲気が好きでした。'],
  '清潔感がある': ['清潔感がありました。','清潔な印象を受けました。','清潔感のある場所でした。'],
  'コスパが良い': ['値段にも満足できました。','コスパの良さを感じました。','値段に対して満足感がありました。'],
  'また来たい': ['また来たいと思います。','また伺いたいです。','また足を運びたいと思います。'],
  'おすすめしたい': ['人にも勧めたいと思いました。','人に勧めたくなりました。','ほかの方にも紹介したくなりました。'],
  '料理が出るまで待った': ['料理が出てくるまで待ちました。','料理が届くまで時間がかかりました。','注文してから料理が出てくるまで時間がかかりました。'],
  '改善してほしい点があった': ['改善してほしい点もありました。','気になる点が残りました。','改善してもらえたらと思うところがありました。'],
  '施術が丁寧': ['施術が丁寧でした。','丁寧に施術していただきました。','丁寧な施術だと感じました。'],
  '力加減がちょうど良い': ['私にはちょうど良い力加減でした。','私に合った力加減でした。','力加減がちょうど良く感じられました。'],
  '力加減が合わなかった': ['私には力加減が合いませんでした。','力加減は自分には合いませんでした。','私にとっては合わない力加減でした。'],
  '体が楽になった': ['施術後は体が楽になりました。','施術を受けた後は体が楽に感じられました。','終わってみると体が楽になっていました。'],
  '説明が分かりやすい': ['説明の内容がよく分かりました。','説明が分かりやすく感じられました。','説明していただいた内容がよく分かりました。'],
  '説明が分かりやすかった': ['説明の内容がよく分かりました。','説明が分かりやすかったです。','説明していただいた内容がよく分かりました。'],
  '説明が足りなかった': ['説明が足りないと感じました。','もう少し説明がほしかったです。','説明がもう少しあると助かります。'],
  '予約が取りやすい': ['予約はスムーズに取れました。','予約が取りやすかったです。','予約しやすいと感じました。'],
  '指導が丁寧': ['丁寧に指導していただきました。','指導が丁寧でした。','丁寧に教えてもらえました。'],
  '自分に合ったメニュー': ['メニューが自分に合っていました。','私に合うメニューでした。','自分に合った内容だと感じました。'],
  '続けやすい': ['続けやすいと感じました。','これなら続けやすいと思いました。','無理なく続けられそうです。'],
  '設備が清潔': ['設備は清潔でした。','設備に清潔感がありました。','設備が綺麗でした。'],
  '変化を感じられた': ['自分でも変化を感じました。','自分の中で変化を感じられました。','変化を実感しました。'],
  'スタッフの対応が良い': ['スタッフの方の対応が好印象でした。','スタッフの方の対応が良かったです。','スタッフの対応が印象に残りました。'],
  '質問する時間があった': ['質問する時間もありました。','質問できる時間がありました。','質問する時間を取ってもらえました。'],
  '受付の流れが分かりやすかった': ['受付の流れが分かりやすかったです。','受付の流れがよく分かりました。','受付の手順を理解しやすかったです。'],
  '予約時間から待った': ['予約の時間を過ぎても待ちました。','予約時間を過ぎてからも待ちました。','予約した時刻を過ぎても待っていました。']
};
const pairs = [
  ['提供が早い','料理がおいしい','注文した料理はすぐに出てきて、美味しくいただきました。','料理が出てくるのが早く、味も良かったです。'],
  ['料理が出るまで待った','料理がおいしい','料理が届くまで待ちましたが、味は良かったです。','料理は美味しかったものの、提供まで時間がかかりました。'],
  ['スタッフが丁寧','雰囲気が良い','スタッフの方の対応が丁寧で、お店の雰囲気も気に入りました。','雰囲気の良いお店で、スタッフの方も丁寧に対応してくれました。'],
  ['清潔感がある','雰囲気が良い','清潔感があり、お店の雰囲気も良かったです。'],
  ['料理がおいしい','コスパが良い','料理が美味しく、値段にも満足できました。'],
  ['料理がおいしい','スタッフが丁寧','料理の美味しさと丁寧な接客が印象に残りました。'],
  ['施術が丁寧','力加減がちょうど良い','丁寧な施術で、力加減もちょうど良かったです。'],
  ['力加減がちょうど良い','体が楽になった','力加減は私にちょうど良く、施術の後は体が楽になりました。'],
  ['施術が丁寧','体が楽になった','丁寧に施術していただき、終わった後は体が楽になりました。'],
  ['施術が丁寧','説明が分かりやすい','説明が分かりやすく、施術も丁寧でした。'],
  ['説明が分かりやすい','力加減が合わなかった','説明は分かりやすかったものの、力加減は私には合いませんでした。'],
  ['指導が丁寧','自分に合ったメニュー','自分に合ったメニューで、丁寧に指導していただきました。'],
  ['説明が分かりやすかった','質問する時間があった','説明が分かりやすく、質問する時間もありました。'],
  ['また来たい','おすすめしたい','また来たいですし、人にも勧めたいと思いました。','人にも勧めたいし、自分でもまた来ようと思います。'],
  ['コスパが良い','おすすめしたい','値段にも満足でき、人にも勧めたいと思いました。'],
  ['料理がおいしい','また来たい','料理が美味しかったので、また食べに来たいです。','料理が美味しくて、また食べに来たくなりました。','料理を美味しくいただきました。また食べに来ようと思います。'],
  ['料理がおいしい','おすすめしたい','料理が美味しく、人にも勧めたいと思いました。'],
  ['施術が丁寧','また来たい','丁寧に施術していただいたので、また伺いたいです。','またこちらで施術を受けたいです。丁寧に施術していただきました。','施術が丁寧で、またお願いしたいと思いました。'],
  ['指導が丁寧','また来たい','丁寧に教えていただいたので、また伺いたいです。','またこちらで指導を受けたいと思えるほど丁寧でした。','指導が丁寧で、またお願いしたいと思いました。'],
  ['説明が分かりやすかった','また来たい','説明が分かりやすく、またこちらに伺いたいと思いました。','説明の内容がよく分かりました。また伺いたいです。','説明が分かりやすかったので、またお願いしたいと思います。'],
  ['雰囲気が良い','また来たい','お店の雰囲気が気に入り、また来たいと思いました。']
];
// 自由記述で別の改善点が書かれている場合は、対象を決めつけない。
const improvementRequests = {
  '料理が出るまで待った':'料理が届くまで待ったので、もう少し早いと助かります。',
  '力加減が合わなかった':'私には力加減が合わず、もう少し調整してもらえたらと思いました。',
  '説明が足りなかった':'もう少し詳しく説明してもらえたらと思いました。'
};
// 食事・利用体験を先に、再訪やおすすめは結びに置く。
const closings = new Set(['また来たい','おすすめしたい','感謝を伝えたい']);
function wording(keys,version,free) {
  const remaining=new Set(keys);
  const lines=[],ending=[];
  const opening=[];
  let request='';
  if(!free && remaining.has('改善してほしい点があった')){
    const negatives=['予約時間から待った',...Object.keys(improvementRequests)].filter(key=>remaining.has(key));
    if(negatives.length===1 && improvementRequests[negatives[0]]){
      const alternatives={
        '料理が出るまで待った':['料理の待ち時間がもう少し短いとありがたいです。','注文から提供までの時間がもう少し短くなると助かります。'],
        '力加減が合わなかった':['私には力加減が合いませんでした。もう少し調整していただけると助かります。','力加減をもう少し自分に合わせてもらえるとありがたいです。'],
        '説明が足りなかった':['説明不足に感じたので、もう少し詳しく聞きたかったです。','もう少し詳しい説明があると助かります。']
      };
      const forms=[improvementRequests[negatives[0]],...alternatives[negatives[0]]];
      request=forms[version%forms.length];
      remaining.delete(negatives[0]);
      remaining.delete('改善してほしい点があった');
    }else if(negatives.includes('予約時間から待った') && negatives.includes('説明が足りなかった')){
      request=['予約の時間を過ぎても待ちました。説明も足りないと感じました。もう少し詳しく説明してもらえると助かります。','予約時間を過ぎても待ち時間がありました。説明ももう少し詳しく聞きたかったです。','予約した時刻を過ぎても待っていました。説明が足りないと感じた点も改善してもらえたらと思います。'][version%3];
      for(const key of ['予約時間から待った','説明が足りなかった','改善してほしい点があった'])remaining.delete(key);
    }
  }
  for(const key of ['予約が取りやすい','受付の流れが分かりやすかった']){
    if(remaining.delete(key))opening.push(singles[key][version%singles[key].length]);
  }
  if(version<2 && opening.length && remaining.has('説明が分かりやすかった') && remaining.has('質問する時間があった')){
    lines.push('説明の内容がよく分かりましたし、質問する時間もありました。');
    remaining.delete('説明が分かりやすかった');
    remaining.delete('質問する時間があった');
  }
  for(const [a,b,...phrases] of pairs){
    if(!remaining.has(a)||!remaining.has(b)||version>=2 && version%3!==0)continue;
    (closings.has(a)||closings.has(b)?ending:lines).push(phrases[(version<2?version:Math.floor(version/3))%phrases.length]);
    remaining.delete(a);remaining.delete(b);
  }
  for(const key of remaining){
    const phrases=singles[key];
    // 本文と結びを独立して組み合わせる。同じ本文でも結びまで固定しない。
    const offset=key==='感謝を伝えたい'?Math.floor(version/3):0;
    (closings.has(key)?ending:lines).push(phrases[(version+offset)%phrases.length]);
  }
  return [...opening,...lines,request,...ending].join('').replaceAll('です。また伺いたいです。','です。また伺いたいと思います。');
}
export async function japaneseParagraph(selected,free,complete,recent,reserve){
  const facts=selected.filter(key=>key!=='感謝を伝えたい' && key!=='また来たい');
  const passages=facts.length===1 && selected.includes('また来たい') && returnPassages(facts[0]);
  if(passages){
    const forms=selected.includes('感謝を伝えたい')?gratefulPassages(facts[0],passages):passages;
    const drafts=[],flows=[];
    forms.forEach((variants,flow)=>{
      for(const prose of variants){drafts.push(prose);flows.push(flow);}
    });
    return chooseWording(drafts,free,complete,recent,reserve,flows);
  }
  const thankTarget=selected.includes('感謝を伝えたい') && facts.find(key=>thanksFor(key));
  if(thankTarget){
    const remaining=selected.filter(key=>key!==thankTarget && key!=='感謝を伝えたい');
    const draftSet=new Set();
    for(const [i,thank] of thanksFor(thankTarget).entries()){
      const rest=wording(remaining,i,free);
      draftSet.add(thank+rest);
      if(rest)draftSet.add(rest+thank);
    }
    return chooseWording([...draftSet],free,complete,recent,reserve);
  }
  const pool=new Set(Array.from({length:9},(_,i)=>wording(selected,i,free)));
  if(facts.length>1){
    // 独立した感想の順番を変える。予約・受付・再訪の位置は wording 側で保つ。
    for(let i=1;i<facts.length;i++){
      const order=[...facts.slice(i),...facts.slice(0,i),...selected.filter(k=>!facts.includes(k))];
      for(let form=0;form<3;form++)pool.add(wording(order,form,free));
    }
  }
  return chooseWording([...pool],free,complete,recent,reserve);
}
