/* Shared workspace interactions. No pointer tracking or animated blur. */
(() => {
  'use strict';
  function start() {
    const menu = document.querySelector('.menu-button');
    const backdrop = document.querySelector('.nav-backdrop');
    const sidebar = document.querySelector('.sidebar');
    function setMenu(open) {
      document.body.classList.toggle('nav-open', open);
      menu?.setAttribute('aria-expanded', String(open));
      menu?.setAttribute('aria-label', open ? 'Закрити меню' : 'Відкрити меню');
      if (backdrop) backdrop.hidden = !open;
      document.body.style.overflow = open ? 'hidden' : '';
      if (open) sidebar?.querySelector('a')?.focus();
    }
    menu?.addEventListener('click', () => setMenu(!document.body.classList.contains('nav-open')));
    backdrop?.addEventListener('click', () => { setMenu(false); menu?.focus(); });
    document.addEventListener('keydown', event => {
      if (!document.body.classList.contains('nav-open')) return;
      if (event.key === 'Escape') { setMenu(false); menu?.focus(); }
      if (event.key === 'Tab') {
        const elements = [...sidebar.querySelectorAll('a, button')];
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    matchMedia('(min-width: 761px)').addEventListener('change', event => { if (event.matches) setMenu(false); });

    // One hardware-decoded backdrop, with one glass compositing layer for the whole shell.
    // Motion preferences and a manual pause control keep the workspace accessible.
    const ambient = document.querySelector('.ambient-toggle');
    const scene = document.createElement('div');
    scene.className = 'coastal-scene';
    scene.setAttribute('aria-hidden', 'true');
    document.body.prepend(scene);
    let video;
    const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
    let wantsMotion = !motionPreference.matches;
    function syncBackdropButton() {
      ambient?.setAttribute('aria-pressed', String(wantsMotion));
      if (ambient) ambient.querySelector('span').textContent = wantsMotion ? 'Призупинити відеофон' : 'Відтворити відеофон';
    }
    async function playBackdrop() {
      if (!wantsMotion || document.hidden) return;
      if (!video) {
        video = document.createElement('video');
        video.className = 'coastal-video';
        video.muted = true; video.loop = true; video.playsInline = true;
        video.autoplay = true; video.preload = 'metadata';
        video.setAttribute('aria-hidden', 'true');
        const mobile = matchMedia('(max-width: 700px)').matches;
        video.poster = mobile ? 'media/coast-poster-mobile.jpg' : 'media/coast-poster.jpg';
        video.src = mobile ? 'media/coast-mobile-v2.mp4' : 'media/coast-desktop-v2.mp4';
        scene.append(video);
      }
      try { await video.play(); } catch {
        wantsMotion = false;
        syncBackdropButton();
      }
    }
    ambient?.addEventListener('click', () => {
      wantsMotion = !wantsMotion;
      syncBackdropButton();
      if (wantsMotion) playBackdrop();
      else video?.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) video?.pause();
      else playBackdrop();
    });
    motionPreference.addEventListener('change', event => {
      wantsMotion = !event.matches;
      syncBackdropButton();
      if (wantsMotion) playBackdrop();
      else video?.pause();
    });
    syncBackdropButton();
    playBackdrop();

    document.querySelectorAll('.drop').forEach(drop => {
      drop.setAttribute('role', 'button');
      drop.tabIndex = 0;
      drop.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); drop.click(); }
      });
    });
    document.querySelectorAll('.status').forEach(status => {
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    });
    const thumbs = document.getElementById('thumbs');
    const fileCount = document.querySelector('.file-count');
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

    document.querySelectorAll('.tones').forEach(group => {
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

    if (document.body.classList.contains('zip-page')) {
      document.getElementById('manualCopyBtn')?.addEventListener('click', event => {
        document.getElementById('asoResults').style.display = '';
        event.currentTarget.setAttribute('aria-expanded', 'true');
        document.getElementById('shortDesc').focus();
      });
      const main = document.getElementById('main');
      const panels = [...main.querySelectorAll(':scope > .card')];
      const labels = ['Дані додатку', 'Скріншоти', 'Файли', 'ASO описи', 'Експорт'];
      const tabs = document.createElement('div');
      tabs.className = 'release-tabs'; tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Етапи підготовки релізу');
      const actions = document.createElement('div');
      actions.className = 'step-actions';
      actions.innerHTML = '<span class="step-counter"></span><div><button type="button" class="btn secondary" id="previousStep">Назад</button><button type="button" class="btn" id="nextStep">Далі →</button></div>';
      let current = 0;
      function select(index, focus = false) {
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
