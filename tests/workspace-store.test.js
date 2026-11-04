import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import {createRepository} from '../lib/workspace-store.js';
function command(port,args){return new Promise((resolve,reject)=>{
 const socket=net.createConnection({host:'127.0.0.1',port});let buf=Buffer.alloc(0);
 const parse=(at=0)=>{if(buf.length<=at)return;const end=buf.indexOf('\r\n',at);if(end<0)return;const type=String.fromCharCode(buf[at]),line=buf.subarray(at+1,end).toString();let p=end+2;
 if(type==='+')return [line,p];if(type===':')return [Number(line),p];if(type==='-')throw new Error(line);
 if(type==='$'){const n=Number(line);if(n===-1)return [null,p];if(buf.length<p+n+2)return;return [buf.subarray(p,p+n).toString(),p+n+2];}
 if(type==='*'){const out=[];for(let i=0;i<Number(line);i++){const child=parse(p);if(!child)return;out.push(child[0]);p=child[1];}return [out,p];}
 throw new Error('未対応の応答');};
 socket.setTimeout(5000,()=>socket.destroy(new Error('保存試験タイムアウト')));socket.on('error',reject);
 socket.on('connect',()=>{const chunks=[Buffer.from('*'+args.length+'\r\n')];for(const arg of args){const data=Buffer.from(String(arg));chunks.push(Buffer.from('$'+data.length+'\r\n'),data,Buffer.from('\r\n'));}socket.write(Buffer.concat(chunks));});
 socket.on('data',chunk=>{buf=Buffer.concat([buf,chunk]);try{const r=parse();if(r){socket.end();resolve(r[0]);}}catch(e){socket.destroy();reject(e);}});
});}
test('実Redisで旧形式移行・契約分割・競合・復元用控え・欠落拒否を検証',{skip:!process.env.MEO_TEST_REDIS_BIN},async()=>{
 const port=16397;const child=spawn(process.env.MEO_TEST_REDIS_BIN,['--bind','127.0.0.1','--port',String(port),'--save','','--appendonly','no'],{stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('検証用Redis起動失敗')),10000);child.on('error',reject);child.on('exit',()=>reject(new Error('検証用Redis終了')));child.stdout.on('data',b=>{if(b.toString().includes('Ready to accept connections')){clearTimeout(timer);resolve();}});});
  const cmd=args=>command(port,args),prefix='test_'+crypto.randomBytes(6).toString('hex'),repo=createRepository(cmd,prefix);
  const legacy={version:3,tenants:[{id:'store-a',name:'契約A',version:1},{id:'store-b',name:'契約B',version:1}],users:[],sessions:[]};
  await cmd(['SET',prefix+'_platform_v1',JSON.stringify(legacy)]);
  const d=await repo.read();assert.equal(d.version,3);await repo.save(d,3);
  const first=await repo.read(),racing=await repo.read();assert.equal(first.version,4);first.tenants[0].name='変更後';first.tenants[0].version++;
  await repo.save(first,4);await assert.rejects(()=>repo.save(racing,4),e=>e.status===409);
  const saved=await repo.read();assert.equal(saved.tenants[0].name,'変更後');assert.equal(saved.tenants[1].name,'契約B');
  const backup=JSON.parse(await cmd(['GET',prefix+'_tenant_v2:store-a:backup:4']));assert.equal(backup.name,'契約A');
  assert.ok(await cmd(['TTL',prefix+'_tenant_v2:store-a:backup:4'])>0);
  assert.equal(await cmd(['GET',prefix+'_tenant_v2:store-b:backup:4']),null);
  // 控えから新しい版として復元。ほかの契約の情報を変更しない。
  saved.tenants[0]={...backup,version:saved.tenants[0].version+1};await repo.save(saved,saved.version);
  assert.equal((await repo.read()).tenants[0].name,'契約A');
  await cmd(['DEL',prefix+'_tenant_v2:store-b']);await assert.rejects(()=>repo.read(),e=>e.status===503);
 }finally{child.kill('SIGTERM');}
});
