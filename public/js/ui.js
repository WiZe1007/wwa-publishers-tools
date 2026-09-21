import { startNavigation } from './navigation.js';
import { startBackdrop } from './backdrop.js';

// Match ASO Checker's two glass appearances without recreating the backdrop.
const themeButton = document.querySelector('.theme-toggle');
let theme = 'light';
try { theme = localStorage.getItem('wwa.publishers.theme') === 'dark' ? 'dark' : 'light'; } catch {}
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  themeButton?.setAttribute('aria-pressed', String(dark));
  const label = dark ? 'Увімкнути світлу тему' : 'Увімкнути темну тему';
  themeButton?.setAttribute('aria-label', label);
  if (themeButton) {
    themeButton.title = label;
    themeButton.querySelector('svg').innerHTML = dark
      ? '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>'
      : '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>';
  }
}
themeButton?.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  applyTheme();
  try { localStorage.setItem('wwa.publishers.theme', theme); } catch {}
});
applyTheme();

// The header and video live for the whole session; only the tool view changes.
const menu = document.querySelector('.menu-button');
const header = document.querySelector('.workspace-header');
function setMenu(open) {
  document.body.classList.toggle('nav-open', open);
  menu?.setAttribute('aria-expanded', String(open));
  menu?.setAttribute('aria-label', open ? 'Закрити меню' : 'Відкрити меню');
}
menu?.addEventListener('click', () => setMenu(!document.body.classList.contains('nav-open')));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.body.classList.contains('nav-open')) {
    setMenu(false); menu?.focus();
  }
});
document.addEventListener('click', event => {
  if (!header.contains(event.target)) setMenu(false);
});
matchMedia('(min-width: 1001px)').addEventListener('change', event => { if (event.matches) setMenu(false); });
startBackdrop();
startNavigation(() => setMenu(false));
