import { FIXED_DATE, isImage, isVideo, stripImageMetadata, stripVideoMetadata } from '../metadata.js';

// Each tool owns its DOM and state, including while detached during navigation.
export function mount(root) {
// ================= State =================
const state = {
  screenshots: [],          // {file, url}
  selectedIdx: null,        // AI-selected order (array of indices) or null
  files: { apk: [], aab: [], banner: [], icon: [], ds: [], other: [] }
};

const $ = id => root.querySelector('#' + CSS.escape(id));

// ================= Screenshots upload =================
const shotsDrop = $('shotsDrop'), shotsInput = $('shotsInput');
shotsDrop.onclick = () => shotsInput.click();
shotsInput.onchange = () => { addShots([...shotsInput.files]); shotsInput.value = ''; };
;['dragover','dragleave','drop'].forEach(ev => shotsDrop.addEventListener(ev, e => {
  e.preventDefault();
  shotsDrop.classList.toggle('dragover', ev === 'dragover');
  if (ev === 'drop') addShots([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
}));

function addShots(files) {
  for (const f of files) state.screenshots.push({ file: f, url: URL.createObjectURL(f) });
  state.selectedIdx = null; // reset AI selection on change
  resetMetaClean();
  renderShots();
}

function renderShots() {
  const box = $('shotsThumbs');
  box.innerHTML = '';
  const sel = state.selectedIdx;
  state.screenshots.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'thumb' + (sel && !sel.includes(i) ? ' dim' : '');
    const orderNum = sel ? (sel.indexOf(i) >= 0 ? sel.indexOf(i) + 1 : '—') : i + 1;
    d.innerHTML = `<img src="${s.url}"><span class="num">${orderNum}</span><span class="x" title="Видалити">✕</span>` +
      (sel && sel.includes(i) ? '<span class="badge">AI ✓</span>' : '');
    d.querySelector('img').onclick = () => openLightbox(s.url);
    d.querySelector('.x').onclick = () => {
      URL.revokeObjectURL(s.url);
      state.screenshots.splice(i, 1);
      state.selectedIdx = null;
      renderShots();
    };
    box.appendChild(d);
  });
}

// ================= Other files upload =================
root.querySelectorAll('.small-drop').forEach(drop => {
  const key = drop.dataset.target;
  const input = $('file_' + key);
  drop.onclick = () => input.click();
  ;['dragover','dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault();
    drop.classList.toggle('dragover', ev === 'dragover');
    if (ev === 'drop') addFiles(key, [...e.dataTransfer.files]);
  }));
  input.onchange = () => { addFiles(key, [...input.files]); input.value = ''; };
});

// Обов'язкові розміри для Google Play
const TARGET_SIZES = { icon: { w: 512, h: 512 }, banner: { w: 1024, h: 500 } };

function addFiles(key, files) {
  const multi = key === 'other';
  if (!multi) state.files[key] = [];
  state.files[key].push(...files);
  resetMetaClean();
  renderFiles(key);
  // Перевірка розмірів banner/icon
  if (TARGET_SIZES[key]) {
    for (const f of files) {
      loadImg(f).then(img => {
        const t = TARGET_SIZES[key];
        f._dim = `${img.width}×${img.height}`;
        f._willResize = img.width !== t.w || img.height !== t.h;
        renderFiles(key);
      }).catch(() => {});
    }
  }
}

function renderFiles(key) {
  const box = $('list_' + key);
  box.innerHTML = '';
  state.files[key].forEach((f, i) => {
    const c = document.createElement('span');
    c.className = 'chip';
    let extra = '';
    if (f._dim) {
      const t = TARGET_SIZES[key];
      extra = f._willResize
        ? ` <i style="color:#e6a23c;font-style:normal">${f._dim} → буде ${t.w}×${t.h}</i>`
        : ` <i style="color:var(--green);font-style:normal">${f._dim} ✓</i>`;
    }
    c.innerHTML = `${f.name} <i style="color:var(--muted);font-style:normal">${fmtSize(f.size)}</i>${extra} <span class="x">✕</span>`;
    c.querySelector('.x').onclick = () => { state.files[key].splice(i, 1); renderFiles(key); };
    box.appendChild(c);
  });
}

