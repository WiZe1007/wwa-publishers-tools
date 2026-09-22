// Логіка аналізу переспаму та цілісність налаштувань генерації
const { test, describe } = require('node:test');
const assert = require('node:assert');
const {
  analyzeText, normalize, tokenize,
  TONE_INSTRUCTIONS, SIZE_INSTRUCTIONS, SIZE_MAX_REPEATS, SPAM_DENSITY
} = require('../server.js');

describe('Нормалізація форм слова (як в ASOMobile)', () => {
  const cases = [
    ['tiles', 'tile'], ['tile', 'tile'],
    ['tapping', 'tap'], ['tapped', 'tap'], ['taps', 'tap'],
    ['matches', 'match'], ['matching', 'match'], ['matched', 'match'],
    ['berries', 'berry'], ['boxes', 'box'],
    ['carried', 'carry'], ['studying', 'study'],
    ['running', 'run'], ['levels', 'level'],
    ['success', 'success'],  // -ss не обрізається
    ['bonus', 'bonus'],      // -us не обрізається
  ];
  for (const [input, expected] of cases) {
    test(`${input} → ${expected}`, () => assert.strictEqual(normalize(input), expected));
  }
});

describe('Об’єднання форм при підрахунку', () => {
  test('tap + taps + tapping + tapped рахуються як одне слово', () => {
    const a = analyzeText('Tap the fruit. He taps again, she tapped once, they are tapping now.');
    const tap = a.frequency.find(w => normalize(w.word) === 'tap');
    assert.ok(tap, 'слово tap має бути у частотності');
    assert.strictEqual(tap.count, 4);
  });

  test('слова через дефіс розбиваються на складові', () => {
    const a = analyzeText('A tile-matching game with tile mechanics and matching rules.');
    const tile = a.frequency.find(w => normalize(w.word) === 'tile');
    const match = a.frequency.find(w => normalize(w.word) === 'match');
    assert.strictEqual(tile.count, 2, 'tile-matching + tile = 2');
    assert.strictEqual(match.count, 2, 'matching (у складеному) + matching = 2');
  });

  test('стоп-слова не потрапляють у частотність', () => {
    const a = analyzeText('the and of a in on with for to from puzzle');
    assert.strictEqual(a.frequency.length, 1);
    assert.strictEqual(a.frequency[0].word, 'puzzle');
  });

  test('totalWords рахує всі слова, включно зі стоп-словами', () => {
    const a = analyzeText('the quick brown fox jumps');
    assert.strictEqual(a.totalWords, 5);
  });
});

describe('Поріг переспаму', () => {
  test(`ліміт щільності = ${SPAM_DENSITY}%`, () => {
    assert.strictEqual(SPAM_DENSITY, 2.5);
  });

  test('слово зі щільністю 2.74% позначається переспамом (як у ASOMobile)', () => {
    // 6 повторів на 219 слів = 2.74%
    const filler = Array.from({ length: 213 }, (_, i) => 'w' + i).join(' ');
    const a = analyzeText('score score score score score score ' + filler);
    assert.strictEqual(a.totalWords, 219);
    const score = a.spam.find(w => w.word === 'score');
    assert.ok(score, 'score має бути в переспамі');
    assert.ok(score.density > 2.5 && score.density < 3, `щільність ${score.density}% має бути ~2.74%`);
  });

  test('слово зі щільністю 2.28% переспамом НЕ вважається', () => {
    // 5 повторів на 219 слів = 2.28%
    const filler = Array.from({ length: 214 }, (_, i) => 'w' + i).join(' ');
    const a = analyzeText('game game game game game ' + filler);
    assert.strictEqual(a.totalWords, 219);
    assert.ok(!a.spam.some(w => w.word === 'game'), 'game не має бути в переспамі');
  });

  test('чистий текст не дає переспаму', () => {
    const words = Array.from({ length: 150 }, (_, i) => 'word' + i).join(' ');
    assert.strictEqual(analyzeText(words).spam.length, 0);
  });

  test('maxAllowed рахується від кількості слів', () => {
    const a = analyzeText(Array.from({ length: 200 }, (_, i) => 'w' + i).join(' '));
    assert.strictEqual(a.maxAllowed, Math.floor(200 * 2.5 / 100));
  });

  test('порожній текст не ламає аналіз', () => {
    const a = analyzeText('');
    assert.strictEqual(a.totalWords, 0);
    assert.strictEqual(a.spam.length, 0);
  });

  test('показується реальна форма слова, а не обрубок', () => {
    const a = analyzeText('Tapping tapping tapping tap');
    assert.strictEqual(a.frequency[0].word, 'tapping', 'найчастіша форма — tapping');
    assert.strictEqual(a.frequency[0].count, 4);
  });
});

