const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fitImageDimensions, planScreenshot, prepareAIScreenshots, validateAIScreenshots, LIMITS } = require('../public/js/ai-screenshots');

test('AI preparation retains ordinary phone dimensions without upscaling small images', () => {
  assert.deepEqual(fitImageDimensions(1080, 1920), { width: 1080, height: 1920 });
  assert.deepEqual(fitImageDimensions(320, 480), { width: 320, height: 480 });
});

test('square images fit both the provider edge and visual-token budgets', () => {
  assert.deepEqual(fitImageDimensions(5000, 5000), { width: 1932, height: 1932 });
  assert.throws(() => fitImageDimensions(0, 1920), /розміри/i);
});

test('resizing preserves the aspect ratio to the nearest pixel', () => {
  assert.deepEqual(fitImageDimensions(6000, 1080), { width: 2576, height: 464 });
  assert.deepEqual(fitImageDimensions(1080, 6000), { width: 464, height: 2576 });
});

test('long screenshots keep overlapping native-resolution fragments so boundary text stays whole', () => {
  const plan = planScreenshot(1080, 6000);
  assert.equal(plan.details.length, 3);
  assert.deepEqual(plan.details.map(({ x, y, sourceWidth, sourceHeight, width, height }) =>
    [x, y, sourceWidth, sourceHeight, width, height]), [
    [0, 0, 1080, 2048, 1080, 2048],
    [0, 1952, 1080, 2096, 1080, 2096],
    [0, 3952, 1080, 2048, 1080, 2048]
  ]);
});

test('thin source images never create empty grid cells', () => {
  for (const [width, height] of [[1, 5000], [5000, 1]]) {
    const plan = planScreenshot(width, height);
    assert.equal(plan.details.length, 2);
    assert.ok(plan.details.every(area => area.sourceWidth > 0 && area.sourceHeight > 0));
  }
});

test('normal screenshots do not incur unnecessary detail images', () => {
  assert.equal(planScreenshot(1080, 2400).details.length, 0);
  assert.equal(planScreenshot(1440, 3200).details.length, 0);
});

test('extreme dimensions fail clearly instead of silently making unreadable strips', () => {
  assert.throws(() => planScreenshot(1000, 20000), /розділіть/i);
  assert.throws(() => planScreenshot(10000, 10000), /великий/i);
});

function browserFixture(t, { pngData = 'cG5n', jpegData = 'anBlZw==', nullContext = false, encodeError = false } = {}) {
  const previous = { Image: global.Image, document: global.document, URL: global.URL };
  const files = new Map(), revoked = [], canvases = [], calls = [];
  let id = 0;
  global.URL = { createObjectURL(file) { const url = `blob:${++id}`; files.set(url, file); return url; },
    revokeObjectURL(url) { revoked.push(url); } };
  global.Image = class {
    set src(url) {
      const file = files.get(url); this.width = this.naturalWidth = file.width; this.height = this.naturalHeight = file.height;
      queueMicrotask(() => file.decodeError ? this.onerror() : this.onload());
    }
  };
  global.document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    const ctx = { drawImage(...args) { calls.push(['draw', ...args.slice(1)]); },
      save() {}, restore() {}, fillRect() { calls.push(['background', this.fillStyle, this.globalCompositeOperation]); } };
    const canvas = { width: 0, height: 0, ctx,
      getContext() { return nullContext ? null : ctx; },
      toDataURL(type, quality) {
        if (encodeError) throw new Error('encoder failed');
        calls.push(['encode', type, quality, this.width, this.height]);
        return `data:${type};base64,${type === 'image/png' ? pngData : jpegData}`;
      } };
    canvases.push(canvas); return canvas;
  } };
  t.after(() => Object.assign(global, previous));
  return { calls, revoked, canvases };
}

test('phone screenshots use lossless PNG at native size and leave ZIP originals untouched', async t => {
  const fixture = browserFixture(t);
  const file = { name: 'phone.png', width: 1080, height: 1920 };
  const result = await prepareAIScreenshots([file]);
  assert.deepEqual(result, [{ mediaType: 'image/png', data: 'cG5n', width: 1080, height: 1920 }]);
  assert.deepEqual(fixture.calls.filter(call => call[0] === 'encode'), [['encode', 'image/png', undefined, 1080, 1920]]);
  assert.equal(fixture.canvases[0].ctx.imageSmoothingQuality, 'high');
  assert.deepEqual(file, { name: 'phone.png', width: 1080, height: 1920 });
  assert.deepEqual(fixture.revoked, ['blob:1']);
  assert.equal(fixture.canvases[0].width, 0);
});

