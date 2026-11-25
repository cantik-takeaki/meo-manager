import {verifyEmailAccess,signEmailAccess} from './review-confirmation-mail.js';
import {confirmationRevision,cardInScope} from './review-confirmation.js';
import {confirmationAction} from './review-confirmation-runtime.js';
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function emailConfirmationPage(req,res,deps){
 res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Content-Type-Options','nosniff');
 res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
 const access=req.query.access,verified=verifyEmailAccess(access,await deps.get('review_approve_secret'));
 const routes=deps.config;
 const route=verified&&routes?.enabled&&routes.routes.find(r=>r.storeId===verified.storeId&&r.to===verified.to&&r.channel==='email'&&r.verified);
 const p=verified&&await deps.get('rv_pending_'+verified.id);
 if(!route||!p||!cardInScope(p,{kind:'store',storeIds:[verified.storeId]})||deps.excluded(p)||confirmationRevision(p)!==verified.revision)return res.status(403).send('この確認リンクは期限切れか更新済みです。最新の案内をご確認ください。');
 if(!['GET','POST'].includes(req.method))return res.status(405).end();
 let result='',nextLink='';
 if(req.method==='POST'){
  if(req.headers.origin!=='https://meo.cantik.co.jp'||req.body?.confirm!=='yes')return res.status(403).send('確認画面から操作してください。');
  const b=req.body||{};
  if(b.decision==='ok'&&b.reply!==p.reply)return res.status(409).send('返信案が編集されています。先に修正版を保存して内容を確認してください。');
  const out=await confirmationAction({id:p.id,revision:verified.revision,decision:b.decision,reply:b.reply,emailScope:{kind:'store',storeIds:[verified.storeId]},sourceType:'email',userId:route.to},{...deps});
  result=out.text||out.messages?.find(m=>m.type==='text')?.text||'処理結果を確認してください。';
  if(b.decision==='save'){const latest=await deps.get('rv_pending_'+p.id);if(latest?.status==='pending')nextLink='?action=review-confirmation-email&access='+encodeURIComponent(signEmailAccess(latest,route,await deps.get('review_approve_secret')));}
 }
 res.setHeader('Content-Type','text/html; charset=utf-8');
 const done=req.method==='POST';
 return res.send(`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>口コミ返信の確認</title><style>body{font-family:system-ui,sans-serif;color:#0a2e5c;margin:0;padding:20px;line-height:1.8}main{max-width:700px;margin:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;border-top:1px solid #ddd;padding:16px 0}textarea{width:100%;box-sizing:border-box;min-height:240px;font:inherit;padding:12px}button{min-height:48px;padding:10px 18px;margin:8px 8px 8px 0;font:inherit;background:#0f4aa2;color:white;border:0}p[role=status]{white-space:pre-line}label{display:block}h1{font-size:24px}h2{font-size:20px}</style><main><h1>${esc(p.store)}の口コミ返信</h1>${p.controlTest?'<p>操作デモです。Googleへの送信は行いません。</p>':''}${result?`<p role="status">${esc(result)}</p>`:''}<h2>口コミ原文</h2><p>評価：${esc(p.star)}　投稿者：${esc(p.name)}</p><pre>${esc(p.review||'（本文なし・星のみ）')}</pre><h2>返信案</h2><pre>${esc(p.reply)}</pre>${done?'<p>この画面での操作を終了しました。</p>'+(nextLink?'<p><a href="'+esc(nextLink)+'">修正後の返信案を確認する</a></p>':''):`<form method="post"><input type="hidden" name="confirm" value="yes"><label for="reply">修正する場合はこちらに全文を入力してください。</label><textarea id="reply" name="reply" maxlength="4000">${esc(p.reply)}</textarea><p>「承認」は上の返信案を送信します。文章を変えた場合は先に「修正版を保存」を押してください。</p><button name="decision" value="ok">${p.controlTest?'デモを承認する':'この返信案を承認する'}</button><button name="decision" value="save">修正版を保存</button><button name="decision" value="later">保留にする</button><button name="decision" value="ng">送らない</button></form>`}<p>株式会社cantik</p></main></html>`);
}
