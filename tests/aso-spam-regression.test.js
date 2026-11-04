const { test } = require('node:test');
const assert = require('node:assert/strict');
const { analyzeText } = require('../server');
const vip = require('./fixtures/english-vip-listing');

function listing(totalWords, characters, repeats) {
  const words = Object.entries(repeats).flatMap(([word, count]) => Array(count).fill(word));
  while (words.length < totalWords) words.push(`detail${words.length}`);
  // Use short unique fixture tokens, then extend one token to set an exact
  // character boundary; whitespace padding must never buy a larger allowance.
  const compact = words.map(word => word.startsWith('detail') ? word.replace('detail', 'w') : word).join(' ');
  assert.ok(compact.length <= characters);
  return compact + 'x'.repeat(characters - compact.length);
}

for (const [words, characters, repeats, max, removed] of [
  [320, 1900, { the: 15, and: 10 }, 7, { the: 8, and: 3 }],
  [267, 1600, { and: 14, your: 9, the: 9, to: 8 }, 6, { and: 8, your: 3, the: 3, to: 2 }],
  [280, 1600, { and: 16, the: 9, to: 9, for: 7 }, 6, { and: 10, the: 3, to: 3, for: 1 }],
  [347, 2100, { and: 15, the: 11 }, 8, { and: 7, the: 3 }]
]) test(`screenshot regression: ${words} words includes grammatical words and the character guard`, () => {
  const text = listing(words, characters, repeats);
  const analysis = analyzeText(text);
  assert.equal(analysis.totalWords, words);
  assert.equal(analysis.maxAllowed, max);
  for (const [word, removeCount] of Object.entries(removed)) {
    const item = analysis.spam.find(row => row.word === word);
    assert.ok(item, `Missing ${word}`);
    assert.equal(item.count, repeats[word]);
    assert.equal(item.removeCount, removeCount);
  }
});

test('actual VIP description groups is/are/be and finds the failure shown by ASOMobile', () => {
  assert.equal(vip.length, 1607);
  const analysis = analyzeText(vip);
  // ASOMobile reports 275, our tokenizer 273 (possessive suffixes differ).
  // This does not alter the allowed count or the observed one-word excess.
  assert.equal(analysis.totalWords, 273);
  assert.equal(analysis.maxAllowed, 6);
  const be = analysis.spam.find(row => row.word === 'be');
  assert.ok(be);
  assert.equal(be.count, 7);
  assert.equal(be.removeCount, 1);
  assert.deepEqual(Object.fromEntries(be.forms.map(form => [form.word, form.count])), { is: 4, are: 2, be: 1 });
});

test('natural minimal edits fix the actual be excess without losing currency restrictions', () => {
  const edited = vip.replace('Is this a real money game?', 'Does this game involve real money?')
    .replace('All coins are virtual', 'All coins stay virtual');
  assert.equal(analyzeText(edited).spam.length, 0);
  for (const fact of ['1000', '24', 'x50', 'x25', 'Platinum Club', 'VIP Vault', 'cannot be withdrawn or exchanged for money'])
    assert.ok(edited.includes(fact));
});

test('HTML cannot hide grammatical repetitions or enlarge the visible-character allowance', () => {
  const plain = listing(280, 1600, { for: 7 });
  const analysis = analyzeText('<b><font color="#D32F2F">' + plain + '</font></b>');
  assert.equal(analysis.maxAllowed, 6);
  assert.equal(analysis.budget.characters, 1600);
  assert.equal(analysis.spam.find(row => row.word === 'for').removeCount, 1);
});

for (const [root, form] of [['get', 'getting'], ['own', 'owned'], ['let', 'letting']]) {
  test(`lexical ${root}/${form} forms share one allowance even when the root is in the legacy stop list`, () => {
    const analysis = analyzeText(listing(320, 1900, { [root]: 4, [form]: 4 }));
    assert.equal(analysis.maxAllowed, 7);
    const problem = analysis.spam.find(item => item.word === root);
    assert.ok(problem);
    assert.equal(problem.count, 8);
    assert.equal(problem.removeCount, 1);
  });
}
test('the pronoun us never consumes the unrelated use/used/using verb allowance', () => {
  const analysis = analyzeText(listing(320, 1900, { us: 4, use: 4 }));
  assert.equal(analysis.spam.length, 0);
  assert.equal(analysis.frequency.find(item => item.word === 'us').count, 4);
  assert.equal(analysis.frequency.find(item => item.word === 'use').count, 4);
});
