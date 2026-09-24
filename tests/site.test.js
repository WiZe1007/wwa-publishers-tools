// Цілісність сайту: синтаксис, наявність ресурсів, синхронність UI та сервера
const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { TONE_INSTRUCTIONS } = require('../server.js');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const PAGES = ['index.html', 'zip.html', 'resize.html', 'convert.html', 'merge.html', 'metadata.html'];
const read = (p) => fs.readFileSync(path.join(PUB, p), 'utf8');

test('every tool offers metadata cleaning', () => {
  for (const page of ['zip', 'resize', 'convert', 'merge']) {
    assert.match(read(page + '.html'), /id="cleanMetaBtn"/);
  }
  assert.match(read('metadata.html'), /id="cleanBtn"/);
  for (const page of ['resize', 'convert', 'merge']) {
    assert.match(read('js/tools/' + page + '.js'), /mountQuickMetadata/);
    assert.match(read(page + '.html'), /id="cleanMetaDownload"/);
    assert.match(read('js/tools/' + page + '.js'), /mountQuickMetadata\(root, \(\) => resultFiles, \{ generatedResults: true \}\)/);
    const html = read(page + '.html');
    assert.ok(html.indexOf('id="resultMetadata"') > html.indexOf('</fieldset>'));
  }
});

test('Metadata navigation label uses English on every page', () => {
  for (const page of PAGES) assert.ok(read(page).includes('<span>Metadata</span>'));
});

