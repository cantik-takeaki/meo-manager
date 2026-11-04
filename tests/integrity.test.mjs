import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {rankNumber,rankSummary,compareRanks,jstMonth,previousMonth,comparisonPeriods,coveredTotal,keywordValue,isDemo} from '../api/_metric_integrity.js';
import {scoreLocation,fetchPerf,fetchAll} from '../api/_shindan.js';
import {observation,recordObservation} from '../measurement/observation.mjs';
import {isSelf} from '../measurement/lib_maps.mjs';
const info={title:'テスト店舗',categories:{primaryCategory:{displayName:'整体'}},profile:{description:'完全個室でゆっくり過ごせます。'},websiteUri:'https://example.com',attributes:[]};
const activity={reviews:[],posts:[],media:[]};
test('欠測で10.5位から1位へ改善としない',()=>{const c=compareRanks(['A','B'],{A:1,B:20},{A:1,B:null});assert.equal(c.comparable,false);assert.equal(c.cur.avgRank,null);});
test('全語がある場合のみ正しい平均差',()=>{const c=compareRanks(['A','B'],{A:5,B:15},{A:3,B:11});assert.equal(c.base.avgRank,10);assert.equal(c.cur.avgRank,7);assert.equal(c.comparable,true);});
test('語の追加、旧集計だけの基準値は比較保留',()=>{assert.equal(compareRanks(['A','B'],{A:1},{A:1,B:2}).comparable,false);assert.equal(compareRanks(['A'],{},{A:1}).base.avgRank,null);});
test('不正値・少数・文字途中を順位にしない',()=>{for(const v of [null,undefined,'',false,0,-1,1.5,'3位','2x',NaN,Infinity])assert.equal(rankNumber(v),null);assert.equal(rankNumber('3'),3);});
test('圏外と未確認は異なる',()=>{const s=rankSummary(['A','B','C'],[1,21,null]);assert.equal(s.out,1);assert.equal(s.unknown,1);assert.equal(s.avgRank,11);});
test('JST月境界・前年12月への繰り越し',()=>{assert.equal(jstMonth(new Date('2026-10-31T15:01:00Z')),'2026-11');assert.equal(previousMonth('2026-01'),'2025-12');});
test('デモだけ除外。通常店舗の名前にdemoが含まれても残す',()=>{assert.equal(isDemo({title:'【デモ】テスト'}),true);assert.equal(isDemo({title:'demo cafe'}),false);});
test('前年期間61日分を対象にする',()=>{const p=comparisonPeriods(new Date('2026-11-02T00:00:00Z'));assert.equal(p.start,'2026-08-20');assert.equal(p.previousStart,'2025-08-20');assert.equal(p.previousEnd,'2025-10-19');});
test('閏年でも同日数',()=>{const p=comparisonPeriods(new Date('2024-03-14T00:00:00Z'));assert.equal((Date.parse(p.previousEnd)-Date.parse(p.previousStart))/86400000+1,61);});
test('指標1つ欠けた場合は合計0と区別する',()=>{assert.equal(coveredTotal({'2026-01-01':{a:0}},'2026-01-01','2026-01-01',['a','b']).total,null);assert.equal(coveredTotal({'2026-01-01':{a:0,b:0}},'2026-01-01','2026-01-01',['a','b']).total,0);});
test('thresholdは実数にしない',()=>{assert.deepEqual(keywordValue({threshold:'15'}),{value:null,threshold:15});assert.deepEqual(keywordValue({value:'0'}),{value:0,threshold:null});});
test('取得失敗は採点保留、件数はnull',()=>{const d=scoreLocation(info,{...activity,errors:{reviews:'403',media:'403',posts:'403'}},null);assert.equal(d.score,null);assert.equal(d.facts.reviews,null);assert.equal(d.facts.media,null);assert.equal(d.facts.postsAlive,null);assert.equal(d.items.filter(x=>['口コミ','写真','投稿'].includes(x.kind)).length,0);});
test('途中までの取得も全件数として採点しない',()=>{const d=scoreLocation(info,{...activity,complete:{reviews:false}},null);assert.equal(d.score,null);assert.equal(d.facts.reviews,null);});
test('完全個室を法令違反にしない',()=>{const d=scoreLocation(info,activity,null);assert.equal(d.items.some(x=>x.msg.includes('完全')),false);assert.equal(d.score,100);assert.equal(d.scoreVersion,'registration-v2');});
test('資格をカテゴリから断定せず人による確認にする',()=>{const d=scoreLocation({...info,profile:{description:'腰痛を改善するマッサージ'}},activity,null);assert.equal(d.items.some(x=>x.kind==='法令'),false);assert.equal(d.items.some(x=>x.kind==='要確認'),true);assert.equal(d.score,100);});
test('未取得属性を未設定とはしない',()=>{const d=scoreLocation({...info,attributes:null,attributesError:'失敗'},activity,null,[{parent:'p'}]);assert.equal(d.attributes,null);assert.equal(d.score,null);assert.equal(d.items.some(x=>x.msg==='予約・メニューのリンクが未設定'),false);});
test('前年データ不足は増減率なし',()=>{const d=scoreLocation(info,activity,{daily:{'2025-10-01':{BUSINESS_IMPRESSIONS_DESKTOP_MAPS:999}}});assert.equal(d.facts.yoyMaps,null);});
test('遮断・失敗・途中・順位ありを区別',()=>{assert.equal(observation({blocked:true}).status,'blocked');assert.equal(observation({error:'失敗'}).status,'error');assert.equal(observation({rank:null,total:20}).status,'partial');assert.equal(observation({rank:2}).status,'ranked');});
test('同日の取得失敗後も過去の成功証拠は消えない',()=>{const e={rankings:[],solo:[]};recordObservation(e,{kw:'A',rank:2,observedAt:'2026-11-02T01:00:00Z'},0,{});recordObservation(e,{kw:'A',error:'失敗',observedAt:'2026-11-02T02:00:00Z'},0,{});assert.equal(e.rankings[0],null);assert.equal(e.lastSuccessful.A.rank,2);assert.equal(e.observations.A.status,'error');});
test('場所IDが違う同名店舗を採用しない',()=>{assert.equal(isSelf({name:'テスト',pid:'other'},{storeName:'テスト',placeId:'self'}),false);});
test('ブラウザの集計関数も同じ欠測判定',()=>{const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');const snippet=html.slice(html.indexOf('function rankNumber('),html.indexOf('async function loadMonthlyReport()'));const ctx={};vm.createContext(ctx);vm.runInContext(snippet,ctx);assert.equal(ctx._mrCommonSummary({kws:['A','B'],baseline:{ranksByKw:{A:1,B:20}},curByKw:{A:1,B:null}}).cur.avgRank,null);});
test('ページ失敗・上限はcomplete:false',async()=>{const prev=global.fetch;try{global.fetch=async()=>new Response(JSON.stringify({reviews:[],nextPageToken:'same'}));const d=await fetchAll('https://example.com','reviews','fixture',2);assert.equal(d.complete,false);global.fetch=async()=>new Response('{}',{status:503});assert.equal((await fetchAll('https://example.com','reviews','fixture')).complete,false);}finally{global.fetch=prev;}});
test('実績取得は必要な前年期間、検索語は3完了月・ページ送り・threshold保持',async()=>{const prev=global.fetch,urls=[];try{global.fetch=async url=>{urls.push(String(url));return new Response(JSON.stringify(String(url).includes('fetchMulti')?{}:String(url).includes('pageToken')?{searchKeywordsCounts:[{searchKeyword:'正確',insightsValue:{value:'20'}}]}:{searchKeywordsCounts:[{searchKeyword:'少数',insightsValue:{threshold:'15'}}],nextPageToken:'next'}));};const r=await fetchPerf('123','fixture',new Date('2026-11-02T00:00:00Z'));assert.match(urls[0],/start_date.month=8/);assert.match(urls[0],/start_date.day=20/);assert.match(urls[1],/end_month.month=10/);assert.equal(urls.length,3);assert.equal(r.keywordCounts[0].threshold,15);assert.deepEqual(r.searchKeywords.recent,[['正確',20]]);}finally{global.fetch=prev;}});

const {rankingReport}=await import('../api/_metric_integrity.js');
test('顧客レポートでも欠測を順位改善にしない',()=>{
 const r=rankingReport({keywords:['A','B'],history:[{date:'2026-01-01',keywords:['B','A'],rankings:[20,1]},{date:'2026-02-01',keywords:['A','B'],rankings:[1,null]}]});
 assert.equal(r[0].change,null);assert.equal(r[1].prev,20);assert.equal(r[1].change,null);
});
test('対応不明の旧履歴は顧客レポートの比較に使わない',()=>{
 const r=rankingReport({keywords:['A'],history:[{date:'2026-01-01',rankings:[20]},{date:'2026-02-01',rankings:[1]}]});
 assert.equal(r[0].current,1);assert.equal(r[0].prev,null);assert.equal(r[0].change,null);
});

test('属性の候補も最後のページまで取得する',async()=>{
 const {fetchAvailableAttributes}=await import('../api/_shindan.js');const original=global.fetch;let n=0;
 try{global.fetch=async()=>new Response(JSON.stringify(++n===1?{attributeMetadata:[{name:'a'}],nextPageToken:'next'}:{attributeMetadata:[{name:'b'}]}));assert.deepEqual((await fetchAvailableAttributes('category','test')).map(x=>x.name),['a','b']);}finally{global.fetch=original;}
});
test('登録情報が不正応答なら診断0点でなく取得失敗',async()=>{
 const {shindanOne}=await import('../api/_shindan.js');const original=global.fetch;
 try{global.fetch=async()=>new Response('not-json',{status:502});const r=await shindanOne('accounts/1/locations/2','test');assert.equal(r.score,null);assert.ok(r.error);}finally{global.fetch=original;}
});

test('地点・端末・計測方式が揃わなければ改善として集計しない',async()=>{
 const {compareRankEntries}=await import('../api/_metric_integrity.js');
 const obs={status:'ranked',source:'local-chrome',device:'pc',point:{lat:35,lng:139},zoom:15};
 const before={ranksByKw:{A:5},observations:{A:obs}},after={ranksByKw:{A:3},observations:{A:{...obs}}};
 assert.equal(compareRankEntries(['A'],before,after).comparable,true);
 for(const modified of [{device:'mobile'},{source:'other'},{point:{lat:35.1,lng:139}},{zoom:14}])assert.equal(compareRankEntries(['A'],before,{...after,observations:{A:{...obs,...modified}}}).comparable,false);
 assert.equal(compareRankEntries(['A'],{ranksByKw:{A:5}},after).comparable,false);
});
