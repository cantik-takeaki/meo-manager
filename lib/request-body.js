import crypto from 'node:crypto';
export async function readJsonBody(req,max=4*1024*1024){
 let raw=Buffer.alloc(0);
 if(req.body && !Buffer.isBuffer(req.body)) throw new Error('未検証の本文');
 if(Buffer.isBuffer(req.body))raw=req.body;
 else for await(const chunk of req){raw=Buffer.concat([raw,Buffer.from(chunk)]);if(raw.length>max)throw new Error('本文が大きすぎます');}
 if(raw.length>max)throw new Error('本文が大きすぎます');
 return {raw,value:raw.length?JSON.parse(raw.toString('utf8')):{}};
}
export function validMetaSignature(raw,signature,secret){
 if(!secret||typeof signature!=='string'||!/^sha256=[a-f0-9]{64}$/.test(signature))return false;
 const expected='sha256='+crypto.createHmac('sha256',secret).update(raw).digest('hex');
 return crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected));
}