function loadImg(file) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Не вдалося прочитати ' + file.name));
    i.src = URL.createObjectURL(file);
  });
}

// Підганяє зображення точно під w×h; повертає {name, data(Blob|File), resized}
async function fitImage(file, w, h) {
  const img = await loadImg(file);
  if (img.width === w && img.height === h) return { name: file.name, data: file, resized: false };
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise(r => c.toBlob(r, type, 0.95));
  if (!blob) throw new Error('Не вдалося змінити розмір ' + file.name);
  const ext = type === 'image/jpeg' ? 'jpg' : 'png';
  return { name: file.name.replace(/\.[^.]+$/, '') + '.' + ext, data: blob, resized: true };
}

const fmtSize = b => b > 1048576 ? (b/1048576).toFixed(1)+' MB' : (b/1024).toFixed(0)+' KB';

// ================= Tone selector =================
let tone = 'normal';
root.querySelectorAll('#tones .tone').forEach(t => {
  t.style.setProperty('--tc', t.dataset.color);
  t.onclick = () => {
    root.querySelectorAll('#tones .tone').forEach(x => x.classList.remove('sel'));
    t.classList.add('sel');
    tone = t.dataset.tone;
  };
});

// ================= Size selector =================
let descSize = 'small';
root.querySelectorAll('#sizes .tone').forEach(t => {
  t.style.setProperty('--tc', t.dataset.color);
  t.onclick = () => {
    root.querySelectorAll('#sizes .tone').forEach(x => x.classList.remove('sel'));
    t.classList.add('sel');
    descSize = t.dataset.size;
  };
});

// Лічильник символів повного опису
const SIZE_MAX = { small: 1500, medium: 2500, large: 3500 };
$('fullDesc').addEventListener('input', updFullCount);
function updFullCount() {
  const len = $('fullDesc').value.length;
  const max = SIZE_MAX[descSize];
  $('fullCount').textContent = `(${len} символів, ціль ≤ ${max})`;
  $('fullCount').style.color = len > max ? 'var(--red)' : '';
}

// ================= Short description counter =================
$('shortDesc').addEventListener('input', updCount);
function updCount(){ $('shortCount').textContent = `(${$('shortDesc').value.length}/80)`; }

// ================= AI generation =================
$('genBtn').onclick = async () => {
  const name = $('appName').value.trim();
  const desc = $('devDescription').value.trim();
  const st = $('genStatus');
  st.className = 'status';
  if (!name || !desc) { st.className = 'status err'; st.textContent = 'Заповніть назву додатку та опис від розробника.'; return; }
  if (state.screenshots.length === 0) { st.className = 'status err'; st.textContent = 'Додайте хоча б один скріншот.'; return; }

  $('genBtn').disabled = true;
  st.innerHTML = '<span class="spinner"></span>Стискаю скріншоти та відправляю в Claude...';
  try {
    const thumbs = [];
    for (const s of state.screenshots) thumbs.push(await compressImage(s.file, 800, 0.72));

    st.innerHTML = '<span class="spinner"></span>Claude генерує описи' + (state.screenshots.length > 8 ? ', обирає 8 найкращих скріншотів' : '') + ' та перевіряє на переспам...';
    const resp = await fetch('/api/aso', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appName: name,
        description: desc,
        category: $('category').value.trim(),
        tone,
        size: descSize,
        screenshots: thumbs
      })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Помилка сервера');

    $('shortDesc').value = data.shortDescription || '';
    $('fullDesc').value = data.fullDescription || '';
    $('asoResults').style.display = '';
    updCount();
    updFullCount();
    if (data.selected) { state.selectedIdx = data.selected; renderShots(); }
    st.className = 'status ok';
    st.textContent = '✓ Готово! Перевірте описи — за потреби відредагуйте їх перед створенням ZIP.';
    if (data.spamCheck) showSpam(data.spamCheck, true);
  } catch (e) {
    st.className = 'status err';
    st.textContent = 'Помилка: ' + e.message;
  }
  $('genBtn').disabled = false;
};

