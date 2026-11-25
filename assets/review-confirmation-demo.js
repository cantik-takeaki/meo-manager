// 架空の口コミだけを使う案内・操作見本。通信・永続化・公開処理を持たない。
export const REVIEW_CONFIRMATION_GUIDE = `お世話になっております。
今後のGoogle口コミへの返信方法についてご案内いたします。

過去に口コミへの返信内容で行き違いがあったため、公開前に内容をご確認いただく運用にいたします。
お手数をおかけしますがご協力いただけますと幸いです。

口コミが届いた際はお客様の口コミと返信案をお送りします。
内容をご確認のうえ、次のいずれかをお選びください。

【この返信でGoogleに送る】
表示された返信案を承認してGoogleへの返信を進めます。
【文を直す】
返信案をコピーして修正し同じトークにお送りください。
修正後の案を再度ご確認いただいてから公開します。
【あとで】
確認を保留し未公開のまま残します。
【送らない】
今回の返信案を取り下げます。
お客様の口コミ自体はそのまま残ります。

「口コミ原文を見る」で元の口コミをご覧いただけます。
「返信本文をコピー」で返信案をコピーできます。
公開を確認できた際は返信が完了した旨をご連絡いたします。
確認や公開に失敗した場合も状況をご報告いたします。
ご返答がない場合は公開せずに保留します。

架空の口コミを使った操作デモで手順をお試しください。
デモのボタンを押してもGoogleには公開されません。`;
export const REVIEW_EMAIL_GUIDE = `お世話になっております。
今後のGoogle口コミへの返信方法についてご案内いたします。

過去に口コミへの返信内容で行き違いがあったため、公開前に内容をご確認いただく運用にいたします。
お手数をおかけしますがご協力いただけますと幸いです。

口コミが届いた際はお客様の口コミと返信案をメールでお送りします。
文面に問題がなければ「この文面で返信してよい」をお選びください。
修正をご希望の場合は「修正内容を伝える」から変更内容をお送りください。
ボタンはメールの返信画面を開きます。
押しただけでは送信やGoogleへの公開は行われません。
確認番号を残したままメールをご返信ください。

返信内容と対象の口コミを照合してから対応します。
文面を変更した場合は修正後の案を改めてご確認いただきます。
公開を確認できた際は返信が完了した旨をご連絡いたします。
ご返答がない場合は公開せずに保留します。

今回のデモは架空の口コミを使用しています。
デモは操作確認専用です。`;
export const DEMO_REVIEW = Object.freeze({
 store:'操作デモ用の店舗',name:'デモのお客様',rating:5,
 original:'料理がおいしかったです。スタッフの方も丁寧でした。また伺います。',
 reply:'ご来店いただきありがとうございます。\n\nお料理を楽しんでいただけて嬉しく思います。\nスタッフへの温かいお言葉もありがとうございます。\nまたのご来店を心よりお待ちしております。\n\nこの度は誠にありがとうございました。\n-操作デモ用の店舗-'
});
export function createReviewDemo(){return {demo:true,status:'pending',editing:false,revision:1,reply:DEMO_REVIEW.reply,history:[],googlePublished:false};}
export function reviewDemoAction(state,action,{text='',revision=state.revision}={}){
 if(state?.demo!==true)throw new Error('架空の操作デモだけを指定してください。');
 const next={...state,history:[...state.history],googlePublished:false};
 let message='';
 if(action==='original')message='【架空の口コミ原文】\n'+DEMO_REVIEW.original;
 else if(action==='copy')message=state.reply;
 else if(revision!==state.revision)message='返信案が更新されています。最新の案をご確認ください。';
 else if(['approved-demo','rejected'].includes(state.status))message='このデモは対応済みです。やり直す場合はデモを最初に戻してください。';
 else if(action==='edit'){next.editing=true;message='返信案をコピーして修正し、下の入力欄から送ってください。\n修正するだけでは承認されません。';}
 else if(action==='save'){
  if(!state.editing)message='先に「文を直す」を選んでください。';
  else if(!text.trim()||text.length>4000)message='返信文を1〜4000字で入力してください。';
  else{next.reply=text.trim();next.revision++;next.editing=false;next.status='pending';message='修正した返信案に差し替えました。\n最新の案を確認してから承認してください。\nデモのためGoogleには公開されません。';}
 }
 else if(action==='later'){next.status='deferred';next.editing=false;message='確認を保留しました。\nGoogleには返信していません。';}
 else if(action==='ng'){next.status='rejected';next.editing=false;message='今回の返信案は送らない設定にしました。\nお客様の口コミは削除されません。';}
 else if(action==='ok'){
  if(state.editing)message='修正文を確定してから最新の案をご確認ください。';
  else{next.status='approved-demo';message='デモの承認を受け付けました。\nGoogleへの送信は行っていません。\n本番では公開を確認してから完了をご連絡します。';}
 }
 else message='操作を確認できませんでした。';
 next.history.push({action,message,revision:next.revision});return {state:next,message};
}
const node=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
export function mountReviewConfirmationDemo(host){
 let state=createReviewDemo();const wrapper=node('section');wrapper.className='ps-review-demo';
 const title=node('h3','口コミ確認の操作デモ'),note=node('p','架空の店舗と口コミです。通信・送信・公開は行いません。');
 const guide=node('details'),summary=node('summary','先方への案内文を確認'),guideText=node('pre',REVIEW_CONFIRMATION_GUIDE);guideText.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';guide.append(summary,guideText);
 const email=node('details'),emailText=node('pre',REVIEW_EMAIL_GUIDE);emailText.style.cssText=guideText.style.cssText;email.append(node('summary','メールでの案内文を確認'),emailText);
 const card=node('article');card.className='ps-brief-variant';card.style.cssText='max-width:430px;margin:12px auto;border-top:6px solid #0f4aa2';
 card.append(node('h3','口コミの確認をお願いします'),node('p',DEMO_REVIEW.store+'／評価5／'+DEMO_REVIEW.name),node('h4','お客様の口コミ（架空）'),node('p',DEMO_REVIEW.original),node('h4','返信案（未公開）'));
 const reply=node('p');reply.style.whiteSpace='pre-wrap';const buttons=node('div');buttons.className='ps-demo-buttons';buttons.style.cssText='display:grid;gap:8px';
 const result=node('p');result.setAttribute('role','status');result.style.whiteSpace='pre-wrap';result.style.cssText+=';padding:12px;background:#eaf1fa;color:#0a2e5c';
 const editor=node('textarea');editor.rows=9;editor.setAttribute('aria-label','デモの修正後の返信案');const save=node('button','修正案を確認する');
 const draw=()=>{reply.textContent=state.reply;editor.hidden=!state.editing;save.hidden=!state.editing;};
 const act=(a,args)=>{const r=reviewDemoAction(state,a,args);state=r.state;result.textContent=r.message;if(a==='edit')editor.value=state.reply;draw();};
 for(const [a,label] of [['ok','この返信でGoogleに送る'],['edit','文を直す'],['later','あとで'],['ng','送らない'],['original','口コミ原文を見る'],['copy','返信本文をコピー']]){
  const button=node('button',label);if(a==='ok')button.style.cssText='background:#0f4aa2;color:white';button.type='button';button.onclick=async()=>{act(a);if(a==='copy')try{await navigator.clipboard.writeText(state.reply);result.textContent='返信文をコピーしました。署名前の空行も残しています。';}catch{result.textContent='コピーできませんでした。表示された返信案からコピーしてください。';}};buttons.append(button);
 }
 save.type='button';save.onclick=()=>act('save',{text:editor.value});const reset=node('button','デモを最初に戻す');reset.type='button';reset.onclick=()=>{state=createReviewDemo();result.textContent='デモを最初に戻しました。';draw();};
 card.append(reply,buttons,editor,save,result);wrapper.append(title,note,guide,email,card,reset);host.append(wrapper);draw();return wrapper;
}
