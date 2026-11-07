// 口コミ本文を組み立てる部品にだけ適用する。お客様の自由記述や引用には適用しない。
export function reviewSpelling(text) {
  return text.replaceAll('きれい','綺麗')
    .replace(/おいし([いくか])/gu,'美味し$1')
    .replaceAll('おすすめしたい','人に勧めたい')
    .replaceAll('人にもすすめたい','人にも勧めたい')
    .replaceAll('ちょうどよ','ちょうど良');
}

export function polishGeneratedSentences(sentences) {
  let usedDesu=false;
  return sentences.map(sentence=>{
    let line=reviewSpelling(sentence);
    if(line.endsWith('です。')){
      // 続く感想は短い常体にする。ただし形容詞に「でした」は接続しない。
      if(usedDesu)line=line.replace(/です。$/u,'。');
      usedDesu=true;
    }
    return line;
  }).join('');
}
