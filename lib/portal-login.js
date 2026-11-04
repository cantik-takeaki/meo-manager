import {monthReport} from './month-report.js';
import {getMasterToken} from '../api/_tokens.js';
import crypto from 'node:crypto';
import {parseCookies} from '../api/_session.js';
import {sameOrigin} from '../api/_auth.js';
import {redis,repository} from './workspace-store.js';
import {locations} from './portal-mapping.js';
import {activePlan} from './workspace.js';

const home = 'https://meo.cantik.co.jp';
const portal = 'https://report.cantik.co.jp';
const valid = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const random = () => crypto.randomBytes(32).toString('hex');
const cookie = (k,v,ttl) => '__Host-'+k+'='+v+'; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age='+ttl;
const sessionKey = token => 'meo_portal_session:'+hash(token);
const hasShop = shop => Object.hasOwn(locations,shop);
function fail(message,status=403){throw Object.assign(new Error(message),{status});}
function move(res,to){res.setHeader('Location',to);return res.status(303).end();}
export async function portalHandler(req,res) {
 const jar=parseCookies(req), action=req.query.action||'state';
 const session=jar['__Host-meo-shop'];
 if(!action.startsWith('portal-') && !session)return false;
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
 try {
  if(action==='portal-start' && req.method==='GET'){
   const shop=String(req.query.shop||'').trim();
   if(!hasShop(shop))fail('この店舗IDは月次レポートとの連携が確認できていません。',404);
   if(req.headers.host!=='meo.cantik.co.jp')return move(res,home+'/api/workspace?action=portal-start&shop='+encodeURIComponent(shop));
   const verifier=random();
   res.setHeader('Set-Cookie',cookie('meo-proof',verifier,180));
   return move(res,portal+'/'+shop+'/meo-login.php?challenge='+hash(verifier));
  }
  if(action==='portal-return' && req.method==='GET'){
   const verifier=jar['__Host-meo-proof'],code=req.query.code;
   if(!valid(verifier)||!valid(code))fail('連携の期限が切れました。最初からログインしてください。');
   const reply=await fetch(portal+'/meo-redeem.php',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,verifier}),signal:AbortSignal.timeout(10000)});
   if(!reply.ok)fail('月次レポートでの本人確認に失敗しました。');
   const {shop}=await reply.json();
   if(!hasShop(shop))fail('対象店舗が確認できません。');
   const token=random();
   await redis(['SET',sessionKey(token),shop,'EX',900]);
   res.setHeader('Set-Cookie',[cookie('meo-shop',token,900),cookie('meo-proof','',0)]);
   return move(res,'/operations.html');
  }
  if(!valid(session))fail('店舗ログインが必要です。',401);
  if(action==='logout' && req.method==='POST' && sameOrigin(req)){
   await redis(['DEL',sessionKey(session)]);res.setHeader('Set-Cookie',cookie('meo-shop','',0));return res.json({ok:true});
  }
  if(!['state','monthly-report'].includes(action)||req.method!=='GET')fail('このログインでは自店舗の閲覧のみ利用できます。');
  const shop=await redis(['GET',sessionKey(session)]);
  if(!shop||!hasShop(shop))fail('月次レポートから再度ログインしてください。',401);
  const registry=await repository.read(),t=registry.tenants.find(t=>t.internal===true);
  if(!t||(req.query.tenant&&req.query.tenant!==t.id))fail('契約を参照できません。');
  activePlan(t);
  const target=locations[shop];
  const rows=t.stores.filter(s=>target.startsWith('store:')?s.id===target.slice(6):s.locationName?.split('/').pop()===target);
  if(rows.length!==1||(req.query.storeId&&req.query.storeId!==rows[0].id))fail('この店舗を参照できません。');
  const s=rows[0];
  if(action==='monthly-report')return res.json(await monthReport(s,req.query.month,await getMasterToken()));
  // 店舗認証では、同じ管理契約の他店舗・社内監査ログ・担当者情報を返さない。
  const workspace={id:t.id,name:'店舗運用',version:t.version,role:'viewer',internal:false,contract:{kind:'store',status:'active',storeLimit:1},stores:[s],issues:t.issues.filter(x=>x.storeId===s.id),metrics:t.metrics.filter(x=>x.storeId===s.id),photos:[],contents:[],members:[],audit:[]};
  return res.json({actor:{name:s.name,operator:false,portal:true},tenants:[{id:t.id,name:'店舗運用'}],workspace});
 }catch(e){return res.status(e.status||503).json({error:e.status?e.message:'店舗ログインの接続を確認してください。'});}
}
