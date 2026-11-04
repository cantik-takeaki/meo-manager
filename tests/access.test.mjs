import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {sessionUser,canUseAdmin} from '../api/_session.js';
import admin from '../api/admin.js';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const cred={user:'owner@example.test',hash:'fixture',_userSet:true};
const token=hash(`sess|${cred.user}|${cred.hash}`);
const db={admin_credential:cred,team_users:[{user:'viewer@example.test',hash:'view',role:'viewer'}],
 managed_locations:[{locId:'locations/1',title:'通常店'},{locId:'locations/2',title:'【デモ】除外'}],admin_stores:[],
 rankings_locations_1:{keywords:['A','B'],history:[{date:'2026-10-01',rankings:[1,20],ranksByKw:{A:1,B:20}},{date:'2026-11-01',rankings:[1,null],ranksByKw:{A:1,B:null}}]}};
async function fixture(fn){const f=global.fetch;process.env.KV_REST_API_URL='https://fixture.invalid';process.env.KV_REST_API_TOKEN='test';try{global.fetch=async url=>{assert.ok(String(url).startsWith('https://fixture.invalid/get/'),'予期しない外部通信');const key=decodeURIComponent(String(url).split('/get/')[1]);return new Response(JSON.stringify({result:db[key]?JSON.stringify(db[key]):null}));};await fn();}finally{global.fetch=f;delete process.env.KV_REST_API_URL;delete process.env.KV_REST_API_TOKEN;}}
const response=()=>({code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;},setHeader(){}});
test('任意Cookieでは管理者になれない',()=>fixture(async()=>{assert.equal(await sessionUser({headers:{cookie:'pw_session=fake'}}),null);const res=response();await admin({method:'GET',query:{action:'dashboard'},headers:{cookie:'pw_session=fake'}},res);assert.equal(res.code,401);}));
test('正規管理者のCookieは通る',()=>fixture(async()=>{const u=await sessionUser({headers:{cookie:`pw_session=${token}`}});assert.equal(u.role,'super_admin');}));
test('閲覧担当は管理APIの更新不可',()=>fixture(async()=>{const t=hash('team|viewer@example.test|view');const res=response();await admin({method:'POST',query:{action:'rankings'},headers:{cookie:`pw_session=${t}; team_user=viewer@example.test`},body:{}},res);assert.equal(res.code,403);assert.equal(canUseAdmin({role:'viewer'},'POST'),false);}));
test('実ハンドラでデモ除外・欠測分類・誤改善なし',()=>fixture(async()=>{const res=response();await admin({method:'GET',query:{action:'dashboard'},headers:{cookie:`pw_session=${token}`}},res);assert.equal(res.code,200);assert.equal(res.body.totals.stores,1);assert.equal(res.body.totals.keywords,2);assert.equal(res.body.totals.unknown,1);assert.equal(res.body.totals.outRange,0);assert.equal(res.body.perStore[0].mom,null);}));
test('変なCookieエンコードでも認証成功にならない',()=>fixture(async()=>{assert.equal(await sessionUser({headers:{cookie:'pw_session=%invalid'}}),null);}));
