// 口コミ自動返信の品質ゲート
// ------------------------------------------------------------------
// 設計＝MEOシステム/口コミ自動返信_設計_2026-09.md §4
// 生成したAIの返信を送信前に機械で判定する。1つでも落ちたら送らない。
//
// なぜゲートが本体か:
//   人手で19件のドラフトを作る過程で、同じ品質の失敗を3回繰り返した。
//   ①7件が「ありがとうございます」で始まり同じ文の色違いに見えた
//   ②読点「、」で改行していてAIが書いた文に見えた（社長指摘 2026-09-04）
//   ③文末が「です」ばかりで単調かつ長かった（社長指摘）
//   AIに任せると必ずこの3つが出る。プロンプトだけでは防げないので機械で弾く。
//
// 使い方:
//   import { checkReply, sanitize } from './gate.mjs';
//   const fixed = sanitize(text);                       // 絵文字・空白・URLを機械除去
//   const r = checkReply(fixed, { reviewText, recentReplies });
//   if (!r.ok) { /* r.action === 'regenerate' なら再生成、'stop' なら送信中止 */ }

// 店の非を認める表現の検出（社長叱責 2026-10-06・麻辣王酒場。詳細は _review_safety.js）
import { findAffirm, findUnsupported, findEffectClaims, findRebuttal } from './_review_safety.js';

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}]/gu;
const NG_WORDS = ['治る', '治す', '治り', '完治', '必ず', '確実に', '絶対', 'No.1', 'no.1',
                  '日本一', '最高の', '効果を保証', '保証します', '100%'];
// 語の照合から除く一般語（これを拾っても「相手の言葉に触れた」ことにならない）
const STOP_TERMS = new Set(['ありがとう', 'ございます', 'お店', '今回', '本当', '施術', '対応',
                            '利用', '感じ', 'とても', 'また', 'こちら', '自分', '時間']);

/** 絵文字・不要な空白・電話番号・URLを機械的に除去する（除去で直るものは落とさない） */
export function sanitize(text) {
  return String(text || '')
    .replace(EMOJI, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/0\d{1,4}-\d{2,4}-\d{3,4}/g, '')
    .replace(/[　]/g, '')          // 全角スペース
    .replace(/ {2,}/g, ' ')        // 連続半角スペース
    .replace(/[ \t]+$/gm, '')      // 行末の空白
    .replace(/\n{3,}/g, '\n\n')    // 空行の連続を1つに
    .trim();
}

/**
 * 口コミ本文から「返信で拾うべき語」の候補を出す。
 * 漢字・カタカナの連続だけだと「強さ」「軽く」のような送り仮名つきの語を取り逃す
 * （実測：承認済み19件のうち5件がこれで誤判定された）。漢字＋ひらがな1〜2文字も拾う。
 */
export function keyTerms(reviewText) {
  const s = String(reviewText || '');
  const raw = [
    ...(s.match(/[一-龥ァ-ヶー]{2,6}/g) || []),   // 漢字・カタカナの連続
    ...(s.match(/[一-龥][ぁ-ん]{1,2}/g) || []),   // 漢字＋送り仮名（強さ・軽く・良かった）
  ];
  return [...new Set(raw)].filter(w => w.length >= 2 && !STOP_TERMS.has(w));
}

/**
 * 返信を判定する。
 * @param {string} text 生成された返信（sanitize済みを渡す）
 * @param {object} ctx  { reviewText, recentReplies }
 *   reviewText    … 元の口コミ本文（語の照合に使う。星のみの口コミは空文字でよい）
 *   recentReplies … 同じ店の直近の返信（書き出し重複の判定に使う）
 * @returns {{ok:boolean, action:'send'|'regenerate'|'stop', failed:string[], detail:object}}
 */
// 外国語の返信で見る禁止表現（景表法・薬機法に当たる英語だけ）
const NG_WORDS_EN = ['guarantee', 'guaranteed', 'cure', 'cures', '100%', 'no.1', 'number one',
                     'best in japan', 'always works', 'permanent results'];
const STOP_EN = new Set(['the', 'and', 'was', 'were', 'this', 'that', 'with', 'have', 'had', 'very',
                         'they', 'them', 'your', 'you', 'our', 'for', 'from', 'here', 'there',
                         'been', 'will', 'would', 'could', 'about', 'when', 'what', 'than', 'then',
                         'really', 'again', 'also', 'just', 'much', 'more', 'most', 'some', 'thank',
                         'thanks', 'good', 'great', 'nice', 'time', 'place', 'staff', 'service']);

/** かなが無ければ日本語ではない（漢字は中国語と共通なので、かなの有無で見る） */
function isJa(s) { return /[぀-ヿ]/.test(String(s || '')); }

