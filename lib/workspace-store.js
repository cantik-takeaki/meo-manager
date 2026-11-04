import { getKV } from '../api/_kv.js';
import { Fault } from './workspace.js';
export async function redis(command){const {url,token}=getKV();const r=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(10000)});const d=await r.json();if(!r.ok||d.error)throw new Fault(503,'保存先に接続できません。操作を完了扱いにせず再確認してください');return d.result;}
const previous=Symbol('読み取り時の契約');
export const SAVE_SCRIPT=`local current=redis.call('GET',KEYS[1]);
local n=0;
if current then n=cjson.decode(current).version
else local legacy=redis.call('GET',KEYS[2]); if legacy then n=cjson.decode(legacy).version end end;
if n~=tonumber(ARGV[1]) then return 0 end;
for i=3,#KEYS,2 do
 local old=redis.call('GET',KEYS[i]);
 if old then redis.call('SET',KEYS[i+1],old,'EX',604800) end;
 redis.call('SET',KEYS[i],ARGV[3+(i-3)/2]);
end;
redis.call('SET',KEYS[1],ARGV[2]); return 1`;
export function createRepository(command=redis,prefix='workspace'){
 const key=prefix+'_registry_v2',legacy=prefix+'_platform_v1',tenantKey=id=>prefix+'_tenant_v2:'+id;
 return {
  async read(){
   const raw=await command(['GET',key]);
   if(!raw){const old=await command(['GET',legacy]);const doc=old?JSON.parse(old):{version:0,tenants:[],users:[],sessions:[]};return doc;}
   const meta=JSON.parse(raw);if(!Array.isArray(meta.tenantIds))throw new Fault(503,'契約の索引を確認できません');
   const payloads=meta.tenantIds.length?await command(['MGET',...meta.tenantIds.map(tenantKey)]):[];
   if(payloads.some(x=>!x))throw new Fault(503,'契約データの一部を取得できません。保存を中止しました');
   const tenants=payloads.map(JSON.parse);
   if(tenants.some((t,i)=>t.id!==meta.tenantIds[i]))throw new Fault(503,'契約データの識別子が一致しません');
   const check=await command(['GET',key]);if(check!==raw)throw new Fault(409,'読み取り中に更新されました。再読み込みしてください');
   const {tenantIds,...base}=meta;const doc={...base,tenants};Object.defineProperty(doc,previous,{value:new Map(tenants.map((t,i)=>[t.id,payloads[i]]))});return doc;
  },
  async save(doc,expected){
   const {tenants,...base}=doc;
   const ids=tenants.map(t=>t.id);if(new Set(ids).size!==ids.length||ids.some(x=>typeof x!=='string'||!/^[\w-]+$/.test(x)))throw new Fault(400,'契約の識別子を確認してください');
   const meta=JSON.stringify({...base,tenantIds:ids,version:expected+1});
   if(Buffer.byteLength(meta)>2_000_000)throw new Fault(413,'利用者情報の保存上限に達しました');
   const keys=[key,legacy],payloads=[];
   for(const t of tenants){const encoded=JSON.stringify(t);if(doc[previous]?.get(t.id)===encoded)continue;
    if(Buffer.byteLength(encoded)>2_000_000)throw new Fault(413,'この契約の保存上限に達しました。運営担当へお問い合わせください');
    keys.push(tenantKey(t.id),tenantKey(t.id)+':backup:'+expected);payloads.push(encoded);
   }
   if(Buffer.byteLength(JSON.stringify([meta,...payloads]))>8_000_000)throw new Fault(413,'一度の保存量が上限を超えました。分けて登録してください');
   if(await command(['EVAL',SAVE_SCRIPT,keys.length,...keys,expected,meta,...payloads])!==1)throw new Fault(409,'同時更新がありました。再読み込みしてください');
  },
  async limit(email,ip){
   const bucket=Math.floor(Date.now()/600000);
   for(const k of [`${prefix}_login:${bucket}:u:${email}`,`${prefix}_login:${bucket}:ip:${ip}`]){
    const n=await command(['EVAL',"local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],660) end; return n",1,k]);
    if(n>20)throw new Fault(429,'しばらく待ってからログインしてください');
   }
  }
 };
}
export const repository=createRepository();
