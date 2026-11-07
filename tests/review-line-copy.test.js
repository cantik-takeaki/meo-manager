import test from 'node:test';
import assert from 'node:assert/strict';
import {formatBubble,reviewDisplay} from '../api/_review_line.js';

test('Google翻訳部分を除き原語から日本語に翻訳する',async()=>{
  let prompt;
  const value=await reviewDisplay('(Translated by Google) Great!\n(Original)\nSehr gut!',async p=>{prompt=p;return 'とてもよかったです。';});
  assert.equal(value.text,'とてもよかったです。');assert.ok(prompt.includes('Sehr gut!'));assert.ok(!prompt.includes('Great!'));
  assert.match((await reviewDisplay('Lovely',async()=>null)).text,/取得できません/);
});
test('署名前の空行をコピーに保存し、カードでも段落を分ける',async()=>{
  const copy='ご来店ありがとうございます。\nまたお待ちしております。\n\nこの度は誠にありがとうございました。\n-KISS BERRY-';
  const b=await formatBubble({store:'KISS BERRY',id:'0123456789',star:5,review:'素敵なお店です。',reply:copy});
  const actions=b.footer.contents.map(x=>x.action).filter(Boolean);
  assert.equal(actions.find(x=>x.type==='clipboard').clipboardText,copy);
  assert.ok(b.body.contents.some(x=>x.text==='この度は誠にありがとうございました。\n-KISS BERRY-'));
  assert.equal(actions.find(x=>x.label==='口コミ原文を見る').text,'原文 0123456789');
});