test('detail views remain grouped with their original screenshot', async t => {
  const fixture = browserFixture(t);
  const result = await prepareAIScreenshots([{ name: 'long.png', width: 1080, height: 6000 }]);
  assert.equal(result.length, 1);
  assert.equal(result[0].details.length, 3);
  assert.deepEqual(result[0].details.map(image => [image.width, image.height]), [[1080, 2048], [1080, 2096], [1080, 2048]]);
  assert.equal(fixture.calls.filter(call => call[0] === 'draw').length, 4);
  assert.deepEqual(fixture.revoked, ['blob:1']);
});

test('oversized PNG encoding falls back to high-quality JPEG without reducing dimensions', async t => {
  const fixture = browserFixture(t, { pngData: 'a'.repeat(LIMITS.maxImageBase64Bytes + 4) });
  const [image] = await prepareAIScreenshots([{ name: 'photo.png', width: 1080, height: 1920 }]);
  assert.equal(image.mediaType, 'image/jpeg');
  assert.deepEqual([image.width, image.height], [1080, 1920]);
  assert.ok(fixture.calls.some(call => call[0] === 'encode' && call[1] === 'image/jpeg' && call[2] >= 0.9));
  assert.ok(fixture.calls.some(call => call[0] === 'background' && call[1] === '#fff'));
});

for (const [label, options, file] of [
  ['decode', {}, { name: 'broken.png', width: 1080, height: 1920, decodeError: true }],
  ['canvas', { nullContext: true }, { name: 'phone.png', width: 1080, height: 1920 }],
  ['encode', { encodeError: true }, { name: 'phone.png', width: 1080, height: 1920 }]
]) test(`preparation ${label} failure rejects and releases its object URL`, async t => {
  const fixture = browserFixture(t, options);
  await assert.rejects(prepareAIScreenshots([file]));
  assert.deepEqual(fixture.revoked, ['blob:1']);
  assert.ok(fixture.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('image byte budgets fail before sending unreadably compressed or discarded screenshots', async t => {
  const tooLarge = 'a'.repeat(LIMITS.maxImageBase64Bytes + 4);
  const fixture = browserFixture(t, { pngData: tooLarge, jpegData: tooLarge });
  await assert.rejects(prepareAIScreenshots([{ name: 'photo.png', width: 1080, height: 1920 }]), /обсяг|розмір/i);
  assert.deepEqual(fixture.revoked, ['blob:1']);
});

test('validation accepts legacy screenshots and counts nested detail images', () => {
  assert.equal(validateAIScreenshots([{ data: 'fixture', details: [{ mediaType: 'image/png', data: 'fixture', width: 1080, height: 1920 }] }]).imageCount, 2);
  assert.equal(validateAIScreenshots([]).imageCount, 0);
});

test('validation rejects invalid frames, impossible dimensions and image-count overflow', () => {
  assert.throws(() => validateAIScreenshots([{ data: 'fixture', details: 'not-an-array' }]));
  assert.throws(() => validateAIScreenshots([{ data: 'fixture', width: 5000, height: 5000 }]));
  const detail = { data: 'fixture', width: 1, height: 1 };
  assert.throws(() => validateAIScreenshots(Array.from({ length: 21 }, () => ({ ...detail, details: Array(4).fill(detail) }))), /зображень|фрагментів/i);
});

test('validation enforces a bounded visual-token budget across originals and details', () => {
  const image = { data: 'fixture', width: 1932, height: 1932 };
  assert.throws(() => validateAIScreenshots(Array.from({ length: 22 }, () => ({ ...image, details: [image] }))), /обсяг|зображень|фрагментів/i);
});

test('validation enforces the aggregate encoded-image budget', () => {
  const image = { data: 'a'.repeat(LIMITS.maxImageBase64Bytes), width: 1, height: 1 };
  assert.throws(() => validateAIScreenshots(Array(8).fill(image)), /обсяг|розмір/i);
});
