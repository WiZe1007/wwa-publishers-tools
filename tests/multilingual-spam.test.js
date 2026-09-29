const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChecker, LANGUAGES } = require('../lib/localization');
const { tokenize, normalizeText } = require('../lib/text-tokens');
const { analyzeStructure } = require('../lib/text-quality');
const keywords = require('./fixtures/native-keywords');
const check = createChecker();
const listing = (locale, text, profile = 'strict') => ({ locale, profile, title: keywords[locale] || keywords[locale.split('-')[0]], shortDescription: 'Demo', fullDescription: text });

for (const { code } of LANGUAGES) {
  const word = keywords[code] || keywords[code.split('-')[0]];
  test(`${code}: native keyword in all fields, both profiles, punctuation and numeric padding`, () => {
    assert.ok(word, `Missing native fixture for ${code}`);
    const baseTokens = tokenize(word, code);
    // ICU may split a dictionary-unknown compound (e.g. Burmese ဂိမ်း).
    // Still require every constituent repetition to be detected, not skipped.
    assert.ok(baseTokens.length > 0);
    assert.equal(check(listing(code, word)).clean, true, 'A singleton is not spam');
    if (new Intl.Locale(code).maximize().script !== 'Latn') {
      assert.ok(check(listing(code, 'Garden timer offline')).issues.some(issue => issue.includes('письма')), 'Wrong writing system must not silently pass');
    }
    for (const profile of ['strict', 'natural']) {
      const text = Array(6).fill(word).join(' — ') + ' ' + Array.from({ length: 250 }, (_, i) => i).join(' ');
      const result = check({ ...listing(code, text, profile), title: `${word} ${word}`, shortDescription: `${word} ${word}` });
      assert.equal(result.clean, false);
      assert.equal(result.analyses.fullDescription.totalWords, 6 * baseTokens.length);
      assert.equal(result.analyses.fullDescription.frequency[0].count, 6);
      for (const field of ['title', 'shortDescription', 'fullDescription']) assert.ok(result.analyses[field].spam.length, `${profile}: ${field}`);
      for (const group of result.analyses.fullDescription.frequency) {
        assert.equal(group.count, group.forms.reduce((sum, form) => sum + form.count, 0));
        assert.ok(group.density <= 100);
      }
    }
  });
}

for (const [locale, text, count] of [
  ['uk', "об’єкт обʼєкт об'єкт", 3], ['fa', 'بازی بازي', 2], ['fa', 'کتاب كتاب', 2],
  ['he', 'משחק מִשְׂחָק', 2], ['ur', 'کھیل کھیْل', 2], ['ar', 'لعبة لُعْبَة لـعبة', 3],
  ['en-US', 'game_game game\u200d game g\u200came', 5],
  ['en-US', 'game g\u202eame g\u2066ame', 3], ['ja', 'ｹﾞｰﾑ ゲーム', 2],
  ['fr', 'café cafe\u0301', 2], ['tr', 'IŞIK ışık', 2], ['az', 'OYUN oyun', 2]
]) test(`Unicode spelling and invisible-character regression: ${locale} / ${text}`, () => {
  const result = check(listing(locale, text));
  assert.equal(result.analyses.fullDescription.frequency.length, 1);
  assert.equal(result.analyses.fullDescription.frequency[0].count, count);
  assert.equal(result.clean, false);
});

for (const [locale, text] of [['ja', 'ゲーム'], ['zh-CN', '游戏'], ['zh-TW', '遊戲'], ['th', 'เกม'], ['km', 'ល្បែង']]) {
  test(`${locale}: repeated words with no spaces`, () => {
    const result = check(listing(locale, text.repeat(6)));
    assert.equal(result.analyses.fullDescription.frequency[0].count, 6);
    assert.ok(result.analyses.fullDescription.spam.length);
  });
}

for (const [locale, first, second] of [
  ['fr', 'sur', 'sûr'], ['es-MX', 'si', 'sí'], ['de', 'schon', 'schön'], ['tr', 'sık', 'sik'],
  ['hi', 'कल', 'कला'], ['bn', 'বল', 'বাল'], ['th', 'ปา', 'ป่า'], ['vi', 'ma', 'má'],
  ['ja', 'は', 'ば'], ['ko', '가', '나']
]) test(`${locale}: meaningful accents and vowels must not be erased`, () => {
  assert.notEqual(normalizeText(first, locale), normalizeText(second, locale));
});

test('Persian and Indic joiners remain in lexical tokens', () => {
  assert.equal(tokenize('بازی‌ها', 'fa')[0], 'بازی‌ها');
  assert.equal(normalizeText('ක්‍රීඩා', 'si'), 'ක්‍රීඩා');
});

