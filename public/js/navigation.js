import { initView } from './view.js';
import { animateEntrance, cancelEntrance } from './motion.js';

const loaders = {
  zip: () => import('./tools/zip.js'),
  resize: () => import('./tools/resize.js'),
  convert: () => import('./tools/convert.js'),
  merge: () => import('./tools/merge.js')
};
const routes = new Set(['index', ...Object.keys(loaders)]);

export async function startNavigation(closeMenu) {
  const cache = new Map();
  let sequence = 0;
  const routeFor = url => {
    if (url.origin !== location.origin || url.hash) return null;
    const match = url.pathname.match(/^\/(index|zip|resize|convert|merge)\.html$/);
    return url.pathname === '/' ? 'index' : match?.[1] || null;
  };
  function entryFrom(doc, route) {
    const root = doc.querySelector('main');
    if (!root || !routes.has(route)) throw new Error('Invalid workspace page');
    return { root, route, title: doc.title, bodyClass: doc.body.className,
      breadcrumb: doc.querySelector('.breadcrumb > span:last-child').textContent,
      footer: doc.querySelector('.app-footer').innerHTML, scroll: 0 };
  }
  async function initialize(entry) {
    if (loaders[entry.route]) (await loaders[entry.route]()).mount(entry.root);
    initView(entry.root, entry.route);
    return entry;
  }
  let current = entryFrom(document, routeFor(new URL(location.href)) || 'index');
  cache.set(current.route, initialize(current));
  await cache.get(current.route);
  animateEntrance(current.root, { initial: true });
  history.scrollRestoration = 'manual';

  const announcement = document.createElement('div');
  announcement.className = 'sr-only';
  announcement.setAttribute('role', 'status');
  document.body.append(announcement);

  function load(route) {
    if (!cache.has(route)) {
      const pending = Promise.all([
        fetch(route + '.html').then(response => {
          if (!response.ok) throw new Error('Page unavailable');
          return response.text();
        }),
        loaders[route]?.()
      ]).then(async ([html]) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        return initialize(entryFrom(doc, route));
      }).catch(error => { cache.delete(route); throw error; });
      cache.set(route, pending);
    }
    return cache.get(route);
  }

  async function navigate(route, url, fromHistory = false) {
    const request = ++sequence;
    closeMenu();
    if (route === current.route) return;
    announcement.textContent = 'Відкриваю інструмент…';
    try {
      const next = await load(route);
      if (request !== sequence) return;
      current.scroll = window.scrollY;
      cancelEntrance();
      current.root.replaceWith(next.root);
      current = next;
      document.title = next.title;
      document.body.className = next.bodyClass;
      document.querySelector('.breadcrumb > span:last-child').textContent = next.breadcrumb;
      document.querySelector('.app-footer').innerHTML = next.footer;
      document.querySelectorAll('.top-nav a').forEach(link => {
        const active = routeFor(new URL(link.href)) === route;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
      });
      if (!fromHistory) history.pushState(null, '', url);
      window.scrollTo({ top: fromHistory ? next.scroll : 0, behavior: 'instant' });
      const heading = next.root.querySelector('h1');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      animateEntrance(next.root);
      announcement.textContent = next.breadcrumb;
    } catch {
      // Direct URLs remain functional if fetching or module loading fails.
      if (request === sequence) location.assign(url);
    }
  }
  document.addEventListener('click', event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest('a[href]');
    if (!link || link.target || link.hasAttribute('download')) return;
    const url = new URL(link.href);
    const route = routeFor(url);
    if (!route) return;
    event.preventDefault();
    navigate(route, url.pathname + url.search);
  });
  // Prepare only links the user points to, not every tool on initial load.
  function warm(event) {
    if (navigator.connection?.saveData) return;
    const link = event.target.closest('a[href]');
    if (!link) return;
    const route = routeFor(new URL(link.href));
    if (route && route !== current.route) load(route).catch(() => {});
  }
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('focusin', warm);
  window.addEventListener('popstate', () => {
    const route = routeFor(new URL(location.href));
    if (route) navigate(route, location.pathname, true);
    else location.reload();
  });
}
