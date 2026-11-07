import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
const source=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name) {
  const start=source.indexOf('async function '+name+'(');
  assert.notEqual(start,-1);
  return source.slice(start,source.indexOf('\n}',start)+2);
}
const code=['publishToTargets','saveDraft','publishDraftNow'].map(extract).join('\n');
const link='https://example.com/reserve?plan=2&utm_content=test%2B01#time';
for(const scenario of ['保存済みリンク','旧下書き・リンクなし','保存失敗','保存中に削除','保存中に店舗切替']){
  test('予約下書きから今すぐ投稿：'+scenario,async()=>{
    const published=[];
    const draft={id:'d1',summary:'料理のご案内',images:[{url:'https://example.com/dish.jpg'}],topicType:'STANDARD',
      ...(scenario==='旧下書き・リンクなし'?{}:{callToActionType:'BOOK',callToActionUrl:link})};
    const ctx={document:{getElementById:id=>id==='draft-d1'?{value:draft.summary}:id==='draftG-d1'?{checked:true}:null},
      currentLocation:{name:'locations/11'},currentLocationId:'11',_draftImages:{d1:draft.images},_draftAspect:{},_draftHashtags:{},
      gbpPolicyGate:()=>true,confirm:()=>true,showToast(){},logAction(){},
      fetch:async(url,opts)=>{
        if(url.includes('action=drafts')){
          if(scenario==='保存中に店舗切替')ctx.currentLocation={name:'locations/22'};
          return {ok:scenario!=='保存失敗',json:async()=>({success:true,drafts:scenario==='保存中に削除'?[]:[draft]})};
        }
        published.push(JSON.parse(opts.body));return {ok:true,json:async()=>({name:'localPosts/mock'})};
      }};
    await vm.runInNewContext(code+"\npublishDraftNow('d1')",ctx);
    if(scenario.startsWith('保存')){if(scenario!=='保存済みリンク')return assert.equal(published.length,0);}
    assert.equal(published.length,1);assert.equal(published[0].callToActionUrl,draft.callToActionUrl||'');
    assert.equal(published[0].callToActionType,draft.callToActionType||'');assert.equal(published[0].mediaUrl,draft.images[0].url);
  });
}
