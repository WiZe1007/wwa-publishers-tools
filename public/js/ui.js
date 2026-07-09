// Мікроанімації інтерфейсу: м'яка поява секцій та світло за курсором.
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let interactivePanels = [];

  function collectPanels() {
    interactivePanels = [...document.querySelectorAll('.card, .tile')];
  }

  function revealPanels() {
    if (reduceMotion || !('IntersectionObserver' in window)) return;
    const panels = [...document.querySelectorAll('.home-page .tile')];
    panels.forEach((panel, index) => {
      panel.classList.add('will-reveal');
      panel.style.setProperty('--reveal-delay', `${Math.min(index * 55, 330)}ms`);
    });

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .12 });

    panels.forEach(panel => observer.observe(panel));
  }

  function start() {
    document.body.classList.add('page-loaded');
    collectPanels();
    revealPanels();

    new MutationObserver(collectPanels).observe(document.body, { childList: true, subtree: true });

    if (reduceMotion) return;
    let raf = null;
    document.addEventListener('pointermove', (event) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        interactivePanels.forEach((panel) => {
          const bounds = panel.getBoundingClientRect();
          if (event.clientX < bounds.left - 80 || event.clientX > bounds.right + 80 ||
              event.clientY < bounds.top - 80 || event.clientY > bounds.bottom + 80) return;
          panel.style.setProperty('--mx', `${event.clientX - bounds.left}px`);
          panel.style.setProperty('--my', `${event.clientY - bounds.top}px`);
        });
      });
    }, { passive: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
