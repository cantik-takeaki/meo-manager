'use strict';
const I18N={
 ja:{language:'言語',thanksVisit:'ご来店ありがとうございました。',stepRating:'評価',stepComment:'感想',stepConfirm:'確認',yourVoice:'お客様の声をお聞かせください',ratingTitle:'本日の満足度はいかがでしたか？',ratingIntro:'感じたままの評価を選んでください。',lowRating:'不満',highRating:'満足',chooseStar:'星を1つ選んでください',nextComment:'感想の入力へ進む',noAutoPost:'この画面の操作だけでGoogleに投稿されることはありません。',backRating:'評価を選び直す',commentTitle:'印象に残ったことを教えてください',commentIntro:'当てはまる項目を選べます。複数選択もできます。',freeLabel:'ご感想（任意）',freePlaceholder:'実際に体験したことをご自由にお書きください。',makeDraft:'内容をもとに下書きを作る',editLater:'作成後に文章を確認・修正できます。',backComment:'感想の入力に戻る',confirmTitle:'投稿する文章をご確認ください',confirmIntro:'実際のご体験と合っているかお確かめください。文章は自由に修正できます。',draftLabel:'口コミの下書き',consent:'自分の体験と合っていることを確認しました。',copy:'文章をコピーして次へ',regenerate:'下書きを作り直す',voluntary:'投稿は任意です。最後の投稿操作はご本人がGoogle上で行います。',lastStep:'あと1つの操作です',googleTitle:'Googleで文章を貼り付けて投稿',copied:'文章をコピーしました。',googleHow1:'下のボタンでGoogleの画面を開きます。',googleHow2:'評価を選び、文章を貼り付けます。',googleHow3:'内容を確認して「投稿」を押します。',openGoogle:'Googleの口コミ投稿画面を開く',googleAccount:'Googleアカウントへのログインが必要な場合があります。',backDraft:'文章を確認・修正する',feedbackTitle:'詳しいご感想をお聞かせください',feedbackIntro:'こちらのご意見は店舗に届きます。Googleには公開されません。',feedbackLabel:'お気づきの点・ご感想',contactLabel:'返信を希望される方のご連絡先（任意）',sendFeedback:'店舗へ感想を送る',doneTitle:'ご感想をありがとうございました',doneText:'いただいたお声を店舗で確認します。',stopped:'ただいま受付を停止しています',stoppedText:'お手数ですが店舗スタッフにお知らせください。',loading:'下書きを作っています。',loadError:'設定を読み込めませんでした。通信を確認してページを開き直してください。',generateError:'下書きを作成できませんでした。入力内容は残っています。時間をおいてもう一度お試しください。',sendError:'送信できませんでした。入力内容は残っています。通信を確認してもう一度お試しください。',copyError:'コピーできませんでした。文章を選択して手動でコピーしてください。',missingGoogle:'Googleの投稿先を確認中です。店舗スタッフにお知らせください。',preview:'確認用です。回答・口コミは送信されません。',previewDraft:'確認用のため、選んだ言葉と入力文をそのまま表示しています。',previewGoogle:'確認用ではGoogleの画面を開きません。公開版ではこのボタンで投稿画面を開きます。',previewDone:'送信操作の確認ができました。回答は保存・送信していません。',ratings:['不満','やや不満','普通','満足','とても満足'],points:['スタッフが丁寧','雰囲気が良い','また来たい','説明が分かりやすい','清潔感がある','対応が早い','コスパが良い','おすすめしたい']},
 en:{language:'Language',thanksVisit:'Thank you for visiting.',stepRating:'Rating',stepComment:'Comments',stepConfirm:'Review',yourVoice:'We would love to hear from you',ratingTitle:'How was your experience today?',ratingIntro:'Please choose the rating that reflects your experience.',lowRating:'Dissatisfied',highRating:'Satisfied',chooseStar:'Choose a star rating',nextComment:'Continue to comments',noAutoPost:'Nothing is posted to Google automatically.',backRating:'Change my rating',commentTitle:'What stood out during your visit?',commentIntro:'Select any that apply. You can choose more than one.',freeLabel:'Your comments (optional)',freePlaceholder:'Tell us about your own experience.',makeDraft:'Create a draft from my comments',editLater:'You can review and edit the draft before posting.',backComment:'Back to comments',confirmTitle:'Please review your draft',confirmIntro:'Make sure it reflects your experience. You can edit any part of it.',draftLabel:'Review draft',consent:'I have checked that this reflects my experience.',copy:'Copy the text and continue',regenerate:'Create another draft',voluntary:'Posting is optional. You will submit the review yourself on Google.',lastStep:'One more step',googleTitle:'Paste your review on Google',copied:'Your text has been copied.',googleHow1:'Open Google using the button below.',googleHow2:'Choose a rating and paste your text.',googleHow3:'Check your review, then select “Post”.',openGoogle:'Open Google to post my review',googleAccount:'You may need to sign in to your Google account.',backDraft:'Review or edit my text',feedbackTitle:'Tell us more about your experience',feedbackIntro:'Your feedback will go to the store. It will not be published on Google.',feedbackLabel:'Your feedback',contactLabel:'Contact details if you would like a reply (optional)',sendFeedback:'Send feedback to the store',doneTitle:'Thank you for your feedback',doneText:'The store will read your comments.',stopped:'Feedback is currently unavailable',stoppedText:'Please ask a member of staff for assistance.',loading:'Creating your draft…',loadError:'Settings could not be loaded. Check your connection and reload the page.',generateError:'We could not create a draft. Your comments are still here. Please try again later.',sendError:'Your feedback was not sent. Your comments are still here. Check your connection and try again.',copyError:'The text could not be copied. Please select it and copy it manually.',missingGoogle:'The Google review link is not available. Please ask a member of staff.',preview:'Preview only. No feedback or reviews will be sent.',previewDraft:'This preview shows only your selected words and the text you entered.',previewGoogle:'This preview does not open Google. The published page will open the review form.',previewDone:'The send action has been tested. Nothing was saved or sent.',ratings:['Dissatisfied','Somewhat dissatisfied','Neutral','Satisfied','Very satisfied'],points:['Helpful staff','Nice atmosphere','Would visit again','Clear explanations','Clean surroundings','Prompt service','Good value','Would recommend']},
 zh:{language:'语言',thanksVisit:'感谢您的光临。',stepRating:'评分',stepComment:'感想',stepConfirm:'确认',yourVoice:'欢迎分享您的感受',ratingTitle:'您对今天的体验满意吗？',ratingIntro:'请选择符合您真实感受的评分。',lowRating:'不满意',highRating:'满意',chooseStar:'请选择星级',nextComment:'下一步：填写感想',noAutoPost:'在此页面操作不会自动发布到Google。',backRating:'重新选择评分',commentTitle:'什么给您留下了印象？',commentIntro:'请选择符合实际体验的项目，可以多选。',freeLabel:'您的感想（选填）',freePlaceholder:'请自由分享您的真实体验。',makeDraft:'根据内容生成草稿',editLater:'生成后可以确认和修改文字。',backComment:'返回填写感想',confirmTitle:'请确认您准备发布的内容',confirmIntro:'请核对内容是否符合您的真实体验，文字可以自由修改。',draftLabel:'评价草稿',consent:'我已确认内容符合我的真实体验。',copy:'复制文字并继续',regenerate:'重新生成草稿',voluntary:'发布评价完全自愿，最终由您本人在Google上发布。',lastStep:'还差最后一步',googleTitle:'在Google粘贴文字并发布',copied:'文字已复制。',googleHow1:'点击下方按钮打开Google。',googleHow2:'选择评分并粘贴文字。',googleHow3:'确认内容后点击“发布”。',openGoogle:'打开Google评价页面',googleAccount:'您可能需要登录Google账号。',backDraft:'确认或修改文字',feedbackTitle:'请详细告诉我们您的感受',feedbackIntro:'这份意见将发送给店铺，不会在Google公开。',feedbackLabel:'您的意见或感想',contactLabel:'如需回复，请留下联系方式（选填）',sendFeedback:'向店铺发送反馈',doneTitle:'感谢您的反馈',doneText:'店铺将认真阅读您的意见。',stopped:'目前暂停接收反馈',stoppedText:'请向店内工作人员咨询。',loading:'正在生成草稿……',loadError:'无法加载设置，请检查网络后重新打开页面。',generateError:'未能生成草稿，您填写的内容已保留，请稍后重试。',sendError:'发送失败，您填写的内容已保留，请检查网络后重试。',copyError:'未能复制文字，请选择文字后手动复制。',missingGoogle:'暂时无法打开Google评价页面，请咨询店内工作人员。',preview:'预览页面，不会发送反馈或发布评价。',previewDraft:'预览仅显示您选择的词语和填写的文字。',previewGoogle:'预览不会打开Google，正式页面可通过此按钮打开评价页面。',previewDone:'发送操作已测试，未保存或发送任何内容。',ratings:['不满意','不太满意','一般','满意','非常满意'],points:['服务周到','氛围很好','愿意再次光临','说明清楚','环境整洁','响应及时','性价比好','愿意推荐']},
 ko:{language:'언어',thanksVisit:'방문해 주셔서 감사합니다.',stepRating:'평가',stepComment:'소감',stepConfirm:'확인',yourVoice:'방문 소감을 들려주세요',ratingTitle:'오늘의 경험은 만족스러우셨나요?',ratingIntro:'실제로 느끼신 평가를 선택해 주세요.',lowRating:'불만족',highRating:'만족',chooseStar:'별점을 선택해 주세요',nextComment:'소감 입력으로 이동',noAutoPost:'이 화면의 조작만으로 Google에 자동 게시되지 않습니다.',backRating:'평가 다시 선택하기',commentTitle:'어떤 점이 인상적이었나요?',commentIntro:'해당하는 항목을 선택해 주세요. 여러 개 선택할 수 있습니다.',freeLabel:'방문 소감 (선택)',freePlaceholder:'직접 경험하신 내용을 자유롭게 적어 주세요.',makeDraft:'입력한 내용으로 초안 만들기',editLater:'초안을 확인하고 수정한 후 게시할 수 있습니다.',backComment:'소감 입력으로 돌아가기',confirmTitle:'게시할 글을 확인해 주세요',confirmIntro:'실제 경험과 일치하는지 확인해 주세요. 글은 자유롭게 수정할 수 있습니다.',draftLabel:'리뷰 초안',consent:'제 경험과 일치하는 내용임을 확인했습니다.',copy:'글을 복사하고 다음으로',regenerate:'초안 다시 만들기',voluntary:'리뷰 작성은 선택입니다. 마지막 게시 작업은 본인이 Google에서 진행합니다.',lastStep:'마지막 단계입니다',googleTitle:'Google에서 글을 붙여넣고 게시',copied:'글을 복사했습니다.',googleHow1:'아래 버튼으로 Google을 엽니다.',googleHow2:'별점을 선택하고 글을 붙여넣습니다.',googleHow3:'내용을 확인한 후 ‘게시’를 누릅니다.',openGoogle:'Google 리뷰 작성 화면 열기',googleAccount:'Google 계정 로그인이 필요할 수 있습니다.',backDraft:'글 확인 및 수정',feedbackTitle:'자세한 소감을 들려주세요',feedbackIntro:'입력하신 의견은 매장으로 전달되며 Google에는 공개되지 않습니다.',feedbackLabel:'의견 및 소감',contactLabel:'답변을 원하시면 연락처를 남겨 주세요 (선택)',sendFeedback:'매장에 소감 보내기',doneTitle:'소감을 남겨 주셔서 감사합니다',doneText:'매장에서 보내주신 의견을 확인하겠습니다.',stopped:'현재 의견 접수를 중단했습니다',stoppedText:'매장 직원에게 문의해 주세요.',loading:'초안을 만드는 중입니다…',loadError:'설정을 불러오지 못했습니다. 연결을 확인하고 페이지를 다시 열어 주세요.',generateError:'초안을 만들지 못했습니다. 입력 내용은 유지됩니다. 잠시 후 다시 시도해 주세요.',sendError:'전송하지 못했습니다. 입력 내용은 유지됩니다. 연결을 확인하고 다시 시도해 주세요.',copyError:'글을 복사하지 못했습니다. 글을 선택해 직접 복사해 주세요.',missingGoogle:'Google 리뷰 링크를 확인 중입니다. 매장 직원에게 문의해 주세요.',preview:'미리보기입니다. 의견이나 리뷰는 전송되지 않습니다.',previewDraft:'미리보기에는 선택한 단어와 입력한 글만 표시됩니다.',previewGoogle:'미리보기에서는 Google을 열지 않습니다. 공개 페이지에서는 이 버튼으로 리뷰 화면을 엽니다.',previewDone:'전송 작업을 확인했습니다. 내용을 저장하거나 전송하지 않았습니다.',ratings:['불만족','조금 불만족','보통','만족','매우 만족'],points:['친절한 직원','좋은 분위기','다시 방문하고 싶음','알기 쉬운 설명','청결한 환경','빠른 응대','좋은 가성비','추천하고 싶음']}
};
const EXTRA_I18N={"ja": {"privateFeedback": "お店にだけ感想を伝える", "openLine": "LINEでお店を見る", "leadTitle": "次回使えるお知らせ", "leadMessage": "お得な情報やクーポンをご希望の方は、メールをご登録ください（任意）。", "leadEmail": "メールアドレス（任意）", "leadSubmit": "登録する", "leadBusy": "登録中です。", "leadDone": "ご登録ありがとうございます。", "leadError": "登録できませんでした。通信を確認してもう一度お試しください。", "leadPreview": "確認用のため、メールは登録していません。"}, "en": {"privateFeedback": "Send private feedback to the store", "openLine": "Find the store on LINE", "leadTitle": "Updates for your next visit", "leadMessage": "You can optionally register your email to receive offers and coupons.", "leadEmail": "Email address (optional)", "leadSubmit": "Register", "leadBusy": "Registering…", "leadDone": "Thank you for registering.", "leadError": "Registration failed. Check your connection and try again.", "leadPreview": "Preview only. Your email has not been registered."}, "zh": {"privateFeedback": "仅向店铺发送意见", "openLine": "在LINE查看店铺", "leadTitle": "下次到店可用的优惠信息", "leadMessage": "如需接收优惠信息和优惠券，可自愿登记电子邮箱。", "leadEmail": "电子邮箱（选填）", "leadSubmit": "登记", "leadBusy": "正在登记……", "leadDone": "感谢您的登记。", "leadError": "登记失败，请检查网络后重试。", "leadPreview": "预览页面，未登记您的邮箱。"}, "ko": {"privateFeedback": "매장에만 의견 전달하기", "openLine": "LINE에서 매장 보기", "leadTitle": "다음 방문을 위한 소식", "leadMessage": "혜택과 쿠폰 소식을 원하시면 이메일을 등록해 주세요. 등록은 선택입니다.", "leadEmail": "이메일 주소 (선택)", "leadSubmit": "등록하기", "leadBusy": "등록 중입니다…", "leadDone": "등록해 주셔서 감사합니다.", "leadError": "등록하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.", "leadPreview": "미리보기입니다. 이메일은 등록되지 않았습니다."}};
Object.keys(EXTRA_I18N).forEach(k=>Object.assign(I18N[k],EXTRA_I18N[k]));
const $=id=>document.getElementById(id),params=new URLSearchParams(location.search);
const PREVIEW=params.get('preview')==='1'||['localhost','127.0.0.1',''].includes(location.hostname);
let STORE_ID=params.get('store')||'';
let lang='ja',store=null,survey=null,rating=0,stage='rating',ready=false,busy=false;
let selected=new Set(),surveyTracked=false,leadBusy=false,leadRegistered=false;
const stages=['rating','comment','confirm','google','feedback','done','stopped'];
const text=key=>I18N[lang][key]??I18N.ja[key]??key;
function status(key){$('status').textContent=key?text(key):'';}
function safeUrl(value,kind='google'){
 try{const u=new URL(value);const ok=kind==='google'?['google.com','www.google.com','search.google.com','maps.google.com','maps.app.goo.gl'].includes(u.hostname):['line.me','lin.ee'].includes(u.hostname);return u.protocol==='https:'&&ok?u.href:'';}catch{return '';}
}
function track(event,extra={}){if(PREVIEW||!ready)return;fetch('/api/admin?action=kpi-track',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:STORE_ID,event,...extra})}).catch(()=>{});}
function show(next,focus=true){
 stage=next;for(const s of stages)$(s+'Stage').hidden=s!==next;
 const index={rating:0,comment:1,feedback:1,confirm:2,google:2,done:2,stopped:-1}[next];
 document.querySelector('.progress').hidden=index<0;
 [0,1,2].forEach(i=>{const e=$('progress'+i);if(i===index)e.setAttribute('aria-current','step');else e.removeAttribute('aria-current');});
 status('');renderExtras();if(focus){$('main').focus({preventScroll:true});$('main').scrollIntoView({block:'start'});}
}
function applyLanguage(){
 document.documentElement.lang=lang;document.body.dataset.lang=lang;document.title=(store?.displayName?store.displayName+' | ':'')+text('yourVoice');
 document.querySelectorAll('[data-i18n]').forEach(e=>e.textContent=text(e.dataset.i18n));
 document.querySelectorAll('[data-placeholder]').forEach(e=>e.placeholder=text(e.dataset.placeholder));
 $('previewNotice').textContent=text('preview');$('language').value=lang;$('language').setAttribute('aria-label',text('language'));document.querySelector('.progress').setAttribute('aria-label',{ja:'回答の手順',en:'Review steps',zh:'评价步骤',ko:'리뷰 작성 단계'}[lang]);if(PREVIEW)document.querySelector('[data-i18n=doneText]').textContent=text('previewDone');
 renderStars();renderPoints();status('');renderExtras();
 if(store){$('area').textContent=store.areaI18n?.[lang]||store.area;const labels={en:{food:'Food & dining',chinese:'Chinese cuisine',japanese:'Thank you for your visit',flower:'Flower café',spa:'Relaxation salon','spa-dark':'Relaxation salon',airy:'Relaxation salon',fitness:'Personal training',red:'Chinese cuisine'},zh:{food:'餐饮',chinese:'中华料理',japanese:'感谢光临',flower:'花卉咖啡馆',spa:'休闲护理','spa-dark':'休闲护理',airy:'休闲护理',fitness:'私人健身训练',red:'中华料理'},ko:{food:'음식점',chinese:'중화요리',japanese:'방문해 주셔서 감사합니다',flower:'플라워 카페',spa:'릴랙세이션 살롱','spa-dark':'릴랙세이션 살롱',airy:'릴랙세이션 살롱',fitness:'퍼스널 트레이닝',red:'중화요리'}};$('genre').textContent=lang==='ja'?store.genre:labels[lang][store.family];}
}
function renderStars(){
 $('stars').replaceChildren();
 for(let i=1;i<=5;i++){const b=document.createElement('button');b.type='button';b.className='star'+(i<=rating?' selected':'');b.setAttribute('aria-label',i+' / 5 — '+text('ratings')[i-1]);b.setAttribute('aria-pressed',String(i===rating));b.textContent='★';b.addEventListener('click',()=>{rating=i;renderStars();});$('stars').append(b);}
 $('ratingLabel').textContent=rating?rating+' / 5 — '+text('ratings')[rating-1]:text('chooseStar');$('ratingNext').disabled=!rating||!ready;
}
function pointLabels(){
 // Current store settings remain the source of truth. Translate the known common labels.
 const original=survey?.goodPoints?.length?survey.goodPoints:I18N.ja.points;
 return original.map(label=>{const i=I18N.ja.points.indexOf(label);return {key:label,label:i>=0?text('points')[i]:label};});
}
function renderPoints(){
 $('points').replaceChildren();for(const p of pointLabels()){const b=document.createElement('button');b.type='button';b.className='point';b.textContent=p.label;b.setAttribute('aria-pressed',String(selected.has(p.key)));b.addEventListener('click',()=>{selected.has(p.key)?selected.delete(p.key):selected.add(p.key);b.setAttribute('aria-pressed',String(selected.has(p.key)));updateGenerate();});$('points').append(b);}updateGenerate();
}
function updateGenerate(){$('generate').disabled=busy||(!selected.size&&!$('freeWord').value.trim());}
async function generate(){
 if(busy||!ready)return;busy=true;updateGenerate();$('regenerate').disabled=true;status('loading');
 const chosen=pointLabels().filter(p=>selected.has(p.key)).map(p=>p.label),free=$('freeWord').value.trim();
 try{
  let draft;
  if(PREVIEW){draft=[...chosen,free].filter(Boolean).join(lang==='ja'?'。\n':'\n');}
  else{
   const r=await fetch('/api/generate-content',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({locationId:STORE_ID,type:'review_draft',words:[...chosen,free].filter(Boolean),language:lang,qrToken:params.get('t')||''})});
   if(!r.ok)throw new Error('response');const d=await r.json();draft=d.text||d.content||d.draft||d.result;if(typeof draft!=='string'||!draft.trim())throw new Error('empty');
  }
  $('draft').value=draft;$('consent').checked=false;$('copy').disabled=true;show('confirm');if(PREVIEW)status('previewDraft');if(!surveyTracked){track('survey');surveyTracked=true;}track('ai');
 }catch{status('generateError');}finally{busy=false;updateGenerate();$('regenerate').disabled=false;}
}
async function init(){
 try{
  const all=window.REVIEW_STORES;if(!all)throw new Error('themes');store=all[STORE_ID]||Object.values(all).find(t=>t.slug===params.get('shop'));
  if(!store){location.replace('review-legacy.html'+location.search+location.hash);return;}STORE_ID=store.id;
  document.body.dataset.slug=store.slug;document.body.dataset.family=store.family;
  const v=document.documentElement.style;v.setProperty('--brand',store.brand);v.setProperty('--gold',store.gold);v.setProperty('--ground',store.paper);v.setProperty('--hero-ground',store.groundColor);v.setProperty('--hero-ink',store.brand);v.setProperty('--display',store.serif?'var(--serif)':'var(--sans)');
  $('headerName').textContent=store.displayName;$('storeName').textContent=store.displayName;$('area').textContent=store.area;$('footerName').textContent=store.name;$('storePhoto').src=store.photo;$('storePhoto').alt=store.displayName;window.applyHPTheme?.(store);
  survey={...store.survey};
  if(!PREVIEW){const response=await fetch('/api/admin?action=survey-public&storeId='+encodeURIComponent(STORE_ID),{cache:'no-store'});if(!response.ok)throw new Error('survey');survey=await response.json();if(survey.error)throw new Error('survey');if(survey.qrToken&&params.get('t')!==survey.qrToken){show('stopped',false);return;}}
  // Spring/Winter's existing QR has its review destination in g; retain that fallback.
  const google=safeUrl(survey.googleUrl)||safeUrl(params.get('g'))||(PREVIEW?safeUrl(store.survey.googleUrl):'');
  $('googleLink').href=google||'#';$('googleLink').dataset.ready=String(!!google);
  ready=true;applyLanguage();renderExtras();if(survey.qrEnabled===false){ready=false;show('stopped',false);}else track('scan');
 }catch{ready=false;show('stopped',false);status('loadError');}
}
function renderExtras(){
 if(!$('extraActions'))return;
 const active=ready&&['comment','google','done'].includes(stage),line=active?safeUrl(survey?.lineUrl,'line'):'';
 $('lineLink').hidden=!line;if(line)$('lineLink').href=line;
 const lead=active&&['google','done'].includes(stage)&&survey?.askEmail!==false;
 $('leadBox').hidden=!lead;$('extraActions').hidden=!line&&!lead;
 if(lang==='ja'&&survey?.leadMsg)$('leadMessage').textContent=survey.leadMsg;
 if(leadRegistered)$('leadStatus').textContent=text(PREVIEW?'leadPreview':'leadDone');
}
$('privateFeedback').addEventListener('click',()=>show('feedback'));
$('lineLink').addEventListener('click',e=>{if(PREVIEW){e.preventDefault();return;}track('line');});
$('leadForm').addEventListener('submit',async e=>{
 e.preventDefault();if(leadBusy||leadRegistered||!ready||!$('leadEmail').validity.valid)return;
 leadBusy=true;$('leadSubmit').disabled=true;$('leadStatus').textContent=text('leadBusy');
 try{if(!PREVIEW){const r=await fetch('/api/admin?action=lead-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:STORE_ID,email:$('leadEmail').value.trim(),rating})});if(!r.ok)throw new Error('lead');const d=await r.json();if(!d.success)throw new Error('lead');}leadRegistered=true;$('leadForm').hidden=true;$('leadStatus').textContent=text(PREVIEW?'leadPreview':'leadDone');}
 catch{$('leadStatus').textContent=text('leadError');}finally{leadBusy=false;$('leadSubmit').disabled=false;}
});
$('previewNotice').hidden=!PREVIEW;
$('language').addEventListener('change',e=>{lang=I18N[e.target.value]?e.target.value:'ja';applyLanguage();});
$('ratingNext').addEventListener('click',()=>{if(!ready||!rating)return;track('rate',{value:rating});show('comment');});
document.querySelectorAll('[data-back]').forEach(b=>b.addEventListener('click',()=>show(b.dataset.back)));
$('freeWord').addEventListener('input',updateGenerate);
$('generate').addEventListener('click',generate);$('regenerate').addEventListener('click',generate);
function copyState(){$('copy').disabled=!$('consent').checked||!$('draft').value.trim();}
$('consent').addEventListener('change',copyState);$('draft').addEventListener('input',()=>{$('consent').checked=false;copyState();});
$('copy').addEventListener('click',async()=>{try{await navigator.clipboard.writeText($('draft').value);show('google');}catch{status('copyError');$('draft').focus();$('draft').select();}});
$('googleLink').addEventListener('click',e=>{if(PREVIEW){e.preventDefault();status('previewGoogle');return;}if(e.currentTarget.dataset.ready!=='true'){e.preventDefault();status('missingGoogle');return;}track('click');});
$('feedback').addEventListener('input',()=>{$('sendFeedback').disabled=!$('feedback').value.trim()||busy;});
$('sendFeedback').addEventListener('click',async()=>{
 if(busy||!ready||!$('feedback').value.trim())return;busy=true;$('sendFeedback').disabled=true;
 try{if(!PREVIEW){const r=await fetch('/api/admin?action=feedback-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeId:STORE_ID,rating,text:$('feedback').value.trim(),contact:$('contact').value.trim()})});if(!r.ok)throw new Error('send');const d=await r.json();if(d.error)throw new Error('send');track('lowfb');}show('done');if(PREVIEW){status('previewDone');document.querySelector('[data-i18n=doneText]').textContent=text('previewDone');}}
 catch{status('sendError');}finally{busy=false;$('sendFeedback').disabled=!$('feedback').value.trim();}
});
applyLanguage();init();
