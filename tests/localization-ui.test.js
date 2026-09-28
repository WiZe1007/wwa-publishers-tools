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
  assert.match($('checkSummary').textContent, /Потрібні правки/);
  $('resultFull').value = valid.fullDescription; $('resultFull').listeners.input();
  await $('checkResult').onclick(); assert.equal($('downloadResult').disabled, false);
});
test('failure preserves previous text without claiming it is newly verified', async () => {
  const { $, state, generate } = await mount(); await generate();
  state.respond = async () => { throw new Error('AI unavailable'); }; await generate();
  assert.equal($('resultFull').value, valid.fullDescription);
  assert.equal($('downloadResult').disabled, true);
  assert.equal($('sourceFields').disabled, false);
  assert.match($('generationStatus').textContent, /некоректну відповідь/);
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
  assert.ok($('checkIssues').children.some(item => item.textContent.includes('de ×3')));
});