test('English families use the same stemmer with or without the legacy callback', () => {
  for (const forms of ['game games gaming', 'create created creating', 'tap taps tapping tapped']) {
    const a = check(listing('en-US', forms)).analyses.fullDescription;
    assert.equal(a.frequency.length, 1);
  }
  assert.equal(check(listing('en-US', 'time timer')).analyses.fullDescription.frequency.length, 2);
});

test('sentence comparison preserves quantities and version numbers', () => {
  const report = analyzeStructure('Collect your daily 5 coins. Collect your daily 10 coins. Use the version 2.0 app. Use the version 3.0 app.', 'en-US', new Set());
  assert.equal(report.sentences.length, 0);
});

test('word and phrase analyzers share normalization and keep coverage bounded', () => {
  const report = analyzeStructure('Play_game 5 today. Play-game 5 tomorrow. Play_game 5 outside. Play—game 5 indoors.', 'en-US', new Set());
  assert.ok(report.phrases.some(item => item.text === 'play game 5' && item.count === 4));
  for (const item of report.phrases) assert.ok(item.coverage <= 100);
});

for (const [locale, text, root, count] of [
  ['en-US', "game game's games", 'game', 3],
  ['fr', "amour l'amour d’amour", 'amour', 3],
  ['it', "amore l'amore dell’amore", 'amore', 3],
  ['hi', 'किताब किताबें किताबों', 'किताब', 3],
  ['ko', '게임 게임을 게임이 게임에서', '게임', 4],
  ['fa', 'بازی بازی‌ها بازیها بازی‌های', 'بازی', 4],
  ['uz', "oʻyin o‘yin o'yin", "o'yin", 3]
]) test(`${locale}: inflection and attached-particle regression`, () => {
  const analysis = check(listing(locale, text)).analyses.fullDescription;
  assert.equal(analysis.frequency.find(item => item.word === root)?.count, count);
  assert.ok(analysis.spam.some(item => item.word === root));
});

test('context-based suffix rules do not invent roots or merge short unrelated words', () => {
  assert.equal(check(listing('ko', '게임을 게임이')).analyses.fullDescription.frequency.length, 2);
  assert.equal(check(listing('ko', '사 사과')).analyses.fullDescription.frequency.length, 2);
  assert.equal(check(listing('fa', 'تن تنها')).analyses.fullDescription.frequency.length, 2);
});

test('apostrophe splitting is language-specific, preserving ordinary compound words', () => {
  assert.deepEqual(tokenize("aujourd'hui", 'fr'), ["aujourd'hui"]);
  assert.deepEqual(tokenize("об'єкт", 'uk'), ["об'єкт"]);
  assert.deepEqual(tokenize("o'yin", 'uz'), ["o'yin"]);
});

for (const [locale, text] of [
  ['uk', 'Плануйте завдання. Запускайте таймер. Переглядайте історію роботи. Дані залишаються на пристрої.'],
  ['es-MX', 'Organiza tareas. Activa un temporizador. Consulta el historial. Funciona sin conexión.'],
  ['fr', 'Organisez vos tâches. Lancez un minuteur. Consultez les résultats. Fonctionne hors ligne.'],
  ['de', 'Plane Aufgaben. Starte einen Timer. Prüfe deinen Fortschritt. Funktioniert offline.'],
  ['it', 'Organizza le attività. Avvia un timer. Controlla i progressi. Funziona offline.'],
  ['pt-BR', 'Organize tarefas. Ative um cronômetro. Confira os resultados. Funciona offline.'],
  ['tr', 'Görevleri planlayın. Zamanlayıcıyı başlatın. Sonuçları inceleyin. Çevrimdışı çalışır.'],
  ['ar', 'نظم مهامك. ابدأ المؤقت. راجع النتائج. يعمل دون اتصال.'],
  ['hi', 'कार्य चुनें। टाइमर शुरू करें। परिणाम देखें। इंटरनेट आवश्यक नहीं है।'],
  ['ja', 'タスクを選択。タイマーを開始。結果を確認。オフラインで利用できます。'],
  ['zh-CN', '选择任务。启动计时器。查看结果。支持离线使用。'],
  ['ko', '작업을 선택하세요. 타이머를 시작하세요. 결과를 확인하세요. 오프라인으로 사용할 수 있습니다.']
]) test(`${locale}: normal short prose is not keyword stuffing in natural mode`, () => {
  const result = check(listing(locale, text, 'natural'));
  assert.equal(result.clean, true, result.issues.join('\n'));
});
