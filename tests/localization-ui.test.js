const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { LANGUAGES, createChecker } = require('../lib/localization');

const valid = { locale: 'pl', title: 'Focus Garden', shortDescription: 'Zaplanuj spokojny dzień.',
  fullDescription: 'Wybierz zadanie. Ustaw minutnik i rozpocznij sesję. Przeglądaj historię oraz odpoczywaj.' };
const check = createChecker();

async function mount() {
  const elements = new Map();
  const element = () => ({ value: '', textContent: '', disabled: false, hidden: false,
    dataset: {}, children: [], listeners: {}, checked: false,
    classList: { toggle() {} }, reportValidity() { return true; }, setAttribute() {}, remove() {}, focus() { this.focused = true; }, click() { this.clicked = true; return this.onclick?.(); },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); } });
  const $ = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const state = { copied: '', blob: null, link: null, respond: async () => ({ ...valid, checks: check(valid), ready: true, attempts: 1 }) };
  const context = vm.createContext({ console, AbortController, Blob, setTimeout: () => 0,
    document: { body: { append(link) { state.link = link; } }, createElement: element },
    navigator: { clipboard: { async writeText(text) { state.copied = text; } } },
    URL: { createObjectURL(blob) { state.blob = blob; return 'blob:test'; }, revokeObjectURL() {} },
    fetch: async (url, options) => ({ ok: true, json: async () => url.endsWith('/languages') ? { languages: LANGUAGES }
      : url.endsWith('/check') ? check(JSON.parse(options.body)) : state.respond(JSON.parse(options.body)) }) });
  const module = new vm.SourceTextModule(fs.readFileSync('public/js/tools/localize.js', 'utf8'), { context });
  await module.link(() => {}); await module.evaluate();
  module.namespace.mount({ querySelector: selector => $(selector.slice(1)) });
  await new Promise(resolve => setImmediate(resolve));
  $('locale').value = 'pl'; $('sourceTitle').value = valid.title;
  $('sourceShort').value = valid.shortDescription; $('sourceFull').value = valid.fullDescription;
  const generate = () => $('localizeForm').listeners.submit({ preventDefault() {} });
  return { $, state, generate, matchingLanguages: module.namespace.matchingLanguages };
}

