import test from 'node:test';
import assert from 'node:assert/strict';
import {formatOwnerReply} from '../lib/review-format.js';
test('句点・空行・署名を一度だけ付け、正規の濁点を保存する',()=>{
  const reply='ご感想をありがとうございます。\n励みになります。\n\nこの度は誠にありがとうございました。\n-イヤーエステ耳舎-';
  assert.equal(formatOwnerReply('こ\u3099感想をありがとうございます。励みになります。','イヤーエステ 耳舎'),reply);
  assert.equal(formatOwnerReply(reply,'イヤーエステ 耳舎'),reply);
  assert.equal(formatOwnerReply('。゛','耳舎'),'');
  assert.equal(formatOwnerReply('ご感想ありがとうございます。',''),'');
});
