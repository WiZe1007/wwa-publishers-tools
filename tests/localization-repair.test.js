const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LANGUAGES, createChecker } = require('../lib/localization');
const { createRepairPlan, applyRepairPlan, repairProgress } = require('../lib/localization-repair');
const blackjack = require('./fixtures/spanish-blackjack');
const nativeWords = require('./fixtures/native-keywords');
const check = createChecker();
const reset = '⚙️ Opción para Reiniciar: Desde Ajustes puedes borrar todas las estadísticas y recuperar el saldo inicial cuando quieras.';

test('actual tu/tus failure is fixed with one sentence, without rewriting the listing', () => {
  const before = check(blackjack), plan = createRepairPlan(blackjack, before);
  assert.deepEqual(before.analyses.fullDescription.spam.map(item => [item.word, item.count]), [['tu', 10]]);
  assert.equal(plan.sentences.length, 1);
  assert.ok(plan.wordsToWatch.some(item => item.word === 'y' && item.count === 9));
  const result = applyRepairPlan(blackjack, plan, { replacements: [{ id: 's1', alternatives: [
    // This reduces tu but introduces new y spam: it must not be selected.
    '⚙️ Opción para Reiniciar: Borra todas las estadísticas y restaura el saldo inicial y hazlo desde Ajustes cuando quieras.', reset
  ] }] }, check);
  assert.equal(result.checks.clean, true);
  assert.equal(result.edits.length, 1);
  assert.equal(result.fields.fullDescription, blackjack.fullDescription.replace(plan.sentences[0].text, reset));
  assert.equal(result.fields.title, blackjack.title);
  assert.equal(result.fields.shortDescription, blackjack.shortDescription);
  assert.deepEqual(repairProgress(before, result.checks), { beforeExcess: 1, afterExcess: 0, status: 'fixed' });
});

test('unchanged or worse alternatives preserve the exact previous text and honest status', () => {
  const before = check(blackjack), plan = createRepairPlan(blackjack, before);
  for (const alternatives of [[plan.sentences[0].text], ['tu tus tu tus tu tus tu tus'], ['y y y y y y y y y y y y']]) {
    const result = applyRepairPlan(blackjack, plan, { replacements: [{ id: 's1', alternatives }] }, check);
    assert.equal(result.fields.fullDescription, blackjack.fullDescription);
    assert.equal(result.checks.clean, false);
    assert.equal(repairProgress(before, result.checks).status, 'unchanged');
  }
});

test('changed quantities and invisible spelling tricks are rejected, not treated as fixes', () => {
  const source = { locale: 'en-US', title: 'Rewards', shortDescription: 'Collect daily bonuses',
    fullDescription: 'Collect 250 coins with coins coins coins.' };
  const plan = createRepairPlan(source, check(source));
  for (const text of ['Collect 300 tokens through daily rewards.', 'Collect 250 co\u200bins through daily rewards.', '']) {
    const result = applyRepairPlan(source, plan, { replacements: [{ id: 's1', alternatives: [text] }] }, check);
    assert.equal(result.fields.fullDescription, source.fullDescription);
  }
  const result = applyRepairPlan(source, plan, { replacements: [{ id: 's1', alternatives: ['Collect 250 tokens through daily rewards.'] }] }, check);
  assert.equal(result.checks.clean, true);
});

test('shortening is checked against the NEW budget and cannot silently create another spam group', () => {
  const source = { locale: 'en-US', title: 'Atlas', shortDescription: 'Organize projects',
    fullDescription: 'Timer timer timer timer daily tasks. Focus focus focus. ' +
      Array.from({ length: 112 }, (_, index) => `topic${index}`).join(' ') };
  const before = check(source), plan = createRepairPlan(source, before);
  assert.equal(before.analyses.fullDescription.totalWords, 121);
  assert.equal(before.analyses.fullDescription.maxAllowed, 3);
  const alternatives = ['Manage schedules efficiently.', 'Manage daily tasks through flexible schedules.'];
  const result = applyRepairPlan(source, plan, { replacements: [{ id: plan.sentences[0].id, alternatives }] }, check);
  assert.equal(result.checks.clean, true);
  assert.ok(result.fields.fullDescription.includes(alternatives[1]));
  assert.equal(result.checks.analyses.fullDescription.maxAllowed, 3);
});

test('unknown, duplicate or malformed patch ids fail closed', () => {
  const plan = createRepairPlan(blackjack, check(blackjack));
  for (const replacements of [null, [{ id: 'unknown', alternatives: [reset] }],
    [{ id: 's1', alternatives: [] }], [{ id: 's1', alternatives: [7] }],
    [{ id: 's1', alternatives: [reset] }, { id: 's1', alternatives: [reset] }]])
    assert.throws(() => applyRepairPlan(blackjack, plan, { replacements }, check));
});

test('large problems or errors in other fields retain the full-rewrite path', () => {
  const source = { ...blackjack, fullDescription: 'tu '.repeat(70) };
  assert.equal(createRepairPlan(source, check(source)), null);
  assert.equal(createRepairPlan({ ...blackjack, title: 'casino casino' }, check({ ...blackjack, title: 'casino casino' })), null);
});

// This validates the local patch/Unicode/checker integration for EVERY locale.
// These are simulated model alternatives, not claims of AI linguistic accuracy.
for (const { code } of LANGUAGES) test(`localized sentence patches preserve Unicode and pass the full checker: ${code}`, () => {
  const word = nativeWords[code] || nativeWords[code.split('-')[0]];
  const source = { locale: code, title: word, shortDescription: word,
    fullDescription: `${Array(6).fill(word).join(' ')} alpha beta gamma.` };
  const before = check(source), plan = createRepairPlan(source, before);
  assert.ok(plan, code);
  assert.equal(before.clean, false);
  const result = applyRepairPlan(source, plan, { replacements: plan.sentences.map(item => ({ id: item.id,
    alternatives: [`${word} alpha beta gamma.`] })) }, check);
  assert.equal(result.checks.clean, true, JSON.stringify(result.checks.issues));
  assert.equal(result.fields.title, word);
  assert.equal(result.fields.shortDescription, word);
});
