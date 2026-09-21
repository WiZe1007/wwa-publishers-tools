// Мікроанімації інтерфейсу: м'яка поява секцій та світло за курсором.
(function () {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let interactivePanels = [];

  function mountBackdrop() {
    if (!document.body.classList.contains('tool-page') || document.querySelector('.tool-bg-video')) return;
    const video = document.createElement('video');
    video.className = 'tool-bg-video';
    video.autoplay = true;
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.setAttribute('aria-hidden', 'true');
    video.poster = 'media/coast-poster.jpg';
    const mobile = document.createElement('source');
    mobile.media = '(max-width: 700px)';
    mobile.type = 'video/mp4';
    mobile.src = 'media/coast-mobile.mp4';
    const desktop = document.createElement('source');
    desktop.type = 'video/mp4';
    desktop.src = 'media/coast-desktop.mp4';
    video.append(mobile, desktop);
    document.body.prepend(video);
    if (reduceMotion) video.remove();
  }

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
    mountBackdrop();
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
