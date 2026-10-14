const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function mount(fetch, { health = '{"ok":true,"aiConfigured":true}' } = {}) {
  const elements = new Map();
  function element() {
    return { value: '', textContent: '', innerHTML: '', disabled: false, style: { setProperty() {} },
      dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [], listeners: {},
      addEventListener(name, callback) { this.listeners[name] = callback; },
      querySelector() { return element(); }, appendChild(child) { this.children.push(child); } };
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = vm.createContext({ console, fetch: (url, options) => url === '/api/health'
    ? Promise.resolve(new Response(health)) : fetch(url, options), AbortController, setTimeout, clearTimeout, TypeError,
    CSS: { escape: value => value },
    document: { createElement: tag => tag === 'canvas'
      ? { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,mock-image' } : element() },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Image: class { width = 100; height = 100; set src(value) { this._src = value; queueMicrotask(() => this.onload()); } get src() { return this._src; } }
  });
  const metadata = new vm.SyntheticModule(['FIXED_DATE', 'isImage', 'isVideo', 'stripImageMetadata', 'stripVideoMetadata'], function () {
    this.setExport('FIXED_DATE', new Date());
    for (const name of ['isImage', 'isVideo', 'stripImageMetadata', 'stripVideoMetadata']) this.setExport(name, () => {});
  }, { context });
  const http = new vm.SourceTextModule(fs.readFileSync('public/js/http.js', 'utf8'), { context });
  await http.link(() => {});
  const module = new vm.SourceTextModule(fs.readFileSync('public/js/tools/zip.js', 'utf8'), { context });
  await module.link(specifier => specifier === '../http.js' ? http : metadata); await module.evaluate();
  module.namespace.mount({ querySelector: selector => $(selector.slice(1)), querySelectorAll: () => [] });
  $('appName').value = 'Demo'; $('devDescription').value = 'A private offline garden guide.';
  $('shortDesc').value = 'Previous short.'; $('fullDesc').value = 'Previous full description.';
  $('shotsInput').files = [{ name: 'test.jpg', type: 'image/jpeg' }]; $('shotsInput').onchange();
  return $;
}

for (const body of ['', '<html>Bad Gateway</html>', '{"shortDescription":', '{}']) {
  test(`ZIP generation preserves existing fields and unlocks its button on ${body || 'empty response'}`, async () => {
    let calls = 0;
    const $ = await mount(async () => { calls++; return new Response(body, { status: body === '{}' ? 200 : 502 }); });
    await $('genBtn').onclick();
    assert.equal(calls, 1);
    assert.equal($('shortDesc').value, 'Previous short.'); assert.equal($('fullDesc').value, 'Previous full description.');
    assert.equal($('genBtn').disabled, false); assert.match($('genStatus').className, /err/);
    assert.doesNotMatch($('genStatus').textContent, /Unexpected|JSON|<html>|undefined/);
  });
}
test('ZIP successful response fills both descriptions and unlocks its button', async () => {
  const $ = await mount(async () => new Response(JSON.stringify({ shortDescription: 'Demo: Choose tasks.', fullDescription: 'Choose tasks. Track progress.' })));
  await $('genBtn').onclick();
  assert.equal($('shortDesc').value, 'Demo: Choose tasks.');
  assert.equal($('fullDesc').value, 'Choose tasks. Track progress.');
  assert.equal($('genBtn').disabled, false); assert.equal($('asoResults').style.display, '');
});
test('ZIP keeps a valid partial result and displays the server warning', async () => {
  const $ = await mount(async () => new Response(JSON.stringify({ shortDescription: 'Demo: Choose tasks.', fullDescription: 'Choose tasks. Track progress.',
    warning: 'AI не встиг відповісти. Отриманий опис збережено.',
    spamCheck: { clean: false, remaining: [{ word: 'task', count: 3, density: 5 }], frequency: [], fixAttempts: 1, maxAllowed: 2, totalWords: 60, densityLimit: 2.5 }
  })));
  await $('genBtn').onclick();
  assert.equal($('fullDesc').value, 'Choose tasks. Track progress.');
  assert.match($('genStatus').textContent, /Отриманий опис збережено/);
  assert.match($('spamStatus').textContent, /Переспам/);
  assert.equal($('genBtn').disabled, false);
});
test('ZIP manual repair preserves the current description after an empty gateway error', async () => {
  const $ = await mount(async () => new Response('', { status: 502 }));
  await $('fixSpamBtn').onclick();
  assert.equal($('fullDesc').value, 'Previous full description.');
  assert.equal($('fixSpamBtn').disabled, false); assert.match($('spamStatus').textContent, /Сервер не повернув/);
});
test('ZIP generation never starts a paid request when the host is not ready', async () => {
  const $ = await mount(() => assert.fail('No paid request before health succeeds'), { health: '{"ok":false}' });
  await $('genBtn').onclick();
  assert.equal($('genBtn').disabled, false);
  assert.match($('genStatus').textContent, /AI-запит не надсилався/);
  assert.equal($('fullDesc').value, 'Previous full description.');
});
test('ZIP manual repair also checks the host before a paid request', async () => {
  const $ = await mount(() => assert.fail('No paid request before health succeeds'), { health: '{"ok":false}' });
  await $('fixSpamBtn').onclick();
  assert.equal($('fixSpamBtn').disabled, false);
  assert.match($('spamStatus').textContent, /AI-запит не надсилався/);
});
