(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.WWAAIScreenshots = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Sonnet 5.5 native vision limits. Use both constraints to avoid a second
  // provider-side resize, which can blur small UI labels on square images too.
  // https://platform.claude.com/docs/en/build-with-claude/vision-coordinates
  const LIMITS = Object.freeze({
    maxEdge: 2576, maxTokens: 4784, maxOriginals: 40, maxDetails: 4,
    maxImages: 100, maxTotalTokens: 200000,
    maxImageBase64Bytes: 8 * 1024 * 1024,
    maxTotalBase64Bytes: 60 * 1024 * 1024,
    requestBytes: 64 * 1024 * 1024,
    maxSourcePixels: 64000000
  });
  const TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const tokenCount = (width, height) => Math.ceil(width / 28) * Math.ceil(height / 28);
  const fits = (width, height) => Math.ceil(width / 28) * 28 <= LIMITS.maxEdge &&
    Math.ceil(height / 28) * 28 <= LIMITS.maxEdge && tokenCount(width, height) <= LIMITS.maxTokens;

  function fitImageDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1)
      throw new Error('Не вдалося визначити розміри скріншота.');
    if (fits(width, height)) return { width, height };
    if (height > width) {
      const rotated = fitImageDimensions(height, width);
      return { width: rotated.height, height: rotated.width };
    }
    const aspect = width / height;
    let low = 1, high = width;
    while (low + 1 < high) {
      const edge = Math.floor((low + high) / 2);
      if (fits(edge, Math.max(1, Math.round(edge / aspect)))) low = edge; else high = edge;
    }
    return { width: low, height: Math.max(1, Math.round(low / aspect)) };
  }

  function region(x, y, sourceWidth, sourceHeight) {
    return { x, y, sourceWidth, sourceHeight, ...fitImageDimensions(sourceWidth, sourceHeight) };
  }

  function planScreenshot(width, height) {
    const overview = region(0, 0, width, height);
    if (width * height > LIMITS.maxSourcePixels)
      throw new Error('Скріншот завеликий для обробки. Розділіть його на кілька зображень.');
    if (Math.min(overview.width / width, overview.height / height) >= 0.7)
      return { overview, details: [] };

    let best;
    // Prefer the fewest detail images that retain at least 90% of source
    // resolution. Every region is covered; no middle section is discarded.
    for (let count = 2; count <= LIMITS.maxDetails; count++) {
      for (let rows = 1; rows <= count; rows++) {
        if (count % rows) continue;
        const columns = count / rows, details = [];
        if (columns > width || rows > height) continue;
        let scale = 1;
        for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
          // Shared margins keep characters and labels on grid boundaries whole
          // in at least one neighboring detail image.
          const x = Math.max(0, Math.floor(column * width / columns) - (column ? 48 : 0));
          const y = Math.max(0, Math.floor(row * height / rows) - (row ? 48 : 0));
          const w = Math.min(width, Math.floor((column + 1) * width / columns) + (column + 1 < columns ? 48 : 0)) - x;
          const h = Math.min(height, Math.floor((row + 1) * height / rows) + (row + 1 < rows ? 48 : 0)) - y;
          const detail = region(x, y, w, h);
          scale = Math.min(scale, detail.width / w, detail.height / h);
          details.push(detail);
        }
        if (!best || scale > best.scale) best = { scale, details };
      }
      if (best.scale >= 0.9) break;
    }
    if (!best || best.scale < 0.7)
      throw new Error('Щоб дрібний текст залишався читабельним, розділіть цей дуже довгий або великий скріншот на кілька зображень.');
    return { overview, details: best.details };
  }

  function validateAIScreenshots(screenshots) {
    if (!Array.isArray(screenshots) || screenshots.length > LIMITS.maxOriginals)
      throw new Error('Додайте коректні скріншоти (до 40 файлів).');
    let imageCount = 0, estimatedTokens = 0, base64Bytes = 0;
    function frame(image) {
      if (!image || typeof image.data !== 'string' || !image.data ||
          (image.mediaType !== undefined && !TYPES.has(image.mediaType)))
        throw new Error('Додайте коректні зображення скріншотів.');
      if (image.data.length > LIMITS.maxImageBase64Bytes)
        throw new Error('Розмір одного зображення завеликий. Додайте менший файл.');
      let tokens = LIMITS.maxTokens; // Conservative bound for older clients.
      if (image.width !== undefined || image.height !== undefined) {
        if (!Number.isInteger(image.width) || !Number.isInteger(image.height) ||
            image.width < 1 || image.height < 1 || !fits(image.width, image.height))
          throw new Error('Некоректні розміри підготовленого зображення. Оновіть сторінку та спробуйте ще раз.');
        tokens = tokenCount(image.width, image.height);
      }
      imageCount++;
      estimatedTokens += tokens;
      base64Bytes += image.data.length;
    }
    for (const screenshot of screenshots) {
      frame(screenshot);
      if (screenshot.details !== undefined && (!Array.isArray(screenshot.details) || screenshot.details.length > LIMITS.maxDetails))
        throw new Error('Некоректний набір збільшених фрагментів скріншота.');
      for (const detail of screenshot.details || []) frame(detail);
    }
    if (imageCount > LIMITS.maxImages || estimatedTokens > LIMITS.maxTotalTokens)
      throw new Error('Загальний обсяг зображень і фрагментів завеликий. Зменште кількість скріншотів для однієї генерації.');
    if (base64Bytes > LIMITS.maxTotalBase64Bytes)
      throw new Error('Загальний розмір скріншотів завеликий. Зменште кількість файлів для однієї генерації.');
    return { imageCount, estimatedTokens, base64Bytes };
  }

  function dataFromCanvas(canvas, mediaType, quality) {
    const value = canvas.toDataURL(mediaType, quality);
    const prefix = `data:${mediaType};base64,`;
    if (typeof value !== 'string' || !value.startsWith(prefix) || value.length === prefix.length)
      throw new Error('Не вдалося підготувати зображення для AI.');
    return value.slice(prefix.length);
  }

  function encodeFrame(image, area, byteBudget) {
    const canvas = document.createElement('canvas');
    try {
      canvas.width = area.width; canvas.height = area.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Браузер не зміг підготувати зображення для AI.');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, area.x, area.y, area.sourceWidth, area.sourceHeight, 0, 0, area.width, area.height);
      // Re-encode even small originals: preserve text pixels without forwarding
      // EXIF/GPS or other embedded metadata to the provider.
      let mediaType = 'image/png', data = dataFromCanvas(canvas, mediaType);
      if (data.length > byteBudget) {
        context.save();
        context.globalCompositeOperation = 'destination-over';
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.restore();
        mediaType = 'image/jpeg';
        for (const quality of [0.94, 0.9]) {
          data = dataFromCanvas(canvas, mediaType, quality);
          if (data.length <= byteBudget) break;
        }
      }
      if (data.length > byteBudget)
        throw new Error('Обсяг скріншота завеликий для чіткої передачі. Додайте менше файлів або розділіть велике зображення.');
      return { mediaType, data, width: area.width, height: area.height };
    } finally {
      canvas.width = 0; canvas.height = 0;
    }
  }

  async function prepareAIScreenshots(files) {
    if (!Array.isArray(files) || files.length > LIMITS.maxOriginals)
      throw new Error('Додайте не більше 40 скріншотів для однієї генерації.');
    const screenshots = [];
    let imageCount = 0, estimatedTokens = 0, base64Bytes = 0;
    for (let index = 0; index < files.length; index++) {
      const file = files[index], url = URL.createObjectURL(file), image = new Image();
      try {
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = () => reject(new Error('Не вдалося прочитати скріншот ' + (file.name || index + 1) + '.'));
          image.src = url;
        });
        const plan = planScreenshot(image.naturalWidth || image.width, image.naturalHeight || image.height);
        const areas = [plan.overview, ...plan.details];
        imageCount += areas.length;
        estimatedTokens += areas.reduce((sum, area) => sum + tokenCount(area.width, area.height), 0);
        if (imageCount > LIMITS.maxImages || estimatedTokens > LIMITS.maxTotalTokens)
          throw new Error('Загальний обсяг зображень і фрагментів завеликий. Додайте менше скріншотів для однієї генерації.');
        const encoded = areas.map((area, areaIndex) => {
          const remaining = files.length - index - 1 + areas.length - areaIndex;
          const budget = Math.min(LIMITS.maxImageBase64Bytes,
            Math.floor((LIMITS.maxTotalBase64Bytes - base64Bytes) / remaining));
          const frame = encodeFrame(image, area, budget);
          base64Bytes += frame.data.length;
          return frame;
        });
        const [overview, ...details] = encoded;
        if (details.length) overview.details = details;
        screenshots.push(overview);
      } finally {
        image.onload = null; image.onerror = null;
        URL.revokeObjectURL(url);
      }
    }
    validateAIScreenshots(screenshots);
    return screenshots;
  }

  return { LIMITS, fitImageDimensions, planScreenshot, validateAIScreenshots, prepareAIScreenshots };
});
