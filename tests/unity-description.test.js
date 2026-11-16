const { test } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

const clean = Array.from({ length: 100 }, (_, i) => `detail${i}`).join(' ');
const repeated = 'orchard '.repeat(12) + clean;
const payload = { appName: 'Demo', description: 'A social casino with three reels, BAR symbols, virtual stakes and a SPIN button.',
  tone: 'tiktok_aso_unity', size: 'small', screenshots: [] };

async function fixture(t, outputs = [clean]) {
  const original = { callClaude: app.locals.callClaude, isAIConfigured: app.locals.isAIConfigured };
  const prompts = [];
  app.locals.isAIConfigured = () => true;
  app.locals.callClaude = async content => {
    prompts.push(content.find(block => block.type === 'text').text);
    return JSON.stringify({ short_description: 'Demo: Explore.', full_description: outputs[Math.min(prompts.length - 1, outputs.length - 1)] });
  };
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); Object.assign(app.locals, original); });
  return { prompts, post: async (path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
    return { status: response.status, data: await response.json() };
  } };
}

test('Unity generation selects its own Terms template without the older TikTok template', async t => {
  const { post, prompts } = await fixture(t);
  const { status, data } = await post('/api/aso', payload);
  assert.equal(status, 200);
  assert.match(prompts[0], /Terms and Conditions/);
  assert.match(prompts[0], /Success in social casino games does not guarantee future success in real-money gambling/);
  assert.doesNotMatch(prompts[0], /No in-app purchases are available/);
  assert.equal(prompts.length, 1);
  assert.equal(data.fullDescription, clean);
});

for (const tone of ['tiktok_aso_unity', 'tiktok_aso_unity_rich_html']) for (const confirmed of [true, false, undefined, 'true', 1]) {
  test(`${tone} RNG certification requires an explicit boolean confirmation (${String(confirmed)})`, async t => {
    const { post, prompts } = await fixture(t);
    const { status } = await post('/api/aso', { ...payload, tone, unityRngCertified: confirmed });
    assert.equal(status, 200);
    assert.match(prompts[0], confirmed === true ? /RNG certification: CONFIRMED/ : /RNG certification: NOT CONFIRMED/);
    assert.equal(prompts.length, 1);
  });
}

const richTone = 'tiktok_aso_unity_rich_html';
const richBody = `\n\n<b><font color="#0F766E">Features</font></b>\n<i>Explore your options.</i> <u>Saved progress.</u>\n${clean}\n\n<b>Terms and Conditions</b>\nFor users aged 18 and above. For entertainment purposes only.\nAll coins, credits and rewards are virtual, have no real-world monetary value, and cannot be withdrawn, exchanged for cash or redeemed for prizes of real-world value.\nSuccess in social casino games does not guarantee future success in real-money gambling.`;
const redIntro = '<b><font color="#D32F2F">Match the middle line. Choose your stake.</font></b>';

test('Unity Rich generation formats just two opening sentences and preserves the disclosure and body emphasis', async t => {
  const { post, prompts } = await fixture(t, ['Match the middle line. Choose your stake. Keep playing.' + richBody]);
  const { status, data } = await post('/api/aso', { ...payload, tone: richTone });
  assert.equal(status, 200);
  assert.equal(data.fullDescription, redIntro + ' Keep playing.' + richBody);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Terms and Conditions/);
  assert.match(prompts[0], /ASO RICH HTML/);
  assert.doesNotMatch(prompts[0], /plain text only, no HTML|Return plain text only: no HTML/);
});

for (const confirmed of [true, false]) for (const route of ['/api/aso', '/api/fix-spam']) {
  test(`Unity Rich ${route} repair keeps formatting and the certification policy (${confirmed})`, async t => {
    const fixed = 'Match the middle line. Choose your stake.' + richBody;
    const { post, prompts } = await fixture(t, route === '/api/aso' ? [repeated + richBody, fixed] : [fixed]);
    const { status, data } = await post(route, { ...payload, text: repeated + richBody, tone: richTone, unityRngCertified: confirmed });
    assert.equal(status, 200);
    assert.equal(data.fullDescription, redIntro + richBody);
    assert.equal(data.spamCheck.clean, true);
    assert.equal(prompts.length, route === '/api/aso' ? 2 : 1);
    const repairPrompt = prompts.at(-1);
    assert.match(repairPrompt, /ASO RICH HTML/);
    assert.match(repairPrompt, /Success in social casino games does not guarantee future success in real-money gambling/);
    assert.match(repairPrompt, confirmed ? /RNG certification: CONFIRMED/ : /RNG certification: NOT CONFIRMED/);
    assert.doesNotMatch(repairPrompt, /Return plain text only: no HTML|Real-money cash-outs are strictly blocked/);
  });
}

for (const confirmed of [true, false]) {
  test(`Unity automatic repetition repair retains the Terms and RNG policy (${confirmed})`, async t => {
    const { post, prompts } = await fixture(t, [repeated, clean]);
    const { status, data } = await post('/api/aso', { ...payload, unityRngCertified: confirmed });
    assert.equal(status, 200);
    assert.equal(prompts.length, 2);
    assert.equal(data.spamCheck.clean, true);
    assert.match(prompts[1], /Terms and Conditions/);
    assert.match(prompts[1], /Success in social casino games does not guarantee future success in real-money gambling/);
    assert.match(prompts[1], confirmed ? /RNG certification: CONFIRMED/ : /RNG certification: NOT CONFIRMED/);
    assert.doesNotMatch(prompts[1], /Real-money cash-outs are strictly blocked/);
  });
  test(`Unity manual repetition repair retains its own policy (${confirmed})`, async t => {
    const { post, prompts } = await fixture(t);
    const { status, data } = await post('/api/fix-spam', { text: repeated, tone: payload.tone, unityRngCertified: confirmed });
    assert.equal(status, 200);
    assert.equal(data.spamCheck.clean, true);
    assert.equal(prompts.length, 1);
    assert.match(prompts[0], /Terms and Conditions/);
    assert.match(prompts[0], confirmed ? /RNG certification: CONFIRMED/ : /RNG certification: NOT CONFIRMED/);
  });
}

test('Unity settings do not leak into another description style', async t => {
  const { post, prompts } = await fixture(t);
  const { status } = await post('/api/aso', { ...payload, tone: 'normal', unityRngCertified: true });
  assert.equal(status, 200);
  assert.doesNotMatch(prompts[0], /RNG certification:|Terms and Conditions/);
});

test('Unity generation returns plain copy when the provider unexpectedly adds HTML', async t => {
  const { post } = await fixture(t, [`<b>${clean}</b>`]);
  const { status, data } = await post('/api/aso', payload);
  assert.equal(status, 200);
  assert.equal(data.fullDescription, clean);
});

test('Unity repair of an earlier rich draft does not inherit red HTML instructions', async t => {
  const { post, prompts } = await fixture(t, [`<i>${clean}</i>`]);
  const { status, data } = await post('/api/fix-spam', {
    tone: payload.tone, text: `<b><font color="#D32F2F">${repeated}</font></b>`
  });
  assert.equal(status, 200);
  assert.doesNotMatch(prompts[0], /ASO RICH HTML/);
  assert.equal(data.fullDescription, clean);
});

test('Unity removes old rich formatting without charging for an otherwise clean draft', async t => {
  const { post, prompts } = await fixture(t);
  const { status, data } = await post('/api/fix-spam', { tone: payload.tone, text: `<b>${clean}</b>` });
  assert.equal(status, 200);
  assert.equal(data.fullDescription, clean);
  assert.equal(prompts.length, 0);
});
