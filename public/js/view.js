export function initView(root, route) {
  const get = id => root.querySelector('#' + CSS.escape(id));
    root.querySelectorAll('.drop').forEach(drop => {
      drop.setAttribute('role', 'button');
      drop.tabIndex = 0;
      drop.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); drop.click(); }
      });
    });
    root.querySelectorAll('.status').forEach(status => {
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    });
    const thumbs = get('thumbs');
    const fileCount = root.querySelector('.file-count');
    if (thumbs && fileCount) {
      const updateCount = () => {
        const count = thumbs.children.length;
        const form = new Intl.PluralRules('uk').select(count);
        fileCount.textContent = count + ' ' + ({one: 'файл', few: 'файли', many: 'файлів'}[form] || 'файлів');
      };
      // Observe this one list, only when files are added/removed.
      new MutationObserver(updateCount).observe(thumbs, { childList: true });
      updateCount();
    }

    root.querySelectorAll('.tones').forEach(group => {
      group.setAttribute('role', 'radiogroup');
      group.setAttribute('aria-label', group.id === 'sizes' ? 'Обсяг опису' : 'Стиль опису');
      const choices = [...group.querySelectorAll('.tone')];
      function syncChoices() {
        choices.forEach(choice => {
          const selected = choice.classList.contains('sel');
          choice.setAttribute('role', 'radio');
          choice.setAttribute('aria-checked', String(selected));
          choice.tabIndex = selected ? 0 : -1;
        });
      }
      choices.forEach((choice, index) => {
        choice.addEventListener('click', syncChoices);
        choice.addEventListener('keydown', event => {
          if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); choice.click(); }
          const delta = ['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 0;
          if (delta) { event.preventDefault(); const next = choices[(index + delta + choices.length) % choices.length]; next.click(); next.focus(); }
        });
      });
      syncChoices();
    });

    if (route === 'zip') {
      get('manualCopyBtn')?.addEventListener('click', event => {
        get('asoResults').style.display = '';
        event.currentTarget.setAttribute('aria-expanded', 'true');
        get('shortDesc').focus();
      });
    }
}
