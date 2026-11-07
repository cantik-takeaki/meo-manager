import {createHash} from 'node:crypto';
import {getKV} from '../api/_kv.js';

// 生成候補の指紋だけを記録する。個人の自由入力はキーにも履歴にも含めない。
const fingerprint=text=>createHash('sha256').update(text).digest('hex').slice(0,32);
const reserve=`
local winner, oldestBody, oldestFull
for i=1,#ARGV,2 do
  local body=tonumber(redis.call('ZSCORE',KEYS[1],ARGV[i]) or '0')
  local full=tonumber(redis.call('ZSCORE',KEYS[1],ARGV[i+1]) or '0')
  if not winner or body<oldestBody or (body==oldestBody and full<oldestFull) then
    winner=i; oldestBody=body; oldestFull=full
  end
end
local last=redis.call('ZREVRANGE',KEYS[1],0,0,'WITHSCORES')
local stamp=tonumber(last[2] or '0')+1
redis.call('ZADD',KEYS[1],stamp,ARGV[winner],stamp,ARGV[winner+1])
redis.call('ZREMRANGEBYRANK',KEYS[1],0,-1025)
redis.call('EXPIRE',KEYS[1],604800)
return (winner-1)/2
`;
export async function reserveSharedWording(group,language,candidates){
  const {url,token}=getKV();
  const hashes=candidates.flatMap(({body,text})=>['b'+fingerprint(body),'f'+fingerprint(text)]);
  const response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},signal:AbortSignal.timeout(3500),body:JSON.stringify(['EVAL',reserve,1,'review-wording:v1:'+group+':'+language,...hashes])});
  if(!response.ok)throw Error('履歴を参照できません');
  const {result}=await response.json();
  if(!Number.isInteger(result)||!candidates[result])throw Error('候補を特定できません');
  return result;
}
