import {Fault} from './workspace.js';
import {coveredTotal,jstMonth} from '../api/_metric_integrity.js';

const indicators={
 BUSINESS_IMPRESSIONS_DESKTOP_MAPS:'Googleマップの表示（パソコン）',
 BUSINESS_IMPRESSIONS_MOBILE_MAPS:'Googleマップの表示（モバイル）',
 BUSINESS_IMPRESSIONS_DESKTOP_SEARCH:'Google検索の表示（パソコン）',
 BUSINESS_IMPRESSIONS_MOBILE_SEARCH:'Google検索の表示（モバイル）',
 BUSINESS_DIRECTION_REQUESTS:'経路の検索',CALL_CLICKS:'電話ボタンのクリック',WEBSITE_CLICKS:'ウェブサイトのクリック'
};
export async function monthReport(store,month,token,request=fetch){
 const id=store.locationName?.match(/(?:^|\/)locations\/(\d+)$/)?.[1];
 if(!id)throw new Fault(400,'この店舗のGoogle拠点がまだ紐付いていません');
 if(!/^20\d\d-(?:0[1-9]|1[0-2])$/.test(month)||month>=jstMonth())throw new Fault(400,'終了した月を選択してください');
 if(!token)throw new Fault(403,'Googleとの連携を確認してください');
 const [year,m]=month.split('-').map(Number),days=new Date(Date.UTC(year,m,0)).getUTCDate();
 const start=month+'-01',end=month+'-'+days;
 const params=new URLSearchParams();
 for(const key of Object.keys(indicators))params.append('dailyMetrics',key);
 for(const [range,day] of [['start_date',1],['end_date',days]]){
  for(const [unit,value] of [['year',year],['month',m],['day',day]])params.set('dailyRange.'+range+'.'+unit,value);
 }
 const endpoint='https://businessprofileperformance.googleapis.com/v1/locations/'+id+':fetchMultiDailyMetricsTimeSeries';
 const response=await request(endpoint+'?'+params,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw new Fault(response.status===403?403:502,'Googleの月次実績を取得できません。権限と対象月を確認してください');
 const raw=await response.json(),daily={};
 if(!Array.isArray(raw.multiDailyMetricTimeSeries))throw new Fault(502,'Googleから日別実績が返りませんでした');
 for(const group of raw.multiDailyMetricTimeSeries)for(const series of group.dailyMetricTimeSeries||[]){
  const key=series.dailyMetric;if(!Object.hasOwn(indicators,key))continue;
  for(const row of series.timeSeries?.datedValues||[]){
   const d=row.date;if(!d||d.year!==year||d.month!==m||!Number.isInteger(d.day)||d.day<1||d.day>days)continue;
   const date=month+'-'+String(d.day).padStart(2,'0');
   const value=row.value===undefined?0:row.value;
   if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value)))continue;
   const values=daily[date]??={};
   if(Object.hasOwn(values,key)&&values[key]!==Number(value))throw new Fault(502,'日別実績に重複した異なる値があります');
   values[key]=Number(value);
  }
 }
 return {store:store.name,month,start,end,observedAt:new Date().toISOString(),source:endpoint,daily,
  rows:Object.entries(indicators).map(([key,label])=>({key,label,...coveredTotal(daily,start,end,[key])}))};
}
