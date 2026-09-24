const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function setup(files = [], clean = async file => file, options = {}) {
  const elements = Object.fromEntries(['cleanMetaBtn', 'cleanMetaStatus', 'cleanMetaDownload'].map(id => [id, {
    hidden: id === 'cleanMetaDownload',
    setAttribute(name, value) { this[name] = value; },
    removeAttribute(name) { delete this[name]; }
  }]));
  const archived = [], revoked = [], downloads = [];
  const context = vm.createContext({
    setTimeout, File: globalThis.File || require('node:buffer').File,
    URL: { createObjectURL: file => { downloads.push(file); return 'blob:test'; }, revokeObjectURL: url => revoked.push(url) },
    JSZip: class {
      file(name, file, options) { archived.push({ name, file, options }); }
      async generateAsync() { return {}; }
    }
  });
  const dependencies = new vm.SyntheticModule(['FIXED_DATE', 'metadataKind', 'stripImageMetadata', 'stripVideoMetadata'], function () {
    this.setExport('FIXED_DATE', new Date('2020-01-01T00:00:00Z'));
    this.setExport('metadataKind', file => /\.png$/i.test(file.name) ? 'image' : null);
    this.setExport('stripImageMetadata', clean);
    this.setExport('stripVideoMetadata', clean);
  }, { context });
  const source = fs.readFileSync(path.join(__dirname, '../public/js/quick-metadata.js'), 'utf8');
  const module = new vm.SourceTextModule(source, { context });
  await module.link(() => dependencies); await module.evaluate();
  const state = { files };
  const controller = module.namespace.mountQuickMetadata({ querySelector: selector => elements[selector.slice(1)] }, () => state.files, options);
  return { elements, state, controller, archived, revoked, downloads };
}

test('generated results keep exact encoded bytes, dimensions/format and filename without re-encoding', async () => {
  const File = globalThis.File || require('node:buffer').File;
  for (const [name, type] of [['resized_1440x2560.png', 'image/png'], ['converted.jpg', 'image/jpeg'], ['converted.bmp', 'image/bmp'], ['merged.webp', 'image/webp']]) {
    const output = new File([new Uint8Array([1, 2, 3, 4])], name, { type });
    const t = await setup([], () => { throw new Error('Must not re-encode generated output'); }, { generatedResults: true });
    assert.equal(t.elements.cleanMetaBtn.disabled, true);
    t.state.files = [output]; t.controller.refresh();
    await t.elements.cleanMetaBtn.onclick();
    assert.equal(t.elements.cleanMetaDownload.hidden, false);
    assert.equal(t.elements.cleanMetaDownload.download, name.replace(/(\.[^.]+)$/, '_clean$1'));
    assert.deepEqual(Buffer.from(await t.downloads[0].arrayBuffer()), Buffer.from(await output.arrayBuffer()));
    assert.equal(t.downloads[0].type, type);
    assert.equal(t.downloads[0].lastModified, new Date('2020-01-01T00:00:00Z').getTime());
    t.state.files = []; t.controller.refresh();
    assert.equal(t.elements.cleanMetaBtn.disabled, true);
    assert.equal(t.elements.cleanMetaDownload.hidden, true);
  }
});

test('quick cleaner is disabled until files exist and does not replace source files', async () => {
  const t = await setup();
  assert.equal(t.elements.cleanMetaBtn.disabled, true);
  const file = { name: 'image.png', size: 100 };
  t.state.files.push(file); t.controller.refresh();
  assert.equal(t.elements.cleanMetaBtn.disabled, false);
  await t.elements.cleanMetaBtn.onclick();
  assert.equal(t.elements.cleanMetaDownload.hidden, false);
  assert.equal(t.elements.cleanMetaDownload.download, 'image_clean.png');
  assert.equal(t.state.files[0], file);
  t.state.files = []; t.controller.refresh();
  assert.equal(t.elements.cleanMetaDownload.hidden, true);
  assert.equal(t.elements.cleanMetaBtn.disabled, true);
  assert.equal(t.revoked.length, 1);
});

test('batch ZIP preserves duplicate names and excludes unsupported files', async () => {
  const t = await setup([{ name: 'same.png', size: 10 }, { name: 'same.png', size: 10 }, { name: 'bad.gif', size: 10 }]);
  await t.elements.cleanMetaBtn.onclick();
  assert.deepEqual(t.archived.map(item => item.name), ['same_clean.png', 'same_clean (2).png']);
  assert.equal(t.archived[0].options.compression, 'STORE');
  assert.equal(t.archived[0].options.date.toISOString(), '2020-01-01T00:00:00.000Z');
  assert.equal(t.elements.cleanMetaDownload.download, 'metadata-cleaned.zip');
  assert.match(t.elements.cleanMetaStatus.textContent, /Очищено: 2 із 3/);
  assert.match(t.elements.cleanMetaStatus.textContent, /bad.gif/);
});

test('changing source files while cleaning never offers a stale result', async () => {
  let finish;
  const t = await setup([{ name: 'old.png', size: 10 }], file => new Promise(resolve => { finish = () => resolve(file); }));
  const pending = t.elements.cleanMetaBtn.onclick();
  assert.equal(t.elements.cleanMetaBtn.disabled, true);
  t.state.files = [{ name: 'new.png', size: 10 }]; finish(); await pending;
  assert.equal(t.elements.cleanMetaDownload.hidden, true);
  assert.match(t.elements.cleanMetaStatus.textContent, /Список файлів змінено/);
});

test('limits and failed files do not produce a download', async () => {
  const t = await setup(Array.from({ length: 51 }, () => ({ name: 'small.png', size: 1 })));
  await t.elements.cleanMetaBtn.onclick();
  assert.equal(t.elements.cleanMetaDownload.hidden, true);
  assert.match(t.elements.cleanMetaStatus.textContent, /50 файлів/);
  const failed = await setup([{ name: 'bad.png', size: 1 }], async () => { throw new Error('Invalid image'); });
  await failed.elements.cleanMetaBtn.onclick();
  assert.equal(failed.elements.cleanMetaDownload.hidden, true);
  assert.match(failed.elements.cleanMetaStatus.textContent, /Invalid image/);
  assert.equal(failed.elements.cleanMetaBtn.disabled, false);
});
