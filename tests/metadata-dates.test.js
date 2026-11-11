const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const JSZip = require('../public/js/vendor/jszip.min.js');

async function dates(storage = new Map(), random = 0x8badf00d) {
  class TestDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-11T15:46:53Z'])); }
    static now() { return Date.parse('2026-11-11T15:46:53Z'); }
  }
  const context = vm.createContext({ Date: TestDate,
    crypto: { getRandomValues(array) { array[0] = random; return array; } },
    localStorage: storage ? {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    } : { getItem() { throw new Error('Storage blocked'); }, setItem() { throw new Error('Storage blocked'); } }
  });
  const module = new vm.SourceTextModule(fs.readFileSync('public/js/metadata.js', 'utf8'), { context });
  await module.link(() => {}); await module.evaluate();
  return module.namespace;
}

test('new cleaned ZIPs receive distinct random historical dates at ZIP precision', async () => {
  const metadata = await dates();
  assert.equal(typeof metadata.createMetadataDate, 'function');
  const timestamps = [];
  for (let index = 0; index < 2; index++) {
    const date = metadata.createMetadataDate();
    assert.ok(date >= new Date('2010-01-01T00:00:00Z'));
    assert.ok(date < new Date('2025-01-01T00:00:00Z'));
    const zip = new JSZip();
    zip.file('1.png', 'same image bytes', { date });
    const saved = await JSZip.loadAsync(await zip.generateAsync({ type: 'nodebuffer' }));
    const entry = saved.file('1.png');
    assert.equal(await entry.async('string'), 'same image bytes');
    timestamps.push(entry.date.getTime());
  }
  assert.notEqual(timestamps[0], timestamps[1]);
});

test('a page reload does not repeat a saved random date, even when randomness collides', async () => {
  const storage = new Map();
  const first = (await dates(storage)).createMetadataDate().getTime();
  const afterReload = (await dates(storage)).createMetadataDate().getTime();
  assert.notEqual(first, afterReload);
});

test('random date generation still works when browser storage is blocked', async () => {
  const metadata = await dates(null);
  const first = metadata.createMetadataDate();
  const next = metadata.createMetadataDate();
  assert.notEqual(first.getTime(), next.getTime());
});
