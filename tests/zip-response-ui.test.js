const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function mount(fetch, { health = '{"ok":true,"aiConfigured":true}', clipboard = [], toneChoice,
  toneChoices = toneChoice ? [toneChoice] : [], screenshots = [{ name: 'test.jpg', type: 'image/jpeg' }],
  prepareAIScreenshots = async files => files.map(file => ({ mediaType: 'image/png', data: file.name, width: 100, height: 100 })),
  zipEntries = [] } = {}) {
  const elements = new Map();
  function element() {
    const descendants = new Map();
    let html = '';
    return { value: '', textContent: '', disabled: false, style: { setProperty() {} },
      dataset: {}, classList: { add() {}, remove() {}, toggle() {} }, children: [], listeners: {},
      get innerHTML() { return html; }, set innerHTML(value) { html = value; this.children = []; descendants.clear(); },
      addEventListener(name, callback) { const previous = this.listeners[name]; this.listeners[name] = (...args) => { previous?.(...args); callback(...args); }; },
      querySelector(selector) { if (!descendants.has(selector)) descendants.set(selector, element()); return descendants.get(selector); },
      appendChild(child) { this.children.push(child); }, click() { this.onclick?.(); } };
  }
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const rngInputs = [];
  for (const [tag] of fs.readFileSync('public/zip.html', 'utf8').matchAll(/<input\b[^>]*>/g)) {
    const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
    if (attrs.type !== 'radio' || attrs.name !== 'unityRngMode') continue;
    const input = $(attrs.id);
    input.value = attrs.value;
    let checked = /\schecked(?:\s|>)/.test(tag);
    Object.defineProperty(input, 'checked', { get: () => checked, set: value => {
      if (value) for (const sibling of rngInputs) if (sibling !== input) sibling.checked = false;
      checked = Boolean(value);
    } });
    rngInputs.push(input);
  }
  const context = vm.createContext({ console, fetch: (url, options) => url === '/api/health'
    ? typeof health === 'function' ? health() : Promise.resolve(new Response(health)) : fetch(url, options),
    AbortController, setTimeout: (...args) => setTimeout(...args).unref(), clearTimeout, TypeError,
    JSZip: class {
      file(name, data, options) { zipEntries.push({ name, data, options }); }
      async generateAsync() { return { size: 1 }; }
    },
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
  // Image decoding/encoding is tested by the screenshot module. Keep request construction,
  // snapshot handling, result application, and original-file ZIP writes real here.
  const aiScreenshots = new vm.SyntheticModule([], function () {
    context.WWAAIScreenshots = { prepareAIScreenshots };
  }, { context });
  const module = new vm.SourceTextModule(fs.readFileSync('public/js/tools/zip.js', 'utf8'), { context });
  const dependencies = new Map([
    ['../http.js', http], ['../description-format.js', descriptionFormat],
    ['../ai-screenshots.js', aiScreenshots], ['../metadata.js', metadata]
  ]);
  await module.link(specifier => {
    assert.ok(dependencies.has(specifier), `Unexpected ZIP dependency: ${specifier}`);
    return dependencies.get(specifier);
  });
  await module.evaluate();
  const tones = toneChoices.map(choice => {
    const control = $('tone_' + choice);
    control.dataset.tone = choice;
    if (choice === toneChoice) elements.set('toneChoice', control);
    return control;
  });
  module.namespace.mount({ querySelector: selector => selector === 'input[name="unityRngMode"]:checked'
    ? rngInputs.find(input => input.checked) || null : $(selector.slice(1)),
    querySelectorAll: selector => selector === '#tones .tone' ? tones : [] });
  $('appName').value = 'Demo'; $('devDescription').value = 'A private offline garden guide.';
  $('shortDesc').value = 'Previous short.'; $('fullDesc').value = 'Previous full description.';
  $('shotsInput').files = screenshots; $('shotsInput').onchange();
  return $;
}

const cleanSpam = { spam: [], frequency: [], maxAllowed: 1, totalWords: 5, densityLimit: 2.5 };

test('ZIP generation keeps prepared overviews and detail crops grouped and exports the original screenshots', async () => {
  const screenshots = [{ name: 'first.png', type: 'image/png' }, { name: 'second.jpg', type: 'image/jpeg' }];
  const prepared = [
    { mediaType: 'image/png', data: 'first-overview', width: 1000, height: 2000, details: [
      { mediaType: 'image/png', data: 'first-top', width: 1000, height: 1000 },
      { mediaType: 'image/png', data: 'first-bottom', width: 1000, height: 1000 }
    ] },
    { mediaType: 'image/png', data: 'second-overview', width: 1600, height: 900 }
  ];
  const requests = [], zipEntries = [];
  const $ = await mount(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(url === '/api/spam-check' ? cleanSpam
      : { shortDescription: 'Explore.', fullDescription: 'Explore the garden.' }));
  }, { screenshots, prepareAIScreenshots: async () => prepared, zipEntries });
  await $('genBtn').onclick();
  assert.deepEqual(requests[0], { url: '/api/aso', body: {
    appName: 'Demo', description: 'A private offline garden guide.', category: '', tone: 'normal', size: 'small', screenshots: prepared
  } });
  await $('zipBtn').onclick();
  assert.deepEqual(requests.map(request => request.url), ['/api/aso', '/api/spam-check']);
  assert.equal(zipEntries[0].name, '1.png');
  assert.equal(zipEntries[0].data, screenshots[0]);
  assert.equal(zipEntries[1].name, '2.jpg');
  assert.equal(zipEntries[1].data, screenshots[1]);
  assert.match($('zipStatus').className, /ok/);
});

