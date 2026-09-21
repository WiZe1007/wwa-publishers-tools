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
  let selection;
  let rendition;
  let monitor;
  let badWindows = 0;
  let stalls = 0;
  const nextLighter = { ultra: 'desktop', desktop: 'lite' };

  async function selectRendition() {
    if (matchMedia('(max-width: 760px) and (orientation: portrait)').matches) return 'mobile';
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const physicalWidth = Math.max(window.innerWidth, window.innerHeight * 16 / 9) * ratio;
    const downlink = connection?.downlink;
    const slow = connection?.effectiveType === '3g' || (downlink > 0 && downlink < 6);
    if (slow || physicalWidth <= 2200) return 'lite';
    // A Retina screen alone does not imply that 4K can be decoded smoothly.
    const canCheck = navigator.mediaCapabilities?.decodingInfo;
    if (!canCheck) return 'desktop';
    const ultra = physicalWidth > 3072 && (!downlink || downlink >= 15);
    const candidate = ultra ? 'ultra' : 'desktop';
    const dimensions = ultra ? [3840, 2160, 12000000, 'avc1.640033'] : [2560, 1440, 8000000, 'avc1.640032'];
    let timer;
    try {
      const capability = await Promise.race([
        navigator.mediaCapabilities.decodingInfo({ type: 'file', video: {
          contentType: `video/mp4; codecs="${dimensions[3]}"`,
          width: dimensions[0], height: dimensions[1], bitrate: dimensions[2], framerate: 30
        } }),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 700); })
      ]);
      if (capability?.supported && capability.smooth && capability.powerEfficient) return candidate;
      return ultra ? 'desktop' : 'lite';
    } catch {
      return 'desktop';
    } finally { clearTimeout(timer); }
  }

  function stopMonitor() {
    clearInterval(monitor);
    monitor = undefined;
  }

  function useLighterVideo() {
    const next = nextLighter[rendition];
    if (!next || !wantsMotion || document.hidden) return false;
    stopMonitor();
    ++playRequest;
    const position = video.currentTime;
    rendition = next;
    badWindows = 0;
    stalls = 0;
    scene.classList.remove('video-ready');
    video.dataset.rendition = rendition;
    video.addEventListener('loadedmetadata', () => {
      video.currentTime = Math.min(position, Math.max(0, video.duration - .1));
      play();
    }, { once: true });
    video.src = `media/mountains-${rendition}-v3.mp4`;
    video.load();
    return true;
  }

  function startMonitor() {
    stopMonitor();
    if (!video.getVideoPlaybackQuality) return;
    let previous = video.getVideoPlaybackQuality();
    monitor = setInterval(() => {
      if (document.hidden || video.paused || !wantsMotion) { stopMonitor(); return; }
      const quality = video.getVideoPlaybackQuality();
      const total = quality.totalVideoFrames - previous.totalVideoFrames;
      const dropped = quality.droppedVideoFrames - previous.droppedVideoFrames;
      previous = quality;
      // Read-only diagnostics for real browser verification, updated only every 4s.
      video.dataset.totalFrames = String(quality.totalVideoFrames);
      video.dataset.droppedFrames = String(quality.droppedVideoFrames);
      if (total < 30 || video.seeking) return;
      badWindows = dropped / total > .04 ? badWindows + 1 : 0;
      if (badWindows >= 2) useLighterVideo();
    }, 4000);
  }

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
    stopMonitor();
    video?.pause();
  }

  async function play() {
    if (!wantsMotion || document.hidden) return;
    const request = ++playRequest;
    if (!video) {
      rendition = await (selection ||= selectRendition());
      if (request !== playRequest || !wantsMotion || document.hidden) return;
      const mobile = rendition === 'mobile';
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
      video.dataset.rendition = rendition;
      video.src = `media/mountains-${rendition}-v3.mp4`;
      const reveal = () => scene.classList.add('video-ready');
      video.addEventListener('playing', () => {
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(reveal);
        else reveal();
        startMonitor();
      });
      video.addEventListener('pause', stopMonitor);
      video.addEventListener('waiting', () => {
        if (video.currentTime > 1 && !video.seeking && !document.hidden && wantsMotion && ++stalls >= 2) useLighterVideo();
      });
      video.addEventListener('error', () => {
        if (useLighterVideo()) return;
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
