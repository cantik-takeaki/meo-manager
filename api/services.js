import workspace from '../lib/http-workspace.js';
import client from '../lib/http-client.js';
export default function handler(req,res){
 const route=req.query.__route;delete req.query.__route;
 if(route==='workspace')return workspace(req,res);
 if(route==='client')return client(req,res);
 return res.status(404).json({error:'対象の機能が見つかりません'});
}
