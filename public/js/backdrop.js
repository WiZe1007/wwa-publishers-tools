// One decoder for the entire workspace. Routing never replaces this layer.
export function startBackdrop() {
  const button = document.querySelector('.ambient-toggle');
  const scene = document.createElement('div');
  scene.className = 'coastal-scene';
  scene.setAttribute('aria-hidden', 'true');
  document.body.prepend(scene);

  const preference = matchMedia('(prefers-reduced-motion: reduce)');
  const connection = navigator.connection;
  const restrictedConnection = () => connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || '');
  let pausedByUser = false;
  try { pausedByUser = localStorage.getItem('wwa.publishers.backdrop-paused') === 'true'; } catch {}
  let wantsMotion = !pausedByUser && !preference.matches && !restrictedConnection();
  let video;
  let playRequest = 0;

  function syncButton() {
    const label = wantsMotion ? 'Призупинити відеофон' : 'Відтворити відеофон';
    button?.setAttribute('aria-pressed', String(wantsMotion));
    button?.setAttribute('aria-label', label);
    if (!button) return;
    button.title = label;
    button.querySelector('span').textContent = label;
    button.querySelector('path').setAttribute('d', wantsMotion ? 'M8 5v14M16 5v14' : 'm9 5 11 7-11 7V5Z');
  }

  function pause() {
    ++playRequest;
    video?.pause();
  }

  async function play() {
    if (!wantsMotion || document.hidden) return;
    const request = ++playRequest;
    if (!video) {
      const mobile = matchMedia('(max-width: 760px)').matches;
      video = document.createElement('video');
      video.className = 'coastal-video';
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.disablePictureInPicture = true;
      video.setAttribute('aria-hidden', 'true');
      video.poster = mobile ? 'media/mountains-poster-mobile-v1.jpg' : 'media/mountains-poster-v1.jpg';
      video.src = mobile ? 'media/mountains-mobile-v1.mp4' : 'media/mountains-desktop-v1.mp4';
      const reveal = () => scene.classList.add('video-ready');
      video.addEventListener('playing', () => {
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(reveal);
        else reveal();
      });
      video.addEventListener('error', () => {
        pause();
        scene.classList.remove('video-ready');
        wantsMotion = false;
        syncButton();
      });
      scene.append(video);
    }
    try {
      if (video.error) video.load();
      await video.play();
    } catch (error) {
      // An intentional pause/visibility change may interrupt an outstanding play.
      if (request !== playRequest || error.name === 'AbortError') return;
      wantsMotion = false;
      syncButton();
    }
  }

  button?.addEventListener('click', () => {
    wantsMotion = !wantsMotion;
    pausedByUser = !wantsMotion;
    try { localStorage.setItem('wwa.publishers.backdrop-paused', String(pausedByUser)); } catch {}
    syncButton();
    if (wantsMotion) play();
    else pause();
  });
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : play());
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', event => { if (event.persisted) play(); });
  function applyPreference() {
    wantsMotion = !pausedByUser && !preference.matches && !restrictedConnection();
    syncButton();
    if (wantsMotion) play();
    else pause();
  }
  preference.addEventListener('change', applyPreference);
  connection?.addEventListener('change', applyPreference);
  syncButton();
  // Render the small poster and usable controls before starting media transfer.
  requestAnimationFrame(() => {
    if ('requestIdleCallback' in window) requestIdleCallback(play, { timeout: 900 });
    else setTimeout(play, 0);
  });
}