/**
 * 外国語の返信を判定する。
 * 日本語向けの基準（字数70〜130・読点改行・敬語・です連続）は外国語に当てても意味がなく、
 * 実測では英語の返信が「323字」として必ず落ちていた（2026-09-13）。
 * 単語数で測り、「相手の言葉を拾う」「定型で始めない」「禁止表現なし」は日本語版と同じ思想で見る。
 */
function checkReplyForeign(text, { reviewText = '', recentReplies = [], negative = false } = {}) {
  const t = String(text || '');
  const blocks = t.split(/\n\s*\n/).filter(b => b.trim());
  const words = t.split(/\s+/).filter(Boolean);
  const failed = [];
  const detail = { lang: 'foreign', words: words.length, blocks: blocks.length, len: t.replace(/\s/g, '').length };

  // ★3以下は社長の型を訳した4文（約30〜60語・1ブロック）なので、語数とブロック数の基準を変える
  const wmin = negative ? 20 : 45;
  if (words.length < wmin || words.length > 130) failed.push(`語数が範囲外（${words.length}語・許容${wmin}〜130）`);
  if (!negative && (blocks.length < 2 || blocks.length > 3)) failed.push(`ブロック数が${blocks.length}（2〜3にする）`);
  if (EMOJI.test(t)) failed.push('絵文字が残っている');
  if (/https?:\/\/|0\d{1,4}-\d{2,4}-\d{3,4}/.test(t)) failed.push('電話番号かURLが残っている');
  if (isJa(t)) failed.push('外国語の口コミに日本語が混ざっている');

  const low = t.toLowerCase();
  const ng = NG_WORDS_EN.filter(w => low.includes(w));
  detail.ngWords = ng;
  if (ng.length) return { ok: false, action: 'stop', failed: [`禁止語: ${ng.join('・')}`], detail };

  const af = findAffirm(t, reviewText);
  detail.affirm = [...af.affirm, ...af.restated];
  if (detail.affirm.length) failed.push(`店の非を認める表現（${detail.affirm.slice(0, 3).join('・')}）`);
  const un = findUnsupported(t, reviewText);
  detail.unsupported = [...un.storeInfo, ...un.visit];
  if (detail.unsupported.length) failed.push(`口コミに無い店の情報・来店状況（${detail.unsupported.slice(0, 3).join('・')}）`);

  const rvWords = [...new Set(String(reviewText).toLowerCase().match(/[a-z][a-z'-]{3,}/g) || [])]
    .filter(w => !STOP_EN.has(w));
  if (!negative && rvWords.length >= 3) {
    const hit = rvWords.filter(w => low.includes(w.slice(0, Math.max(4, w.length - 2))));
    detail.termsHit = hit.slice(0, 5);
    if (!hit.length) failed.push('口コミ本文の語を1つも拾っていない');
  }

  if (!negative && /^(thank you|thanks|we are (so )?glad|we're (so )?glad|dear )/i.test(t.trim())) {
    failed.push('定型の挨拶で書き出している（相手が書いた点への反応から入る）');
  }
  const thanks = (low.match(/thank/g) || []).length;
  detail.thanksCount = thanks;
  if (thanks >= (negative ? 3 : 3)) failed.push(`"thank" が${thanks}回（1〜2回にする）`);

  const head = t.slice(0, 12);
  const tail = t.trim().slice(-16);
  if (recentReplies.some(r => String(r || '').slice(0, 12) === head)) failed.push('直近の返信と書き出しが重複');
  if (recentReplies.slice(-3).some(r => String(r || '').trim().slice(-16) === tail)) failed.push('直近の返信と締めが重複');

  return { ok: failed.length === 0, action: failed.length ? 'regenerate' : 'send', failed, detail };
}

// negative=true … ★3以下の返信（社長の見本の型：お礼→ご期待に沿えず→店内で共有し見直す→お礼）。
//   見本は「この度はご来店いただき」で始まり「ありがとう」が2回・約130字なので、その形を通す。
//   相手の言葉を拾う判定はしない（悪口を拾うと言い直し＝肯定になるため）。
export function checkReply(text, { reviewText = '', recentReplies = [], negative = false } = {}) {
  // 口コミか返信のどちらかが日本語でなければ外国語の基準で見る
  //   ★3以下の星だけの口コミ（本文が空）は、日本語の返信を日本語の基準で見る
  //   （自動送信を止めて全件グループ確認にしたので、★4-5の星のみも日本語の基準で見る・2026-10-07）
  const starOnly = !String(reviewText || '').trim();
  if ((!isJa(reviewText) && !starOnly) || !isJa(text)) {
    return checkReplyForeign(text, { reviewText, recentReplies, negative });
  }
  const t = String(text || '');
  const lines = t.split('\n').filter(l => l.trim());
  const blocks = t.split(/\n\s*\n/).filter(b => b.trim());
  const sents = t.replace(/\n/g, '').split(/(?<=。)/).filter(s => s.trim());
  const len = t.replace(/\s/g, '').length;

  const failed = [];
  const detail = { len, blocks: blocks.length, sentences: sents.length };

  // 1. 読点で改行していない（最終行以外が「、」で終わらない）
  const commaBreaks = lines.slice(0, -1).filter(l => l.trimEnd().endsWith('、')).length;
  detail.commaBreaks = commaBreaks;
  if (commaBreaks > 0) failed.push('読点で改行している');

  // 2. 「です。」が3連続していない
  let run = 0, maxRun = 0;
  for (const s of sents) {
    if (s.trimEnd().endsWith('です。')) { run++; maxRun = Math.max(maxRun, run); }
    else run = 0;
  }
  detail.desuRun = maxRun;
  if (maxRun >= 3) failed.push('文末「です」が3連続');

  // 3. 長さ（80〜130字。星のみの短い返信は50字から許容）
  // 下限は口コミの長さに応じて変える。短い口コミに長い返信を返すのは不自然。
  //（実測：17字の口コミ「ハルさんありがとう。またよろしく。」への67字の返信が
  //  固定下限70字で落ちた。承認済み19件の実測下限は70字だが、それは本文のある口コミ）
  const rvLen = reviewText.trim().length;
  const min = negative ? 50 : rvLen === 0 ? 40 : rvLen < 20 ? 50 : 70;
  const max = negative ? 180 : 130;
  if (len < min || len > max) failed.push(`字数が範囲外（${len}字・許容${min}〜${max}）`);

  // 4. 空行で2〜3ブロック（★3の短い返信は1ブロックも可）
  if (blocks.length < (negative ? 1 : 2) || blocks.length > 3) failed.push(`ブロック数が${blocks.length}（2〜3にする）`);

  // 4-2. 事実を認める表現・相手の悪口の言い直し（社長叱責 2026-10-06・麻辣王酒場）
  //   「ご指摘のとおりです」「〜させてしまい」は、相手の主張を店の公式見解にする。
  //   ★3以下は、店の細かい内容（調整できます・ご用意しております等）も書かない（分からないため）。
  const af = findAffirm(t, reviewText);
  detail.affirm = [...af.affirm, ...af.restated];
  if (detail.affirm.length) failed.push(`事実を認める表現（${detail.affirm.slice(0, 3).join('・')}）`);
  // 4-3. 口コミに書かれていない店の情報・来店状況の決めつけ（社長叱責 2026-10-07・§1-42）
  const un = findUnsupported(t, reviewText);
  detail.unsupported = [...un.storeInfo, ...un.visit];
  if (un.storeInfo.length) failed.push(`口コミに無い店の情報（${un.storeInfo.slice(0, 3).join('・')}）`);
  if (un.visit.length) failed.push(`来店状況の決めつけ（${un.visit.slice(0, 3).join('・')}）`);
  const ef = findEffectClaims(t);
  if (ef.length) failed.push(`効果の言い切り（${ef.slice(0, 3).join('・')}）`);
  const rb = findRebuttal(t);
  if (rb.length) failed.push(`言い返し・正当化（${rb.slice(0, 3).join('・')}）`);
  if (negative) {
    detail.specific = af.specific;
    if (af.specific.length) failed.push(`店の細かい内容を書いている（${af.specific.slice(0, 3).join('・')}）`);
  }

  // 5-6. 絵文字・空白（sanitizeで消えているはず。残っていたら実装の穴）
  if (EMOJI.test(t)) failed.push('絵文字が残っている');
  if (/[　]|[ \t]{2,}/.test(t)) failed.push('余分な空白が残っている');  // 改行は空白として数えない

  // 7. 禁止語 → これだけは再生成せず送信中止（プロンプトの問題ではなく事実誤認の疑い）
  const ng = NG_WORDS.filter(w => t.includes(w));
  detail.ngWords = ng;
  if (ng.length) {
    return { ok: false, action: 'stop', failed: [`禁止語: ${ng.join('・')}`], detail };
  }

  // 8. 相手の言葉を1つ以上拾っているか（テンプレ化を防ぐ最重要ゲート）
  //    ただし「なかなか良かった」のような20字未満の口コミは拾える語が無いので免除する。
  //    活用形が変わると照合できない（口コミ「楽しみ」→返信「楽しんで」）ため、
  //    漢字2文字以上の語は語幹（先頭2文字）でも照合する。
  const rv = reviewText.trim();
  if (negative) {
    detail.termsHit = ['(★3の返信は相手の指摘を拾わない)'];
  } else if (rv.length >= 20) {
    const terms = keyTerms(rv);
    const stems = terms.filter(w => /^[一-龥]{2,}/.test(w)).map(w => w.slice(0, 2));
    const hit = [...terms.filter(w => t.includes(w)),
                 ...stems.filter(w => t.includes(w))];
    detail.termsHit = [...new Set(hit)].slice(0, 5);
    if (hit.length === 0) failed.push('口コミ本文の語を1つも拾っていない');
  } else if (rv) {
    detail.termsHit = ['(口コミが短いため免除)'];
  }

  // 8-2. 定型の挨拶で書き出していないか（AIが最も選びがちな型）
  //   「お世話になっております。」で全件始めると、11件並んだときに同じ文の色違いに見える。
  //   社長指摘 2026-09-04「。でです。ばかり」「ありがとうございます が多い」に対応。
  const OPENERS = ['お世話になっております', 'いつもお世話に', 'この度はご利用', 'この度はご来店',
                   'ありがとうございます', 'ありがとうございました'];
  const head12 = t.slice(0, 12);
  if (!negative && OPENERS.some(o => head12.startsWith(o))) {
    failed.push('定型の挨拶で書き出している（相手の言葉への反応から入る）');
  }

  // 8-3. 「ありがとう」が2回以上出ていないか（お礼は1回で足りる）
  //   ★3以下は社長の見本が冒頭と締めの2回なので、3回以上だけ落とす。
  const thanks = (t.match(/ありがとう/g) || []).length;
  detail.thanksCount = thanks;
  if (thanks >= (negative ? 3 : 2)) failed.push(`「ありがとう」が${thanks}回（${negative ? '2' : '1'}回までにする）`);

  // 8-4. 敬語が崩れていないか（字数を縮めるとAIが「です・ます」を落とす）
  //   実測 2026-09-06：130字以内に絞ったところ「大変光栄だ」「揉みほぐした」「来店を待つ」
  //   のように常体になった。ただし「またどうぞ。」「スタートでしたね。」は丁寧な表現なので通す。
  //   （最初にホワイトリストだけで判定したら承認済み19件のうち6件を誤検知した）
  //   → 丁寧な語尾を広く許し、常体の語尾に当たるものだけを弾く。
  const POLITE_END = /(です|ます|ました|ません|でした|ください|ください|ませ|ございます|ございました|いたします|おります|思います|申し上げます|どうぞ|ですね|ますね|でしたね|ましたね|でしょう|ありません)。$/;
  const PLAIN_END = /(だ|である|った|えた|いた|した|する|なる|ある|いる|待つ|思う|なった|くれた)。$/;
  const plain = sents.filter(x => {
    const y = x.trim();
    if (!y.endsWith('。')) return false;
    if (POLITE_END.test(y)) return false;     // 丁寧なら通す
    return PLAIN_END.test(y);                  // 常体の語尾に当たるものだけ弾く
  });
  detail.plainSentences = plain.map(x => x.trim().slice(-12));
  if (plain.length) failed.push(`敬語が崩れている文が${plain.length}つ（${plain[0].trim().slice(-10)}）`);

  // 9. 直近の返信と書き出し・締めが重複していない
  //   書き出しだけ見ていると、締めが全部「またのご来店を心よりお待ちしております。」で揃う
  //   （実測 2026-09-06：3回生成して3回とも同じ締めになった）。末尾も見る。
  const head = t.slice(0, 8);
  const tail = t.trim().slice(-12);
  const dupHead = recentReplies.filter(r => String(r || '').slice(0, 8) === head).length;
  // 締めは言い回しの選択肢が書き出しより少ないので、直近3件だけ見る
  //（5件で判定したら承認済み19件のうち2件が落ちた＝現実的でない厳しさだった）
  const dupTail = recentReplies.slice(-3).filter(r => String(r || '').trim().slice(-12) === tail).length;
  detail.headDup = dupHead;
  detail.tailDup = dupTail;
  // ★3の返信は書き出し（ご来店ありがとうございます）と締め（ご意見参考に）を社長指示で固定しているので見ない
  if (!negative && dupHead > 0) failed.push('直近の返信と書き出しが重複');
  if (!negative && dupTail > 0) failed.push('直近の返信と締めが重複');

  // 10. 電話番号・URL（sanitizeで消えているはず）
  if (/https?:\/\/|0\d{1,4}-\d{2,4}-\d{3,4}/.test(t)) failed.push('電話番号かURLが残っている');

  return { ok: failed.length === 0, action: failed.length ? 'regenerate' : 'send', failed, detail };
}
