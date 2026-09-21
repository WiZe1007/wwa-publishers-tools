// Short, compositor-only motion; no scroll handlers or continuous effects.
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const running = new Set();
export function cancelEntrance() {
  running.forEach(animation => animation.cancel());
  running.clear();
}
preference.addEventListener('change', () => { if (preference.matches) cancelEntrance(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) cancelEntrance(); });

export function animateEntrance(root, { initial = false } = {}) {
  cancelEntrance();
  if (preference.matches || document.hidden || !root.animate) return;
  const hero = root.querySelector('.home-content');
  const targets = hero ? [...hero.children] : [root];
  targets.forEach((target, index) => {
    const animation = target.animate([
      { opacity: hero ? .25 : .65, transform: `translateY(${hero ? 12 : 5}px)` },
      { opacity: 1, transform: 'translateY(0)' }
    ], {
      duration: hero ? (initial ? 560 : 360) : 200,
      delay: hero ? index * 55 : 0,
      easing: 'cubic-bezier(.22,1,.36,1)',
      fill: 'backwards'
    });
    running.add(animation);
    animation.addEventListener('finish', () => running.delete(animation), { once: true });
  });
}
