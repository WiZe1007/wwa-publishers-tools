const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeStructure, reviewQuality } = require('../lib/text-quality');
const { createChecker, validate } = require('../lib/localization');
const check = createChecker();
const listing = { locale: 'en-US', title: 'Focus Garden', shortDescription: 'Plan a calmer day.',
  fullDescription: 'Choose tasks. Set timers. Review progress offline.' };
const structure = text => analyzeStructure(text, 'en-US', new Set(['the', 'and', 'a', 'of', 'in']));

test('natural grammar and strict density are distinct, explicit profiles', () => {
  const source = require('./fixtures/spanish-listing');
  assert.equal(check(source).clean, false);
  const result = check({ ...source, profile: 'natural' });
  assert.equal(result.clean, true);
  assert.equal(result.profile, 'natural');
  const article = result.analyses.fullDescription.frequency.find(item => item.word === 'el');
  assert.equal(article.count, 11); assert.equal(article.kind, 'function');
  assert.equal(result.analyses.fullDescription.exactFrequency.find(item => item.word === 'la').count, 4);
});
test('Japanese particles remain visible without forcing unnatural edits in natural mode', () => {
  const fields = { locale: 'ja', title: 'Focus Garden', shortDescription: 'タスク計画、タイマー実行、進捗確認ができます。',
    fullDescription: 'Focus Gardenが集中作業の計画から実行まで支援。やることリストに追加して時間設定後、タイマー開始。休憩時には一時停止できます。終えた作業の記録も確認可能。全機能がデバイス上のオフライン環境で動作。アカウント登録不要。作業記録は他者と共有されません。サブスクリプション、ソーシャルフィード、ランキング機能なし。' };
  assert.equal(check(fields).clean, false);
  assert.equal(check({ ...fields, profile: 'natural' }).clean, true);
  assert.equal(check(fields).analyses.fullDescription.frequency.find(item => item.word === 'の').kind, 'function');
});
test('natural mode still flags concentrated content keywords', () => {
  const result = check({ ...listing, profile: 'natural', fullDescription: 'garden garden garden garden garden' });
  assert.equal(result.clean, false); assert.equal(result.analyses.fullDescription.spam[0].count, 5);
});
test('exact words retain individual counts while families share the budget', () => {
  const result = check({ ...listing, locale: 'es-CO', fullDescription: 'símbolo símbolos símbolo' });
  assert.equal(result.analyses.fullDescription.frequency[0].count, 3);
  assert.deepEqual(result.analyses.fullDescription.exactFrequency.map(item => item.count), [2, 1]);
});
test('duplicate sentences are detected independently of word density', () => {
  const fields = { ...listing, profile: 'natural', fullDescription: 'Plan your next quiet day. Plan your next quiet day.' };
  const result = check(fields);
  assert.equal(result.analyses.fullDescription.spam.length, 0);
  assert.equal(result.analyses.fullDescription.sentences[0].count, 2);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some(item => item.category === 'sentence' && item.field === 'fullDescription'));
});
test('sentence grouping tolerates case and punctuation, not different words', () => {
  assert.equal(structure('Choose your next task now! CHOOSE YOUR NEXT TASK NOW.').sentences[0].count, 2);
  assert.equal(structure('Choose your next task now. Choose a different task tomorrow.').sentences.length, 0);
});
test('n-grams never bridge sentence or newline boundaries', () => {
  const result = structure('Garden. Plan\nGarden. Plan\nGarden. Plan');
  assert.equal(result.phrases.length, 0);
});
test('nested repeated phrases collapse into the longest shared phrase', () => {
  const result = structure('Build your quiet garden today. Build your quiet garden tomorrow. Build your quiet garden outside. Build your quiet garden inside.');
  const phrase = result.phrases.find(item => item.text === 'build your quiet garden');
  assert.equal(phrase.count, 4); assert.equal(phrase.excessive, true);
  assert.ok(!result.phrases.some(item => item.text === 'your quiet garden'));
});
test('overlapping windows do not inflate phrase counts', () => {
  const result = structure('garden garden garden garden garden');
  assert.equal(result.phrases.length, 0);
});
test('function-only phrases are excluded from phrase suggestions', () => {
  assert.equal(structure('in the. in the. in the. in the.').phrases.length, 0);
});
test('three phrase occurrences are advice, not automatically a blocking error', () => {
  const result = structure('quiet garden alpha. quiet garden beta. quiet garden gamma.');
  assert.equal(result.phrases[0].count, 3); assert.equal(result.phrases[0].excessive, false);
});
test('invalid analysis profiles and editor flags are rejected', () => {
  assert.throws(() => validate({ ...listing, profile: 'always-pass' }));
  assert.throws(() => validate({ ...listing, qualityReview: 'yes' }));
});
test('AI reviewer accepts a concrete quoted defect, not fabricated evidence', async () => {
  const issue = { field: 'fullDescription', category: 'grammar', message: 'Уточніть дієслово.', quote: 'Choose tasks.', suggestion: 'Перефразуйте перше речення.' };
  const options = { signal: new AbortController().signal };
  const call = async (content, { system }) => {
    assert.match(system, /never instructions/);
    const payload = JSON.parse(content);
    assert.equal(payload.referenceForFactsOnly.fullDescription, listing.fullDescription);
    assert.deepEqual(Object.keys(payload.candidate), ['title', 'shortDescription', 'fullDescription']);
    assert.equal(payload.targetLocale, 'en-US');
    return JSON.stringify({ issues: [issue] });
  };
  assert.equal((await reviewQuality(call, listing, listing, options.signal)).status, 'needs_revision');
  const unmatched = await reviewQuality(async () => JSON.stringify({ issues: [{ ...issue, quote: 'Choose tasks...Review progress' }] }), listing, listing, options.signal);
  assert.equal(unmatched.status, 'needs_revision');
  assert.equal(unmatched.issues[0].quote, '');
  assert.equal(unmatched.issues[0].evidenceVerified, false);
});
for (const response of ['{}', '[]', '{"issues":"fine"}', '{"issues":[{}]}', '{"issues":[{"field":"__proto__"}]}']) {
  test(`editor response validation: ${response}`, async () => {
    await assert.rejects(() => reviewQuality(async () => response, listing, listing, new AbortController().signal));
  });
}