test('ZIP screenshot preparation failure preserves previous descriptions and unlocks generation without an AI request', async () => {
  let calls = 0;
  const $ = await mount(async () => {
    calls++;
    return new Response(JSON.stringify({ shortDescription: 'New short.', fullDescription: 'New full.' }));
  }, { prepareAIScreenshots: async () => { throw new Error('Не вдалося прочитати скріншот.'); } });
  await $('genBtn').onclick();
  assert.equal(calls, 0);
  assert.equal($('shortDesc').value, 'Previous short.');
  assert.equal($('fullDesc').value, 'Previous full description.');
  assert.equal($('genBtn').disabled, false);
  assert.match($('genStatus').className, /err/);
  assert.match($('genStatus').textContent, /Не вдалося прочитати скріншот/);
});

test('ZIP snapshots screenshots before waking the server and ignores AI selection after the upload list changes', async () => {
  const screenshots = Array.from({ length: 9 }, (_, index) => ({ name: `shot-${index}.png`, type: 'image/png' }));
  const replacement = { name: 'replacement.png', type: 'image/png' };
  let releaseHealth;
  const health = new Promise(resolve => { releaseHealth = () => resolve(new Response('{"ok":true,"aiConfigured":true}')); });
  const requests = [], zipEntries = [];
  const $ = await mount(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify(url === '/api/spam-check' ? cleanSpam : {
      shortDescription: 'Snapshot short.', fullDescription: 'Snapshot full description.', selected: [8, 7, 6, 5, 4, 3, 2, 1]
    }));
  }, { screenshots, health: () => health, zipEntries });
  const generation = $('genBtn').onclick();
  $('shotsThumbs').children[0].querySelector('.x').onclick();
  $('shotsInput').files = [replacement]; $('shotsInput').onchange();
  releaseHealth();
  await generation;
  assert.deepEqual(requests[0].body.screenshots.map(shot => shot.data), screenshots.map(file => file.name));
  assert.equal($('shortDesc').value, 'Snapshot short.');
  assert.equal($('fullDesc').value, 'Snapshot full description.');
  assert.equal($('genBtn').disabled, false);
  for (const thumb of $('shotsThumbs').children) assert.doesNotMatch(thumb.innerHTML, /AI ✓/);
  await $('zipBtn').onclick();
  const exported = zipEntries.filter(entry => /^\d+\.png$/.test(entry.name));
  assert.equal(exported.length, 8);
  for (let index = 0; index < 8; index++) assert.equal(exported[index].data, screenshots[index + 1]);
});

