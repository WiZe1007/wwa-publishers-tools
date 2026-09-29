const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createChecker, createLocalizationRouter, LANGUAGES, validate } = require('../lib/localization');
const { normalize } = require('../server');

const clean = { locale: 'en-US', title: 'Focus Garden', shortDescription: 'Plan your day with a quiet timer.',
  fullDescription: 'Choose tasks. Set timers. Start focused sessions. Review completed work. Take breaks when needed. Track progress offline without accounts, reminders, subscriptions or social features.' };
const check = createChecker({ normalizeEnglish: normalize, englishStopWords: new Set('a the your you in and with when one'.split(' ')) });

test('all 107 language/region options are unique and supported by the segmenter', () => {
  assert.equal(LANGUAGES.length, 107);
  assert.equal(new Set(LANGUAGES.map(language => language.code)).size, 107);
  for (const language of LANGUAGES) {
    assert.equal(Intl.Segmenter.supportedLocalesOf(language.code).length, 1);
    assert.doesNotThrow(() => check({ ...clean, locale: language.code }));
    assert.ok(language.searchLabel);
  }
  for (const locale of ['ar-SA', 'fa', 'he', 'ur', 'ps']) assert.equal(LANGUAGES.find(item => item.code === locale).dir, 'rtl');
});
test('short natural copy passes; singleton words are not spam', () => assert.equal(check(clean).clean, true));
test('English variants are grouped and repeated title words flagged', () => {
  const result = check({ ...clean, title: 'Focus focus', fullDescription: 'Tap taps tapping tapped.' });
  assert.equal(result.clean, false);
  assert.equal(result.analyses.fullDescription.spam[0].count, 4);
  assert.equal(result.analyses.title.spam[0].count, 2);
});
test('full description includes Ukrainian function words, while short fields exclude them', () => {
  const result = check({ locale: 'uk', title: 'Тихий сад', shortDescription: 'Плануйте день та відпочинок', fullDescription: 'Сад та сад і сад та робота.' });
  assert.deepEqual(result.analyses.fullDescription.spam.map(item => item.word), ['сад', 'та']);
  assert.equal(check({ locale: 'uk', title: 'Тихий сад', shortDescription: 'Робота та відпочинок та навчання', fullDescription: 'Плануйте день.' }).clean, true);
});

// Reproduce the COUNTS in the screenshot, not its unavailable full text.
const spanishReport = { locale: 'es-MX', title: 'Prueba', shortDescription: 'Planifica tu día.',
  fullDescription: [...Array(25).fill('de'), ...Array(11).fill('el'), ...Array(7).fill('en'),
    ...Array.from({ length: 243 }, (_, index) => `palabra${index}`)].join(' ') };
