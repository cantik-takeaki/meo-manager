import {postPrompt,checkPost} from './post-policy.js';
import {monthReport} from './month-report.js';
import {getMasterToken} from '../api/_tokens.js';
import {shindanOne} from '../api/_shindan.js';
import {getClientSession,revokeClientSession} from './http-client.js';
import {createGoogleClient} from './workspace-google.js';
import { repository } from './workspace-store.js';
import { createHandler } from './workspace-service.js';
import { resolveSessionUser } from '../api/_session.js';
import { kvGet } from '../api/_kv.js';
import { llmComplete } from '../api/generate-content.js';
export default createHandler({repo:repository,google:createGoogleClient(),staffResolver:resolveSessionUser,clientResolver:getClientSession,clientLogout:revokeClientSession,
 legacyMonthly:async(store,month)=>monthReport(store,month,await getMasterToken()),
 legacyInspect:async store=>{const token=await getMasterToken();if(!token)throw new Error('Google接続を確認してください');return shindanOne(store.locationName,token);},
 legacyLoader:async()=>{
  const managed=await kvGet('managed_locations')||[],manual=await kvGet('admin_stores')||[];
  const list=[...managed,...manual.filter(x=>!managed.some(m=>m.storeId===x.storeId||String(m.locId).replace(/\//g,'_')===x.storeId)).map(x=>({...x,locId:x.storeId,title:x.storeName}))];
  return Promise.all(list.map(async x=>{const sid=x.storeId||String(x.locId||'').replace(/\//g,'_');const c=await kvGet('client_'+sid);return {...x,isDemo:x.isDemo||/^【デモ】/.test(x.title||x.storeName||''),active:x.active!==false&&!/羊大厨|麻辣王酒場/.test(x.title||x.storeName||''),legacyClientId:c?.active?sid:null};}));
 },
 generate:async data=>{const body=await llmComplete(postPrompt(data),{maxTokens:1600,temperature:0.3});const check=checkPost(body,data.facts);if(!check.ok)throw new Error(check.failed.join('・'));return body;}
});
