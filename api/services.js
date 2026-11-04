import {portalHandler} from '../lib/portal-login.js';
import workspace from '../lib/http-workspace.js';
import client from '../lib/http-client.js';
export default async function handler(req,res){
 const route=req.query.__route;delete req.query.__route;
 if(route==='workspace'){
  if(await portalHandler(req,res)!==false)return;
  return workspace(req,res);
 }
 if(route==='client')return client(req,res);
 return res.status(404).json({error:'対象の機能が見つかりません'});
}
