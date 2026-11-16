export const BASELINE_VERSION='2026-11-16.1';
const normalized=s=>String(s??'').normalize('NFKC').trim();
export function addressKey(s){return normalized(s).replace(/\s/g,'').replace(/[‐‑‒–—―−－]/g,'-').replace(/(\d+)丁目(?=\d)/g,'$1-').replace(/(\d+)番地?(?=\d)/g,'$1-').replace(/(\d+)号(?=\D|$)/g,'$1').replace(/(\d+)(?:階|F)/gi,'$1F');}
export function urlKey(s){try{const u=new URL(normalized(s));for(const k of [...u.searchParams.keys()])if(/^utm_/i.test(k))u.searchParams.delete(k);u.searchParams.sort();return u.origin+u.pathname.replace(/\/$/,'')+u.search+u.hash;}catch{return normalized(s);}}
const days=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
export function hoursKey(s){
 const t=normalized(s), re=/(SUNDAY|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY)\s+(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})/g;
 const matches=[...t.matchAll(re)];
 if(!matches.length || t.replace(re,'').trim())return t.replace(/\s/g,'');
 const week=Array.from({length:7},()=>[]);
 for(const m of matches){const d=days.indexOf(m[1]),a=+m[2]*60 + +m[3],b=+m[4]*60 + +m[5];
  if(a>1440||b>1440||+m[3]>59||+m[5]>59)return t;
  if(b<a){week[d].push([a,1440]);week[(d+1)%7].push([0,b]);}else week[d].push([a,b]);
 }
 return JSON.stringify(week.map(row=>{const result=[];for(const p of row.sort((a,b)=>a[0]-b[0])){const last=result.at(-1);if(last&&p[0]<=last[1])last[1]=Math.max(last[1],p[1]);else result.push([...p]);}return result;}));
}
export const fieldLabels={title:'店舗名',phone:'電話番号',address:'住所',category:'カテゴリ',url:'公式URL',hours:'営業時間'};
export function diffBaseline(saved={},current={}){
 const keys={title:s=>normalized(s).replace(/\s/g,''),phone:s=>normalized(s).replace(/[^0-9]/g,''),address:addressKey,category:normalized,url:urlKey,hours:hoursKey};
 return Object.entries(fieldLabels).flatMap(([key,field])=>saved[key]&&keys[key](saved[key])!==keys[key](current[key])?[{key,field,saved:saved[key],current:current[key]??''}]:[]);
}
export function alertSignature(diffs){return JSON.stringify(diffs.map(x=>[x.field,x.saved,x.current]).sort((a,b)=>a[0].localeCompare(b[0])));}
