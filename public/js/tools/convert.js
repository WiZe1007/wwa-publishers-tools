import { mountQuickMetadata } from '../quick-metadata.js';

// Each tool owns its DOM and state, including while detached during navigation.
export function mount(root) {
const $ = id => root.querySelector('#' + CSS.escape(id));
let files = [];       // {file, url}
let converted = [];   // {name, blob}
let resultFiles = [], resultVersion = 0;
const metadata = mountQuickMetadata(root, () => resultFiles, { generatedResults: true });
function invalidateResults() {
  resultVersion++; resultFiles = []; metadata.refresh();
}
$('controlFields').addEventListener('input', invalidateResults);
$('controlFields').addEventListener('change', invalidateResults);

const drop = $('drop'), input = $('input');
drop.onclick = () => input.click();
input.onchange = () => { addFiles([...input.files]); input.value = ''; };
;['dragover','dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => {
  e.preventDefault();
  drop.classList.toggle('dragover', ev === 'dragover');
  if (ev === 'drop') addFiles([...e.dataTransfer.files]);
}));

function addFiles(list) {
  for (const f of list) files.push({ file: f, url: URL.createObjectURL(f) });
  render();
  $('controlFields').disabled = !files.length;
}

function render() {
  invalidateResults();
  const box = $('thumbs');
  box.innerHTML = '';
  files.forEach((f, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.innerHTML = `<img src="${f.url}" onerror="this.style.display='none'"><span class="size">${f.file.name}</span><span class="x">✕</span>`;
    d.title = f.file.name;
    d.querySelector('img').onclick = () => openLightbox(f.url);
    d.querySelector('.x').onclick = () => { URL.revokeObjectURL(f.url); files.splice(i, 1); render(); $('controlFields').disabled = !files.length; };
    box.appendChild(d);
  });
}

$('quality').oninput = () => $('qv').textContent = $('quality').value;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    // createImageBitmap handles more formats (incl. AVIF/ICO in modern browsers)
    createImageBitmap(file).then(resolve).catch(() => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Формат не підтримується браузером: ' + file.name));
      i.src = URL.createObjectURL(file);
    });
  });
}

// BMP encoder (canvas.toBlob не підтримує BMP)
function canvasToBMP(canvas) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, w, h).data;
  const rowSize = Math.ceil(w * 3 / 4) * 4;
  const size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size);
  const v = new DataView(buf);
  v.setUint8(0, 0x42); v.setUint8(1, 0x4D);
  v.setUint32(2, size, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, -h, true); // top-down
  v.setUint16(26, 1, true); v.setUint16(28, 24, true);
  v.setUint32(34, rowSize * h, true);
  let off = 54;
  for (let y = 0; y < h; y++) {
    let x = 0;
    for (; x < w; x++) {
      const p = (y * w + x) * 4;
      // composite alpha over white
      const a = data[p+3] / 255;
      v.setUint8(off++, Math.round(data[p+2]*a + 255*(1-a)));
      v.setUint8(off++, Math.round(data[p+1]*a + 255*(1-a)));
      v.setUint8(off++, Math.round(data[p]*a + 255*(1-a)));
    }
    off += rowSize - w * 3;
  }
  return new Blob([buf], { type: 'image/bmp' });
}

$('convertBtn').onclick = async () => {
  invalidateResults();
  const version = resultVersion;
  const st = $('status');
  const type = $('format').value;
  const q = $('quality').value / 100;
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp' }[type];
  converted = [];
  $('results').innerHTML = '';
  $('convertBtn').disabled = true;

  let done = 0, failed = 0;
  for (const f of files) {
    st.innerHTML = `<span class="spinner"></span>Конвертую ${++done}/${files.length}...`;
    try {
      const img = await loadImage(f.file);
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext('2d');
      if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height); }
      ctx.drawImage(img, 0, 0);

      let blob;
      if (type === 'image/bmp') blob = canvasToBMP(c);
      else blob = await new Promise(r => c.toBlob(r, type, q));
      if (!blob) throw new Error('Не вдалося конвертувати');

      const name = f.file.name.replace(/\.[^.]+$/, '') + '.' + ext;
      converted.push({ name, blob });

      const chip = document.createElement('span');
      chip.className = 'chip';
      const url = URL.createObjectURL(blob);
      chip.innerHTML = `✓ <a href="${url}" download="${name}" style="color:var(--accent)">${name}</a>`;
      $('results').appendChild(chip);
    } catch (e) {
      failed++;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `<span style="color:var(--red)">✕ ${f.file.name}</span>`;
      $('results').appendChild(chip);
    }
  }
  if (version === resultVersion) {
    resultFiles = converted.map(result => new File([result.blob], result.name, { type: result.blob.type }));
    metadata.refresh();
  }
  st.className = failed ? 'status err' : 'status ok';
  st.textContent = failed ? `Готово з помилками: ${converted.length} ок, ${failed} не вдалося` : `✓ Конвертовано: ${converted.length}. Натисніть на файл, щоб скачати.`;
  $('zipBtn').style.display = converted.length > 1 ? '' : 'none';
  $('convertBtn').disabled = false;

  // Auto-download if single file
  if (converted.length === 1 && !failed) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(converted[0].blob);
    a.download = converted[0].name;
    a.click();
  }
};

$('zipBtn').onclick = async () => {
  const button = $('zipBtn');
  button.disabled = true;
  $('status').className = 'status';
  $('status').textContent = 'Пакую файли в ZIP…';
  try {
    const zip = new JSZip();
    for (const c of converted) zip.file(c.name, c.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'converted_images.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    $('status').className = 'status ok';
    $('status').textContent = 'Архів готовий: converted_images.zip';
  } catch (error) {
    $('status').className = 'status err';
    $('status').textContent = 'Не вдалося створити ZIP. Спробуйте ще раз.';
  } finally {
    button.disabled = false;
  }
};

}
