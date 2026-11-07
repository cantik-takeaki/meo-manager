// 各訳は日本語の選択項目と同じ事実だけを表す。
const alternative={
  '料理がおいしい':['I enjoyed the food','我很喜欢菜的味道','음식을 맛있게 먹었어요'],
  'スタッフが丁寧':['The staff treated me courteously','工作人员待人很有礼貌','직원분들이 정중하게 응대해 주셨어요'],
  '雰囲気が良い':['I enjoyed the atmosphere here','店里的氛围让我很喜欢','가게 분위기가 마음에 들었어요'],
  '清潔感がある':['The place felt clean','这里很整洁','깨끗한 인상을 받았어요'],
  '提供が早い':['My food arrived quickly','上菜速度很快','주문한 음식이 금방 나왔어요'],
  'コスパが良い':['I was happy with the value for money','我觉得物有所值','가격 대비 만족했어요'],
  'おすすめしたい':['I would recommend this place to others','我愿意向别人推荐这里','다른 분들께도 추천하고 싶어요'],
  '施術が丁寧':['I was treated with care','手法很细致','세심하게 관리해 주셨어요'],
  '力加減がちょうど良い':['The pressure was just right for me','这个力度正适合我','강도가 저에게 딱 맞았어요'],
  '体が楽になった':['I felt more comfortable after the treatment','做完以后身体轻松了些','관리를 받은 뒤 몸이 한결 편해졌어요'],
  '説明が分かりやすい':['I found the explanation easy to follow','说明很容易理解','설명을 쉽게 이해할 수 있었어요'],
  '説明が分かりやすかった':['I could follow the explanation easily','说明很容易理解','설명 내용이 이해하기 쉬웠어요'],
  '予約が取りやすい':['Booking was straightforward','预约起来很方便','예약을 쉽게 할 수 있었어요'],
  '指導が丁寧':['The coaching was attentive','指导很用心','꼼꼼하게 지도해 주셨어요'],
  '自分に合ったメニュー':['The program was a good fit for me','课程内容很适合我','프로그램이 저한테 잘 맞았어요'],
  '続けやすい':['It felt manageable to keep going','我觉得比较容易坚持下去','꾸준히 하기 좋겠다고 느꼈어요'],
  '設備が清潔':['The equipment was clean','设施给人的感觉很干净','시설이 청결했어요'],
  '変化を感じられた':['I could feel a change','我能感觉到变化','변화가 느껴졌어요'],
  'スタッフの対応が良い':['I liked the way the staff treated me','我对工作人员的服务很满意','직원분들의 응대가 좋았어요'],
  '質問する時間があった':['I had time to ask questions','留出了提问的时间','질문할 시간이 있었어요'],
  '受付の流れが分かりやすかった':['It was easy to follow the check-in process','接待流程很好懂','접수 절차를 쉽게 이해할 수 있었어요'],
  '予約時間から待った':['I was still waiting after my appointment time','过了预约时间我还在等候','예약 시간을 넘겨서도 기다렸어요'],
  '料理が出るまで待った':['It took a while for my food to arrive','我等了一会儿菜才上来','음식이 나오기까지 시간이 걸렸어요'],
  '改善してほしい点があった':['There were things I would like to see improved','有些地方我希望能改进','조금 개선되었으면 하는 점이 있었어요'],
  '力加減が合わなかった':['The pressure did not feel right for me','这个力度不太适合我','강도가 제게 잘 맞지 않았어요'],
  '説明が足りなかった':['I would have liked a fuller explanation','我希望说明能更详细些','설명이 좀 더 자세했으면 좋겠어요'],
  '感謝を伝えたい':['Thank you','谢谢','감사합니다'],
  'また来たい':['I would like to visit again','我还想再来','다시 방문하고 싶어요']
};
const closing={
 '感謝を伝えたい':[['I appreciate it','很感谢你们','고맙습니다'],['Many thanks','对你们表示感谢','감사한 마음을 전합니다']],
 'また来たい':[['I would like to come back','希望下次还能再来','또 오고 싶습니다'],['I hope to visit again','我愿意再来这里','다음에도 방문하고 싶어요']]
};
export function internationalVariants(key,language,original,label){
 const i=['en','zh','ko'].indexOf(language);
 if(closing[key])return [alternative[key][i],...closing[key].map(form=>form[i])];
 return [...new Set([original||label,alternative[key][i]])];
}
