import test from 'node:test';
import assert from 'node:assert/strict';
import {formatOwnerReply} from '../lib/review-format.js';
test('句点・空行・署名を一度だけ付け、正規の濁点を保存する',()=>{
  const reply='ご評価いただきありがとうございます。\n\nご感想をありがとうございます。\n励みになります。\n\nこの度は誠にありがとうございました。\n-イヤーエステ耳舎-';
  assert.equal(formatOwnerReply('こ\u3099感想をありがとうございます。励みになります。','イヤーエステ 耳舎'),reply);
  assert.equal(formatOwnerReply(reply,'イヤーエステ 耳舎'),reply);
  assert.equal(formatOwnerReply('。゛','耳舎'),'');
  assert.equal(formatOwnerReply('ご感想ありがとうございます。',''),'');
});

test('初回と再来店を読み分け、挨拶だけを一度置く',()=>{
 const body='ご来店いただきありがとうございます。\n焼き菓子を楽しんでいただけて嬉しいです。';
 assert.match(formatOwnerReply(body,'KISS BERRY','また行きたいです'),/^ご来店いただきありがとうございます。\n\n焼き菓子/);
 assert.match(formatOwnerReply(body,'KISS BERRY','いつも利用しています'),/^いつもご利用いただきありがとうございます。\n\n焼き菓子/);
});
