import { FIXED_DATE, metadataKind, stripImageMetadata, stripVideoMetadata } from './metadata.js';

// generatedResults is only for trusted canvas output, never uploaded originals.
// Canvas has already discarded source tags, so preserve encoded pixels/format.
export function mountQuickMetadata(root, getFiles, { generatedResults = false } = {}) {
  const button = root.querySelector('#cleanMetaBtn');
  const status = root.querySelector('#cleanMetaStatus');
  const download = root.querySelector('#cleanMetaDownload');
  let busy = false, resultUrl = null, completedSources = [];
  const sameFiles = (a, b) => a.length === b.length && a.every((file, i) => file === b[i]);
  function clearResult() {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    resultUrl = null; completedSources = [];
    download.hidden = true; download.removeAttribute('href');
  }
  function refresh() {
    const files = getFiles();
    button.disabled = busy || !files.length;
    if (!busy && resultUrl && !sameFiles(files, completedSources)) {
      clearResult();
      status.textContent = 'Список файлів змінено — очистіть метадані ще раз.';
      status.className = 'status';
    }
  }
  button.onclick = async () => {
    if (busy) return;
    const files = [...getFiles()];
    if (!files.length) return;
    clearResult();
    status.className = 'status';
    if (files.length > 50 || files.reduce((size, file) => size + file.size, 0) > 400 * 1048576) {
      status.className = 'status err';
      status.textContent = 'За один раз можна очистити до 50 файлів / 400 МБ разом.';
      return;
    }
    busy = true; refresh(); button.setAttribute('aria-busy', 'true');
    const cleaned = [], failures = [], names = new Set();
    try {
      for (const [index, file] of files.entries()) {
        status.textContent = `Очищення метаданих: ${index + 1} із ${files.length}…`;
        try {
          const kind = metadataKind(file);
          if (!generatedResults && !kind) throw new Error('Для очищення підтримуються JPEG, PNG, WebP, MP4, MOV та M4V.');
          const result = generatedResults
            ? new File([file], file.name, { type: file.type, lastModified: FIXED_DATE.getTime() })
            : await (kind === 'image' ? stripImageMetadata(file) : stripVideoMetadata(file));
          const name = uniqueCleanName(result.name, names);
          cleaned.push({ name, file: result });
        } catch (error) { failures.push(`${file.name}: ${error.message || 'Не вдалося очистити файл.'}`); }
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      // Do not offer a stale download if the user changed the source list mid-run.
      if (!sameFiles(files, getFiles())) {
        status.textContent = 'Список файлів змінено під час очищення. Натисніть кнопку ще раз.';
        return;
      }
      if (cleaned.length) {
        let blob = cleaned[0].file, name = cleaned[0].name;
        if (cleaned.length > 1) {
          const zip = new JSZip();
          for (const item of cleaned) zip.file(item.name, item.file, { date: FIXED_DATE, compression: 'STORE' });
          blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
          name = 'metadata-cleaned.zip';
        }
        if (!sameFiles(files, getFiles())) {
          status.textContent = 'Список файлів змінено під час очищення. Натисніть кнопку ще раз.';
          return;
        }
        resultUrl = URL.createObjectURL(blob); completedSources = files;
        download.href = resultUrl; download.download = name; download.hidden = false;
        download.textContent = cleaned.length > 1 ? 'Скачати очищені файли ZIP' : 'Скачати очищений файл';
      }
      status.className = failures.length ? 'status err' : 'status ok';
      status.textContent = `Очищено: ${cleaned.length} із ${files.length}.` + (generatedResults ? ' Розміри, формат і якість результату збережено.' : ' Оригінали не змінено.') +
        (failures.length ? ` Не включено до завантаження: ${failures.join(' · ')}` : ' Копії готові до скачування.');
    } catch (error) {
      clearResult(); status.className = 'status err';
      status.textContent = 'Не вдалося підготувати очищені файли: ' + error.message;
    } finally { busy = false; button.removeAttribute('aria-busy'); refresh(); }
  };
  refresh();
  return { refresh };
}

export function uniqueCleanName(filename, used) {
  const safe = filename.replace(/[\\/\x00-\x1f]/g, '_');
  const dot = safe.lastIndexOf('.');
  const stem = (dot > 0 ? safe.slice(0, dot) : safe) + '_clean';
  const extension = dot > 0 ? safe.slice(dot) : '';
  let name = stem + extension, count = 1;
  while (used.has(name.toLowerCase())) name = `${stem} (${++count})${extension}`;
  used.add(name.toLowerCase());
  return name;
}