test('copy and downloaded UTF-8 text contain all checked localized fields', async () => {
  const { $, state, generate } = await mount();
  assert.equal($('downloadResult').disabled, true);
  await generate();
  assert.equal($('downloadResult').disabled, false);
  await $('copyResult').onclick(); $('downloadResult').onclick();
  assert.equal(state.link.download, 'aso-pl.txt'); assert.equal(state.link.clicked, true);
  assert.equal(await state.blob.text(), state.copied);
  for (const value of [valid.title, valid.shortDescription, valid.fullDescription]) assert.ok(state.copied.includes(value));
});
test('manual edits invalidate ready state; checks block spam then allow repaired output', async () => {
  const { $, generate } = await mount(); await generate();
  $('resultFull').value = 'minutnik minutnik minutnik minutnik'; $('resultFull').listeners.input();
  assert.equal($('downloadResult').disabled, true);
  await $('checkResult').onclick(); assert.equal($('copyResult').disabled, true);
  assert.match($('checkSummary').textContent, /Є зайві повтори/);
  $('resultFull').value = valid.fullDescription; $('resultFull').listeners.input();
  await $('checkResult').onclick(); assert.equal($('downloadResult').disabled, false);
});
test('failure preserves previous text and its existing verification and export', async () => {
  const { $, state, generate } = await mount(); await generate();
  state.respond = async () => { throw new Error('AI unavailable'); }; await generate();
  assert.equal($('resultFull').value, valid.fullDescription);
  assert.equal($('downloadResult').disabled, false);
  assert.match($('checkSummary').textContent, /Зайвих повторів не знайдено/);
  assert.match($('resultNotice').textContent, /Попередній текст і його перевірку збережено/);
  assert.equal($('sourceFields').disabled, false);
  assert.match($('generationStatus').textContent, /некоректну відповідь/);
});
test('failed regeneration never enables export for manually edited unverified text', async () => {
  const { $, state, generate } = await mount(); await generate();
  $('resultFull').value = 'edited edited'; $('resultFull').listeners.input();
  state.respond = async () => { throw new Error('unavailable'); }; await generate();
  assert.equal($('downloadResult').disabled, true);
  assert.match($('checkSummary').textContent, /Текст змінено/);
});
test('cancelled attempt restores the previous verified result', async () => {
  const { $, state, generate } = await mount(); await generate();
  state.respond = async () => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); };
  await generate();
  assert.equal($('downloadResult').disabled, false);
  assert.match($('resultNotice').textContent, /скасовано/);
  assert.equal($('cancelGeneration').hidden, true);
});
test('unavailable AI review stays separate from clean repetitions and allows clearly warned export', async () => {
  const { $, state, generate } = await mount();
  state.respond = async () => ({ ...valid, checks: { ...check(valid), editor: { status: 'unavailable', issues: [] } }, ready: false });
  await generate();
  assert.equal($('downloadResult').disabled, false);
  assert.equal($('checkReport').dataset.state, 'warning');
  assert.match($('checkSummary').textContent, /Зайвих повторів не знайдено/);
  assert.match($('editorSummary').textContent, /Мову не перевірено/);
  assert.match($('editorSummary').textContent, /перед публікацією перечитайте/);
  assert.equal($('repairResult').textContent, 'Повторити з AI');
});
test('known editorial defects stay visible and cannot be cleared by repetition-only recheck', async () => {
  const { $, state, generate } = await mount();
  state.respond = async () => ({ ...valid, checks: { ...check(valid), editor: { status: 'needs_revision', issues: [
    { field: 'fullDescription', message: 'Пропущено обмеження.', suggestion: 'Поверніть уточнення.' }
  ] } }, ready: false });
  await generate();
  await $('checkResult').onclick();
  assert.equal($('downloadResult').disabled, true);
  assert.match($('detailIssues').children.map(item => item.textContent).join(' '), /Пропущено обмеження/);
  state.respond = async () => { throw new Error('failure'); }; await generate();
  assert.equal($('downloadResult').disabled, true);
  assert.match($('editorSummary').textContent, /потрібно покращити/);
});
test('late manual-check response cannot validate text edited during the request', async () => {
  const { $, generate } = await mount(); await generate();
  const pending = $('checkResult').onclick();
  $('resultTitle').value = 'Brand Brand'; $('resultTitle').listeners.input();
  await pending;
  assert.equal($('downloadResult').disabled, true);
  assert.match($('checkSummary').textContent, /Текст змінено/);
});

test('visible search results preserve selection and work by click, Enter and Escape', async () => {
  const { $ } = await mount();
  $('languageSearch').value = 'японська'; $('languageSearch').listeners.input();
  assert.equal($('languageResults').children.length, 1);
  assert.match($('languageResults').children[0].textContent, /ja/);
  assert.equal($('locale').value, 'pl'); assert.equal($('generate').disabled, false);
  $('languageResults').children[0].click();
  assert.equal($('locale').value, 'ja');
  assert.equal($('generate').disabled, false);
  assert.equal($('languageResults').hidden, true);
  assert.equal($('locale').children.length, 107);
  $('languageSearch').value = 'pt_BR'; $('languageSearch').listeners.input();
  $('languageSearch').listeners.keydown({ key: 'Enter', preventDefault() {} });
  assert.equal($('locale').value, 'pt-BR');
  $('languageSearch').value = 'Spanish'; $('languageSearch').listeners.input();
  assert.ok($('languageResults').children.length >= 8);
  $('languageSearch').listeners.keydown({ key: 'ArrowDown', preventDefault() {} });
  assert.equal($('languageResults').children[0].focused, true);
  $('languageSearch').value = 'not-a-language'; $('languageSearch').listeners.input();
  assert.equal($('languageResults').children.length, 0); assert.equal($('checkSource').disabled, false);
  assert.equal($('locale').value, 'pt-BR');
  $('languageSearch').listeners.keydown({ key: 'Escape' });
  assert.equal($('languageSearch').value, ''); assert.equal($('languageResults').hidden, true);
});

