// Прожектор, що слідкує за курсором на картках (Linear-style spotlight)
(function () {
  let els = [];
  const collect = () => { els = [...document.querySelectorAll('.card, .tile')]; };
  document.addEventListener('DOMContentLoaded', collect);
  new MutationObserver(collect).observe(document.documentElement, { childList: true, subtree: true });

  let raf = null;
  document.addEventListener('pointermove', e => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = null;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (e.clientX < r.left - 100 || e.clientX > r.right + 100 ||
            e.clientY < r.top - 100 || e.clientY > r.bottom + 100) continue;
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      }
    });
  }, { passive: true });
})();
