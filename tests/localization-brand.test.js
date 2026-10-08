const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createBrandProtection } = require('../lib/localization-brand');
const { LANGUAGES, createChecker, createLocalizationRouter } = require('../lib/localization');
const { createRepairPlan, applyRepairPlan } = require('../lib/localization-repair');
const nativeWords = require('./fixtures/native-keywords');

const original = { locale: 'ar-EG', preserveTitle: true, title: 'Egypt : Global Casino',
  shortDescription: 'Global Casino: Classic Blackjack 21 with strategy and fun!',
  fullDescription: 'Discover Global Casino. Play Blackjack with virtual rewards, not real money.' };
const arabic = { locale: 'ar-EG', title: original.title, shortDescription: 'Global Casino: بلاك جاك',
  fullDescription: 'Global Casino يقدم ترفيهًا افتراضيًا بأوراق اللعب.' };
const check = createChecker();

async function fixture(t, callClaude) {
  const app = express(); app.use(express.json());
  app.use('/api/localize', createLocalizationRouter({ isConfigured: () => true, callClaude }));
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  return async (body, path = '') => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/localize${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  };
}

test('regional title protects the actual brand in both original descriptions', () => {
  const protection = createBrandProtection(original);
  assert.equal(protection.title, 'Egypt : Global Casino');
  assert.deepEqual(protection.names, ['Global Casino']);
  assert.deepEqual(protection.required, { shortDescription: ['Global Casino'], fullDescription: ['Global Casino'] });
  assert.deepEqual(protection.missing(arabic), []);
  const translated = { ...arabic, shortDescription: 'كازينو عالمي: بلاك جاك', fullDescription: 'يقدم كازينو عالمي ترفيهًا افتراضيًا.' };
  assert.deepEqual(protection.missing(translated), [
    { field: 'shortDescription', name: 'Global Casino' }, { field: 'fullDescription', name: 'Global Casino' }
  ]);
  assert.equal(check(translated, protection).clean, false);
});

test('names are masked before translation and restored before checking counts and lengths', () => {
  const protection = createBrandProtection(original), masked = protection.mask(original);
  assert.equal(masked.title, original.title);
  assert.ok(!masked.fullDescription.includes('Global Casino'));
  assert.deepEqual(protection.restore(masked), original);
  assert.deepEqual(check(protection.restore(masked), protection).lengths, check(original).lengths);
  assert.equal(JSON.stringify(protection.restore(masked)).includes(protection.contract.names[0].token), false);
});

test('a name absent from original copy is not forced into that field', () => {
  const source = { ...original, shortDescription: 'Classic Blackjack 21 with strategy and fun!' };
  const protection = createBrandProtection(source);
  assert.deepEqual(protection.required.shortDescription, []);
  assert.deepEqual(protection.missing({ ...arabic, shortDescription: 'بلاك جاك' }), []);
  assert.equal(createBrandProtection({ ...source, preserveTitle: false }), null);
});

test('complete titles, punctuation, Unicode, case and nested names survive mask/restore', () => {
  for (const title of ['Global Casino', 'Brand', 'WWA', 'Cat', 'C++', 'A.B (Pro)', 'Pokémon', '⚡ Focus', 'حديقة', 'ゲーム', 'Brand: Pro']) {
    const source = { ...original, title, shortDescription: `${title}: Play.`, fullDescription: `Discover ${title}.` };
    const protection = createBrandProtection(source);
    assert.deepEqual(protection.required.fullDescription, [title], title);
    assert.deepEqual(protection.restore(protection.mask(source)), source, title);
    assert.deepEqual(protection.missing(source), [], title);
  }
  const source = { ...original, title: 'Global Casino', shortDescription: 'GLOBAL CASINO: Play.' };
  const protection = createBrandProtection(source);
  assert.equal(protection.restore(protection.mask(source)).shortDescription, 'Global Casino: Play.');
  assert.ok(protection.missing(source).some(item => item.field === 'shortDescription'));
});

test('substring coincidences do not create protected brands; CJK and RTL joins do', () => {
  const source = { ...original, title: 'Cat', shortDescription: 'Catapult strategy', fullDescription: 'Category details.' };
  assert.deepEqual(createBrandProtection(source).names, []);
  const protection = createBrandProtection(original);
  for (const text of ['Global Casino让你享受游戏', 'وGlobal Casino يقدم ترفيهًا', '「Global Casino」で遊ぶ', 'Global Casinoเกม'])
    assert.deepEqual(protection.missing({ ...arabic, fullDescription: text }), [], text);
  assert.ok(protection.missing({ ...arabic, fullDescription: 'Global CasinoPlus' }).length);
});

