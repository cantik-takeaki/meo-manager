import crypto from 'node:crypto';
import {kvGet} from '../api/_kv.js';
import {confirmationRevision} from './review-confirmation.js';

export function signEmailAccess(p,route,secret,now=Date.now()){
 if(!secret||route.channel!=='email'||!route.verified)throw new Error('メール確認先が未確定です。');
 const payload=Buffer.from(JSON.stringify({id:p.id,revision:confirmationRevision(p),storeId:route.storeId,to:route.to,exp:now+7*86400000})).toString('base64url');
 return payload+'.'+crypto.createHmac('sha256',secret).update(payload).digest('base64url');
}
export function verifyEmailAccess(token,secret,now=Date.now()){
 if(typeof token!=='string'||token.length>2000||!secret)return null;
 const [payload,sig,...extra]=token.split('.');if(extra.length||!sig)return null;
 const expected=crypto.createHmac('sha256',secret).update(payload).digest('base64url');
 if(expected.length!==sig.length||!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(sig)))return null;
 try{const p=JSON.parse(Buffer.from(payload,'base64url'));return /^[0-9a-f]{10}$/.test(p.id)&&/^[0-9a-f]{16}$/.test(p.revision)&&p.exp>now?p:null;}catch{return null;}
}
export async function sendConfirmationEmail(plan,key){
 const transport=await kvGet('review_confirmation_mail_transport');
 if(transport?.enabled!==true||transport?.from!=='info@cantik.co.jp')return {accepted:false,notSent:true,reason:'メール送信の接続確認待ちです。'};
 const secret=await kvGet('review_approve_secret');
 const access=signEmailAccess(plan.record,plan,secret);
 const url='https://meo.cantik.co.jp/api/admin?action=review-confirmation-email&access='+encodeURIComponent(access);
 const text=plan.email.text+'\n\n【原文と返信案を確認して承認・修正・保留】\n'+url+'\nリンクを開くだけではGoogleに送信されません。\nこの確認リンクは7日間有効です。';
 const response=await fetch('https://cantik.co.jp/line/review-mail.php',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({from:'info@cantik.co.jp',to:plan.to,subject:plan.email.subject,text,key}),signal:AbortSignal.timeout(10000)});
 if(!response.ok)return {accepted:false,reason:'メール送信結果を照合する必要があります。'};
 const result=await response.json();return {accepted:result.accepted===true,reference:key};
}
