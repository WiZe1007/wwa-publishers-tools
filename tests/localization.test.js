const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createChecker, createLocalizationRouter, LANGUAGES, validate } = require('../lib/localization');
const { normalize } = require('../server');

const clean = { locale: 'en-US', title: 'Focus Garden', shortDescription: 'Plan your day with a quiet timer.',
  fullDescription: 'Plan a focused session. Set a timer, choose a task and start working. Review completed sessions in your history. Take a break when you need one.' };
const check = createChecker({ normalizeEnglish: normalize, englishStopWords: new Set('a the your you in and with when one'.split(' ')) });

test('all 24 supported locales have a working segmenter', () => {
  assert.equal(LANGUAGES.length, 24);
  for (const language of LANGUAGES) assert.doesNotThrow(() => check({ ...clean, locale: language.code }));
});
test('short natural copy passes; singleton words are not spam', () => assert.equal(check(clean).clean, true));
test('English variants are grouped and repeated title words flagged', () => {
  const result = check({ ...clean, title: 'Focus focus', fullDescription: 'Tap taps tapping tapped.' });
  assert.equal(result.clean, false);
  assert.equal(result.analyses.fullDescription.spam[0].count, 4);
  assert.equal(result.analyses.title.spam[0].count, 2);
});
test('Ukrainian stopwords are excluded, not English-stemmed', () => {
  const result = check({ locale: 'uk', title: 'Тихий сад', shortDescription: 'Плануйте день та відпочинок', fullDescription: 'Сад та сад і сад та робота.' });
  assert.deepEqual(result.analyses.fullDescription.spam.map(item => item.word), ['сад']);
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
  assert.equal((await post('/languages', null)).data.languages.length, 24);
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
  assert.equal(calls, 3); assert.equal(data.ready, false); assert.equal(data.checks.clean, false);
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
