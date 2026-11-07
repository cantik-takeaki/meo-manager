// 自由記述は記録しない。候補番号だけを同じタブの作り直しに使う。
(() => {
  const memory = new Map();
  function read(key) {
    if (memory.has(key)) return memory.get(key);
    try { return JSON.parse(sessionStorage.getItem('reviewVariants:'+key)) || []; }
    catch { return []; }
  }
  function remember(key, variant) {
    if (!Number.isInteger(variant)) return;
    const recent = [...read(key).filter(n => n !== variant),variant].slice(-8);
    memory.set(key,recent);
    try { sessionStorage.setItem('reviewVariants:'+key,JSON.stringify(recent)); } catch {}
  }
  window.reviewVariants = {read,remember};
})();
