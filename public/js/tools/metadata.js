import { FIXED_DATE, metadataKind, stripImageMetadata, stripVideoMetadata } from '../metadata.js';

export function mount(root) {
  const $ = id => root.querySelector('#' + id);
  let entries = [], busy = false;
  const formatSize = size => size < 1048576 ? `${(size / 1024).toFixed(1)} КБ` : `${(size / 1048576).toFixed(1)} МБ`;
  const announce = (text, error = false) => { $('status').textContent = text; $('status').className = 'status' + (error ? ' err' : ''); };
  const safeName = name => name.replace(/[\\/\x00-\x1f]/g, '_');
  function outputName(file) {
    const name = safeName(file.name), dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) + '_clean' + name.slice(dot) : name + '_clean';
  }
  function render() {
    $('fileQueue').replaceChildren();
    $('fileCount').textContent = `Файлів: ${entries.length}`;
    $('emptyQueue').hidden = entries.length > 0;
    for (const entry of entries) {
      const row = document.createElement('li'); row.className = 'metadata-file';
      const info = document.createElement('div'); info.className = 'metadata-file-info';
      const name = document.createElement('strong'); name.textContent = entry.file.name;
      const detail = document.createElement('span');
      detail.textContent = `${formatSize(entry.file.size)} · ${entry.message || (entry.kind === 'video' ? 'Відео · без перекодування' : 'Зображення')}`;
      if (entry.error) detail.className = 'status err';
      info.append(name, detail); row.append(info);
      if (entry.url) {
        const link = document.createElement('a'); link.className = 'btn secondary small';
        link.href = entry.url; link.download = outputName(entry.result); link.textContent = 'Скачати';
        link.setAttribute('aria-label', `Скачати ${entry.file.name}`); row.append(link);
      }
      const remove = document.createElement('button'); remove.className = 'btn secondary small'; remove.type = 'button';
      remove.textContent = '×'; remove.disabled = busy; remove.setAttribute('aria-label', `Прибрати ${entry.file.name}`);
      remove.onclick = () => { if (entry.url) URL.revokeObjectURL(entry.url); entries = entries.filter(item => item !== entry); render(); announce(''); };
      row.append(remove); $('fileQueue').append(row);
    }
    $('cleanBtn').disabled = busy || !entries.some(entry => !entry.result);
    $('clearBtn').disabled = busy || !entries.length;
    $('input').disabled = busy;
    $('drop').setAttribute('aria-disabled', String(busy));
    $('downloadZip').hidden = !entries.some(entry => entry.result);
    $('downloadZip').disabled = busy;
    $('progress').hidden = !busy;
    $('fileQueue').setAttribute('aria-busy', String(busy));
  }
  function addFiles(files) {
    if (busy) return;
    let skipped = 0;
    let total = entries.reduce((sum, entry) => sum + entry.file.size, 0);
    for (const file of files) {
      const kind = metadataKind(file);
      const limit = kind === 'image' ? 32 : 200;
      if (!kind || !file.size || file.size > limit * 1048576 || total + file.size > 400 * 1048576 || entries.length >= 50) { skipped++; continue; }
      total += file.size; entries.push({ file, kind });
    }
    render();
    announce(skipped ? `Пропущено файлів: ${skipped}. Перевірте формати й обмеження розміру нижче.` : 'Файли додано. Натисніть «Очистити метадані».', skipped > 0);
  }
  $('drop').onclick = () => { if (!busy) $('input').click(); };
  $('input').onchange = () => { addFiles([...$('input').files]); $('input').value = ''; };
  for (const name of ['dragover', 'dragleave', 'drop']) $('drop').addEventListener(name, event => {
    event.preventDefault(); $('drop').classList.toggle('dragover', name === 'dragover' && !busy);
    if (name === 'drop') addFiles([...event.dataTransfer.files]);
  });
  $('clearBtn').onclick = () => {
    for (const entry of entries) if (entry.url) URL.revokeObjectURL(entry.url);
    entries = []; render(); announce('Список очищено. Оригінальні файли не змінювалися.');
  };
  $('cleanBtn').onclick = async () => {
    if (busy) return;
    busy = true; $('progress').max = entries.length; $('progress').value = 0; render();
    let failed = 0;
    try {
      for (const [index, entry] of entries.entries()) {
        if (!entry.result) {
          announce(`Очищення ${index + 1} із ${entries.length}: ${entry.file.name}`);
          try {
            entry.result = await (entry.kind === 'image' ? stripImageMetadata(entry.file) : stripVideoMetadata(entry.file));
            entry.url = URL.createObjectURL(entry.result); entry.error = false;
            entry.message = `Готово · ${formatSize(entry.result.size)}`;
          } catch (error) { entry.error = true; entry.message = error.message || 'Не вдалося очистити файл.'; failed++; }
        }
        $('progress').value = index + 1; render();
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      const count = entries.filter(entry => entry.result).length;
      announce(`Готово: ${count} із ${entries.length}.` + (failed ? ` Помилок: ${failed}; ці файли не включено до завантаження.` : ' Можна скачати файли окремо або одним ZIP.'), failed > 0);
    } finally { busy = false; render(); }
  };
  $('downloadZip').onclick = async () => {
    if (busy) return;
    busy = true; render(); announce('Готую ZIP із очищеними файлами…');
    try {
      const zip = new JSZip(), used = new Set();
      for (const entry of entries.filter(item => item.result)) {
        const base = outputName(entry.result), dot = base.lastIndexOf('.');
        let name = base, count = 1;
        while (used.has(name.toLowerCase())) { count++; name = dot > 0 ? `${base.slice(0, dot)} (${count})${base.slice(dot)}` : `${base} (${count})`; }
        used.add(name.toLowerCase());
        zip.file(name, entry.result, { date: FIXED_DATE, compression: 'STORE' });
      }
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
      const url = URL.createObjectURL(blob), link = document.createElement('a');
      link.href = url; link.download = 'metadata-cleaned.zip'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      announce(`ZIP створено: ${used.size} файлів · ${formatSize(blob.size)}.`);
    } catch (error) { announce('Не вдалося створити ZIP: ' + error.message, true); }
    finally { busy = false; render(); }
  };
  render();
}
