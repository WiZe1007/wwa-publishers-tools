const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function mount(fetch, { health = '{"ok":true,"aiConfigured":true}', clipboard = [], toneChoice } = {}) {
  const elements = new Map();
  function element() {
    return { value: '', textContent: '', innerHTML: '', disabled: false, style: { setProperty() {} },
      dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [], listeners: {},
      addEventListener(name, callback) { const previous = this.listeners[name]; this.listeners[name] = (...args) => { previous?.(...args); callback(...args); }; },
      querySelector() { return element(); }, appendChild(child) { this.children.push(child); } };
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const context = vm.createContext({ console, fetch: (url, options) => url === '/api/health'
    ? Promise.resolve(new Response(health)) : fetch(url, options), AbortController, setTimeout, clearTimeout, TypeError,
    CSS: { escape: value => value },
    navigator: { clipboard: { writeText: async value => { clipboard.push(value); } } },
    document: { createElement: tag => tag === 'canvas'
      ? { getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,mock-image' } : element() },
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Image: class { width = 100; height = 100; set src(value) { this._src = value; queueMicrotask(() => this.onload()); } get src() { return this._src; } }
  });
  const metadata = new vm.SyntheticModule(['createMetadataDate', 'isImage', 'isVideo', 'stripImageMetadata', 'stripVideoMetadata'], function () {
    this.setExport('createMetadataDate', () => new Date('2018-05-17T11:23:46Z'));
    for (const name of ['isImage', 'isVideo', 'stripImageMetadata', 'stripVideoMetadata']) this.setExport(name, () => {});
  }, { context });
  const http = new vm.SourceTextModule(fs.readFileSync('public/js/http.js', 'utf8'), { context });
  await http.link(() => {});
  const descriptionFormat = new vm.SourceTextModule(fs.readFileSync('public/js/description-format.js', 'utf8'), { context });
  await descriptionFormat.link(() => {});
  const module = new vm.SourceTextModule(fs.readFileSync('public/js/tools/zip.js', 'utf8'), { context });
  await module.link(specifier => specifier === '../http.js' ? http : specifier === '../description-format.js' ? descriptionFormat : metadata); await module.evaluate();
  if (toneChoice) $('toneChoice').dataset.tone = toneChoice;
  module.namespace.mount({ querySelector: selector => $(selector.slice(1)),
    querySelectorAll: selector => toneChoice && selector === '#tones .tone' ? [$('toneChoice')] : [] });
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
test('TikTok rich HTML selection enables preview and reaches generation and manual repair', async () => {
  const requests = [];
  const $ = await mount(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ shortDescription: 'Demo: Explore.', fullDescription: 'Explore gardens.',
      spamCheck: { clean: true, remaining: [], frequency: [], maxAllowed: 1, totalWords: 2, densityLimit: 2.5 } }));
  }, { toneChoice: 'tiktok_aso_max_rich_html' });
  $('toneChoice').onclick();
  assert.equal($('descriptionPreviewPanel').hidden, false);
  await $('genBtn').onclick();
  await $('fixSpamBtn').onclick();
  assert.deepEqual(requests.map(request => [request.url, request.body.tone]), [
    ['/api/aso', 'tiktok_aso_max_rich_html'], ['/api/fix-spam', 'tiktok_aso_max_rich_html']
  ]);
});
test('ZIP rich result previews safe formatting and copies both original HTML and visible text', async () => {
  const clipboard = [];
  const html = '<b><font color="red">Explore</font></b>\n<i>At your pace</i> <u>offline</u>';
  const $ = await mount(async () => new Response(JSON.stringify({ shortDescription: 'Demo: Explore.', fullDescription: html })), { clipboard });
  await $('genBtn').onclick();
  assert.equal($('descriptionPreviewPanel').hidden, false);
  assert.equal($('descriptionPreview').innerHTML, html);
  assert.match($('fullCount').textContent, /HTML/);
  await $('copyHtmlBtn').onclick();
  await $('copyPlainBtn').onclick();
  assert.deepEqual(clipboard, [html, 'Explore\nAt your pace offline']);
  $('fullDesc').value = '<img src=x onerror=alert(1)><b>Updated</b>';
  $('fullDesc').listeners.input();
  assert.doesNotMatch($('descriptionPreview').innerHTML, /<img/);
  assert.match($('descriptionPreview').innerHTML, /<b>Updated<\/b>/);
});
test('ZIP keeps a valid partial result and displays the server warning', async () => {
  const $ = await mount(async () => new Response(JSON.stringify({ shortDescription: 'Demo: Choose tasks.', fullDescription: 'Choose tasks. Track progress.',
    warning: 'AI не встиг відповісти. Отриманий опис збережено.',
    spamCheck: { clean: false, remaining: [{ word: 'spin', count: 7, density: 2.29 }],
      frequency: [{ word: 'spin', count: 7, density: 2.29 }], fixAttempts: 1, maxAllowed: 6, totalWords: 306, densityLimit: 2.5 }
  })));
  await $('genBtn').onclick();
  assert.equal($('fullDesc').value, 'Choose tasks. Track progress.');
  assert.match($('genStatus').textContent, /Отриманий опис збережено/);
  assert.doesNotMatch($('genStatus').textContent, /Готово/);
  assert.match($('spamStatus').textContent, /«spin» ×7.*прибрати 1/);
  assert.equal($('spamTable').children[0].style.borderColor, 'var(--red)');
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

test('ZIP blocks malformed HTML copying and offers free repair without changing visible text', async () => {
  const clipboard = [];
  const $ = await mount(() => assert.fail('Formatting repair must not use AI'), { clipboard });
  $('fullDesc').value = '<b><font color="red">First. Second.\n\nBody text.</font></b>';
  $('fullDesc').listeners.input();
  assert.equal($('copyHtmlBtn').disabled, true);
  await $('copyHtmlBtn').onclick(); assert.equal(clipboard.length, 0);
  $('fixDescriptionFormatBtn').onclick();
  assert.equal($('copyHtmlBtn').disabled, false);
  await $('copyHtmlBtn').onclick();
  assert.equal(require('../public/js/description-format').formatDescription(clipboard[0]).text, 'First. Second.\n\nBody text.');
});

test('ZIP export never bypasses a formatting defect even after a second click', async () => {
  const $ = await mount(() => assert.fail('Invalid HTML must stop export before network requests'));
  $('fullDesc').value = '<font color="red">First.\n\nBody.</font>';
  await $('zipBtn').onclick(); await $('zipBtn').onclick();
  assert.match($('zipStatus').textContent, /оформлення/i);
  assert.equal($('zipBtn').disabled, false);
});
