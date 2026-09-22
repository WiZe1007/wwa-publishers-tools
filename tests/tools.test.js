// Тести реального коду інструментів (без браузера): байтові операції та шаблони.
// Функції витягуються з робочих модулів, а не дублюються — тестуємо те, що справді відвантажується.
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUB = path.join(__dirname, '..', 'public');

/** Дістає вихідний код named-функції з модуля за балансом дужок */
function extractFunction(file, name) {
  const src = fs.readFileSync(path.join(PUB, file), 'utf8');
  const start = src.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `не знайдено функцію ${name} у ${file}`);
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`не вдалося розібрати ${name}`);
}

/* ─────────── Очищення метаданих відео ─────────── */
describe('stripVideoMetadata — очищення MP4', () => {
  const source = 'async ' + extractFunction('js/metadata.js', 'stripVideoMetadata');
  const FIXED_DATE = new Date('2020-01-01T00:00:00Z');
  const strip = new Function('File', 'FIXED_DATE', `${source}; return stripVideoMetadata;`)(
    globalThis.File || require('node:buffer').File, FIXED_DATE);

  /** Мінімальний валідний MP4: ftyp + moov(mvhd + udta) + mdat */
  function buildMp4() {
    const box = (type, payload) => {
      const b = Buffer.alloc(8 + payload.length);
      b.writeUInt32BE(8 + payload.length, 0);
      b.write(type, 4, 'ascii');
      payload.copy(b, 8);
      return b;
    };
    const ftyp = box('ftyp', Buffer.from('isomiso2avc1mp41', 'ascii'));

    const mvhdPayload = Buffer.alloc(100);
    mvhdPayload.writeUInt8(0, 0);              // version 0
    mvhdPayload.writeUInt32BE(3_600_000_000, 4);  // creation_time
    mvhdPayload.writeUInt32BE(3_600_000_001, 8);  // modification_time
    const mvhd = box('mvhd', mvhdPayload);

    const nam = box('©nam', Buffer.from('Bogdan MacBook-Pro', 'ascii'));
    const udta = box('udta', nam);

    const moov = box('moov', Buffer.concat([mvhd, udta]));
    const mdat = box('mdat', Buffer.alloc(64, 0x42));
    return Buffer.concat([ftyp, moov, mdat]);
  }

  const fakeFile = (buf) => ({
    name: 'DATA SAFETY.mp4', type: 'video/mp4',
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  });

  test('видаляє ідентифікуючі рядки з udta', async () => {
    const orig = buildMp4();
    assert.ok(orig.includes('Bogdan'), 'фікстура має містити ім’я');
    const out = await strip(fakeFile(orig));
    const cleaned = Buffer.from(await out.arrayBuffer());
    assert.ok(!cleaned.includes('Bogdan'), 'ім’я має бути затерте');
    assert.ok(!cleaned.includes('MacBook'), 'назва пристрою має бути затерта');
  });

  test('розмір файлу не змінюється (байтові зсуви збережені)', async () => {
    const orig = buildMp4();
    const out = await strip(fakeFile(orig));
    const cleaned = Buffer.from(await out.arrayBuffer());
    assert.strictEqual(cleaned.length, orig.length);
  });

  test('блок udta перетворюється на free', async () => {
    const out = await strip(fakeFile(buildMp4()));
    const cleaned = Buffer.from(await out.arrayBuffer());
    assert.ok(!cleaned.includes(Buffer.from('udta', 'ascii')), 'udta має зникнути');
    assert.ok(cleaned.includes(Buffer.from('free', 'ascii')), 'має з’явитися free');
  });

  test('дати створення обнуляються', async () => {
    const out = await strip(fakeFile(buildMp4()));
    const cleaned = Buffer.from(await out.arrayBuffer());
    const mvhd = cleaned.indexOf(Buffer.from('mvhd', 'ascii'));
    assert.notStrictEqual(mvhd, -1);
    assert.strictEqual(cleaned.readUInt32BE(mvhd + 4 + 4), 0, 'creation_time має бути 0');
    assert.strictEqual(cleaned.readUInt32BE(mvhd + 4 + 8), 0, 'modification_time має бути 0');
  });

  test('структура лишається валідною: ftyp, moov і mdat на місці', async () => {
    const out = await strip(fakeFile(buildMp4()));
    const cleaned = Buffer.from(await out.arrayBuffer());
    assert.strictEqual(cleaned.toString('ascii', 4, 8), 'ftyp');
    assert.ok(cleaned.includes(Buffer.from('moov', 'ascii')));
    assert.ok(cleaned.includes(Buffer.from('mdat', 'ascii')));
    // вміст mdat недоторканий
    const mdat = cleaned.indexOf(Buffer.from('mdat', 'ascii'));
    assert.strictEqual(cleaned[mdat + 4], 0x42, 'відеодані не мають змінюватись');
  });

  test('дати очищуються навіть без udta/meta/uuid', async () => {
    const box = (type, payload) => {
      const b = Buffer.alloc(8 + payload.length);
      b.writeUInt32BE(8 + payload.length, 0); b.write(type, 4, 'ascii'); payload.copy(b, 8);
      return b;
    };
    const times = Buffer.alloc(100); times.writeUInt32BE(12345, 4); times.writeUInt32BE(67890, 8);
    const plain = Buffer.concat([box('ftyp', Buffer.from('isom')), box('moov', box('mvhd', times)), box('mdat', Buffer.alloc(32, 42))]);
    const output = Buffer.from(await (await strip(fakeFile(plain))).arrayBuffer());
    const offset = output.indexOf('mvhd');
    assert.strictEqual(output.readUInt32BE(offset + 8), 0);
    assert.strictEqual(output.readUInt32BE(offset + 12), 0);
    assert.strictEqual(output.length, plain.length);
    assert.deepStrictEqual(output.subarray(output.indexOf('mdat') + 4), Buffer.alloc(32, 42));
  });

  test('пошкоджений файл відхиляється, а не позначається очищеним', async () => {
    const junk = Buffer.from([0xff, 0xff, 0xff, 0xff, 0x61, 0x62, 0x63, 0x64, 0x00, 0x01]);
    await assert.rejects(() => strip(fakeFile(junk)), /Invalid MP4\/MOV block size/);
  });

  test('дата файлу нормалізується', async () => {
    const out = await strip(fakeFile(buildMp4()));
    assert.strictEqual(out.lastModified, FIXED_DATE.getTime());
  });
});

