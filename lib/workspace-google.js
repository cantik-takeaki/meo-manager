import { shindanOne } from '../api/_shindan.js';
import crypto from 'node:crypto';
import {Fault} from './workspace.js';
const SCOPE='https://www.googleapis.com/auth/business.manage';
export function createGoogleClient(env=process.env,request=fetch){
 const config=()=>{const redirect=env.WORKSPACE_GOOGLE_REDIRECT_URI||env.REDIRECT_URI||'https://meo-manager-rho.vercel.app/api/auth/callback',key=env.WORKSPACE_TOKEN_KEY;let u;try{u=new URL(redirect);}catch{}
  if(!env.GOOGLE_CLIENT_ID||!env.GOOGLE_CLIENT_SECRET||!u||u.protocol!=='https:'||!key||Buffer.from(key,'base64').length!==32)throw new Fault(503,'Google連携の環境設定が完了していません。運営担当へお問い合わせください');
  return {redirect,key:Buffer.from(key,'base64')};};
 const seal=(value,tenant)=>{const {key}=config(),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(tenant));const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return {iv:iv.toString('base64'),data:data.toString('base64'),tag:cipher.getAuthTag().toString('base64')};};
 const unseal=(value,tenant)=>{try{const {key}=config(),d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'));d.setAAD(Buffer.from(tenant));d.setAuthTag(Buffer.from(value.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(value.data,'base64')),d.final()]).toString());}catch{throw new Fault(503,'Google連携の保存情報を確認できません');}};
 async function json(url,options){const r=await request(url,{...options,signal:AbortSignal.timeout(15000)});const d=await r.json();if(!r.ok||d.error)throw new Fault(r.status===401||r.status===403?403:502,'Googleから情報を取得できません。権限と連携状態を確認してください');return d;}
 async function token(body){return json('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,...body})});}
 return {
  start(state,verifier){const {redirect}=config();const u=new URL('https://accounts.google.com/o/oauth2/v2/auth');u.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:SCOPE,access_type:'offline',prompt:'consent',state,code_challenge:crypto.createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});return u.toString();},
  async exchange(code,verifier,tenant){const {redirect}=config();const d=await token({code,code_verifier:verifier,redirect_uri:redirect,grant_type:'authorization_code'});if(!d.refresh_token||!d.scope?.split(' ').includes(SCOPE))throw new Fault(403,'店舗情報の管理権限が許可されませんでした。再連携してください');return seal({refreshToken:d.refresh_token},tenant);},
  async publish(connection,tenant,store,content){
   const account=store.googleSnapshot?.accountName,location=store.locationName;
   if(!/^accounts\/[\w-]+$/.test(account)||!/^locations\/[\w-]+$/.test(location))throw new Fault(400,'Googleの店舗情報を取得し直してください');
   const credentials=unseal(connection,tenant),access=await token({refresh_token:credentials.refreshToken,grant_type:'refresh_token'});
   if(!access.access_token)throw new Fault(403,'Googleとの再連携が必要です');
   const d=await json(`https://mybusiness.googleapis.com/v4/${account}/${location}/localPosts`,{method:'POST',headers:{Authorization:`Bearer ${access.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({languageCode:'ja',topicType:'STANDARD',summary:content.body,callToAction:{actionType:'LEARN_MORE',url:content.cta},...(content.photoUrl?{media:[{mediaFormat:'PHOTO',sourceUrl:content.photoUrl}]}:{})})});
   if(!d.name)throw new Fault(502,'Googleの受付結果を確認できません');return {name:d.name,state:d.state||null};
  },
  async inspect(connection,tenant,store){
   const account=store.googleSnapshot?.accountName,location=store.locationName;
   if(!/^accounts\/[\w-]+$/.test(account)||!/^locations\/[\w-]+$/.test(location))throw new Fault(400,'Google店舗情報を取得し直してください');
   const credentials=unseal(connection,tenant),access=await token({refresh_token:credentials.refreshToken,grant_type:'refresh_token'});
   if(!access.access_token)throw new Fault(403,'Googleとの再連携が必要です');
   return shindanOne(`${account}/${location}`,access.access_token,{withPerf:true});
  },
  async locations(connection,tenant){const credentials=unseal(connection,tenant);const access=await token({refresh_token:credentials.refreshToken,grant_type:'refresh_token'});if(!access.access_token)throw new Fault(403,'Googleとの再連携が必要です');const headers={Authorization:`Bearer ${access.access_token}`};
   async function pages(url,field){let list=[],pageToken='';const seen=new Set();do{const u=new URL(url);if(pageToken)u.searchParams.set('pageToken',pageToken);const d=await json(u.toString(),{headers});list.push(...(d[field]||[]));pageToken=d.nextPageToken||'';if(pageToken&&seen.has(pageToken))throw new Fault(502,'Googleのページ取得を完了できません');seen.add(pageToken);if(seen.size>100)throw new Fault(413,'Google店舗数が取得上限を超えました');}while(pageToken);return list;}
   const accounts=await pages('https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20','accounts');const all=[];
   for(const a of accounts){if(!/^accounts\/[\w-]+$/.test(a.name))continue;const rows=await pages(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,storefrontAddress,websiteUri,regularHours,specialHours,profile,serviceItems,phoneNumbers,categories,metadata&pageSize=100`,'locations');for(const x of rows)if(/^locations\/[\w-]+$/.test(x.name))all.push({...x,accountName:a.name});}
   return [...new Map(all.map(x=>[x.name,x])).values()];
  }
 };
}
