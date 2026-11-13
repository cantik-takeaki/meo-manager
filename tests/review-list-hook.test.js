import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHmac} from 'node:crypto';
import handler from '../api/line-hook.js';
import {formatOwnerReply} from '../lib/review-format.js';

test('接客への感想の直前の読点と重複するお礼を整える',()=>{
  const text=formatOwnerReply('温かいご評価をありがとうございます。スタッフのサービス精神を評価していただき、嬉しく思います。','KISS BERRY','接客が良かった');
  assert.equal(text,'ご来店いただきありがとうございます。\n\nスタッフのサービス精神を評価していただき嬉しく思います。\n\nこの度は誠にありがとうございました。\n-KISS BERRY-');
});

for(const count of [0,2,480])test('署名付き一覧と通常メッセージの混在 '+count,async t=>{
  process.env.KV_REST_API_URL='https://kv.invalid';process.env.KV_REST_API_TOKEN='fixture';
  const sign=b=>createHmac('sha256','fixture').update(b).digest('base64');
  const kv={meo_paused_stores:[{lid:'1122'}],line_channel_secret__review_alert:'fixture',line_conn__review_alert:{token:'fixture'},review_alert_line:{group:'group'},line_seen_groups:{group:{}},rv_queue:['ended','precontract','paused',...Array.from({length:count},(_,i)=>String(i))]};
  const receipts=[], relayed=[];
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    if(url.startsWith('https://kv.invalid/get/'))return Response.json({result:JSON.stringify(kv[url.split('/').pop()])});
    if(url==='https://kv.invalid'){const [op,...keys]=JSON.parse(opts.body);return Response.json({result:op==='MGET'?keys.map(id=>JSON.stringify({sid:id.endsWith('ended')?'locations_12710891692154182344':id.endsWith('precontract')?'locations_3635533343268879986':id.endsWith('paused')?'locations_1122':'locations_415',status:'pending',id,store:'店'.repeat(62),name:'名'.repeat(38),star:5})):'OK'});}
    if(url.endsWith('/message/reply')){receipts.push(JSON.parse(opts.body));return Response.json({});}
    assert.equal(opts.headers['X-Line-Signature'],sign(opts.body));relayed.push(...JSON.parse(opts.body).events);return Response.json({});
  });
  const event={type:'message',source:{type:'group',groupId:'group'},replyToken:'test',message:{type:'text',text:'一覧'}};
  const other={...event,message:{type:'text',text:'通常の会話'}};
  const body=Buffer.from(JSON.stringify({events:[event,other]}));
  const req=Object.assign(Readable.from([body]),{method:'POST',headers:{'x-line-signature':sign(body)}});
  await handler(req,{status(n){assert.equal(n,200);return this;},send(){}});
  assert.equal(receipts.length,1);const text=receipts[0].messages[0].text;
  assert.ok(text.includes(count?'確認待ち '+count+'件':'ありません'));assert.ok(text.length<=5000);assert.deepEqual(relayed,[other]);
});

test('社内試験カードの3操作は架空の口コミだけを扱う',async t=>{
  process.env.KV_REST_API_URL='https://kv.invalid';process.env.KV_REST_API_TOKEN='fixture';
  const data={review_approve_secret:'test',review_alert_line:{group:'test'},meo_paused_stores:[],rv_queue:['existing']};
  t.mock.method(globalThis,'fetch',async(url,opts)=>{
    if(url.startsWith('https://kv.invalid/get/'))return Response.json({result:JSON.stringify(data[decodeURIComponent(url.split('/').pop())]??null)});
    assert.equal(url,'https://kv.invalid','GoogleやLINEへの通信は禁止');
    const [op,k,v]=JSON.parse(opts.body);assert.equal(op,'SET');data[k]=JSON.parse(v);return Response.json({result:'OK'});
  });
  const {default:admin}=await import('../api/admin.js');
  const call=async(action,params)=>{let out;await admin({method:'POST',query:{action},headers:{authorization:'Bearer test'},body:{sourceType:'group',groupId:'test',userId:'tester',...params}},
    {setHeader(){},status(){return this;},json(v){out=v;}});return out;};
  const card=(await call('review-edit',{text:'社内ボタン動作試験'})).messages[0];
  const controls=card.contents.footer.contents.map(x=>x.action.data);
  const id=controls[0].split('id=')[1];
  assert.deepEqual(controls,['edit','later','ng'].map(a=>'rv='+a+'&id='+id));
  const decision=d=>call('review-approve',{decision:d,id});
  assert.match((await decision('ok')).text,/送信できません/);
  assert.match((await decision('edit')).text,/文を直します/);
  assert.match((await call('review-edit',{text:'操作確認用に修正しました。'})).messages[0].text,/差し替えました/);
  assert.match((await decision('later')).text,/あとでにしました/);
  assert.match((await decision('ng')).text,/送らないにしました/);
  assert.deepEqual(data.rv_queue,['existing']);
});