test('screenshot regression: de 25/286 and el 11/286 cannot pass', () => {
  const result = check(spanishReport);
  const analysis = result.analyses.fullDescription;
  assert.equal(result.clean, false); assert.equal(analysis.totalWords, 286); assert.equal(analysis.maxAllowed, 7);
  assert.deepEqual(analysis.spam.map(({ forms, kind, ...item }) => item), [
    { word: 'de', count: 25, density: 8.74, removeCount: 18 },
    { word: 'el', count: 11, density: 3.85, removeCount: 4 }
  ]);
  assert.ok(analysis.frequency.some(item => item.word === 'en' && item.density === 2.45));
});
test('English function words are included without accidental stemming', () => {
  const result = createChecker({ normalizeEnglish: normalize, englishStopWords: new Set(['the', 'was']) })({ ...clean,
    fullDescription: 'the the the was was was' });
  assert.deepEqual(result.analyses.fullDescription.spam.map(item => item.word), ['the', 'was']);
});
test('two repetitions above 2.5 percent are flagged, not hidden by a three-use exemption', () => {
  const result = check({ ...clean, locale: 'es-MX', fullDescription: 'de de sol luna' });
  assert.equal(result.clean, false); assert.equal(result.analyses.fullDescription.spam[0].removeCount, 1);
});
test('invisible split characters and full-width forms cannot hide duplicate keywords', () => {
  const result = check({ ...clean, fullDescription: 'garden gar\u200bden gar\u00adden ｇａｒｄｅｎ' });
  assert.equal(result.analyses.fullDescription.spam[0].count, 4);
});
test('numbers contribute to total word count, but are not keyword-frequency entries', () => {
  const analysis = check({ ...clean, fullDescription: 'de de alpha 1 2 3 4' }).analyses.fullDescription;
  assert.equal(analysis.totalWords, 7);
  assert.deepEqual(analysis.frequency.map(item => item.word), ['de', 'alpha']);
});
test('Chinese is segmented without spaces; repeated keywords are visible', () => {
  const result = check({ locale: 'zh-CN', title: '专注花园', shortDescription: '安排每日任务', fullDescription: '游戏。游戏。游戏。游戏。' });
  assert.ok(result.analyses.fullDescription.totalWords >= 4);
  assert.ok(result.analyses.fullDescription.spam.some(item => item.word === '游戏'));
});
test('Unicode counts use code points and limits are not silently truncated', () => {
  assert.equal(check({ ...clean, title: '🌱'.repeat(30) }).lengths.title, 30);
  assert.equal(check({ ...clean, title: '🌱'.repeat(31) }).clean, false);
});
test('wrong script, empty outputs and long outputs fail validation', () => {
  assert.equal(check({ ...clean, locale: 'uk' }).clean, false);
  assert.equal(check({ ...clean, title: '' }).clean, false);
  assert.equal(check({ ...clean, fullDescription: 'word '.repeat(850) }).clean, false);
});
test('strict source validation rejects bad types, unsupported languages and oversized fields', () => {
  for (const body of [null, {}, { ...clean, locale: 'xx' }, { ...clean, title: [] }, { ...clean, title: ' ' },
    { ...clean, fullDescription: 'x'.repeat(12001) }, { ...clean, preserveTitle: 'true' },
    { ...clean, title: 'x'.repeat(31), preserveTitle: true }]) assert.throws(() => validate(body));
});

