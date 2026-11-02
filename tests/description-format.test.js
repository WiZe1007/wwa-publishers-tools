const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { analyzeText } = require('../server');

test('ASO repetition analysis counts visible words, excluding formatting and color attributes', () => {
  const result = analyzeText('<b><font color="red">Play</font></b> <i>the</i> <u>puzzle</u><br>R&amp;D');
  assert.equal(result.totalWords, 5);
  assert.deepEqual(result.frequency.map(row => [row.word, row.count]), [['play', 1], ['puzzle', 1]]);
});

test('formatting preserves nested emphasis and decodes entities for plain-text copying', () => {
  const { formatDescription } = require('../public/js/description-format');
  const result = formatDescription('<b><font color="red">Explore &amp; play</font></b>\n<i>At your pace</i> <u>offline</u><br>Start &#128640;');
  assert.equal(result.text, 'Explore & play\nAt your pace offline\nStart 🚀');
  assert.equal(result.html, '<b><font color="red">Explore &amp; play</font></b>\n<i>At your pace</i> <u>offline</u>\nStart 🚀');
  assert.equal(result.hasMarkup, true);
});

test('preview escapes active content, arbitrary attributes and unsafe color values', () => {
  const { formatDescription } = require('../public/js/description-format');
  const input = '<img src="https://bad.invalid/x" onerror="alert(1)"><script>alert(2)</script><b onclick="alert(3)">Safe</b><font color="red;background:url(x)">Text</font>';
  const result = formatDescription(input);
  assert.doesNotMatch(result.html, /<(?:img|script)|<b\s|<font\s/i);
  assert.match(result.html, /&lt;img/);
  assert.match(result.text, /Safe/);
});

test('encoded tags stay visible text and mismatched emphasis is balanced safely', () => {
  const { formatDescription } = require('../public/js/description-format');
  assert.equal(formatDescription('&lt;img src=x&gt;').html, '&lt;img src=x&gt;');
  assert.equal(formatDescription('<b><i>Play</b>').html, '<b><i>Play</i></b>');
  assert.equal(formatDescription('Score < 20 & time > 5').text, 'Score < 20 & time > 5');
});

for (const [label, input] of [
  ['unclosed angle brackets', "'<'.repeat(100000)"],
  ['unmatched closing tags after deep nesting', "'<b>'.repeat(100000) + '</i>'.repeat(100000)"]
]) test(`malformed ${label} cannot stall preview or the public analyzer`, () => {
  const code = `const {formatDescription}=require('./public/js/description-format');
    const result=formatDescription(${input});
    if(!result.html || !result.text) process.exit(1);
    process.stdout.write('done');`;
  assert.equal(execFileSync(process.execPath, ['-e', code], { cwd: process.cwd(), encoding: 'utf8', timeout: 2000 }), 'done');
});
