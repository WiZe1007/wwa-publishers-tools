const { test } = require('node:test');
const assert = require('node:assert/strict');
const { checkDescriptionFormat, repairDescriptionFormat, formatDescription } = require('../public/js/description-format');
const { LANGUAGES, createChecker } = require('../lib/localization');

test('format validation catches unclosed, crossed, stray and unsupported tags before preview repairs them', () => {
  for (const source of ['<b>Text', '<b><i>Text</b></i>', 'Text</font>', '<font color="url(x)">Text</font>', '<img src=x>Text']) {
    assert.equal(checkDescriptionFormat(source).valid, false, source);
  }
  assert.equal(checkDescriptionFormat('Score < 20 & time > 5').valid, true);
  assert.equal(checkDescriptionFormat('&lt;b&gt;Visible example&lt;/b&gt;').valid, true);
});

test('format validation catches balanced color leakage and limits red to the first two sentences', () => {
  for (const source of [
    '<b><font color="#D32F2F">First sentence. Second sentence.\n\nFEATURES\nPlay offline.</font></b>',
    '<font color="red">First. Second. Third.</font>',
    'First sentence.\n\n<font color="red">Body paragraph.</font>',
    '<font color="teal">FEATURES\nPlay offline. Track progress.</font>'
  ]) assert.equal(checkDescriptionFormat(source).valid, false, source);
  assert.equal(checkDescriptionFormat('<b><font color="red">First. Second.</font></b>\n\n<b><font color="teal">FEATURES</font></b>\nPlay offline.').valid, true);
});

test('free formatting repair closes scopes without changing visible text, names or figures', () => {
  const source = '<b><font color="#D32F2F">Fruit Machine. Match symbols!\n\nFEATURES\n🍒 <b>Wins</b>: 5x, 250x and 50/50.\n\n<b><font color="#0F766E">IMPORTANT</font></b>\nNo real money.</font></b>';
  const fixed = repairDescriptionFormat(source);
  assert.equal(checkDescriptionFormat(fixed).valid, true);
  assert.equal(formatDescription(fixed).text, formatDescription(source).text);
  assert.match(fixed, /^<b><font color="#D32F2F">Fruit Machine\. Match symbols!<\/font><\/b>\n\nFEATURES/);
  assert.match(fixed, /<font color="#0f766e">(?:<b>)?IMPORTANT/);
  assert.equal(repairDescriptionFormat(fixed), fixed);
});

test('free repair balances tags and strips unsupported wrappers without activating encoded HTML', () => {
  const fixed = repairDescriptionFormat('<b><i>Safe</b></i> <span onclick="bad()">words</span> &lt;img src=x&gt;');
  assert.equal(checkDescriptionFormat(fixed).valid, true);
  assert.equal(formatDescription(fixed).text, 'Safe words <img src=x>');
  assert.doesNotMatch(fixed, /<span|onclick|<img/);
});

test('unfinished formatting tags are detected and redundant deep nesting can be safely repaired', () => {
  assert.equal(checkDescriptionFormat('<font color="red"').valid, false);
  assert.equal(checkDescriptionFormat('<b').valid, false);
  const fixed = repairDescriptionFormat('<b>'.repeat(80) + 'Keep this text.' + '</b>'.repeat(80));
  assert.equal(checkDescriptionFormat(fixed).valid, true);
  assert.equal(formatDescription(fixed).text, 'Keep this text.');
});

test('free repair recognizes paragraph breaks separated by formatting tags', () => {
  const source = '<b>First.\n<i>\nBody</i></b>';
  const fixed = repairDescriptionFormat(source);
  assert.equal(checkDescriptionFormat(fixed).valid, true);
  assert.equal(formatDescription(fixed).text, 'First.\n\nBody');
});

test('repair preserves visible whitespace inside malformed colored wrappers', () => {
  for (const source of ['<b><font color="red">\nFirst.\n\nBody</font></b>', '<b><font color="red">  First. Second.  \n\nBody</font></b>']) {
    const fixed = repairDescriptionFormat(source);
    assert.equal(formatDescription(fixed).text, formatDescription(source).text);
    assert.equal(checkDescriptionFormat(fixed).valid, true);
  }
});

