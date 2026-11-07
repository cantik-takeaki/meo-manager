// 閉じ括弧は直前の文に残し、既に改行されている箇所には空行を作らない。
function sentenceLines(text) {
  return text.replace(/(。[」』”’）】〉》〕］)]*)(?![」』”’）】〉》〕］)])/gu,
    (ending, _group, offset) => {
      const next = text[offset + ending.length];
      return next && next !== '\n' && next !== '\r' ? ending + '\n' : ending;
    });
}
if (typeof module === 'object' && module.exports) module.exports = sentenceLines;
else window.reviewSentenceLines = sentenceLines;
