import {confirmationPlan,confirmationEml} from './review-confirmation.js';
import {unavailableCard} from '../api/_review_line.js';

// 読み取り専用。通知・返信公開・確認先設定の保存は行わない。
export async function prepareConfirmationPreview({config,ids,readRecord,paused=[],cursor=0}){
 if(!Number.isInteger(cursor)||cursor<0||!Array.isArray(ids)||ids.some(x=>typeof x!=='string'))throw new Error('確認待ちの読み取り位置を確認してください。');
 const page=ids.slice(cursor,cursor+100),records=await Promise.all(page.map(readRecord));
 const plans=confirmationPlan(records.filter(Boolean),{...config,enabled:false},p=>unavailableCard(p,paused)).map(p=>p.email?{...p,email:{...p.email,eml:confirmationEml(p.email)}}:p);
 return {plans,next:cursor+page.length<ids.length?cursor+page.length:null,queueCount:ids.length,mode:'preview-only',sent:0,published:0};
}