test('last name cannot be lost during a surgical anti-spam repair', () => {
  const source = { ...original, locale: 'en-US', title: 'Brand', shortDescription: 'Brand: Play.',
    fullDescription: 'Brand offers coins coins coins for entertainment.' };
  const protection = createBrandProtection(source), checked = fields => check(fields, protection);
  const plan = createRepairPlan(source, checked(source));
  assert.ok(plan);
  const result = applyRepairPlan(source, plan, { replacements: [{ id: 's1', alternatives: [
    'Collect tokens during entertaining sessions.', 'Brand offers virtual tokens for entertainment.'
  ] }] }, checked);
  assert.equal(result.checks.clean, true);
  assert.equal(result.fields.fullDescription, 'Brand offers virtual tokens for entertainment.');
});

test('excess brand mentions may decrease, but the final original name remains', () => {
  const source = { ...original, locale: 'en-US', title: 'Brand', shortDescription: 'Brand: Play.',
    fullDescription: 'Brand Brand Brand offers coins for entertainment.' };
  const protection = createBrandProtection(source), checked = fields => check(fields, protection);
  const plan = createRepairPlan(source, checked(source));
  const result = applyRepairPlan(source, plan, { replacements: [{ id: 's1', alternatives: [
    'Brand offers coins for entertainment.'
  ] }] }, checked);
  assert.equal(result.checks.clean, true);
  assert.deepEqual(result.checks.brand.missing, []);
});

test('Arabic omission is detected and repaired instead of receiving ready:true', async t => {
  let calls = 0;
  const post = await fixture(t, async (content, { system }) => {
    const payload = JSON.parse(content);
    assert.match(system, /BRAND LOCK/);
    assert.equal(payload.protectedBrand.title, original.title);
    const token = payload.protectedBrand.names[0].token;
    assert.ok(payload.source.fullDescription.includes(token));
    if (!calls++) return JSON.stringify({ ...arabic, shortDescription: 'كازينو عالمي', fullDescription: 'كازينو عالمي يقدم ترفيهًا افتراضيًا.' });
    assert.deepEqual(payload.fieldsToRepair, ['shortDescription', 'fullDescription']);
    assert.ok(payload.issues.some(issue => issue.includes('Global Casino')));
    return JSON.stringify({ ...arabic, shortDescription: `${token}: بلاك جاك`, fullDescription: `${token} يقدم ترفيهًا افتراضيًا.` });
  });
  const { status, data } = await post(original);
  assert.equal(status, 200); assert.equal(data.ready, true, JSON.stringify(data.checks.issues));
  assert.equal(data.title, original.title); assert.ok(data.shortDescription.includes('Global Casino'));
  assert.ok(data.fullDescription.includes('Global Casino')); assert.equal(data.usage.calls, 2);
});

test('repeated Arabic brand failures stay blocked within the same two-call budget', async t => {
  const post = await fixture(t, async () => JSON.stringify({ ...arabic, shortDescription: 'كازينو عالمي', fullDescription: 'كازينو عالمي يقدم ترفيهًا افتراضيًا.' }));
  const { data } = await post(original);
  assert.equal(data.ready, false); assert.equal(data.checks.brand.missing.length, 2);
  assert.equal(data.usage.calls, 2); assert.equal(data.usage.limit, 2);
});

test('surgical API repair restores opaque names and rejects a cheaper name-deleting alternative', async t => {
  const source = { locale: 'en-US', title: 'Brand', shortDescription: 'Brand: Play.', preserveTitle: true, mode: 'repair',
    fullDescription: 'Brand offers coins coins coins for entertainment.' };
  const post = await fixture(t, async content => {
    const payload = JSON.parse(content), token = payload.protectedBrand.names[0].token;
    assert.ok(payload.repairPlan.sentences[0].text.includes(token));
    return JSON.stringify({ replacements: [{ id: 's1', alternatives: [
      'Collect tokens during entertaining sessions.', `${token} offers virtual tokens for entertainment.`
    ] }] });
  });
  const { data } = await post(source);
  assert.equal(data.ready, true, JSON.stringify(data.checks.issues));
  assert.equal(data.fullDescription, 'Brand offers virtual tokens for entertainment.');
  assert.equal(data.usage.calls, 1);
});