test('language search finds native, Ukrainian, Russian, English, accentless and reordered region names', async () => {
  const { matchingLanguages } = await mount();
  for (const [query, code] of [['японська', 'ja'], ['японский', 'ja'], ['Japanese', 'ja'], ['日本語', 'ja'],
    ['Spanish Mexico', 'es-MX'], ['Mexico Spanish', 'es-MX'], ['испанский Мексика', 'es-MX'],
    ['es_MX', 'es-MX'], ['  PT_br  ', 'pt-BR'], ['portugues brasil', 'pt-BR'], ['китайська', 'zh-CN']]) {
    assert.ok(matchingLanguages(LANGUAGES, query).some(item => item.code === code), query);
  }
  for (const language of LANGUAGES) {
    assert.equal(matchingLanguages(LANGUAGES, language.code)[0].code, language.code);
    assert.ok(matchingLanguages(LANGUAGES, language.label).some(item => item.code === language.code));
  }
});
test('copy full description has no wrapper; repairing uses the current result and its locale', async () => {
  const { $, state, generate } = await mount(); await generate();
  await $('copyFull').onclick(); assert.equal(state.copied, valid.fullDescription);
  $('locale').value = 'ja';
  $('resultFull').value = 'ogrody ogrody'; $('resultFull').listeners.input();
  assert.equal($('copyFull').disabled, true);
  state.respond = async body => {
    assert.equal(body.locale, 'pl'); assert.equal(body.mode, 'repair');
    assert.equal(body.fullDescription, 'ogrody ogrody');
    return { ...valid, checks: check(valid), ready: true, attempts: 1 };
  };
  await $('repairResult').onclick(); assert.equal($('copyFull').disabled, false);
});
test('check without AI catches Spanish function-word spam and disables export', async () => {
  const { $, state } = await mount();
  state.respond = () => assert.fail('Checking must not call AI');
  $('locale').value = 'es-MX'; $('sourceTitle').value = 'Prueba'; $('sourceShort').value = 'Planifica tu día';
  $('sourceFull').value = 'de de de el el el prueba';
  await $('checkSource').onclick();
  assert.equal($('resultFull').value, $('sourceFull').value);
  assert.equal($('downloadResult').disabled, true);
  assert.match($('checkMetrics').textContent, /Слів із перевищенням: 2/);
  assert.ok($('checkIssues').children.some(item => item.textContent.includes('«de» — 3 рази. Приберіть 2 зайві повтори.')));
  assert.ok($('detailIssues').children.some(item => item.textContent.includes('de ×3')));
});

test('switching profiles rechecks the same text without translation or stale export', async () => {
  const { $, state } = await mount();
  state.respond = () => assert.fail('Profile change must not invoke AI');
  $('locale').value = 'es-MX'; $('sourceFull').value = 'el la los las';
  await $('checkSource').onclick(); assert.equal($('copyFull').disabled, true);
  $('checkProfile').value = 'natural';
  const pending = $('checkProfile').listeners.change();
  assert.equal($('copyFull').disabled, true);
  await pending; assert.equal($('copyFull').disabled, false);
  assert.match($('editorSummary').textContent, /Перевірено основні слова/);
  assert.match($('checkMetrics').textContent, /За строгим порогом/);
});
test('report switches fields and views, searches forms and shows empty results', async () => {
  const { $ } = await mount();
  $('locale').value = 'es-MX'; $('sourceFull').value = 'el la los las símbolo símbolos';
  await $('checkSource').onclick();
  $('reportView').value = 'exact'; $('reportView').listeners.change();
  assert.equal($('frequencyBody').children.length, 6);
  $('reportSearch').value = 'simbolo'; $('reportSearch').listeners.input();
  assert.equal($('frequencyBody').children.length, 2);
  $('reportSearch').value = 'nonexistent'; $('reportSearch').listeners.input();
  assert.equal($('reportEmpty').hidden, false);
  $('reportSearch').value = ''; $('reportSearch').listeners.input();
  $('reportField').value = 'title'; $('reportField').listeners.change();
  assert.equal($('frequencyBody').children.length, 2);
  $('reportField').value = 'fullDescription'; $('reportField').listeners.change();
  $('reportView').value = 'sentences'; $('reportView').listeners.change();
  assert.equal($('reportEmpty').hidden, false);
});
test('manual changes invalidate AI editorial approval and repair retains the original source', async () => {
  const { $, state, generate } = await mount();
  state.respond = async () => ({ ...valid, checks: { ...check(valid), editor: { status: 'passed', issues: [] } }, ready: true, attempts: 1 });
  await generate(); assert.match($('editorSummary').textContent, /AI також перевірив/);
  $('sourceFull').value = 'Changed unrelated source';
  $('resultFull').value = 'Now edited'; $('resultFull').listeners.input();
  assert.equal($('editorSummary').textContent, '');
  state.respond = async body => {
    assert.equal(body.reference.fullDescription, valid.fullDescription);
    return { ...valid, checks: check(valid), ready: true, attempts: 1 };
  };
  await $('repairResult').onclick();
  assert.match($('editorSummary').textContent, /Перевірено лише повтори/);
});

