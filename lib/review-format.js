const closing = 'この度は誠にありがとうございました。';
const signatures = new Map([
  ['イヤーエステ 耳舎', 'イヤーエステ耳舎'],
  ['新大久保 フラワーカフェ KISS BERRY （キスベリー）', 'KISS BERRY'],
  ['台湾式マッサージ 禅（ZEN）リラクゼーション', '禅'],
  ['美康堂 整体・リンパ・健美リラクゼーション池袋店', '美康堂'],
]);

export const ownerReplyStyle = '店舗のスタッフとして、口コミにある具体的な一点に丁寧な日本語で応えてください。感想の丸写し、宣伝、過度な敬語、同じ語尾の繰り返しを避けてください。句点で改行し、読点は意味の切れ目にだけ使ってください。定型のお礼と署名はシステムで付けるため、本文だけを書いてください。';

export function formatOwnerReply(content, storeName) {
  const name = String(storeName || '').trim().normalize('NFC');
  let body = String(content || '').normalize('NFC').trim();
  // Strip only our fixed ending. Preserve approved wording inside the body.
  body = body.split(closing)[0].trim().replace(/\n-[^\n]+-$/u, '').trim();
  body = body.replace(/。[^\S\n]*(?:\n\s*)?/gu, '。\n').trim();
  if (!body || !name || /[\r\n]/u.test(name)) return '';
  if (/[\u3099\u309a\u309b\u309c]/u.test(body)) return '';
  return body + '\n\n' + closing + '\n-' + (signatures.get(name) || name) + '-';
}
