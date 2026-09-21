// Each tool owns its DOM and state, including while detached during navigation.
export function mount(root) {
const $ = id => root.querySelector('#' + CSS.escape(id));
let items = []; // {file, url, img}

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
    const img = await new Promise(res => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => res(null);
      i.src = url;
    });
    if (img) items.push({ file: f, url, img });
  }
  render();
  // Якщо одне зображення — підставити його розміри
  if (items.length === 1) { $('w').value = items[0].img.width; $('h').value = items[0].img.height; }
}

function render() {
  const box = $('thumbs');
  box.innerHTML = '';
  items.forEach((it, i) => {
    const d = document.createElement('div');
    d.className = 'thumb';
    d.innerHTML = `<img src="${it.url}"><span class="size">${it.img.width}×${it.img.height}</span><span class="x">✕</span>`;
    d.title = it.file.name;
    d.querySelector('img').onclick = () => openLightbox(it.url);
    d.querySelector('.x').onclick = () => { URL.revokeObjectURL(it.url); items.splice(i, 1); render(); };
    box.appendChild(d);
  });
  $('controlFields').disabled = !items.length;
}

// ===== Пропорції =====
let lastChanged = 'w';
$('w').addEventListener('input', () => { lastChanged = 'w'; sync(); });
$('h').addEventListener('input', () => { lastChanged = 'h'; sync(); });
$('keepRatio').addEventListener('change', () => {
  $('ratioHint').style.display = $('keepRatio').checked && items.length > 1 ? '' : 'none';
  sync();
});

function sync() {
  if (!$('keepRatio').checked) { $('ratioHint').style.display = 'none'; return; }
  if (items.length === 1) {
    // одне зображення — синхронізуємо поля за його пропорціями
    const r = items[0].img.width / items[0].img.height;
    if (lastChanged === 'w' && $('w').value > 0) $('h').value = Math.max(1, Math.round($('w').value / r));
    else if (lastChanged === 'h' && $('h').value > 0) $('w').value = Math.max(1, Math.round($('h').value * r));
  } else {
    $('ratioHint').style.display = '';
  }
}

$('quality').oninput = () => $('qv').textContent = $('quality').value;

// ===== Resize =====
function resizeOne(it, W, H, type, q) {
  let w = W, h = H;
  if ($('keepRatio').checked && items.length > 1) {
    // авто-розрахунок відсутнього боку по пропорціях кожного зображення
    const r = it.img.width / it.img.height;
    if (W && !H) h = Math.max(1, Math.round(W / r));
    else if (H && !W) w = Math.max(1, Math.round(H * r));
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  let t = type === 'same' ? it.file.type : type;
  if (!['image/png','image/jpeg','image/webp'].includes(t)) t = 'image/png';
  if (t === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(it.img, 0, 0, w, h);
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[t];
  const name = it.file.name.replace(/\.[^.]+$/, '') + `_${w}x${h}.` + ext;
  return new Promise(res => c.toBlob(b => res({ name, blob: b, w, h }), t, q));
}

$('resizeBtn').onclick = async () => {
  const st = $('status');
  st.className = 'status';
  if (!items.length) return;

  const W = parseInt($('w').value) || 0;
  const H = parseInt($('h').value) || 0;
  const ratioAuto = $('keepRatio').checked && items.length > 1;

  if (ratioAuto) {
    if ((W && H) || (!W && !H)) {
      st.className = 'status err';
      st.textContent = 'З пропорціями для декількох зображень заповніть лише ОДНЕ поле — ширину або висоту.';
      return;
    }
  } else if (!W || !H) {
    st.className = 'status err';
    st.textContent = 'Вкажіть коректні ширину та висоту.';
    return;
  }

  $('resizeBtn').disabled = true;
  $('results').innerHTML = '';
  const type = $('format').value, q = $('quality').value / 100;
  const out = [];
  let failed = 0;

  for (let i = 0; i < items.length; i++) {
    st.innerHTML = `<span class="spinner"></span>Обробляю ${i + 1}/${items.length}...`;
    try {
      const r = await resizeOne(items[i], W, H, type, q);
      if (!r.blob) throw new Error();
      out.push(r);
      const chip = document.createElement('span');
      chip.className = 'chip';
      const url = URL.createObjectURL(r.blob);
      chip.innerHTML = `✓ <a href="${url}" download="${r.name}" style="color:var(--accent)">${r.name}</a> <i style="color:var(--muted);font-style:normal">${r.w}×${r.h}</i>`;
      $('results').appendChild(chip);
    } catch (e) {
      failed++;
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.innerHTML = `<span style="color:var(--red)">✕ ${items[i].file.name}</span>`;
      $('results').appendChild(chip);
    }
  }

  // Скачування: 1 файл — напряму, декілька — ZIP
  if (out.length === 1) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out[0].blob);
    a.download = out[0].name;
    a.click();
  } else if (out.length > 1) {
    st.innerHTML = '<span class="spinner"></span>Пакую в ZIP...';
    const zip = new JSZip();
    for (const r of out) zip.file(r.name, r.blob);
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'resized_images.zip';
    a.click();
  }

  st.className = failed ? 'status err' : 'status ok';
  st.textContent = failed
    ? `Готово з помилками: ${out.length} ок, ${failed} не вдалося`
    : `✓ Готово: ${out.length} ${out.length === 1 ? 'зображення' : 'зображень'}${out.length > 1 ? ' (скачано ZIP-архівом, окремі файли — по кліку вище)' : ''}`;
  $('resizeBtn').disabled = false;
};

}