async function fixture(t, options = {}) {
  const app = express(); app.use(express.json());
  app.use('/api/localize', createLocalizationRouter({ isConfigured: () => true,
    callClaude: async () => JSON.stringify(clean), englishStopWords: new Set('a your you in and with when one'.split(' ')), ...options }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/localize`;
  return async (path = '', body = clean) => {
    const response = await fetch(base + path, body === null ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, data: await response.json() };
  };
}
test('language API and checking work without an AI key or external calls', async t => {
  const post = await fixture(t, { isConfigured: () => false, callClaude: () => assert.fail('AI must not be called') });
  assert.equal((await post('/languages', null)).data.languages.length, 107);
  assert.equal((await post('/check')).data.clean, true);
  assert.equal((await post()).status, 503);
  assert.equal((await post('', {})).status, 400);
});
test('successful generation checks every field and sends source as JSON data', async t => {
  const post = await fixture(t, { callClaude: async (content, options) => {
    assert.equal(JSON.parse(content).source.locale, 'en-US');
    assert.match(options.system, /untrusted content/);
    assert.ok(options.signal);
    return JSON.stringify(clean);
  } });
  const { status, data } = await post();
  assert.equal(status, 200); assert.equal(data.ready, true); assert.equal(data.attempts, 1);
  assert.equal(data.fullDescription, clean.fullDescription);
});
test('spam triggers repair with specific issues, then returns a clean candidate', async t => {
  let calls = 0;
  const post = await fixture(t, { callClaude: async content => {
    if (++calls === 1) return JSON.stringify({ ...clean, fullDescription: 'garden garden garden garden' });
    assert.ok(JSON.parse(content).issues.length);
    return JSON.stringify(clean);
  } });
  const { data } = await post();
  assert.equal(data.ready, true); assert.equal(data.attempts, 2);
});
test('unresolved spam is never marked ready and retries are bounded', async t => {
  let calls = 0;
  const post = await fixture(t, { callClaude: async () => { calls++; return JSON.stringify({ ...clean, title: 'garden garden' }); } });
  const { data } = await post();
  assert.equal(calls, 5); assert.equal(data.ready, false); assert.equal(data.checks.clean, false);
});
test('Spanish function-word spam reaches repair and cannot produce ready:true', async t => {
  let calls = 0;
  const post = await fixture(t, { callClaude: async (content, { system }) => {
    assert.match(system, /INCLUDING grammatical function words/);
    const payload = JSON.parse(content);
    if (calls++) {
      assert.equal(payload.fullDescriptionCheck.maxAllowed, 7);
      assert.equal(payload.fullDescriptionCheck.wordsToReduce[0].word, 'de');
      assert.equal(payload.fullDescriptionCheck.wordsToReduce[0].removeCount, 18);
    }
    return JSON.stringify(spanishReport);
  } });
  const checked = await post('/check', spanishReport);
  assert.equal(checked.data.clean, false);
  const { data } = await post('', spanishReport);
  assert.equal(calls, 5); assert.equal(data.ready, false);
  assert.ok(data.checks.issues.some(issue => issue.includes('de ×25')));
});
test('preserve-title option enforces the original brand even if AI changes it', async t => {
  const post = await fixture(t);
  assert.equal((await post('', { ...clean, title: 'My Brand', preserveTitle: true })).data.title, 'My Brand');
});
test('malformed AI response returns an actionable error, not partial success', async t => {
  const post = await fixture(t, { callClaude: async () => '{"title":7}' });
  assert.equal((await post()).status, 502);
});
test('provider rejection is sanitized', async t => {
  const post = await fixture(t, { callClaude: async () => { throw new Error('secret-provider-detail'); } });
  const response = await post();
  assert.equal(response.status, 502); assert.ok(!response.data.error.includes('secret-provider-detail'));
});
test('timeout aborts the AI request and frees the concurrency slot', async t => {
  const post = await fixture(t, { timeoutMs: 20, callClaude: (content, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }) });
  assert.equal((await post()).status, 504);
  assert.equal((await post()).status, 504);
});

test('repair starts from the current result, with aggregated forms and a regional instruction', async t => {
  const source = require('./fixtures/spanish-listing');
  const post = await fixture(t, { callClaude: async (content, { system }) => {
    const payload = JSON.parse(content);
    assert.equal(payload.candidate.fullDescription, source.fullDescription);
    assert.deepEqual(payload.fieldsToRepair, ['fullDescription']);
    assert.equal(payload.fullDescriptionCheck.wordsToReduce.find(item => item.word === 'el').forms.length, 4);
    assert.match(system, /WORD FAMILIES/); assert.match(system, /Colombian/);
    return JSON.stringify(source);
  } });
  const { data } = await post('', { ...source, mode: 'repair' });
  assert.equal(data.ready, false); assert.equal(data.attempts, 5);
});
test('repair receives the latest candidate even when its score ties the best', async t => {
  let calls = 0;
  const post = await fixture(t, { callClaude: async content => {
    const payload = JSON.parse(content);
    calls++;
    if (calls === 3) assert.equal(payload.candidate.fullDescription, 'timer timer');
    return JSON.stringify({ ...clean, fullDescription: calls === 1 ? 'garden garden' : 'timer timer' });
  } });
  const { data } = await post();
  assert.equal(data.ready, false);
  assert.equal(data.fullDescription, 'timer timer');
});
test('provider failure after a valid draft preserves it but never marks it ready', async t => {
  let calls = 0;
  const post = await fixture(t, { callClaude: async () => {
    if (++calls > 1) throw new Error('private-provider-error');
    return JSON.stringify({ ...clean, fullDescription: 'garden garden' });
  } });
  const { status, data } = await post();
  assert.equal(status, 200); assert.equal(data.ready, false);
  assert.equal(data.fullDescription, 'garden garden'); assert.ok(data.warning);
  assert.ok(!JSON.stringify(data).includes('private-provider-error'));
});
test('invalid repair mode is rejected before calling AI', async t => {
  const post = await fixture(t, { callClaude: () => assert.fail('No AI call') });
  assert.equal((await post('', { ...clean, mode: 'anything' })).status, 400);
});

test('AI editor catches quality defects, then verifies the repaired candidate', async t => {
  let drafts = 0, reviews = 0;
  const post = await fixture(t, { callClaude: async (content, { system }) => {
    const payload = JSON.parse(content);
    if (system.includes('careful app-store copy editor')) {
      reviews++;
      return JSON.stringify({ issues: reviews === 1 ? [{ field: 'fullDescription', category: 'meaning', message: 'Пропущено уточнення.', quote: '', suggestion: 'Поверніть обмеження з джерела.' }] : [] });
    }
    if (++drafts === 2) {
      assert.deepEqual(payload.fieldsToRepair, ['fullDescription']);
      assert.equal(payload.editorFeedback[0].category, 'meaning');
    }
    return JSON.stringify({ ...clean, fullDescription: drafts > 1 ? clean.fullDescription + ' Offline only.' : clean.fullDescription });
  } });
  const { data } = await post('', { ...clean, profile: 'natural', qualityReview: true });
  assert.equal(drafts, 2); assert.equal(reviews, 2);
  assert.equal(data.ready, true); assert.equal(data.checks.editor.status, 'passed');
  assert.equal(data.profile, 'natural'); assert.equal(data.editorCalls, 2);
});
test('failed AI quality check cannot silently become a ready result', async t => {
  const post = await fixture(t, { callClaude: async (content, { system }) => system.includes('careful app-store copy editor') ? '{}' : JSON.stringify(clean) });
  const { data } = await post('', { ...clean, qualityReview: true });
  assert.equal(data.ready, false); assert.equal(data.checks.clean, true);
  assert.deepEqual(data.checks.issues, []);
  assert.equal(data.checks.editor.reason, 'invalid_response');
  assert.equal(data.checks.editor.status, 'unavailable'); assert.equal(data.fullDescription, clean.fullDescription);
});
test('AI editor and draft call budgets are bounded when criticism remains unresolved', async t => {
  let drafts = 0, reviews = 0;
  const post = await fixture(t, { callClaude: async (content, { system }) => {
    if (system.includes('careful app-store copy editor')) { reviews++; return JSON.stringify({ issues: [{ field: 'fullDescription', category: 'grammar', message: 'Неприродне речення.', quote: 'Choose tasks.', suggestion: 'Перебудуйте речення.' }] }); }
    drafts++; return JSON.stringify(clean);
  } });
  const { data } = await post('', { ...clean, qualityReview: true });
  assert.equal(drafts, 2); assert.equal(reviews, 1); assert.equal(data.ready, false);
  assert.equal(data.checks.editor.status, 'needs_revision');
});
test('repair editor uses the original reference, not a previously damaged candidate', async t => {
  const reference = { ...clean, fullDescription: 'Offline only. No subscriptions.' };
  const post = await fixture(t, { callClaude: async (content, { system }) => {
    const payload = JSON.parse(content);
    if (system.includes('careful app-store copy editor')) {
      assert.equal(payload.referenceForFactsOnly.fullDescription, reference.fullDescription);
      return '{"issues":[]}';
    }
    assert.equal(payload.originalReference.fullDescription, reference.fullDescription);
    return JSON.stringify(clean);
  } });
  assert.equal((await post('', { ...clean, mode: 'repair', reference, qualityReview: true })).data.ready, true);
});

test('editor checks a spammy first draft and carries its feedback through density repairs', async t => {
  let drafts = 0, reviews = 0;
  const post = await fixture(t, { callClaude: async (content, { system }) => {
    const payload = JSON.parse(content);
    if (system.includes('careful app-store copy editor')) {
      reviews++;
      return JSON.stringify({ issues: [{ field: 'shortDescription', category: 'grammar', message: 'Помилка.', quote: '', suggestion: 'Виправте граматику.' }] });
    }
    if (++drafts > 1) {
      assert.equal(payload.editorFeedback[0].category, 'grammar');
      assert.ok(payload.fieldsToRepair.includes('shortDescription'));
    }
    return JSON.stringify({ ...clean, fullDescription: 'garden garden garden garden' });
  } });
  const { data } = await post('', { ...clean, qualityReview: true });
  assert.equal(drafts, 2); assert.equal(reviews, 1); assert.equal(data.ready, false);
});

test('third distinct draft can receive editorial approval without a two-review ceiling', async t => {
  let drafts = 0, reviews = 0;
  const post = await fixture(t, { callClaude: async (content, { system }) => {
    if (system.includes('careful app-store copy editor')) {
      reviews++;
      return JSON.stringify({ issues: reviews < 3 ? [{ field: 'fullDescription', category: 'grammar', message: 'Уточніть речення.', quote: '', suggestion: 'Перефразуйте.' }] : [] });
    }
    return JSON.stringify({ ...clean, fullDescription: clean.fullDescription + [' Discover gardens.', ' Explore forests.', ' Enjoy nature.'][drafts++] });
  } });
  const { data } = await post('', { ...clean, qualityReview: true });
  assert.equal(data.ready, true); assert.equal(data.editorCalls, 3); assert.equal(drafts, 3);
});

for (const kind of ['malformed', 'network']) test(`one ${kind} failure automatically recovers`, async t => {
  let calls = 0;
  const post = await fixture(t, { callClaude: async () => {
    if (++calls === 1) {
      if (kind === 'malformed') return '{"title":';
      throw new Error('temporary private network error');
    }
    return JSON.stringify(clean);
  } });
  const { data } = await post();
  assert.equal(calls, 2); assert.equal(data.ready, true); assert.equal(data.attempts, 2);
});

for (const [status, code] of [[401, 'configuration'], [429, 'rate_limit']]) test(`provider ${status} has a distinct safe message and is not retried`, async t => {
  let calls = 0;
  const post = await fixture(t, { callClaude: async () => { calls++; throw Object.assign(new Error('private provider detail'), { status }); } });
  const response = await post();
  assert.equal(calls, 1); assert.equal(response.data.code, code);
  assert.doesNotMatch(response.data.error, /private/);
});

test('a permanently malformed draft gets only one retry', async t => {
  let calls = 0;
  const post = await fixture(t, { callClaude: async () => { calls++; return '{}'; } });
  const { status, data } = await post();
  assert.equal(calls, 2); assert.equal(status, 502); assert.equal(data.code, 'invalid_response');
});

test('editor timeout preserves deterministic checks without claiming AI approval', async t => {
  const post = await fixture(t, { timeoutMs: 20, callClaude: async (content, { system, signal }) => {
    if (!system.includes('careful app-store copy editor')) return JSON.stringify(clean);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const { data } = await post('', { ...clean, qualityReview: true });
  assert.equal(data.ready, false); assert.equal(data.checks.clean, true);
  assert.equal(data.checks.editor.reason, 'timeout');
});

test('incomplete editorial response is retried without generating the translation again', async t => {
  let drafts = 0, reviews = 0;
  const post = await fixture(t, { callClaude: async (content, { system }) => {
    if (system.includes('careful app-store copy editor')) return ++reviews === 1 ? '{}' : '{"issues":[]}';
    drafts++; return JSON.stringify(clean);
  } });
  const { data } = await post('', { ...clean, qualityReview: true });
  assert.equal(drafts, 1); assert.equal(reviews, 2); assert.equal(data.ready, true);
});
