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
      const mobile = matchMedia('(max-width: 760px) and (orientation: portrait)').matches;
      // Match physical cover resolution, not just CSS width (Retina needs 4K).
      // Select once: no speculative alternate downloads or navigation restarts.
      const coverScale = Math.max(window.innerWidth / 1920, window.innerHeight / 1080);
      const needsUltra = coverScale * Math.min(window.devicePixelRatio || 1, 2) > 1.15;
      const limitedConnection = connection?.effectiveType === '3g';
      const rendition = mobile ? 'mobile' : needsUltra && !limitedConnection ? 'ultra' : 'desktop';
      video = document.createElement('video');
      video.className = 'coastal-video';
      video.muted = true;
      video.defaultMuted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.disablePictureInPicture = true;
      video.setAttribute('aria-hidden', 'true');
      video.poster = mobile ? 'media/mountains-poster-mobile-v2.jpg' : 'media/mountains-poster-v2.jpg';
      const standardSource = `media/mountains-${rendition}-v2.mp4`;
      const efficient4K = rendition === 'ultra' && video.canPlayType('video/mp4; codecs="hvc1.1.6.L153.B0"');
      video.src = efficient4K ? 'media/mountains-ultra-hevc-v2.mp4' : standardSource;
      let canFallback = Boolean(efficient4K);
      const reveal = () => scene.classList.add('video-ready');
      video.addEventListener('playing', () => {
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(reveal);
        else reveal();
      });
      video.addEventListener('error', () => {
        // Some devices advertise HEVC but cannot decode this profile in practice.
        if (canFallback) {
          canFallback = false;
          scene.classList.remove('video-ready');
          video.src = standardSource;
          play();
          return;
        }
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