describe('Синтаксис JS', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

  for (const file of walk(path.join(PUB, 'js'))) {
    const rel = path.relative(PUB, file);
    if (rel.includes('vendor')) continue; // мініфіковані бібліотеки не перевіряємо
    test(rel, () => {
      const src = fs.readFileSync(file, 'utf8');
      const isModule = /^\s*(import|export)\s/m.test(src);
      // Модулі перевіряємо через парсер модулів, звичайні скрипти — через Function
      if (isModule) {
        const vm = require('node:vm');
        assert.doesNotThrow(() => new vm.SourceTextModule(src, { identifier: rel }));
      } else {
        assert.doesNotThrow(() => new Function(src));
      }
    });
  }

  test('server.js парситься', () => {
    assert.doesNotThrow(() => new Function(fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8')));
  });
});

describe('Інлайнові скрипти сторінок', () => {
  for (const page of PAGES) {
    test(page, () => {
      const html = read(page);
      const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
      for (const [, code] of blocks) {
        if (!code.trim() || /type=["']application\/(ld\+)?json/.test(code)) continue;
        assert.doesNotThrow(() => new Function(code), `зламаний інлайновий скрипт у ${page}`);
      }
    });
  }
});

describe('Посилання на ресурси існують', () => {
  for (const page of PAGES) {
    test(page, () => {
      const html = read(page);
      const refs = [...html.matchAll(/(?:src|href)=["'](?!https?:|data:|mailto:|#)([^"']+)["']/g)].map(m => m[1]);
      for (const ref of refs) {
        const clean = ref.split(/[?#]/)[0];
        if (!clean || clean.endsWith('.html')) continue; // сторінки перевіряються окремо
        const file = path.join(PUB, clean.replace(/^\//, ''));
        assert.ok(fs.existsSync(file), `${page}: немає файлу ${clean}`);
      }
    });
  }

  test('усі внутрішні сторінки-посилання існують', () => {
    for (const page of PAGES) {
      const refs = [...read(page).matchAll(/href=["'](?!https?:|#)([^"']*\.html)["']/g)].map(m => m[1]);
      for (const ref of refs) {
        assert.ok(fs.existsSync(path.join(PUB, ref.replace(/^\//, ''))), `${page} → ${ref} не існує`);
      }
    }
  });
});

describe('Стилі опису: UI ↔ сервер', () => {
  const zip = read('zip.html');
  const uiTones = [...zip.matchAll(/data-tone=["']([a-z_]+)["']/g)].map(m => m[1]);

  test('на сторінці є картки стилів', () => {
    assert.ok(uiTones.length >= 8, `очікували щонайменше 8 стилів, знайшли ${uiTones.length}`);
  });

  test('кожен стиль з UI має інструкцію на сервері', () => {
    for (const tone of uiTones) {
      assert.ok(TONE_INSTRUCTIONS[tone], `стиль "${tone}" є в UI, але немає інструкції на сервері`);
    }
  });

  test('немає інструкцій-сиріт на сервері', () => {
    for (const tone of Object.keys(TONE_INSTRUCTIONS)) {
      assert.ok(uiTones.includes(tone), `інструкція "${tone}" не показана в UI`);
    }
  });

  test('усі data-tone унікальні', () => {
    assert.strictEqual(new Set(uiTones).size, uiTones.length, 'є дублікати data-tone');
  });

  test('кожна картка має колір, емодзі та опис', () => {
    const cards = [...zip.matchAll(/<div class="tone[^"]*"[^>]*data-tone="([a-z_]+)"[^>]*data-color="(#[0-9a-fA-F]{3,8})"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="tone|<\/div>)/g)];
    assert.ok(cards.length >= 8, `розібрали лише ${cards.length} карток`);
    for (const [, tone, , body] of cards) {
      assert.match(body, /class="t-emoji"/, `${tone}: немає емодзі`);
      assert.match(body, /<b>.+<\/b>/, `${tone}: немає назви`);
      assert.match(body, /<p>.+<\/p>/s, `${tone}: немає опису`);
    }
  });

  test('обсяги опису присутні в UI', () => {
    for (const size of ['small', 'medium', 'large']) {
      assert.ok(zip.includes(`data-size="${size}"`), `немає картки обсягу ${size}`);
    }
  });
});

describe('Критичні елементи сторінки ZIP', () => {
  const zip = read('zip.html');
  const ids = ['appName', 'devDescription', 'shortDesc', 'fullDesc', 'shotsInput',
               'file_apk', 'file_aab', 'file_banner', 'file_icon', 'file_ds', 'file_other'];
  for (const id of ids) {
    test(`є елемент #${id}`, () => assert.ok(zip.includes(`id="${id}"`), `немає #${id}`));
  }

  test('є кнопки генерації, перевірки переспаму та створення ZIP', () => {
    for (const id of ['genBtn', 'spamBtn', 'zipBtn']) {
      assert.ok(zip.includes(`id="${id}"`), `немає кнопки #${id}`);
    }
  });
});

describe('Шаблон How to Publish', () => {
  const zipJs = fs.existsSync(path.join(PUB, 'js/tools/zip.js'))
    ? fs.readFileSync(path.join(PUB, 'js/tools/zip.js'), 'utf8')
    : read('zip.html');

  const FIELDS = ['App title', 'Policy', 'Mail', 'Website', 'Category',
                  'Target audience', 'Content rating', 'Short description', 'Full description'];
  for (const field of FIELDS) {
    test(`поле "${field}" присутнє`, () => assert.ok(zipJs.includes(field), `немає поля ${field}`));
  }

  test('посилання на гайд збережено', () => {
    assert.ok(zipJs.includes('youtube.com/watch?v=fKbg_JvAB_8'), 'немає посилання на гайд');
  });
});

describe('Обов’язкові розміри графіки', () => {
  const src = fs.existsSync(path.join(PUB, 'js/tools/zip.js'))
    ? fs.readFileSync(path.join(PUB, 'js/tools/zip.js'), 'utf8')
    : read('zip.html');

  test('icon підганяється під 512×512', () => {
    assert.match(src, /icon[^}]*512[^}]*512|512[^}]*512[^}]*icon/s, 'немає правила 512×512 для icon');
  });
  test('banner підганяється під 1024×500', () => {
    assert.match(src, /1024[\s\S]{0,60}500/, 'немає правила 1024×500 для banner');
  });
});

describe('Конфігурація проєкту', () => {
  test('.env не потрапляє в git', () => {
    const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    assert.match(gitignore, /^\.env$/m, '.env має бути у .gitignore');
  });

  test('.env.example існує і не містить справжнього ключа', () => {
    const ex = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    assert.ok(ex.includes('ANTHROPIC_API_KEY'));
    assert.ok(!/sk-ant-api03-[A-Za-z0-9_-]{20,}/.test(ex), 'у .env.example справжній ключ!');
  });

  test('у коді немає захардкодженого API-ключа', () => {
    const files = [path.join(ROOT, 'server.js'), ...PAGES.map(p => path.join(PUB, p))];
    for (const f of files) {
      assert.ok(!/sk-ant-api03-[A-Za-z0-9_-]{20,}/.test(fs.readFileSync(f, 'utf8')),
        `у ${path.basename(f)} знайдено API-ключ`);
    }
  });

  test('render.yaml готовий до деплою', () => {
    const y = fs.readFileSync(path.join(ROOT, 'render.yaml'), 'utf8');
    assert.ok(y.includes('npm install') && y.includes('npm start'));
    assert.ok(y.includes('ANTHROPIC_API_KEY'));
  });
});
