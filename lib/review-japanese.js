import {polishGeneratedSentences} from './review-wording.js';
// 前半は次の節に続く形、後半は文末で使う形。選択した事実だけを組み合わせる。
const expressions = {
  '料理が出るまで待った':['料理が出るまで待ち','料理が出てくるまで待ちました'],
  '説明が足りなかった':['説明が足りず','説明が足りないと感じました'],
  '力加減が合わなかった':['力加減が合わず','私には力加減が合いませんでした'],
  '改善してほしい点があった':['改善してほしい点があり','改善してほしい点がありました'],
  '料理がおいしい':['料理がおいしく','料理がおいしかったです'],
  '提供が早い':['注文した料理が出てくるのが早く','注文した料理が出てくるのも早かったです'],
  '雰囲気が良い':['雰囲気が良く','雰囲気も良かったです'],
  '店内がきれい':['店内がきれいで','店内はきれいでした'],
  '清潔感がある':['清潔感があり','清潔感がありました'],
  'コスパが良い':['値段にも満足できて','値段にも満足できました'],
  'おすすめしたい':['人にもすすめたいと思い','人にもすすめたいと思います'],
  'また来たい':['また来たいと思い','また来たいです'],
  'スタッフが丁寧':['スタッフの方の対応が丁寧で','スタッフの方の対応が丁寧でした'],
  '施術が丁寧':['施術が丁寧で','施術が丁寧でした'],
  '力加減がちょうど良い':['力加減がちょうどよく','力加減がちょうどよかったです'],
  '体が楽になった':['体が楽になり','体が楽になりました'],
  '説明が分かりやすい':['説明が分かりやすく','説明が分かりやすかったです'],
  '説明が分かりやすかった':['説明が分かりやすく','説明が分かりやすかったです'],
  '予約が取りやすい':['予約が取りやすく','予約が取りやすかったです'],
  '指導が丁寧':['指導が丁寧で','指導が丁寧でした'],
  '自分に合ったメニュー':['メニューが自分に合っていて','メニューが自分に合っていました'],
  '続けやすい':['続けやすく','続けやすいと感じました'],
  '設備が清潔':['設備が清潔で','設備が清潔でした'],
  '変化を感じられた':['変化を感じられて','変化を感じました'],
  'スタッフの対応が良い':['スタッフの方の対応が良く','スタッフの方の対応が良かったです'],
  '質問する時間があった':['質問する時間があり','質問する時間がありました'],
  '受付の流れが分かりやすかった':['受付の流れが分かりやすく','受付の流れが分かりやすかったです'],
  '予約時間から待った':['予約時間を過ぎても待つことになり','予約時間を過ぎても待ちました']
};
const related = [
  ['店内がきれい','清潔感がある','雰囲気が良い'],
  ['提供が早い','料理がおいしい','コスパが良い'],
  ['施術が丁寧','力加減がちょうど良い','体が楽になった'],
  ['指導が丁寧','自分に合ったメニュー','続けやすい'],
  ['受付の流れが分かりやすかった','説明が分かりやすかった','質問する時間があった'],
  ['コスパが良い','おすすめしたい','また来たい']
];
function renderGroup(labels) {
  if(labels.join('/')==='提供が早い/料理がおいしい')return '料理はすぐに出てきて美味しくいただきました。';
  if(labels.join('/')==='店内がきれい/雰囲気が良い')return '店内は綺麗で雰囲気も良かったです。';
  if(labels.join('/')==='コスパが良い/おすすめしたい')return 'コスパも良くて人にも勧めたくなるお店でした。';
  if(labels.length===1)return expressions[labels[0]][1].replace('出てくるのも','出てくるのが').replace('雰囲気も','雰囲気が')+'。';
  const first=expressions[labels[0]][0];
  const second=expressions[labels[1]][1];
  const pause=first.length+second.length>28?'、':'';
  return first+pause+second+'。';
}
export async function japaneseParagraph(selected,free,complete,group){
  const keys=new Set(selected);
  let remainder=free;
  const sentences=[];
  for(const theme of related){
    const pair=theme.filter(key=>keys.has(key)).slice(0,2);
    if(pair.length!==2)continue;
    sentences.push(renderGroup(pair));pair.forEach(key=>keys.delete(key));
  }
  for(const key of keys)sentences.push(renderGroup([key]));
  const alternatives=[polishGeneratedSentences(sentences)];
  if(sentences.length>1){
    const last=sentences.at(-1);
    alternatives.push(polishGeneratedSentences([...sentences.slice(0,-1).reverse(),last]));
  }
  const drafts=[...new Set(alternatives)];
  let index=0,source='template';
  try{
    const raw=await complete('日本語の口コミとして、話題の順序と文のつながりが最も自然な完成稿を一つ選んでください。候補番号（0始まり）をJSONのchoices配列に1個だけ返してください。候補：'+JSON.stringify(drafts),{maxTokens:400,temperature:0,reviewChoices:true});
    const {choices}=JSON.parse(raw);
    if(Array.isArray(choices)&&choices.length===1&&Number.isInteger(choices[0])&&drafts[choices[0]]!==undefined){index=choices[0];source='ai';}
  }catch{/* モデル停止時も、同じ事実から組み立てた文章を返す。 */}
  return {content:[drafts[index],remainder].filter(Boolean).join('\n'),source};
}
