const { test } = require('node:test');
const assert = require('node:assert/strict');
const { repetitionBudget } = require('../lib/repetition-policy');
const { createChecker, LANGUAGES } = require('../lib/localization');
const urdu = require('./fixtures/urdu-listing');
const check = createChecker();

test('real Urdu listing: six occurrences at low density are not clean', () => {
  const report = check(urdu), a = report.analyses.fullDescription;
  assert.equal(report.clean, false);
  assert.equal(a.totalWords, 249); // ASOMobile counts 259, notably including numbers.
  assert.equal(a.budget.densityMax, 6);
  assert.equal(a.budget.characterMax, 5);
  assert.equal(a.maxAllowed, 5);
  for (const word of ['میں', 'کا']) {
    const issue = a.spam.find(item => item.word === word);
    assert.equal(issue.count, 6); assert.equal(issue.removeCount, 1);
  }
  assert.equal(a.spam.some(item => item.word === 'پر'), false);
});

// Observed via the ASOMobile UI, not inferred from its displayed density.
// Same 200 words, apple/pear x12: 1011 chars => remove8; 3123 => not spam.
// Single apple x12 + a long q token: 1249 chars => remove8; 1250 => remove7.
for (const [characters, expected] of [[1011, 4], [1249, 4], [1250, 5], [1431, 5], [1499, 5], [1500, 6], [3123, 12]]) {
  test(`reference character-budget observation: ${characters} => ${expected}`, () => {
    assert.equal(repetitionBudget('q'.repeat(characters), 'en-US', 200).characterMax, expected);
  });
}
test('minimal Urdu rephrasing passes without padding or removing factual quantities', () => {
  // Manually edited regression fixture, not a claim of a live Claude test.
  const fullDescription = urdu.fullDescription.replace('تجربہ دریافت کریں۔', 'تجربہ آزمائیں۔')
    .replace('Fortune Gems میں', 'Fortune Gems:').replace('کھیلنے کا طریقہ', 'طریقۂ کھیل')
    .replace('روزانہ خزانہ حاصل کریں:', 'روزانہ خزانہ لیں:');
  assert.ok(fullDescription.length < urdu.fullDescription.length);
  assert.equal(check({ ...urdu, fullDescription }).clean, true);
  for (const fact of ['250', '5×3', '(×3)', '(×5)', '(×8)', '(×15)', 'حقیقی رقم کا داؤ، نقدی ادائیگی، نکلوائی پیش نہیں کرتا']) {
    assert.ok(fullDescription.includes(fact));
  }
});
for (const { code } of LANGUAGES) test(`${code}: strict character guard and natural profile use distinct budgets`, () => {
  // Isolate the policy from segmentation/morphology: 249 lexical words at 1422 characters.
  const strict = repetitionBudget('x'.repeat(1422), code, 249);
  const natural = repetitionBudget('x'.repeat(1422), code, 249, 'natural');
  assert.equal(strict.maxAllowed, 5);
  assert.equal(natural.maxAllowed, 9);
  assert.equal(natural.strictMaxAllowed, 5);
  assert.ok(strict.repairTarget <= strict.maxAllowed);
});
test('shortening a repair recomputes the budget instead of reusing the old allowance', () => {
  assert.equal(repetitionBudget('x'.repeat(1500), 'ur', 300).maxAllowed, 6);
  assert.equal(repetitionBudget('x'.repeat(1499), 'ur', 300).maxAllowed, 5);
  assert.equal(repetitionBudget('x'.repeat(1500), 'ur', 300).repairTarget, 5);
});
test('density guard still blocks padding with extremely long words', () => {
  const budget = repetitionBudget('x'.repeat(3123), 'en-US', 13);
  assert.equal(budget.characterMax, 12); assert.equal(budget.maxAllowed, 1);
});
test('whitespace, invisibles and emoji UTF-16 pairs cannot inflate the character guard', () => {
  const base = repetitionBudget('word '.repeat(200).trim(), 'en-US', 200);
  assert.equal(repetitionBudget('word\n\n\n '.repeat(200).trim(), 'en-US', 200).characterMax, base.characterMax);
  assert.equal(repetitionBudget('wo\u200brd '.repeat(200).trim(), 'en-US', 200).characterMax, base.characterMax);
  assert.equal(repetitionBudget('🌱'.repeat(250), 'en-US', 200).characters, 250);
});