// ================= Spam check (аналог ASOMobile Text Analyzer) =================
function showSpam(sc, afterGen) {
  const st = $('spamStatus');
  const box = $('spamTable');
  const limInfo = `щільність ≤ ${sc.densityLimit}%, тобто макс ${sc.maxAllowed} повторів при ${sc.totalWords} словах`;
  if (sc.clean) {
    st.className = 'status ok';
    st.textContent = `✓ Переспаму немає (${limInfo})` +
      (afterGen && sc.fixAttempts ? `. AI виправляв опис ${sc.fixAttempts} раз(и)` : '');
  } else {
    st.className = 'status err';
    st.textContent = `⚠ Переспам: ${sc.remaining.map(w => `«${w.word}» ×${w.count} (${w.density}%)`).join(', ')} — ${limInfo}` +
      (afterGen ? `. AI зробив ${sc.fixAttempts} спроб(и) виправлення — відредагуйте вручну або згенеруйте ще раз.` : '');
  }
  $('fixSpamBtn').style.display = sc.clean ? 'none' : '';
  box.innerHTML = '';
  (sc.frequency || []).slice(0, 24).forEach(w => {
    const over = w.density > sc.densityLimit, warn = !over && w.count >= sc.maxAllowed;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.title = `щільність ${w.density}%`;
    chip.style.borderColor = over ? 'var(--red)' : warn ? 'var(--orange)' : 'var(--line)';
    chip.innerHTML = `${w.word} <b style="color:${over ? 'var(--red)' : warn ? 'var(--orange)' : 'var(--green)'}">${w.count}</b>`;
    box.appendChild(chip);
  });
}

// Перевірка тексту на переспам; повертає spamCheck або null
async function runSpamCheck(text) {
  const resp = await fetch('/api/spam-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text })
  });
  const d = await resp.json();
  if (!resp.ok) throw new Error(d.error || 'Помилка перевірки');
  return { densityLimit: d.densityLimit, totalWords: d.totalWords, maxAllowed: d.maxAllowed,
           clean: d.spam.length === 0, remaining: d.spam, frequency: d.frequency };
}

$('fixSpamBtn').onclick = async () => {
  const st = $('spamStatus');
  const text = $('fullDesc').value.trim();
  if (!text) return;
  $('fixSpamBtn').disabled = true;
  st.className = 'status';
  st.innerHTML = '<span class="spinner"></span>AI переписує опис без переспаму...';
  try {
    const resp = await fetch('/api/fix-spam', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, appName: $('appName').value.trim() })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Помилка сервера');
    $('fullDesc').value = data.fullDescription;
    updFullCount();
    showSpam(data.spamCheck, true);
  } catch (e) {
    st.className = 'status err';
    st.textContent = 'Помилка: ' + e.message;
  }
  $('fixSpamBtn').disabled = false;
};

$('spamBtn').onclick = async () => {
  const text = $('fullDesc').value.trim();
  const st = $('spamStatus');
  if (!text) { st.className = 'status err'; st.textContent = 'Full description порожній.'; return; }
  st.className = 'status';
  st.innerHTML = '<span class="spinner"></span>Перевіряю...';
  try {
    const resp = await fetch('/api/spam-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const data = await resp.json();
    showSpam({
      densityLimit: data.densityLimit, totalWords: data.totalWords, maxAllowed: data.maxAllowed,
      clean: data.spam.length === 0, remaining: data.spam, frequency: data.frequency
    }, false);
  } catch (e) {
    st.className = 'status err';
    st.textContent = 'Помилка: ' + e.message;
  }
};

// Compress image → {mediaType, data(base64)}
function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * k));
      c.height = Math.max(1, Math.round(img.height * k));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', quality);
      URL.revokeObjectURL(img.src);
      resolve({ mediaType: 'image/jpeg', data: dataUrl.split(',')[1] });
    };
    img.onerror = () => reject(new Error('Не вдалося прочитати ' + file.name));
    img.src = URL.createObjectURL(file);
  });
}