describe('Токенізація', () => {
  test('цифри й пунктуація не рахуються словами частотності', () => {
    const a = analyzeText('Level 15 done! Level 20 done.');
    assert.ok(!a.frequency.some(w => /^\d+$/.test(w.word)));
  });
  test('апострофи не ламають слово', () => {
    assert.deepStrictEqual(tokenize("don't"), ["don't"]);
  });
});

describe('Стилі та обсяги опису', () => {
  const EXPECTED_TONES = [
    'normal', 'normal_plus', 'semi', 'aggressive',
    'aso_pro', 'aso_pro_alt', 'tiktok_aso_pro', 'tiktok_aso_max'
  ];

  test('усі 8 стилів мають інструкції', () => {
    for (const tone of EXPECTED_TONES) {
      assert.ok(TONE_INSTRUCTIONS[tone], `немає інструкції для стилю ${tone}`);
      assert.ok(TONE_INSTRUCTIONS[tone].length > 100, `інструкція ${tone} підозріло коротка`);
    }
  });

  test('три обсяги описані та мають ліміти повторів', () => {
    for (const size of ['small', 'medium', 'large']) {
      assert.ok(SIZE_INSTRUCTIONS[size], `немає опису обсягу ${size}`);
      assert.ok(Number.isInteger(SIZE_MAX_REPEATS[size]), `немає ліміту повторів для ${size}`);
    }
    assert.ok(SIZE_MAX_REPEATS.small < SIZE_MAX_REPEATS.medium);
    assert.ok(SIZE_MAX_REPEATS.medium < SIZE_MAX_REPEATS.large);
  });

  test('ліміти повторів узгоджені з порогом щільності', () => {
    // ~6.2 символи на слово; ліміт має бути не більшим за поріг щільності
    const chars = { small: 1500, medium: 2500, large: 3500 };
    for (const size of Object.keys(chars)) {
      const words = chars[size] / 6.2;
      const maxByDensity = Math.floor(words * SPAM_DENSITY / 100);
      assert.ok(SIZE_MAX_REPEATS[size] <= maxByDensity,
        `${size}: ліміт ${SIZE_MAX_REPEATS[size]} перевищує допустимий ${maxByDensity}`);
    }
  });

  test('compliance-стилі містять обов’язкові фрази', () => {
    for (const tone of ['tiktok_aso_pro', 'tiktok_aso_max']) {
      const t = TONE_INSTRUCTIONS[tone];
      for (const phrase of ['social casino experience', 'simulated luck', 'virtual progress',
                            'Players interact with virtual elements', 'do not represent real-money gambling',
                            'Real-money cash-outs are strictly blocked', '18+']) {
        assert.ok(t.includes(phrase), `${tone}: немає фрази "${phrase}"`);
      }
    }
  });

  test('новий стиль ТОП містить ASO-методологію', () => {
    const t = TONE_INSTRUCTIONS.tiktok_aso_max;
    for (const part of ['СЕМАНТИЧНЕ ЯДРО', 'long-tail', '167', 'SHORT DESCRIPTION', 'ЩІЛЬНОСТІ']) {
      assert.ok(t.includes(part), `немає блоку "${part}"`);
    }
  });

  test('жоден стиль не дозволяє вигадувати функціонал', () => {
    // Загальне правило живе в основному промті; стилі не мають його скасовувати
    for (const [tone, text] of Object.entries(TONE_INSTRUCTIONS)) {
      assert.ok(!/вигадай|придумай нов[иі] функц/i.test(text), `${tone} заохочує вигадувати функції`);
    }
  });
});
