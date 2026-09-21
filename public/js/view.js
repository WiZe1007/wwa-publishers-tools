import { animateEntrance } from './motion.js';

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
      const main = root;
      const panels = [...main.querySelectorAll(':scope > .card')];
      const labels = ['Дані додатку', 'Скріншоти', 'Файли', 'ASO описи', 'Експорт'];
      const tabs = document.createElement('div');
      tabs.className = 'release-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Етапи підготовки релізу');
      const actions = document.createElement('div');
      actions.className = 'step-actions';
      actions.innerHTML = '<span class="step-counter"></span><div><button type="button" class="btn secondary" id="previousStep">Назад</button><button type="button" class="btn" id="nextStep">Далі →</button></div>';
      let current = 0;
      function select(index, focus = false) {
        const previous = current;
        current = Math.max(0, Math.min(panels.length - 1, index));
        panels.forEach((panel, i) => {
          panel.hidden = i !== current;
          const tab = tabs.children[i];
          tab.setAttribute('aria-selected', String(i === current));
          tab.tabIndex = i === current ? 0 : -1;
        });
        actions.querySelector('.step-counter').textContent = 'Крок ' + (current + 1) + ' із ' + panels.length;
        actions.querySelector('#previousStep').disabled = current === 0;
        actions.querySelector('#nextStep').hidden = current === panels.length - 1;
        if (previous !== current && root.isConnected) animateEntrance(panels[current]);
        if (focus) { tabs.children[current].focus(); tabs.children[current].scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
      }
      panels.forEach((panel, index) => {
        panel.classList.add('release-panel');
        panel.id = 'release-step-' + index;
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-labelledby', 'release-tab-' + index);
        const tab = document.createElement('button');
        tab.type = 'button'; tab.id = 'release-tab-' + index;
        tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', panel.id);
        tab.innerHTML = '<span>0' + (index + 1) + '</span>' + labels[index];
        tab.addEventListener('click', () => select(index));
        tab.addEventListener('keydown', event => {
          let next;
          if (event.key === 'ArrowRight') next = (current + 1) % panels.length;
          if (event.key === 'ArrowLeft') next = (current - 1 + panels.length) % panels.length;
          if (event.key === 'Home') next = 0;
          if (event.key === 'End') next = panels.length - 1;
          if (next !== undefined) { event.preventDefault(); select(next, true); }
        });
        tabs.append(tab);
      });
      panels[0].before(tabs);
      main.append(actions);
      actions.querySelector('#previousStep').addEventListener('click', () => select(current - 1, true));
      actions.querySelector('#nextStep').addEventListener('click', () => select(current + 1, true));
      select(0);
    }
}
