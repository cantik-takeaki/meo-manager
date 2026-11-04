import test from 'node:test';import assert from 'node:assert/strict';
import {kvGet,kvSet,kvDel,kvScanKeys} from '../api/_kv.js';
test('保存先エラーを空データ・保存成功と取り違えない',async()=>{
 const original=global.fetch;const old={url:process.env.KV_REST_API_URL,token:process.env.KV_REST_API_TOKEN};
 process.env.KV_REST_API_URL='https://fixture.invalid';process.env.KV_REST_API_TOKEN='test';
 try {for(const response of [{error:'failure'},{unexpected:true}]){
 global.fetch=async()=>new Response(JSON.stringify(response),{status:503});
 for(const fn of [()=>kvGet('x'),()=>kvSet('x',{}),()=>kvDel('x'),()=>kvScanKeys('x')])await assert.rejects(fn);
 }}finally{global.fetch=original;for(const [key,value]of [['KV_REST_API_URL',old.url],['KV_REST_API_TOKEN',old.token]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});