test('formatting repair preserves literal angle-bracket identifiers and separates unsupported block wrappers', () => {
  const fixed = repairDescriptionFormat('Contact <player@example.com>. <div>One block.</div><div>Next block.</div>');
  assert.equal(checkDescriptionFormat(fixed).valid, true);
  assert.ok(formatDescription(fixed).text.includes('<player@example.com>'));
  assert.match(formatDescription(fixed).text, /One block\.\s+Next block\./);
});

test('quoted angle brackets in unsupported attributes never become visible garbage after repair', () => {
  for (const source of ['<span title="1 > 0">words</span>', '<div title="1 > 0">words</div>', '<section>words</section>']) {
    assert.equal(checkDescriptionFormat(source).valid, false);
    const fixed = repairDescriptionFormat(source);
    assert.equal(formatDescription(fixed).text.trim(), 'words');
    assert.equal(checkDescriptionFormat(fixed).valid, true);
  }
});

test('malformed attribute quotes cannot hide later tags or delete description text', () => {
  for (const source of ['<font color="red>Text</font>', '<i title="oops>Words</i> Rest.', "Score < 20 & player's <b>Bold"]) {
    assert.equal(checkDescriptionFormat(source).valid, false, source);
    const fixed = repairDescriptionFormat(source);
    assert.equal(checkDescriptionFormat(fixed).valid, true, fixed);
    assert.ok(formatDescription(fixed).text.includes(source.includes('Text') ? 'Text' : source.includes('Words') ? 'Words' : 'Bold'));
  }
  assert.equal(formatDescription(repairDescriptionFormat("Score < 20 & player's <b>Bold")).text, "Score < 20 & player's Bold");
  assert.equal(formatDescription(repairDescriptionFormat('<font color="red>Press "Play" > 0 times.</font>')).text, 'Press "Play" > 0 times.');
  assert.equal(formatDescription(repairDescriptionFormat('<font color="red>Text " > words</font>')).text, 'Text " > words');
});

for (const { code } of LANGUAGES) test(`formatting validation and repair preserve Unicode text for ${code}`, () => {
  const scripts = {
    Arab: 'ابدأ اللعب. اكتشف العالم!', Cyrl: 'Почніть гру. Відкрийте світ!',
    Hans: '开始游戏。探索世界！', Hant: '開始遊戲。探索世界！', Jpan: 'ゲームを始めよう。世界を探検！',
    Kore: '게임을 시작하세요. 세계를 탐험하세요!', Deva: 'खेल शुरू करें। दुनिया खोजें!',
    Thai: 'เริ่มเล่นเกม สำรวจโลก', Hebr: 'התחילו לשחק. גלו עולם!',
    Latn: 'Explore the world. Start playing!'
  };
  const intro = scripts[new Intl.Locale(code).maximize().script] || '遊戲 दुनिया عالم 🌍';
  const source = `<b><font color="red">${intro}\n\n✦ 5x · 250x · Fruit Machine</font></b>`;
  assert.equal(checkDescriptionFormat(source, { locale: code }).valid, false);
  const fixed = repairDescriptionFormat(source, { locale: code });
  assert.equal(checkDescriptionFormat(fixed, { locale: code }).valid, true);
  assert.equal(formatDescription(fixed).text, formatDescription(source).text);
});

test('Localize checker reports formatting defects and analyzes visible words instead of tags', () => {
  const check = createChecker();
  const fields = { locale: 'en-US', profile: 'natural', title: 'Garden', shortDescription: 'Choose a task.', fullDescription: 'Explore nature.\n\nReview progress.' };
  const broken = check({ ...fields, fullDescription: '<font color="red">' + fields.fullDescription + '</font>' });
  assert.equal(broken.formatting.valid, false);
  assert.equal(broken.clean, false);
  assert.ok(broken.findings.some(item => item.category === 'formatting'));
  const plain = check(fields);
  const rich = check({ ...fields, fullDescription: '<b>Explore nature.</b>\n\n<i>Review progress.</i>' });
  assert.deepEqual(rich.analyses.fullDescription, plain.analyses.fullDescription);
});
