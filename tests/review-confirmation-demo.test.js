import test from 'node:test';
import assert from 'node:assert/strict';
import {createReviewDemo,reviewDemoAction,DEMO_REVIEW,REVIEW_CONFIRMATION_GUIDE,REVIEW_EMAIL_GUIDE} from '../assets/review-confirmation-demo.js';
test('デモ承認はGoogleへの公開を常に無効にする',()=>{
 const first=createReviewDemo(),r=reviewDemoAction(first,'ok');
 assert.equal(r.state.status,'approved-demo');assert.equal(r.state.googlePublished,false);
 assert.equal(first.status,'pending');assert.match(r.message,/送信は行っていません/);
 assert.match(reviewDemoAction(r.state,'ok').message,/対応済み/);
 assert.throws(()=>reviewDemoAction({demo:false},'ok'),/架空/);
});
test('修正だけでは承認されず古い版の承認も受け付けない',()=>{
 let s=reviewDemoAction(createReviewDemo(),'edit').state;
 assert.equal(reviewDemoAction(s,'ok').state.status,'pending');
 assert.match(reviewDemoAction(s,'save',{text:''}).message,/1〜4000字/);
 const r=reviewDemoAction(s,'save',{text:'確認用の修正文です。'});s=r.state;
 assert.equal(s.reply,'確認用の修正文です。');assert.equal(s.revision,2);assert.equal(s.status,'pending');
 assert.match(reviewDemoAction(s,'ok',{revision:1}).message,/更新/);
 assert.equal(reviewDemoAction(s,'ok',{revision:2}).state.googlePublished,false);
});
test('保留・送らない・原文・コピーは実際の口コミを操作しない',()=>{
 let s=reviewDemoAction(createReviewDemo(),'later').state;
 assert.equal(s.status,'deferred');s=reviewDemoAction(s,'ng').state;
 assert.equal(s.status,'rejected');assert.equal(s.googlePublished,false);
 assert.equal(reviewDemoAction(s,'copy').message,DEMO_REVIEW.reply);
 assert.match(reviewDemoAction(s,'copy').message,/\n\nこの度は誠にありがとうございました。\n-/);
 assert.match(reviewDemoAction(s,'original').message,/架空の口コミ原文/);
 for(const key of ['reviewId','locationName','sid','groupId','token'])assert.equal(key in s,false);
});
test('案内文は承認前の公開・無返答の公開・デモ公開を約束しない',()=>{
 assert.match(REVIEW_CONFIRMATION_GUIDE,/ご返答がない場合は公開せずに保留/);
 assert.match(REVIEW_CONFIRMATION_GUIDE,/過去に口コミへの返信内容/);
 assert.match(REVIEW_EMAIL_GUIDE,/押しただけでは送信やGoogleへの公開は行われません/);
 assert.match(REVIEW_EMAIL_GUIDE,/確認番号/);
});
