const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createChecker, LANGUAGES } = require('../lib/localization');
const { STEMMERS } = require('../lib/word-families');
const { normalize } = require('../server');
const listing = require('./fixtures/spanish-listing');
const check = createChecker({ normalizeEnglish: normalize });
const analyze = (text, locale = 'es-CO') => check({ ...listing, locale, fullDescription: text }).analyses.fullDescription;

test('real ASOMobile regression: 11 article forms cannot be reported as clean', () => {
  const result = check(listing), analysis = result.analyses.fullDescription;
  assert.equal(result.clean, false);
  const articles = analysis.spam.find(item => item.word === 'el');
  assert.equal(articles.count, 11);
  assert.deepEqual(Object.fromEntries(articles.forms.map(item => [item.word, item.count])), { el: 2, la: 4, los: 3, las: 2 });
  assert.equal(analysis.frequency.find(item => item.forms.some(form => form.word === 'ronda')).count, 5);
  assert.equal(analysis.frequency.find(item => item.forms.some(form => form.word === 'símbolo')).count, 4);
  assert.equal(analysis.frequency.find(item => item.word === 'uno').count, 4);
});
for (const [locale, words] of [
  ['es-MX', 'el la los las'], ['es-CO', 'un una unos unas'], ['es-ES', 'ronda rondas'], ['es-AR', 'símbolo símbolos'],
  ['fr', 'le la les'], ['fr-CA', 'chat chats'], ['de', 'der die das den dem des'],
  ['pt-BR', 'um uma uns umas'], ['pt-PT', 'jogo jogos'], ['it', 'il lo la i gli le'],
  ['en-US', 'tap taps tapping tapped'], ['uk', 'завдання завданнями'], ['ru', 'игра игры'],
  ['de', 'spiel spiele'], ['fr', 'jeu jeux']
]) test(`word-family grouping: ${locale} / ${words}`, () => {
  const analysis = analyze(words, locale);
  assert.equal(analysis.frequency.length, 1);
  assert.equal(analysis.frequency[0].count, words.split(' ').length);
});
for (const language of LANGUAGES) test(`analysis invariants and normalized repetition: ${language.code}`, () => {
  const analysis = analyze('Alpha alpha ALPHA delta 123', language.code);
  assert.equal(analysis.totalWords, 5);
  assert.equal(analysis.frequency.find(item => item.forms.some(form => form.word === 'alpha')).count, 3);
  for (const item of analysis.frequency) {
    assert.equal(item.count, item.forms.reduce((sum, form) => sum + form.count, 0));
    assert.ok(Number.isFinite(item.density));
  }
  assert.equal(analysis.grouping, language.code.startsWith('en') || STEMMERS[language.code.split('-')[0]] ? 'stemmed' : 'exact');
});
test('density boundaries remain exact before display rounding', () => {
  for (const length of [39, 40, 79, 80, 119, 120, 256, 286, 400]) {
    const text = ['ronda', 'rondas', ...Array.from({ length: length - 2 }, (_, i) => `token${i}`)].join(' ');
    const analysis = analyze(text);
    assert.equal(analysis.maxAllowed, Math.max(1, Math.floor(length * .025)));
    assert.equal(analysis.spam.some(item => item.forms.some(form => form.word === 'ronda')), 2 > analysis.maxAllowed);
  }
});
test('report includes all groups rather than silently truncating at 50', () => {
  const analysis = analyze(Array.from({ length: 70 }, (_, i) => `token${i}`).join(' '));
  assert.equal(analysis.frequency.length, 70);
});
