// api/_sanitize.js — GBPへ出す文章の最終ゲート（2026-10-21）
//
// 経緯：生成プロンプトには「絵文字は絶対に使わない」と書いてあったが、生成後に落とす処理が
// 無かったため素通りしていた。管理19店の投稿319件中204件（64%）に絵文字が入っていた
// （cantik自社のGBPだけ0件＝別系統の tools/gbp-daily-poster に絵文字検査があったため）。
// 指示は守られるとは限らない。**出口で機械的に落とす。**
//
// 判定は社内の既存実装に合わせる（tools/gbp-daily-poster/posts_round2.py の EMOJI / BANNED）。

// 絵文字・記号・異体字セレクタ・ZWJ。社内実装（posts_round2.py の EMOJI）と**同じ範囲に揃える**。
// 2026-10-21: 最初に矢印（U+2190-21FF, U+2900-297F）とU+2B00-2BFFを足したが誤り。
//   「18,900円 → 12,800円」の「→」まで消えて値下げ表示が壊れた。矢印は絵文字ではない。
//   実データで検証して気づいた。範囲を広げるときは必ず本番の実文で確かめる。
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}]/gu;

// 景表法で根拠が要る語。**自動では消さない**（「人気No.1」を黙って消すと主張が変わるため）。
// 呼び出し側に返して見せる。
const NG_WORDS = ['No.1', 'NO.1', 'ナンバーワン', '日本一', '世界一', '業界最安', '最安値', '最安',
                  '必ず', '絶対', '完全に治', '保証します', '1位獲得'];

/** 絵文字を落とす。落としたぶんの空白の重なりも整える。 */
export function stripEmoji(text) {
  const s = String(text ?? '');
  const out = s.replace(EMOJI, '');
  return {
    text: out
      .replace(/[ \t　]{2,}/g, ' ')      // 絵文字が消えてできた連続空白
      .replace(/^[ \t　]+/gm, (m) => m)  // 行頭のインデントは保つ
      .replace(/[ \t　]+$/gm, '')        // 行末の空白は落とす
      .replace(/\n{3,}/g, '\n\n'),
    removed: (s.match(EMOJI) || []).length,
  };
}

/** 景表法で根拠が要る語を拾う（消さない）。 */
export function findNgWords(text) {
  const s = String(text ?? '');
  return NG_WORDS.filter((w) => s.includes(w));
}

/**
 * GBPへ出す本文の最終処理。
 * 絵文字は落とす（絶対遵守§1-1・全面禁止）。景表法の語は落とさず報告する。
 */
export function sanitizeForGbp(text) {
  const { text: clean, removed } = stripEmoji(text);
  return { text: clean, emojiRemoved: removed, ngWords: findNgWords(clean) };
}