test('a full AI rewrite cannot win by losing an existing protected brand', async t => {
  const source = { locale: 'en-US', title: 'Brand', shortDescription: 'Brand: Play.', preserveTitle: true, mode: 'repair',
    fullDescription: 'Brand offers coins coins coins for entertainment.' };
  const post = await fixture(t, async () => JSON.stringify({ ...source, fullDescription: 'Collect tokens during entertaining sessions.' }));
  const { data } = await post(source);
  assert.equal(data.ready, false); assert.equal(data.fullDescription, source.fullDescription);
  assert.deepEqual(data.checks.brand.missing, []); assert.equal(data.usage.calls, 2);
});

test('repair of an already translated brand uses original reference, not the damaged title', async t => {
  const post = await fixture(t, async content => {
    const payload = JSON.parse(content), token = payload.protectedBrand.names[0].token;
    assert.equal(payload.protectedBrand.title, original.title);
    assert.deepEqual(payload.fieldsToRepair, ['title', 'shortDescription', 'fullDescription']);
    assert.ok(payload.originalReference.fullDescription.includes(token));
    return JSON.stringify({ title: 'مصر: كازينو عالمي', shortDescription: `${token}: بلاك جاك`, fullDescription: `${token} يقدم ترفيهًا افتراضيًا.` });
  });
  const { data } = await post({ ...arabic, title: 'مصر: كازينو عالمي', shortDescription: 'كازينو عالمي',
    fullDescription: 'كازينو عالمي يقدم ترفيهًا افتراضيًا.', preserveTitle: true, mode: 'repair', reference: original });
  assert.equal(data.ready, true, JSON.stringify(data.checks.issues)); assert.equal(data.title, original.title);
  assert.deepEqual(data.checks.brand.missing, []); assert.equal(data.usage.calls, 1);
});

test('free result checking cannot forget required brands after a manual edit', async t => {
  const post = await fixture(t, () => assert.fail('Brand checking must not use Claude'));
  const { data } = await post({ ...arabic, preserveTitle: true, reference: original,
    fullDescription: 'يقدم ترفيهًا افتراضيًا بأوراق اللعب.' }, '/check');
  assert.equal(data.clean, false);
  assert.deepEqual(data.brand.missing, [{ field: 'fullDescription', name: 'Global Casino' }]);
  const restored = await post({ ...arabic, preserveTitle: true, reference: original }, '/check');
  assert.equal(restored.data.clean, true);
});

test('repair refuses a protected original title over the store limit', async t => {
  const post = await fixture(t, () => assert.fail('Invalid input must not use Claude'));
  const { status } = await post({ ...arabic, preserveTitle: true, reference: { ...original, preserveTitle: false, title: 'A'.repeat(31) } });
  assert.equal(status, 400);
});

test('an overlong damaged title does not silently turn brand protection off', async t => {
  const post = await fixture(t, async content => {
    const payload = JSON.parse(content);
    assert.equal(payload.protectedBrand.title, original.title);
    return JSON.stringify(arabic);
  });
  const { data, status } = await post({ ...arabic, title: 'A'.repeat(31), preserveTitle: true, mode: 'repair', reference: original });
  assert.equal(status, 200); assert.equal(data.title, original.title); assert.equal(data.ready, true);
});

// Simulated model outputs test the token/API/checker contract, not linguistic
// quality. The same deterministic brand protection runs in all 107 locales.
for (const { code } of LANGUAGES) test(`original brand survives localized output and free checking: ${code}`, async t => {
  const native = nativeWords[code] || nativeWords[code.split('-')[0]];
  const post = await fixture(t, async content => {
    const payload = JSON.parse(content), token = payload.protectedBrand.names[0].token;
    return JSON.stringify({ title: native, shortDescription: `${token}: ${native}`, fullDescription: `${native} ${token}.` });
  });
  const { data } = await post({ ...original, locale: code });
  assert.equal(data.ready, true, JSON.stringify(data.checks.issues));
  assert.equal(data.title, original.title); assert.equal(data.usage.calls, 1);
  assert.ok(data.shortDescription.includes('Global Casino')); assert.ok(data.fullDescription.includes('Global Casino'));
  assert.deepEqual(data.checks.brand.missing, []);
  assert.equal((await post({ ...data, preserveTitle: true, reference: original }, '/check')).data.clean, true);
});
