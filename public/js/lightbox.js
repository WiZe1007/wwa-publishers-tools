// Повноекранний перегляд зображень: openLightbox(src)
(function () {
  const lb = document.createElement('div');
  lb.id = 'lightbox';
  lb.innerHTML = '<img alt=""><span id="lb-close">✕</span>';
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(lb));
  const img = lb.querySelector('img');
  const close = () => { lb.classList.remove('open'); setTimeout(() => { img.src = ''; }, 200); };
  lb.onclick = close;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  window.openLightbox = src => { img.src = src; lb.classList.add('open'); };
})();
