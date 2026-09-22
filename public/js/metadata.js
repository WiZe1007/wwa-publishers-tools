// Shared by the standalone cleaner and Release Package. No network requests.
export const FIXED_DATE = new Date('2020-01-01T00:00:00Z');
export const isImage = file => (file.type || '').startsWith('image/');
export const isVideo = file => (file.type || '').startsWith('video/') || /\.(mp4|mov|m4v)$/i.test(file.name);
export function metadataKind(file) {
  if (/\.(jpe?g|png|webp)$/i.test(file.name)) return 'image';
  if (/\.(mp4|mov|m4v)$/i.test(file.name)) return 'video';
  return null;
}

async function rejectAnimatedImage(file) {
  if (!/\.(png|webp)$/i.test(file.name) && !/image\/(png|webp)/.test(file.type)) return;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const text = (offset, count) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  if (text(1, 3) === 'PNG') {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const size = view.getUint32(offset);
      if (offset + 12 + size > bytes.length) throw new Error('Invalid PNG file.');
      if (text(offset + 4, 4) === 'acTL') throw new Error('Animated PNG is not supported. Your original animation is unchanged.');
      offset += size + 12;
    }
  } else if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const size = view.getUint32(offset + 4, true);
      if (offset + 8 + size > bytes.length) throw new Error('Invalid WebP file.');
      if (['ANIM', 'ANMF'].includes(text(offset, 4))) throw new Error('Animated WebP is not supported. Your original animation is unchanged.');
      offset += size + 8 + (size % 2);
    }
  }
}

export async function stripImageMetadata(file) {
  if (file.size > 32 * 1024 * 1024) throw new Error('Image exceeds the 32 MB limit.');
  await rejectAnimatedImage(file);
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      try {
        const width = img.naturalWidth, height = img.naturalHeight;
        if (!width || !height || width * height > 40000000 || Math.max(width, height) > 16384) throw new Error('Image is too large: maximum 40 MP and 16384 px per side.');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas is unavailable in this browser.');
        let type = file.type;
        if (/\.jpe?g$/i.test(file.name)) type = 'image/jpeg';
        if (/\.png$/i.test(file.name)) type = 'image/png';
        if (/\.webp$/i.test(file.name)) type = 'image/webp';
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(type)) type = 'image/png';
        if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, width, height); }
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(blob => {
          URL.revokeObjectURL(url);
          canvas.width = canvas.height = 0;
          if (!blob) { reject(new Error('Could not re-encode the image.')); return; }
          const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[blob.type];
          if (!extension) { reject(new Error('Unsupported output format.')); return; }
          const same = (blob.type === 'image/jpeg' && /\.jpe?g$/i.test(file.name)) || file.name.toLowerCase().endsWith('.' + extension);
          const name = same ? file.name : file.name.replace(/\.[^.]+$/, '') + '.' + extension;
          resolve(new File([blob], name, { type: blob.type, lastModified: FIXED_DATE.getTime() }));
        }, type, .96);
      } catch (error) {
        URL.revokeObjectURL(url); canvas.width = canvas.height = 0; reject(error);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image.')); };
    img.src = url;
  });
}

export async function stripVideoMetadata(file) {
  if (file.size > 200 * 1024 * 1024) throw new Error('Video exceeds the 200 MB limit.');
  const buffer = await file.arrayBuffer();
  const view = new DataView(buffer), bytes = new Uint8Array(buffer);
  const text = (offset, count) => String.fromCharCode(...bytes.subarray(offset, offset + count));
  let movie = false, media = false;
  const walk = (start, end, depth) => {
    if (depth > 12) throw new Error('MP4/MOV nesting is too deep.');
    for (let offset = start; offset < end;) {
      if (offset + 8 > end) throw new Error('Invalid MP4/MOV structure.');
      let size = view.getUint32(offset), header = 8;
      const type = text(offset + 4, 4);
      if (size === 1) {
        if (offset + 16 > end) throw new Error('Invalid MP4/MOV header.');
        const largeSize = view.getBigUint64(offset + 8);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4/MOV block is too large.');
        size = Number(largeSize); header = 16;
      } else if (size === 0) size = end - offset;
      if (size < header || offset + size > end) throw new Error('Invalid MP4/MOV block size.');
      if (depth === 0 && type === 'moov') movie = true;
      if (depth === 0 && type === 'mdat') media = true;
      if (['udta', 'meta', 'uuid', 'free', 'skip'].includes(type)) {
        bytes.set([102, 114, 101, 101], offset + 4); // free; preserve every media offset
        bytes.fill(0, offset + header, offset + size);
      } else if (['mvhd', 'tkhd', 'mdhd'].includes(type)) {
        const body = offset + header;
        if (body + 4 > offset + size) throw new Error('Invalid timestamps.');
        const version = view.getUint8(body);
        if (version !== 0 && version !== 1) throw new Error('Unsupported timestamp version.');
        const count = version === 1 ? 16 : 8;
        if (body + 4 + count > offset + size) throw new Error('Invalid timestamps.');
        bytes.fill(0, body + 4, body + 4 + count);
      } else if (['moov', 'trak', 'mdia', 'edts', 'minf', 'stbl', 'moof', 'traf', 'mvex', 'mfra'].includes(type)) {
        walk(offset + header, offset + size, depth + 1);
      }
      offset += size;
    }
  };
  walk(0, buffer.byteLength, 0);
  if (!movie || !media) throw new Error('A standalone MP4/MOV/M4V file is required. Other video formats are not supported.');
  // Return timestamp-only changes too; the old implementation discarded these.
  return new File([buffer], file.name, { type: file.type || 'video/mp4', lastModified: FIXED_DATE.getTime() });
}