test('large reports paginate without hiding search matches beyond the first page', async () => {
  const { $ } = await mount();
  $('sourceFull').value = Array.from({ length: 123 }, (_, i) => `unique${i}`).join(' ');
  await $('checkSource').onclick();
  assert.equal($('frequencyBody').children.length, 50);
  assert.equal($('reportMore').hidden, false);
  $('reportMore').onclick();
  assert.equal($('frequencyBody').children.length, 100);
  $('reportMore').onclick();
  assert.equal($('frequencyBody').children.length, 123);
  assert.equal($('reportMore').hidden, true);
  $('reportSearch').value = 'unique122'; $('reportSearch').listeners.input();
  assert.equal($('frequencyBody').children.length, 1);
  assert.match($('reportCount').textContent, /1 із 1/);
});

test('simple report limits visible advice but preserves every issue in details', async () => {
  const { $ } = await mount();
  $('sourceFull').value = 'alpha alpha beta beta gamma gamma delta delta epsilon epsilon';
  await $('checkSource').onclick();
  assert.equal($('checkIssues').children.length, 3);
  assert.equal($('moreIssues').hidden, false);
  assert.match($('moreIssues').textContent, /2/);
  const shortAdvice = $('checkIssues').children.map(item => item.textContent).join(' ');
  assert.doesNotMatch(shortAdvice, /%|щільність|профіль|словоформ/);
  assert.match($('detailIssues').children.map(item => item.textContent).join(' '), /epsilon/);
  assert.equal($('copyFull').disabled, true);
});

test('advanced report and settings are collapsed and main repair action precedes details', () => {
  const html = fs.readFileSync('public/localize.html', 'utf8');
  assert.match(html, /<details id="frequencyDetails"><summary>Деталі перевірки/);
  assert.match(html, /<details class="localization-settings"><summary>/);
  assert.ok(html.indexOf('id="repairResult"') < html.indexOf('id="frequencyDetails"'));
  assert.ok(html.indexOf('id="frequencyDetails"') < html.indexOf('id="checkMetrics"'));
  assert.equal((html.match(/id="repairResult"/g) || []).length, 1);
});

test('costly editorial review is opt-in and spending limits are visible before submitting', () => {
  const html = fs.readFileSync('public/localize.html', 'utf8');
  assert.doesNotMatch(html.match(/<input id="qualityReview"[^>]*>/)[0], /\bchecked\b/);
  assert.match(html, /до 2 AI-запитів/);
  assert.match(html, /платні запити/);
});

test('actual request and token usage is displayed; repetition-only checks cost no AI calls', async () => {
  const { $, state, generate } = await mount();
  state.respond = async body => {
    assert.equal(body.qualityReview, false);
    return { ...valid, checks: check(valid), ready: true, usage: { calls: 1, limit: 2, reportedCalls: 1, inputTokens: 500, outputTokens: 100 } };
  };
  await generate();
  assert.match($('usageStatus').textContent, /1 із максимум 2/);
  assert.match($('usageStatus').textContent, /500 вхідних \/ 100 вихідних/);
  await $('checkResult').onclick();
  assert.match($('usageStatus').textContent, /0 AI-запитів/);
});
