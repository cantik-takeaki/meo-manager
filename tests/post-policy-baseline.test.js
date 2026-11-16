import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPost,postPrompt,refinePostDraft} from '../lib/post-policy.js';
import {addressKey,urlKey,hoursKey,diffBaseline} from '../lib/gbp-baseline.js';
test('確認済みの短文を引き延ばさず人の確認を残す',()=>{
 const text='経絡に沿って背面をケアする60分のコースです。\n料金は6,930円です。';
 const x=checkPost(text,{menu:'背面60分6,930円'});assert.equal(x.ok,true);assert.equal(x.needsHuman,true);assert.ok(x.len<300);
});
test('未登録価格・予約先・治癒保証を止める',()=>{
 for(const text of ['料金は8,000円です。','https://unknown.example/','必ず治ります。'])assert.equal(checkPost(text,{menu:'60分6,930円'}).ok,false);
});
test('男性や経絡を単語だけで違反扱いしない',()=>assert.equal(checkPost('男性の方も経絡に沿った施術を受けられます。',{}).ok,true));
test('主題欄と事実資料を分けて指示し、誤ったメニュー置換を求めない',()=>{
 const p=postPrompt({store:'検証店',facts:{menu:'お茶'},purpose:'100円と書く'});assert.ok(p.includes('主題の希望（未検証）'));assert.ok(p.includes('意味を変えて審査を避けない'));
});
test('住所表記差は吸収して階・部屋番号・建物名は保持する',()=>{
 assert.equal(addressKey('大久保１丁目17-7 メゾン豊ビルB1F'),addressKey('大久保1-17-7 メゾン豊ビル B1F'));
 assert.equal(addressKey('西池袋１丁目１０−２ 日高ビル ２０３'),addressKey('西池袋1-10-2 日高ビル203'));
 assert.equal(diffBaseline({address:'市谷本村町3-20'},{address:'市谷本村町3-20 1F'}).length,1);
 assert.equal(diffBaseline({address:'小宮ビル3階'},{address:'コミヤビル3F'}).length,1);
 assert.equal(diffBaseline({address:'ビル203'},{address:'ビル20'}).length,1);
});
test('計測パラメータだけを同一視し予約先の違いは検知する',()=>{
 assert.equal(urlKey('https://hoshinosekkotuinn.jp/'),urlKey('https://hoshinosekkotuinn.jp/?utm_source=gbp&utm_medium=organic'));
 assert.notEqual(urlKey('https://a.test/?store=1'),urlKey('https://a.test/?store=2'));
 assert.notEqual(urlKey('https://a.test/ABC'),urlKey('https://a.test/abc'));
});
test('曜日の削除・閉店時刻変更・項目削除を見逃さない',()=>{
 assert.notEqual(hoursKey('MONDAY 10:00-22:00 TUESDAY 10:00-22:00'),hoursKey('MONDAY 10:00-22:00'));
 assert.equal(diffBaseline({hours:'MONDAY 10:00-21:30'},{hours:'MONDAY 10:00-22:00'}).length,1);
 assert.equal(diffBaseline({url:'https://a.test/'},{url:''}).length,1);
});
test('翌日をまたぐ営業時間は同じ週の時間帯として比較する',()=>{
 assert.equal(hoursKey('MONDAY 9:00-2:00'),hoursKey('MONDAY 9:00-24:00 TUESDAY 0:00-2:00'));
});

test('旧資料に含まれる強い健康効果も通さない',()=>assert.equal(checkPost('体内毒素を排出します。',{description:'体内毒素を排出'}).ok,false));

test('旧形式の同日複数時間帯も比較し午後の変更を見逃さない',()=>{
 assert.equal(hoursKey('MONDAY 8:30-12:30,15:30-19:30'),hoursKey('MONDAY 8:30-12:30 MONDAY 15:30-19:30'));
 assert.notEqual(hoursKey('MONDAY 8:30-12:30,15:30-19:30'),hoursKey('MONDAY 8:30-12:30 MONDAY 15:30-18:30'));
});

test('修正後も事実検査を通った本文だけ採用する',async()=>{
 const data={store:'検証店',facts:{menu:'60分6,930円'}};
 let calls=0;const bad='料金は8,000円です。';
 assert.equal(await refinePostDraft(bad,data,async()=>{calls++;return '料金は6,930円です。';}),'料金は6,930円です。');
 assert.equal(calls,1);
 assert.equal(await refinePostDraft(bad,data,async()=>'料金は9,000円です。'),bad);
});
