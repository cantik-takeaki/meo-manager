const closing = 'この度は誠にありがとうございました。';
const signatures = new Map([
  ['イヤーエステ 耳舎', 'イヤーエステ耳舎'],
  ['新大久保 フラワーカフェ KISS BERRY （キスベリー）', 'KISS BERRY'],
  ['台湾式マッサージ 禅（ZEN）リラクゼーション', '禅'],
  ['美康堂 整体・リンパ・健美リラクゼーション池袋店', '美康堂'],
]);

export const ownerReplyStyle = '店舗のスタッフとして、口コミにある具体的な一点に丁寧な日本語で応えてください。感想の丸写し、宣伝、過度な敬語、同じ語尾の繰り返しを避けてください。句点で改行し、読点は意味の切れ目にだけ使ってください。定型のお礼と署名はシステムで付けるため、本文だけを書いてください。';

const regularVisit = /(?:いつも|毎回|何度も)(?:こちらを|このお店を|ここを)?(?:利用して|通って|お世話に|お願いして)|(?:二|三|[2-9２-９])回目の(?:来店|訪問|利用)|(?:my|our) (?:second|third) visit|(?:I|we) (?:come|visit) regularly/iu;
const greetingLine = /^(?:(?:この度は|いつも)?(?:ご来店|ご利用|ご依頼|ご来院|お越し)(?:いただき|くださり)[、,]?ありがとうございます|ご評価いただきありがとうございます)。/u;

export function formatOwnerReply(content, storeName, review = '') {
  const name = String(storeName || '').trim().normalize('NFC');
  let body = String(content || '').normalize('NFC').trim();
  // Strip only our fixed ending. Preserve approved wording inside the body.
  body = body.split(closing)[0].trim().replace(/\n-[^\n]+-$/u, '').trim();
  body = body.replace(/。[^\S\n]*(?:\n\s*)?/gu, '。\n').trim();
  if (!body || !name || /[\r\n]/u.test(name)) return '';
  if (/[\u3099\u309a\u309b\u309c]/u.test(body)) return '';
  const greeting = regularVisit.test(review) ? 'いつもご利用いただきありがとうございます。'
    : !String(review).trim() ? 'ご評価いただきありがとうございます。'
    : /株式会社|レンタカー|清掃|ホームページ/u.test(name) ? 'この度はご利用いただきありがとうございます。'
    : 'ご来店いただきありがとうございます。';
  body = body.replace(greetingLine, '').trim();
  return [greeting, body].filter(Boolean).join('\n\n') + '\n\n' + closing + '\n-' + (signatures.get(name) || name) + '-';
}
