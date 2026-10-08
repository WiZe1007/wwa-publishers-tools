const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChecker } = require('../lib/localization');
const { FAMILIES } = require('../lib/word-families');
const { tokenize } = require('../lib/text-tokens');
const { createRepairPlan, applyRepairPlan } = require('../lib/localization-repair');
const source = require('./fixtures/french-blackjack');
const check = createChecker();

for (const locale of ['fr', 'fr-CA', 'fr-BE', 'fr-CH']) {
  test(`${locale}: exact user listing detects all three external French repetition groups`, () => {
    const result = check({ ...source, locale });
    const full = result.analyses.fullDescription;
    assert.equal(result.clean, false);
    assert.equal(full.totalWords, 456); // 464 in ASOMobile includes 8 standalone numbers.
    assert.equal(tokenize(source.fullDescription, locale, { includeNumbers: true }).length, 464);
    assert.equal(full.maxAllowed, 11); // Conservative lexical density, not an increased threshold.
    assert.deepEqual(full.spam.map(({ word, count }) => ({ word, count })), [
      { word: 'de', count: 19 }, { word: 'un', count: 18 }, { word: 'votre', count: 14 }
    ]);
    assert.deepEqual(Object.fromEntries(full.spam.find(row => row.word === 'un').forms.map(row => [row.word, row.count])),
      { une: 7, un: 4, des: 7 });
    assert.deepEqual(Object.fromEntries(full.spam.find(row => row.word === 'de').forms.map(row => [row.word, row.count])),
      { du: 8, de: 11 });
    assert.deepEqual(Object.fromEntries(full.spam.find(row => row.word === 'votre').forms.map(row => [row.word, row.count])),
      { votre: 9, vos: 5 });
    assert.equal(full.frequency.reduce((sum, row) => sum + row.count, 0), full.totalWords);
    for (const row of full.frequency) assert.equal(row.count, row.forms.reduce((sum, form) => sum + form.count, 0));
    for (const word of ['du', 'des', 'vos']) {
      assert.ok(full.exactFrequency.some(row => row.word === word), 'Exact counts must remain inspectable');
    }
  });
}

for (const words of ['de du', 'un une des', 'votre vos', 'notre nos', 'leur leurs']) {
  test(`French ${words}: forms share a budget without inventing content-word spam`, () => {
    const result = check({ ...source, fullDescription: words });
    assert.equal(result.analyses.fullDescription.frequency.length, 1);
    assert.equal(result.analyses.fullDescription.spam[0].count, words.split(' ').length);
    assert.equal(result.analyses.fullDescription.spam[0].kind, 'function');
    const natural = check({ ...source, profile: 'natural', fullDescription: words });
    assert.equal(natural.clean, true, natural.issues.join('\n'));
    const short = check({ ...source, title: words, shortDescription: words, fullDescription: 'Organisez tranquillement.' });
    assert.equal(short.analyses.title.spam.length, 0);
    assert.equal(short.analyses.shortDescription.spam.length, 0);
  });
}

test('French apostrophes and meaningful accents are not guessed into external lemmas', () => {
  const result = check({ ...source, fullDescription: "de du d'amour l’amour" }).analyses.fullDescription;
  assert.equal(result.frequency.find(row => row.word === 'de').count, 2);
  assert.equal(result.exactFrequency.find(row => row.word === 'd').count, 1);
  assert.equal(result.frequency.find(row => row.word === 'amour').count, 2);
  assert.deepEqual(tokenize("aujourd’hui à a", 'fr'), ["aujourd'hui", 'à', 'a']);
});

test('explicit grammatical families cannot silently overwrite one another', () => {
  for (const [locale, families] of Object.entries(FAMILIES)) {
    const words = families.flatMap(group => group.split(' '));
    assert.equal(new Set(words).size, words.length, locale);
  }
});

test('French surgical repair receives every contracted/plural form and rejects form-swapping as a fix', () => {
  const checks = check(source), plan = createRepairPlan(source, checks);
  assert.ok(plan);
  assert.deepEqual(plan.wordsToReduce.map(row => row.word), ['de', 'un', 'votre']);
  for (const word of ['de', 'du', 'un', 'une', 'des', 'votre', 'vos']) {
    assert.ok(plan.wordsToReduce.some(row => row.forms.some(form => form.word === word)), word);
    assert.ok(plan.sentences.some(sentence => sentence.hits.includes(word)), `Sentence coverage for ${word}`);
  }
  const response = { replacements: plan.sentences.map(sentence => ({ id: sentence.id,
    alternatives: [sentence.text.replace(/\b(votre|vos)\b/giu, word => word.toLowerCase() === 'vos' ? 'votre' : 'vos')]
  })) };
  const result = applyRepairPlan(source, plan, response, check);
  assert.equal(result.checks.clean, false);
  assert.equal(result.fields.fullDescription, source.fullDescription);
});