for (const replaceEntry of [false, true]) {
  test(`ZIP ${replaceEntry ? 'ignores selection when an entry is replaced with the same file' : 'applies AI selection while screenshot entries stay unchanged'} during the AI request`, async () => {
    const screenshots = Array.from({ length: 9 }, (_, index) => ({ name: `shot-${index}.png`, type: 'image/png' }));
    const selected = [8, 7, 6, 5, 4, 3, 2, 1];
    let releaseAI, notifyRequest;
    const requestStarted = new Promise(resolve => { notifyRequest = resolve; });
    const aiResponse = new Promise(resolve => { releaseAI = resolve; });
    const zipEntries = [];
    const $ = await mount(async url => {
      if (url === '/api/aso') { notifyRequest(); return aiResponse; }
      return new Response(JSON.stringify(cleanSpam));
    }, { screenshots, zipEntries });
    const generation = $('genBtn').onclick();
    await requestStarted;
    if (replaceEntry) {
      $('shotsThumbs').children[8].querySelector('.x').onclick();
      $('shotsInput').files = [screenshots[8]]; $('shotsInput').onchange();
    }
    releaseAI(new Response(JSON.stringify({ shortDescription: 'Explore.', fullDescription: 'Explore the garden.', selected })));
    await generation;
    assert.equal($('shotsThumbs').children.filter(thumb => thumb.innerHTML.includes('AI ✓')).length, replaceEntry ? 0 : 8);
    await $('zipBtn').onclick();
    const exported = zipEntries.filter(entry => /^\d+\.png$/.test(entry.name));
    assert.equal(exported.length, 8);
    const expected = replaceEntry ? screenshots.slice(0, 8) : selected.map(index => screenshots[index]);
    for (let index = 0; index < 8; index++) assert.equal(exported[index].data, expected[index]);
  });
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
test('Unity rich HTML selection shows preview for empty and plain drafts', async () => {
  const $ = await mount(() => assert.fail('Preview selection must not use AI'), { toneChoice: 'tiktok_aso_unity_rich_html' });
  $('fullDesc').value = '';
  $('toneChoice').onclick();
  assert.equal($('descriptionPreviewPanel').hidden, false);
  assert.equal($('unityOptions').hidden, false);
  $('fullDesc').value = 'Explore virtual games.';
  $('fullDesc').listeners.input();
  assert.equal($('descriptionPreviewPanel').hidden, false);
  assert.equal($('descriptionPreview').innerHTML, 'Explore virtual games.');
});
test('Alternative Unity selection offers RNG options and keeps empty and plain drafts as plain text', async () => {
  const $ = await mount(() => assert.fail('Style selection must not use AI'), { toneChoice: 'aso_pro_alt_unity' });
  $('fullDesc').value = '';
  $('toneChoice').onclick();
  assert.equal($('unityOptions').hidden, false);
  assert.equal($('descriptionPreviewPanel').hidden, true);
  $('fullDesc').value = 'Explore virtual games.';
  $('fullDesc').listeners.input();
  assert.equal($('descriptionPreviewPanel').hidden, true);
});
for (const toneChoice of ['tiktok_aso_unity', 'tiktok_aso_unity_rich_html', 'aso_pro_alt_unity']) {
  for (const [inputId, expected] of [[null, 'chance'], ['unityRngOmit', 'omit'], ['unityRngChance', 'chance'], ['unityRngCertified', 'certified']]) {
    test(`${toneChoice} sends ${inputId ? expected : 'default chance'} to generation and manual repair`, async () => {
      const requests = [];
      const $ = await mount(async (url, options) => {
        requests.push({ url, body: JSON.parse(options.body) });
        return new Response(JSON.stringify({ shortDescription: 'Demo: Explore.', fullDescription: 'Explore virtual games.',
          spamCheck: { clean: true, remaining: [], frequency: [], maxAllowed: 1, totalWords: 3, densityLimit: 2.5 } }));
      }, { toneChoice });
      $('toneChoice').onclick();
      assert.equal($('unityOptions').hidden, false);
      if (inputId) $(inputId).checked = true;
      await $('genBtn').onclick();
      await $('fixSpamBtn').onclick();
      assert.deepEqual(requests.map(({ url, body }) => [url, body.tone, body.unityRngMode]), [
        ['/api/aso', toneChoice, expected], ['/api/fix-spam', toneChoice, expected]
      ]);
      for (const { body } of requests) assert.equal(Object.hasOwn(body, 'unityRngCertified'), false);
    });
  }
}
for (const toneChoice of ['normal', 'normal_plus', 'semi', 'aggressive', 'aso_pro', 'aso_pro_alt',
  'tiktok_aso_pro', 'tiktok_aso_max', 'tiktok_aso_max_rich_html', 'aso_rich_html']) {
  test(`${toneChoice} hides and isolates a saved RNG certification choice`, async () => {
    const requests = [];
    const $ = await mount(async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ shortDescription: 'Demo: Explore.', fullDescription: 'Explore virtual games.',
        spamCheck: { clean: true, remaining: [], frequency: [], maxAllowed: 1, totalWords: 3, densityLimit: 2.5 } }));
    }, { toneChoice });
    $('unityRngCertified').checked = true;
    $('toneChoice').onclick();
    assert.equal($('unityOptions').hidden, true);
    await $('genBtn').onclick();
    await $('fixSpamBtn').onclick();
    assert.deepEqual(requests.map(({ url, body }) => [url, body.tone]), [
      ['/api/aso', toneChoice], ['/api/fix-spam', toneChoice]
    ]);
    for (const { body } of requests) {
      assert.equal(body.unityRngMode, undefined);
      assert.equal(Object.hasOwn(body, 'unityRngCertified'), false);
    }
  });
}
test('Unity RNG selection survives switching among Unity styles and away to another style', async () => {
  const requests = [];
  const $ = await mount(async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return new Response(JSON.stringify({ shortDescription: 'Demo: Explore.', fullDescription: 'Explore virtual games.',
      spamCheck: { clean: true, remaining: [], frequency: [], maxAllowed: 1, totalWords: 3, densityLimit: 2.5 } }));
  }, { toneChoices: ['tiktok_aso_unity', 'tiktok_aso_unity_rich_html', 'aso_pro_alt_unity', 'normal'] });
  $('tone_tiktok_aso_unity').onclick();
  $('unityRngOmit').checked = true;
  $('tone_tiktok_aso_unity_rich_html').onclick();
  await $('genBtn').onclick();
  $('tone_normal').onclick();
  assert.equal($('unityOptions').hidden, true);
  await $('fixSpamBtn').onclick();
  $('tone_aso_pro_alt_unity').onclick();
  assert.equal($('unityOptions').hidden, false);
  await $('genBtn').onclick();
  await $('fixSpamBtn').onclick();
  assert.equal($('unityRngOmit').checked, true);
  assert.deepEqual(requests.map(({ url, body }) => [url, body.tone, body.unityRngMode]), [
    ['/api/aso', 'tiktok_aso_unity_rich_html', 'omit'],
    ['/api/fix-spam', 'normal', undefined],
    ['/api/aso', 'aso_pro_alt_unity', 'omit'],
    ['/api/fix-spam', 'aso_pro_alt_unity', 'omit']
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
