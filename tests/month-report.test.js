import test from 'node:test';
import assert from 'node:assert/strict';
import {monthReport} from '../lib/month-report.js';
test('月次はうるう日の明示ゼロと欠測を分け、日別原本と一致する',async()=>{
 const rows=Array.from({length:29},(_,i)=>({date:{year:2024,month:2,day:i+1},...(i?{value:String(i)}:{})}));
 const request=async(url)=>{assert.match(String(url),/end_date.day=29/);return Response.json({multiDailyMetricTimeSeries:[{dailyMetricTimeSeries:[{dailyMetric:'CALL_CLICKS',timeSeries:{datedValues:rows}},{dailyMetric:'WEBSITE_CLICKS',timeSeries:{datedValues:rows.slice(1)}}]}]});};
 const r=await monthReport({name:'検証',locationName:'accounts/1/locations/2'},'2024-02','test',request);
 assert.equal(r.rows.find(x=>x.key==='CALL_CLICKS').total,406);
 assert.equal(r.daily['2024-02-01'].CALL_CLICKS,0);
 assert.deepEqual(r.rows.filter(x=>x.key==='WEBSITE_CLICKS').map(x=>[x.total,x.present,x.expected]),[[null,28,29]]);
});
