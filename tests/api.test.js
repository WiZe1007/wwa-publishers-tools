// HTTP-рівень: сторінки, статика та API
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const { app } = require('../server.js');

let server, base;

before(async () => {
  await new Promise(resolve => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server && server.close());

const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
});

describe('Сторінки віддаються', () => {
  for (const page of ['/', '/zip.html', '/resize.html', '/convert.html', '/merge.html', '/metadata.html']) {
    test(page, async () => {
      const r = await get(page);
      assert.strictEqual(r.status, 200);
      const html = await r.text();
      assert.match(html, /^\s*<!doctype html/i, 'має бути валідний HTML-документ');
      assert.match(html, /<html[^>]*lang=/i, 'має бути вказана мова сторінки');
    });
  }
});

describe('Статичні ресурси', () => {
  for (const asset of ['/css/style.css', '/js/ui.js', '/js/tools/zip.js', '/js/tools/resize.js',
                       '/js/tools/convert.js', '/js/tools/merge.js', '/js/metadata.js', '/js/tools/metadata.js', '/js/vendor/jszip.min.js']) {
    test(asset, async () => assert.strictEqual((await get(asset)).status, 200));
  }
});

describe('GET /api/health', () => {
  test('повертає стан сервера', async () => {
    const r = await get('/api/health');
    assert.strictEqual(r.status, 200);
    const d = await r.json();
    assert.strictEqual(d.ok, true);
    assert.strictEqual(typeof d.aiConfigured, 'boolean');
  });
});

describe('POST /api/spam-check', () => {
  test('знаходить переспам і повертає частотність', async () => {
    const filler = Array.from({ length: 213 }, (_, i) => 'w' + i).join(' ');
    const r = await post('/api/spam-check', { text: 'score score score score score score ' + filler });
    assert.strictEqual(r.status, 200);
    const d = await r.json();
    assert.strictEqual(d.densityLimit, 2.5);
    assert.strictEqual(d.totalWords, 219);
    assert.ok(d.spam.some(w => w.word === 'score'));
    assert.ok(Array.isArray(d.frequency) && d.frequency.length > 0);
  });

  test('чистий текст → пустий spam', async () => {
    const r = await post('/api/spam-check', { text: Array.from({ length: 150 }, (_, i) => 'x' + i).join(' ') });
    const d = await r.json();
    assert.strictEqual(d.spam.length, 0);
  });

  test('порожній текст не ламає endpoint', async () => {
    const r = await post('/api/spam-check', { text: '' });
    assert.strictEqual(r.status, 200);
    assert.strictEqual((await r.json()).totalWords, 0);
  });

  test('форми слова об’єднуються на боці API', async () => {
    const r = await post('/api/spam-check', { text: 'tap taps tapping tapped tile-matching tile' });
    const d = await r.json();
    const tap = d.frequency.find(w => w.word.startsWith('tap'));
    assert.strictEqual(tap.count, 4);
  });
});

describe('POST /api/aso — валідація вводу', () => {
  test('без назви та опису → 400', async () => {
    const r = await post('/api/aso', {});
    assert.strictEqual(r.status, 400);
    assert.ok((await r.json()).error);
  });

  test('лише назва без опису → 400', async () => {
    const r = await post('/api/aso', { appName: 'Test' });
    assert.strictEqual(r.status, 400);
  });
});

describe('POST /api/fix-spam — валідація вводу', () => {
  test('порожній текст → 400', async () => {
    const r = await post('/api/fix-spam', { text: '' });
    assert.strictEqual(r.status, 400);
  });

  test('чистий текст повертається без звернення до AI', async () => {
    const text = Array.from({ length: 150 }, (_, i) => 'q' + i).join(' ');
    const r = await post('/api/fix-spam', { text, appName: 'Test' });
    assert.strictEqual(r.status, 200);
    const d = await r.json();
    assert.strictEqual(d.fixAttempts, 0);
    assert.strictEqual(d.spamCheck.clean, true);
    assert.strictEqual(d.fullDescription, text);
  });
});

describe('Невідомі маршрути', () => {
  test('неіснуюча сторінка → 404', async () => {
    assert.strictEqual((await get('/nope-does-not-exist')).status, 404);
  });
});
