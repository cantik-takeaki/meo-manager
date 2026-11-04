/* 運用準備の確認。Googleのランキング評価・予測ではない。 */
(function(root){
 'use strict';
 root.meoDiagnostic=function(k={},rk={},rv={},connected,loc,photos){
  const own=(o,key)=>o!=null&&Object.prototype.hasOwnProperty.call(o,key);
  const numeric=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
  const loaded=k&&!k.error&&(k._loaded===true||Object.keys(k).some(x=>!x.startsWith('_')));
  const has=v=>typeof v==='string'?v.trim().length>0:!!v;
  const items=[];
  const add=(label,ok,fix,reason,source)=>items.push({label,ok:ok===null?null:!!ok,w:1,fix,reason,source});
  for(const [key,label]of [['storeName','店名の記録'],['category','業種の記録'],['address','所在地の記録'],['phone','連絡先の記録'],['businessHours','営業時間の記録'],['description','店舗説明の記録'],['services','提供サービスの記録']]){
   add(label,loaded&&(!k._partial||own(k,key))?has(k[key]):null,'knowledge',loaded&&(!k._partial||own(k,key))?'確認資料の入力有無。正確性やGoogle公開値との一致を保証しません。':'この項目の確認資料が未取得です。','店舗ナレッジ');
  }
  add('Google連携の状態',connected==null?null:connected===true,'stores','このツールとの連携有無です。未連携でもGoogleで掲載されている場合があります。','連携状態');
  const gbp=!!loc&&!loc.error&&(loc._type==='gbp'||loc.gbpConnected===true||own(loc,'categories'));
  add('Googleメインカテゴリ',gbp?!!loc.categories?.primaryCategory:null,'stores','取得したカテゴリの有無。実際の業務との適合は別途確認が必要です。','Googleプロフィール');
  add('Googleウェブサイト',gbp?has(loc.websiteUri):null,'stores','取得したリンクの有無。予約完了やリンク先の内容は別途確認が必要です。','Googleプロフィール');
  add('Google写真の登録',numeric(photos?.photoCount)?photos.photoCount>0:null,'posts','写真の登録有無。枚数・更新日数だけでは品質や順位効果を判定しません。','Google写真');
  const reviewKnown=numeric(rv.totalCount)&&numeric(rv.unrepliedCount)&&rv.unrepliedCount<=rv.totalCount;
  add('口コミへの返信',reviewKnown?rv.unrepliedCount===0:null,'reviews',reviewKnown?(rv.totalCount===0?'口コミ0件のため返信対象はありません。':'取得した口コミの未返信 '+rv.unrepliedCount+'件。返信文の適切さは別途確認します。'):'口コミ総数と未返信数の両方が必要です。','Google口コミ');
  const kw=[...new Set([...(Array.isArray(k.keywords)?k.keywords:[]),...(Array.isArray(rk.keywords)?rk.keywords:[])].filter(x=>typeof x==='string'&&x.trim()&&rk.meta?.[x]?.enabled!==false))];
  const rankKnown=rk&&!rk.error&&(own(rk,'keywords')||own(rk,'history'));
  add('測定する検索語の設定',rankKnown?kw.length>0:null,'rankmgr','語数の多さを加点しません。店舗の業務と商圏に合う検索語を選びます。','順位の測定設定');
  const known=items.filter(x=>x.ok!==null),done=known.filter(x=>x.ok),coverage=Math.round(known.length/items.length*100);
  const score=coverage>=70?Math.round(done.length/known.length*100):null;
  const grade=score===null?'—':score>=90?'A':score>=70?'B':'C';
  const gradeInfo={color:score===null?'var(--text-sub)':'var(--accent)',label:score===null?'判定材料が不足':score>=90?'準備項目を確認済み':'未対応項目あり',advice:'未取得を先に確認し、確認済みの不備から対応してください。'};
  return {items,score,grade,gradeInfo,coverage,known:known.length,total:items.length,kwCount:kw.length,methodVersion:'readiness-2026-10-29',sourceUrl:'https://support.google.com/business/answer/7091?hl=ja'};
 };
})(globalThis);
