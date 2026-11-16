import {chooseWording} from './review-variants.js';
import labels from './review-business-choices.js';
const forms={
 ja:[['説明が分かりやすかったです。','分かりやすく説明していただきました。','説明の内容を理解しやすかったです。'],['丁寧に対応していただきました。','対応が丁寧でした。','丁寧な対応が印象に残っています。'],['相談しやすかったです。','気軽に相談できました。','相談しやすいと感じました。'],['連絡がスムーズでした。','スムーズに連絡を取れました。','連絡のやり取りが円滑でした。'],['提案が具体的でした。','具体的な提案をいただきました。','提案の内容が具体的だと感じました。'],['仕上がりに満足しています。','満足のいく仕上がりでした。','仕上がりが気に入りました。'],['ありがとうございました。','お世話になりました。','ありがとうございます。']],
 en:[['The explanations were clear.','I found the explanations easy to understand.'],['The support was courteous.','I was treated courteously.'],['It was easy to ask for advice.','I felt comfortable asking for advice.'],['Communication went smoothly.','We communicated smoothly.'],['The proposals were specific.','I received specific proposals.'],['I am satisfied with the result.','The finished result met my expectations.'],['Thank you.','I appreciate your help.']],
 zh:[['说明很清楚。','我觉得说明容易理解。'],['服务很周到。','工作人员的接待很有礼貌。'],['咨询起来很方便。','我觉得很容易沟通咨询。'],['联系很顺畅。','沟通联系进行得很顺利。'],['建议很具体。','收到了具体的建议。'],['我对成果很满意。','完成后的效果让我满意。'],['谢谢。','感谢你们。']],
 ko:[['설명이 이해하기 쉬웠습니다.','설명을 쉽게 이해할 수 있었습니다.'],['정중하게 응대해 주셨습니다.','응대가 정중했습니다.'],['상담하기 편했습니다.','편하게 상담할 수 있었습니다.'],['연락이 원활했습니다.','원활하게 연락을 주고받았습니다.'],['제안이 구체적이었습니다.','구체적인 제안을 받았습니다.'],['결과에 만족합니다.','완성된 결과가 마음에 들었습니다.'],['감사합니다.','고맙습니다.']]
};
export function businessReview(selected,free,language,complete,recent,reserve){
 const indexes=selected.map(label=>labels[language].indexOf(label));
 const pool=[];
 for(let v=0;v<9;v++){
  const order=v%2?[...indexes].reverse():indexes;
  const text=order.map((i,j)=>forms[language][i][(v+j)%forms[language][i].length]).join(language==='ja'||language==='zh'?'':' ');
  if(!pool.includes(text))pool.push(text);
 }
 return chooseWording(pool,free,complete,recent,reserve);
}
