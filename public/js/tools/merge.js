import { mountQuickMetadata } from '../quick-metadata.js';

// Each tool owns its DOM and state, including while detached during navigation.
export function mount(root) {
const $ = id => root.querySelector('#' + CSS.escape(id));
let items = []; // {file, url, img}
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
  if (ev === 'drop') addFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
}));

async function addFiles(list) {
  for (const f of list) {
    const url = URL.createObjectURL(f);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej();
      i.src = url;
    }).catch(() => null);
    if (img) items.push({ file: f, url, img });
  }
  render();
}

function render() {
  invalidateResults();
  const box = $('thumbs');
  box.innerHTML = '';
  items.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.innerHTML = `<img src="${it.url}"><span class="num">${i + 1}</span><span class="x">✕</span>
      <div style="position:absolute;bottom:2px;left:2px;right:2px;display:flex;justify-content:space-between">
        <button class="mv" data-d="-1" style="background:rgba(0,0,0,.65);color:#fff;border:none;border-radius:5px;cursor:pointer;padding:0 6px">←</button>
        <button class="mv" data-d="1" style="background:rgba(0,0,0,.65);color:#fff;border:none;border-radius:5px;cursor:pointer;padding:0 6px">→</button>
      </div>`;
    d.querySelector('img').onclick = () => openLightbox(it.url);
    d.querySelector('.x').onclick = () => { URL.revokeObjectURL(it.url); items.splice(i, 1); render(); };
    d.querySelectorAll('.mv').forEach(b => b.onclick = () => {
      const j = i + Number(b.dataset.d);
      if (j < 0 || j >= items.length) return;
      [items[i], items[j]] = [items[j], items[i]];
      render();
    });
    box.appendChild(d);
  });
  $('controlFields').disabled = items.length < 2;
}

$('direction').onchange = () => {
  $('colsWrap').style.display = $('direction').value === 'grid' ? '' : 'none';
};
$('colsWrap').style.display = 'none';

$('format').onchange = () => {
  if ($('format').value !== 'image/png') $('transparent').checked = false;
};

function compose() {
  const dir = $('direction').value;
  const gap = Math.max(0, parseInt($('gap').value) || 0);
  const unify = $('fitMode').value === 'unify';
  const cols = dir === 'grid' ? Math.max(1, parseInt($('cols').value) || 2) : (dir === 'horizontal' ? items.length : 1);
  const transparent = $('transparent').checked && $('format').value === 'image/png';

  // Determine cell sizes
  let sizes = items.map(it => ({ w: it.img.width, h: it.img.height }));
  if (unify) {
    if (dir === 'horizontal') {
      const h = Math.min(...sizes.map(s => s.h));
      sizes = items.map(it => ({ w: Math.round(it.img.width * h / it.img.height), h }));
    } else if (dir === 'vertical') {
      const w = Math.min(...sizes.map(s => s.w));
      sizes = items.map(it => ({ w, h: Math.round(it.img.height * w / it.img.width) }));
    } else {
      // grid: спільна ширина клітинки = мінімальна ширина, висота — пропорційно кожному зображенню
      const w = Math.min(...sizes.map(s => s.w));
      sizes = items.map(it => ({ w, h: Math.round(it.img.height * w / it.img.width) }));
    }
  }

  const rows = Math.ceil(items.length / cols);
  let colW = [], rowH = [];
  for (let i = 0; i < items.length; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    colW[c] = Math.max(colW[c] || 0, sizes[i].w);
    rowH[r] = Math.max(rowH[r] || 0, sizes[i].h);
  }
  const W = colW.reduce((a, b) => a + b, 0) + gap * (colW.length - 1);
  const H = rowH.reduce((a, b) => a + b, 0) + gap * (rowH.length - 1);

  const canvas = $('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (!transparent) { ctx.fillStyle = $('bgColor').value; ctx.fillRect(0, 0, W, H); }
  else ctx.clearRect(0, 0, W, H);

  for (let i = 0; i < items.length; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    let x = 0, y = 0;
    for (let k = 0; k < c; k++) x += colW[k] + gap;
    for (let k = 0; k < r; k++) y += rowH[k] + gap;
    // center in cell
    x += Math.round((colW[c] - sizes[i].w) / 2);
    y += Math.round((rowH[r] - sizes[i].h) / 2);
    ctx.drawImage(items[i].img, x, y, sizes[i].w, sizes[i].h);
  }
  return canvas;
}

$('previewBtn').onclick = () => {
  if (items.length < 2) return;
  compose();
  $('previewBox').style.display = '';
  $('status').className = 'status';
  $('status').textContent = `Розмір результату: ${$('canvas').width} × ${$('canvas').height} px`;
};

$('mergeBtn').onclick = () => {
  const st = $('status');
  if (items.length < 2) { st.className = 'status err'; st.textContent = 'Додайте мінімум 2 зображення.'; return; }
  invalidateResults();
  const version = resultVersion;
  const canvas = compose();
  $('previewBox').style.display = '';
  const type = $('format').value;
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[type];
  canvas.toBlob(blob => {
    if (!blob) { st.className = 'status err'; st.textContent = 'Помилка створення зображення.'; return; }
    if (version === resultVersion) {
      resultFiles = [new File([blob], `merged.${ext}`, { type: blob.type })];
      metadata.refresh();
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `merged.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    st.className = 'status ok';
    st.textContent = `✓ Готово: merged.${ext} (${canvas.width} × ${canvas.height} px)`;
  }, type, 0.95);
};

}
