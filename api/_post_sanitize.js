// GBP投稿の本文を、Googleへ送る直前に機械で整える（社長指示 2026-10-06/07）
// ------------------------------------------------------------------
// なぜ送信口に置くか：
//   投稿文の生成（generate-content.js）は絵文字を消す作りだが、
//   アプリ外（ChatGPT等）で作った絵文字入りの文を人が貼り付けて投稿すると、そのまま公開されていた
//   （クライアント17店の投稿201件中126件に絵文字・📍・【】。出どころは手作業の貼り付けで、
//    このMacの自動処理ではない＝2026-10-07 調査）。生成だけでなく「投稿の瞬間」にも通して塞ぐ。
// やること：絵文字の除去／冒頭の【…】見出し行の除去／末尾の住所・店名だけの行の除去／空白の正規化。
// やらないこと：本文の意味を変える書き換えはしない（AIは通さない）。

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F1E6}-\u{1F1FF}\u{1F900}-\u{1F9FF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{FE00}-\u{FE0F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}]/gu;

export function sanitizePostText(text, storeName = '') {
  let s = String(text || '').replace(EMOJI, '');
  let lines = s.split('\n');
  // 先頭の【…】や ■◆●▶ だけの見出し行（句点を含まない短い行）を落とす
  while (lines.length && /^[\s　]*[【［\[■◆●▶].{0,40}$/.test(lines[0]) && !/[。．！？]/.test(lines[0])) lines.shift();
  // 末尾の、住所・店名・アクセスだけの行を落とす（本文ではない貼り付け）
  const sName = String(storeName || '').trim();
  const isFooter = (l) => {
    const t = l.trim();
    if (!t) return true;
    if (sName && (t === sName || t.replace(/[（(].*$/, '') === sName)) return true;
    if (/^〒?\s*[都道府県]/.test(t) && !/[。！？]/.test(t)) return true;
    return /(丁目|番地|[0-9]-[0-9]|ビル|階|駅(から)?徒歩)/.test(t) && t.length < 40 && !/[。！？]/.test(t);
  };
  while (lines.length && isFooter(lines[lines.length - 1])) lines.pop();
  return lines.join('\n')
    .replace(/[ \t　]{2,}/g, ' ')
    .replace(/[ \t　]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 変わったかどうかも返す（ログ用） */
export function sanitizePostInfo(text, storeName = '') {
  const before = String(text || '');
  const after = sanitizePostText(before, storeName);
  return { text: after, changed: after !== before, hadEmoji: EMOJI.test(before) };
}
