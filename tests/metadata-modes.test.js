const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const JSZip = require('../public/js/vendor/jszip.min.js');

function element() {
  return {
    value: '', children: [], classList: { toggle() {} },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
    setAttribute() {}, addEventListener() {}, click() { this.onclick?.(); }
  };
}

async function page() {
  const nodes = Object.fromEntries(['fileQueue', 'fileCount', 'emptyQueue', 'cleanBtn', 'clearBtn',
    'input', 'drop', 'downloadZip', 'progress', 'status', 'cleanMode', 'modeHint'].map(id => [id, element()]));
  nodes.cleanMode.value = 'clean';
  const blobs = new Map(), downloads = [], storage = new Map();
  let cleanCount = 0;
  const context = vm.createContext({ Date, Uint32Array,
    crypto: { getRandomValues(array) { array[0] = 0x8badf00d; return array; } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    JSZip, setTimeout(callback, delay) { if (!delay) callback(); },
    URL: { createObjectURL(blob) { const url = `blob:${blobs.size}`; blobs.set(url, blob); return url; }, revokeObjectURL() {} },
    document: { createElement() { const node = element(); node.click = () => downloads.push(blobs.get(node.href)); return node; } }
  });
  const metadata = new vm.SourceTextModule(fs.readFileSync('public/js/metadata.js', 'utf8'), { context });
  await metadata.link(() => {}); await metadata.evaluate();
  // Canvas/video decoding is outside this test; archive creation and date generation stay real.
  const dependencies = new vm.SyntheticModule(['createMetadataDate', 'metadataKind', 'stripImageMetadata', 'stripVideoMetadata'], function () {
    this.setExport('createMetadataDate', metadata.namespace.createMetadataDate);
    this.setExport('metadataKind', metadata.namespace.metadataKind);
    const clean = async file => { cleanCount++; return file; };
    this.setExport('stripImageMetadata', clean); this.setExport('stripVideoMetadata', clean);
  }, { context });
  const module = new vm.SourceTextModule(fs.readFileSync('public/js/tools/metadata.js', 'utf8'), { context });
  await module.link(() => dependencies); await module.evaluate();
  module.namespace.mount({ querySelector: selector => nodes[selector.slice(1)] });
  return {
    nodes,
    get cleanCount() { return cleanCount; },
    get archive() { return downloads.at(-1); },
    async clean(files) { nodes.input.files = files; nodes.input.onchange(); await nodes.cleanBtn.onclick(); },
    mode(value) { nodes.cleanMode.value = value; nodes.cleanMode.onchange?.(); },
    async zip() {
      const count = downloads.length;
      await nodes.downloadZip.onclick();
      assert.equal(downloads.length, count + 1, nodes.status.textContent);
      return JSZip.loadAsync(await downloads.at(-1).arrayBuffer());
    }
  };
}

function source(name, date) {
  const file = new Uint8Array([1, 2, 3, 4]);
  Object.assign(file, { name, type: 'image/png', size: file.length, lastModified: Date.parse(date) });
  return file;
}

test('Metadata clean-only ZIP preserves each source file date', async () => {
  const app = await page();
  // DOS ZIP dates are local calendar fields; JSZip exposes those fields as UTC.
  await app.clean([source('first.png', '2022-04-07T09:13:24'), source('second.png', '2023-09-18T21:35:48')]);
  const zip = await app.zip();
  assert.equal(zip.file('first_clean.png').date.toISOString(), '2022-04-07T09:13:24.000Z');
  assert.equal(zip.file('second_clean.png').date.toISOString(), '2023-09-18T21:35:48.000Z');
  assert.deepEqual(await zip.file('first_clean.png').async('uint8array'), new Uint8Array([1, 2, 3, 4]));
});

test('Metadata mode can change after cleaning, with fresh unique dates on every ZIP', async () => {
  const app = await page();
  await app.clean([source('first.png', '2022-04-07T09:13:24'), source('second.png', '2023-09-18T21:35:48')]);
  app.mode('unique');
  assert.equal(app.nodes.fileQueue.children[0].children.some(child => child.download), false,
    'Unique dates must be downloaded in ZIP, including a single cleaned file');
  const first = await app.zip(), second = await app.zip();
  const date = first.file('first_clean.png').date;
  assert.ok(date >= new Date('2010-01-01T00:00:00Z') && date < new Date('2025-01-01T00:00:00Z'));
  assert.equal(date.getTime(), first.file('second_clean.png').date.getTime());
  assert.notEqual(date.getTime(), second.file('first_clean.png').date.getTime());
  app.mode('clean');
  const restored = await app.zip();
  assert.equal(restored.file('first_clean.png').date.toISOString(), '2022-04-07T09:13:24.000Z');
  assert.equal(restored.file('second_clean.png').date.toISOString(), '2023-09-18T21:35:48.000Z');
  assert.equal(app.cleanCount, 2, 'Switching export modes must not reprocess images');
});

test('Metadata clean-only ZIP clamps dates outside the ZIP supported range', async () => {
  const app = await page();
  await app.clean([source('old.png', '1970-01-01T00:00:00Z'), source('future.png', '2200-01-01T00:00:00Z')]);
  const zip = await app.zip();
  assert.equal(zip.file('old_clean.png').date.toISOString(), '1980-01-01T00:00:00.000Z');
  assert.equal(zip.file('future_clean.png').date.toISOString(), '2107-12-31T23:59:58.000Z');
});

test('Metadata source modification times survive native ZIP extraction in local time zones', async () => {
  const originalZone = process.env.TZ;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wwa-metadata-modes-'));
  try {
    for (const zone of ['Europe/Kyiv', 'America/New_York']) {
      process.env.TZ = zone;
      const app = await page();
      await app.clean([source('summer.png', '2022-04-07T09:13:24Z'), source('winter.png', '2023-12-18T21:35:48Z')]);
      await app.zip();
      const archive = path.join(directory, 'cleaned.zip');
      fs.writeFileSync(archive, Buffer.from(await app.archive.arrayBuffer()));
      execFileSync('unzip', ['-oq', archive, '-d', directory]);
      assert.equal(fs.statSync(path.join(directory, 'summer_clean.png')).mtimeMs, Date.parse('2022-04-07T09:13:24Z'), zone);
      assert.equal(fs.statSync(path.join(directory, 'winter_clean.png')).mtimeMs, Date.parse('2023-12-18T21:35:48Z'), zone);
    }
  } finally {
    if (originalZone === undefined) delete process.env.TZ; else process.env.TZ = originalZone;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
