const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { app } = require('../server');
const { createAiRequest } = require('../lib/ai-request');
const cleanText = Array.from({ length: 80 }, (_, i) => `detail${i}`).join(' ');
const spamText = 'orchard '.repeat(8) + cleanText;
const draft = { short_description: 'Demo: Explore.', full_description: cleanText };
const body = { appName: 'Demo', description: 'An offline garden guide.', tone: 'aso_pro', size: 'small', screenshots: [] };

async function fixture(t, callClaude) {
  const original = { callClaude: app.locals.callClaude, isAIConfigured: app.locals.isAIConfigured };
  app.locals.callClaude = callClaude; app.locals.isAIConfigured = () => true;
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); Object.assign(app.locals, original); });
  return async (path = '/api/aso', payload = body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof payload === 'string' ? payload : JSON.stringify(payload)
    });
    assert.match(response.headers.get('content-type'), /json/);
    return { status: response.status, data: await response.json() };
  };
}
test('ASO successful generation returns both fields and makes one provider call', async t => {
  let calls = 0;
  const post = await fixture(t, async (content, options) => { calls++; assert.ok(options.signal); return JSON.stringify(draft); });
  const { status, data } = await post();
  assert.equal(status, 200); assert.equal(calls, 1); assert.equal(data.usage.limit, 2);
  assert.equal(data.fullDescription, cleanText); assert.equal(data.shortDescription, draft.short_description);
});
for (const output of ['', '{"short_description":', '{}', 'null', '{"short_description":"Demo.","full_description":7}']) {
  test(`ASO rejects incomplete model data without an automatic paid retry: ${output || 'empty'}`, async t => {
    let calls = 0;
    const post = await fixture(t, async () => { calls++; return output; });
    const { status, data } = await post();
    assert.equal(status, 502); assert.equal(data.code, 'invalid_response'); assert.equal(calls, 1);
    assert.ok(data.error); assert.equal(data.fullDescription, undefined);
  });
}
for (const [error, status, code] of [
  [{ code: 'timeout' }, 504, 'timeout'], [{ status: 401 }, 503, 'configuration'],
  [{ status: 429 }, 429, 'rate_limit'], [{}, 502, 'provider_error']
]) test(`ASO failure ${code} returns safe structured JSON and stops`, async t => {
  let calls = 0;
  const post = await fixture(t, async () => { calls++; throw Object.assign(new Error('secret-provider-message'), error); });
  const response = await post();
  assert.equal(response.status, status); assert.equal(response.data.code, code); assert.equal(calls, 1);
  assert.doesNotMatch(response.data.error, /secret-provider-message/);
});
test('ASO repair timeout preserves the generated draft instead of losing the entire result', async t => {
  let calls = 0;
  const post = await fixture(t, async () => {
    if (++calls === 1) return JSON.stringify({ ...draft, full_description: spamText });
    throw Object.assign(new Error('deadline'), { code: 'timeout' });
  });
  const { status, data } = await post();
  assert.equal(status, 200); assert.equal(data.fullDescription, spamText);
  assert.equal(calls, 2); assert.equal(data.usage.calls, 2); assert.equal(data.spamCheck.clean, false);
  assert.match(data.warning, /Отриманий опис збережено/);
});
test('ASO auto repair stops at two total provider calls even when spam remains', async t => {
  let calls = 0;
  const post = await fixture(t, async () => { calls++; return JSON.stringify({ ...draft, full_description: spamText }); });
  const { status, data } = await post();
  assert.equal(status, 200); assert.equal(calls, 2); assert.equal(data.spamCheck.fixAttempts, 1);
  assert.equal(data.spamCheck.clean, false);
});
test('manual spam repair also stops at two calls and preserves its best text', async t => {
  let calls = 0;
  const post = await fixture(t, async () => { calls++; return JSON.stringify({ full_description: spamText }); });
  const { status, data } = await post('/api/fix-spam', { appName: 'Demo', text: spamText });
  assert.equal(status, 200); assert.equal(calls, 2); assert.equal(data.fullDescription, spamText);
  assert.equal(data.spamCheck.clean, false);
});
test('manual repair provider failure keeps the input and shows a warning', async t => {
  const post = await fixture(t, async () => { throw new TypeError('private network detail'); });
  const { status, data } = await post('/api/fix-spam', { text: spamText });
  assert.equal(status, 200); assert.equal(data.fullDescription, spamText);
  assert.match(data.warning, /Поточний опис збережено/); assert.doesNotMatch(data.warning, /private network detail/);
});
test('malformed HTTP JSON is rejected as JSON before invoking AI', async t => {
  const post = await fixture(t, () => assert.fail('Must not call AI'));
  const { status, data } = await post('/api/aso', '{"appName":');
  assert.equal(status, 400); assert.equal(data.code, 'invalid_json');
});
test('invalid screenshots are rejected before invoking AI', async t => {
  const post = await fixture(t, () => assert.fail('Must not call AI'));
  const { status } = await post('/api/aso', { ...body, screenshots: ['bad-image'] });
  assert.equal(status, 400);
});

test('real deadline returns JSON even when a provider ignores cancellation', async t => {
  const demo = express(); demo.use(express.json());
  let calls = 0, observedSignal;
  demo.post('/generate', createAiRequest({ timeoutMs: 10, callClaude: () => (content, { signal }) => {
    calls++; observedSignal = signal; return new Promise(() => {});
  } }), async (req, res) => {
    try { await req.ai.run('data'); } catch (error) { res.status(504).json({ code: error.code }); }
  });
  const server = await new Promise(resolve => { const instance = demo.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/generate`, { method: 'POST' });
  assert.equal(response.status, 504); assert.equal((await response.json()).code, 'timeout');
  assert.equal(observedSignal.aborted, true); assert.equal(calls, 1);
});

test('disconnect cancels provider work and releases the concurrency slot', async t => {
  const demo = express();
  let calls = 0, firstSignal, releaseStart, releaseClose;
  const started = new Promise(resolve => { releaseStart = resolve; });
  const closed = new Promise(resolve => { releaseClose = resolve; });
  demo.post('/generate', createAiRequest({ timeoutMs: 1000, maxActive: 1, callClaude: () => (content, { signal }) => {
    calls++;
    if (calls === 1) { firstSignal = signal; releaseStart(); return new Promise(() => {}); }
    return 'done';
  } }), async (req, res) => {
    res.once('close', releaseClose);
    try { const value = await req.ai.run('data'); res.json({ value }); }
    catch { if (!res.destroyed) res.status(504).json({ error: 'cancelled' }); }
  });
  const server = await new Promise(resolve => { const instance = demo.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/generate`, controller = new AbortController();
  const pending = fetch(url, { method: 'POST', signal: controller.signal }).catch(error => error);
  await started;
  const busy = await fetch(url, { method: 'POST' });
  assert.equal(busy.status, 429); assert.equal(calls, 1);
  controller.abort(); await pending; await closed;
  assert.equal(firstSignal.aborted, true);
  const next = await fetch(url, { method: 'POST' });
  assert.equal(next.status, 200); assert.equal((await next.json()).value, 'done'); assert.equal(calls, 2);
});
