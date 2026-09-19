// Мобільне меню: слайд-панель справа зі stagger-появою пунктів
(function () {
  var burger = document.querySelector('.burger');
  var menu = document.getElementById('mobile-menu');
  var backdrop = document.getElementById('menu-backdrop');
  if (!burger || !menu) return;

  function set(open) {
    menu.classList.toggle('open', open);
    if (backdrop) backdrop.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.body.style.overflow = open ? 'hidden' : '';
  }
  set(false);

  burger.addEventListener('click', function (e) {
    e.stopPropagation();
    set(burger.getAttribute('aria-expanded') !== 'true');
  });
  if (backdrop) backdrop.addEventListener('click', function () { set(false); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && burger.getAttribute('aria-expanded') === 'true') { set(false); burger.focus(); }
  });
})();