/* ─────────── BMP-кодек ─────────── */
describe('canvasToBMP — кодування BMP', () => {
  const file = fs.existsSync(path.join(PUB, 'js/tools/convert.js')) ? 'js/tools/convert.js' : 'convert.html';
  const src = fs.readFileSync(path.join(PUB, file), 'utf8');
  const hasEncoder = src.includes('canvasToBMP');

  test('кодер присутній у коді', () => assert.ok(hasEncoder, 'немає canvasToBMP'));

  if (hasEncoder) {
    const code = extractFunction(file, 'canvasToBMP');
    const encode = new Function('Blob', `${code}; return canvasToBMP;`)(globalThis.Blob);

    // Полотно 2×2: канвас віддає RGBA
    const fakeCanvas = (w, h, rgba) => ({
      width: w, height: h,
      getContext: () => ({ getImageData: () => ({ data: Uint8ClampedArray.from(rgba) }) })
    });

    test('заголовок BM та коректний розмір', async () => {
      const px = [255,0,0,255, 0,255,0,255, 0,0,255,255, 255,255,255,255];
      const blob = encode(fakeCanvas(2, 2, px));
      const buf = Buffer.from(await blob.arrayBuffer());
      assert.strictEqual(buf.toString('ascii', 0, 2), 'BM');
      const rowSize = Math.ceil(2 * 3 / 4) * 4;
      assert.strictEqual(buf.length, 54 + rowSize * 2);
      assert.strictEqual(buf.readUInt32LE(2), buf.length, 'розмір у заголовку має збігатися');
      assert.strictEqual(buf.readInt32LE(18), 2, 'ширина');
      assert.strictEqual(buf.readInt32LE(22), -2, 'висота top-down');
      assert.strictEqual(buf.readUInt16LE(28), 24, '24 біти на піксель');
    });

    test('кольори пишуться у порядку BGR', async () => {
      const px = [255,0,0,255, 0,0,0,255, 0,0,0,255, 0,0,0,255]; // перший піксель червоний
      const buf = Buffer.from(await encode(fakeCanvas(2, 2, px)).arrayBuffer());
      assert.strictEqual(buf[54 + 0], 0,   'B = 0');
      assert.strictEqual(buf[54 + 1], 0,   'G = 0');
      assert.strictEqual(buf[54 + 2], 255, 'R = 255');
    });

    test('прозорість накладається на білий', async () => {
      const px = [0,0,0,0, 0,0,0,255, 0,0,0,255, 0,0,0,255]; // перший піксель повністю прозорий
      const buf = Buffer.from(await encode(fakeCanvas(2, 2, px)).arrayBuffer());
      assert.strictEqual(buf[54 + 0], 255, 'прозорий піксель має стати білим');
    });
  }
});

/* ─────────── Шаблон How to Publish ─────────── */
describe('buildHowToPublish — заповнення шаблону', () => {
  const file = fs.existsSync(path.join(PUB, 'js/tools/zip.js')) ? 'js/tools/zip.js' : 'zip.html';
  const code = extractFunction(file, 'buildHowToPublish');

  const VALUES = {
    appName: 'Tower Quest', policy: 'https://policy.example', mail: 'dev@example.com',
    website: 'https://site.example', category: 'Puzzle', audience: 'Everyone',
    rating: '3+', advId: 'Yes (Analytics + Advertising Marketing)',
    shortDesc: 'Tower Quest: match tiles and clear the board!',
    fullDesc: 'Full description text.'
  };
  const build = new Function('$', `${code}; return buildHowToPublish;`)(
    (id) => ({ value: VALUES[id] ?? '' }));

  const out = build();

  test('усі заповнені поля потрапляють у файл', () => {
    for (const v of Object.values(VALUES)) assert.ok(out.includes(v), `немає значення "${v}"`);
  });

  test('структура шаблону збережена', () => {
    for (const label of ['App title:', 'Policy:', 'Mail:', 'Website:', 'Category:',
                         'Target audience and content:', 'Content rating:', 'Advirtising ID:',
                         'Short description:', 'Full description:']) {
      assert.ok(out.includes(label), `немає рядка "${label}"`);
    }
  });

  test('посилання на гайд на місці', () => {
    assert.ok(out.includes('https://www.youtube.com/watch?v=fKbg_JvAB_8'));
  });

  test('порожні поля позначаються зірочками, а не undefined', () => {
    const empty = new Function('$', `${code}; return buildHowToPublish;`)(() => ({ value: '' }))();
    assert.ok(!empty.includes('undefined'), 'у шаблоні не має бути undefined');
    assert.ok(empty.includes('***'), 'порожні поля позначаються ***');
  });
});