// ================= How to Publish.txt template =================
function buildHowToPublish() {
  return `GUIDE HOW TO PUBLISH --->  https://www.youtube.com/watch?v=fKbg_JvAB_8

App title: ${$('appName').value.trim() || '***'}

Policy: ${$('policy').value.trim() || '***'}

Mail: ${$('mail').value.trim() || '***'}

Website: ${$('website').value.trim() || '***'}

Category: ${$('category').value.trim() || '***'}

Target audience and content: ${$('audience').value.trim()}

Content rating: ${$('rating').value.trim() || '3+'}

Advirtising ID: ${$('advId').value}

Short description: ${$('shortDesc').value.trim() || '***'}

Full description: ${$('fullDesc').value.trim() || '***'}
`;
}

// ================= Очищення метаданих =================
let metaCleaned = false;

// Нові файли після очищення — скидаємо статус, щоб не потрапили неочищеними
function resetMetaClean() {
  if (!metaCleaned) return;
  metaCleaned = false;
  const st = root.querySelector('#cleanStatus');
  if (st) {
    st.className = 'status err';
    st.textContent = '⚠ Додано нові файли — натисніть «Очистити метадані» ще раз.';
  }
}

$('cleanMetaBtn').onclick = async () => {
  const st = $('cleanStatus');
  st.className = 'status';
  let cleaned = 0, cleanedVideo = 0, skipped = [], failed = 0;

  $('cleanMetaBtn').disabled = true;
  st.innerHTML = '<span class="spinner"></span>Очищаю метадані...';

  try {
    // Скріншоти
    for (let i = 0; i < state.screenshots.length; i++) {
      try {
        const nf = await stripImageMetadata(state.screenshots[i].file);
        URL.revokeObjectURL(state.screenshots[i].url);
        state.screenshots[i] = { file: nf, url: URL.createObjectURL(nf) };
        cleaned++;
      } catch (e) { failed++; }
    }
    renderShots();

    // Інші файли
    for (const key of ['apk', 'aab', 'banner', 'icon', 'ds', 'other']) {
      for (let i = 0; i < state.files[key].length; i++) {
        const f = state.files[key][i];
        if (isImage(f)) {
          try {
            const nf = await stripImageMetadata(f);
            nf._dim = f._dim; nf._willResize = f._willResize;
            state.files[key][i] = nf;
            cleaned++;
          } catch (e) { failed++; }
        } else if (isVideo(f)) {
          try {
            st.innerHTML = '<span class="spinner"></span>Очищаю метадані відео...';
            const nf = await stripVideoMetadata(f);
            if (nf) { state.files[key][i] = nf; cleanedVideo++; }
          } catch (e) { failed++; }
        } else {
          const ext = (f.name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
          if (!skipped.includes(ext) && ext) skipped.push(ext);
        }
      }
      renderFiles(key);
    }

    metaCleaned = true;
    st.className = 'status ok';
    st.textContent = `✓ Очищено метадані: ${cleaned} зображень` +
      (cleanedVideo ? `, ${cleanedVideo} відео` : '') +
      (failed ? `, не вдалося: ${failed}` : '') +
      `. Часові мітки в архіві буде уніфіковано.` +
      (skipped.length ? ` Не чіпалися (щоб не пошкодити підпис): ${skipped.join(', ')}.` : '');
  } catch (e) {
    st.className = 'status err';
    st.textContent = 'Помилка: ' + e.message;
  }
  $('cleanMetaBtn').disabled = false;
};

// ================= ZIP build =================
let zipForce = false;
$('fullDesc').addEventListener('input', () => {
  if (zipForce) { zipForce = false; $('zipBtn').textContent = '📦 Створити та скачати ZIP'; }
});

$('zipBtn').onclick = async () => {
  const st = $('zipStatus');
  st.className = 'status';
  const name = $('appName').value.trim();
  if (!name) { st.className = 'status err'; st.textContent = 'Заповніть назву додатку.'; return; }
  if (state.screenshots.length === 0) { st.className = 'status err'; st.textContent = 'Додайте скріншоти.'; return; }
  if (!$('shortDesc').value.trim() || !$('fullDesc').value.trim()) {
    st.className = 'status err';
    st.textContent = 'Згенеруйте описи в розділі «ASO описи» або заповніть їх вручну.';
    $('asoResults').style.display = '';
    return;
  }

  // Фінальна перевірка опису на переспам (у т.ч. якщо його редагували вручну)
  $('zipBtn').disabled = true;
  try {
    st.innerHTML = '<span class="spinner"></span>Перевіряю опис на переспам...';
    const sc = await runSpamCheck($('fullDesc').value.trim());
    showSpam(sc, false);
    if (!sc.clean) {
      $('zipBtn').disabled = false;
      st.className = 'status err';
      st.textContent = `⚠ У повному описі є переспам: ${sc.remaining.map(w => `«${w.word}» ×${w.count}`).join(', ')}. ` +
        'Натисніть «🛠 Виправити переспам (AI)» вище, або створіть ZIP примусово ще раз натиснувши кнопку.';
      if (!zipForce) { zipForce = true; $('zipBtn').textContent = '📦 Все одно створити ZIP'; return; }
    }
  } catch (e) {
    console.warn('Spam pre-check failed:', e.message);
  }
  zipForce = false;
  $('zipBtn').textContent = '📦 Створити та скачати ZIP';

  st.className = 'status';
  st.innerHTML = '<span class="spinner"></span>Збираю ZIP...';
  try {
    const zip = new JSZip();

    // Screenshots: AI order (max 8) or all if ≤8
    let order;
    if (state.selectedIdx && state.selectedIdx.length) order = state.selectedIdx.slice(0, 8);
    else order = state.screenshots.map((_, i) => i).slice(0, 8);
    if (state.screenshots.length <= 8) order = state.screenshots.map((_, i) => i);

    // Якщо метадані чистили — однакова часова мітка для всіх записів архіву
    const zipOpts = metaCleaned ? { date: FIXED_DATE } : undefined;

    order.forEach((idx, n) => {
      const f = state.screenshots[idx].file;
      const ext = (f.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0];
      zip.file(`${n + 1}${ext}`, f, { ...zipOpts, compression: 'STORE' });
    });

    for (const key of ['apk', 'aab', 'ds', 'other'])
      for (const f of state.files[key]) zip.file(f.name, f, {
        ...zipOpts,
        // APK/AAB, media and archives are already compressed; recompressing stalls large releases.
        compression: /\.(apk|aab|zip|mp4|mov|png|jpe?g|webp|avif)$/i.test(f.name) ? 'STORE' : 'DEFLATE'
      });

    // Banner та icon: автоматична підгонка під обов'язкові розміри + правильна назва файлу
    const resizedNotes = [];
    for (const key of ['banner', 'icon']) {
      const t = TARGET_SIZES[key];
      for (const f of state.files[key]) {
        try {
          st.innerHTML = `<span class="spinner"></span>Перевіряю розмір ${key}...`;
          const r = await fitImage(f, t.w, t.h);
          const ext = (r.name.match(/\.[a-z0-9]+$/i) || ['.png'])[0].toLowerCase();
          zip.file(key + ext, r.data, { ...zipOpts, compression: 'STORE' }); // завжди icon.* / banner.*
          if (r.resized) resizedNotes.push(`${key} → ${t.w}×${t.h}`);
        } catch (e) {
          // якщо не вдалося прочитати як зображення — кладемо як є, але з правильною назвою
          const ext = (f.name.match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
          zip.file(key + ext, f, zipOpts);
        }
      }
    }

    zip.file('How to Publish.txt', buildHowToPublish(), zipOpts);

    st.innerHTML = '<span class="spinner"></span>Стискаю архів (великі apk/aab можуть зайняти час)...';
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      meta => { st.innerHTML = `<span class="spinner"></span>Стискаю архів... ${meta.percent.toFixed(0)}%`; }
    );

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/[\\/:*?"<>|]/g, '') + '.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    st.className = 'status ok';
    st.textContent = `✓ ZIP створено: ${a.download} (${fmtSize(blob.size)})` +
      (resizedNotes.length ? `. Автоматично підігнано: ${resizedNotes.join(', ')}` : '');
  } catch (e) {
    st.className = 'status err';
    st.textContent = 'Помилка: ' + e.message;
  }
  $('zipBtn').disabled = false;
};

}
