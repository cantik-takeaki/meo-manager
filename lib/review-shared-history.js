import {createHash} from 'node:crypto';
import {getKV} from '../api/_kv.js';

// 生成候補の指紋だけを記録する。個人の自由入力はキーにも履歴にも含めない。
const fingerprint=text=>createHash('sha256').update(text).digest('hex').slice(0,32);
const reserve=`
local winner, best
local function earlier(a,b)
  if not b then return true end
  for i=1,#a do
    if a[i]~=b[i] then return a[i]<b[i] end
  end
  return false
end
for i=1,#ARGV,5 do
  local body=tonumber(redis.call('ZSCORE',KEYS[1],ARGV[i]) or '0')
  local full=tonumber(redis.call('ZSCORE',KEYS[1],ARGV[i+1]) or '0')
  local opening=tonumber(redis.call('ZSCORE',KEYS[1],ARGV[i+2]) or '0')
  local prefix=tonumber(redis.call('ZSCORE',KEYS[1],ARGV[i+3]) or '0')
  local ending=tonumber(redis.call('ZSCORE',KEYS[1],ARGV[i+4]) or '0')
  local rank={body==0 and 0 or 1,opening==0 and 0 or 1,ending==0 and 0 or 1,prefix==0 and 0 or 1,ending,opening,prefix,body,full}
  if earlier(rank,best) then winner=i; best=rank end
end
local last=redis.call('ZREVRANGE',KEYS[1],0,0,'WITHSCORES')
local stamp=tonumber(last[2] or '0')+1
redis.call('ZADD',KEYS[1],stamp,ARGV[winner],stamp,ARGV[winner+1],stamp,ARGV[winner+2],stamp,ARGV[winner+3],stamp,ARGV[winner+4])
redis.call('ZREMRANGEBYRANK',KEYS[1],0,-1025)
redis.call('EXPIRE',KEYS[1],604800)
return (winner-1)/5
`;
export async function reserveSharedWording(group,language,candidates){
  const {url,token}=getKV();
  const hashes=candidates.flatMap(({body,text,opening,ending})=>['b'+fingerprint(body),'f'+fingerprint(text),'o'+fingerprint(opening),'p'+fingerprint([...opening].slice(0,6).join('')),'e'+fingerprint(ending)]);
  const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(3500),body:JSON.stringify(['EVAL',reserve,1,'review-wording:v1:'+group+':'+language,...hashes])});
  if(!response.ok)throw Error('履歴を参照できません');
  const {result}=await response.json();
  if(!Number.isInteger(result)||!candidates[result])throw Error('候補を特定できません');
  return result;
}
