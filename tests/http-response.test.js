const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

async function helper(fetch, name = 'requestJson') {
  const context = vm.createContext({ fetch, AbortController, setTimeout, clearTimeout, TypeError });
  const module = new vm.SourceTextModule(fs.readFileSync('public/js/http.js', 'utf8'), { context });
  await module.link(() => {}); await module.evaluate();
  return module.namespace[name];
}
for (const [body, status] of [['', 200], ['', 502], ['<html>Bad Gateway</html>', 502], ['{"error":', 504], ['null', 200], ['[]', 200]]) {
  test(`HTTP response ${status} / ${body || 'empty'} gives a readable error, not a JSON exception`, async () => {
    let calls = 0;
    const request = await helper(async () => { calls++; return new Response(body, { status }); });
    await assert.rejects(request('/api/aso', { method: 'POST' }), error => {
      assert.match(error.message, /Сервер/);
      assert.doesNotMatch(error.message, /Unexpected|JSON|<html>/);
      return true;
    });
    assert.equal(calls, 1, 'Paid POST must not automatically retry');
  });
}
test('JSON API errors keep their safe explanation and status', async () => {
  const request = await helper(async () => new Response(JSON.stringify({ code: 'timeout', error: 'AI не встиг відповісти.' }), { status: 504 }));
  await assert.rejects(request('/api/aso'), error => error.status === 504 && error.code === 'timeout' && error.message === 'AI не встиг відповісти.');
});
for (const status of [413, 429]) test(`non-JSON ${status} has a specific explanation`, async () => {
  const request = await helper(async () => new Response('', { status }));
  await assert.rejects(request('/api/aso'), status === 413 ? /Забагато даних/ : /Забагато запитів/);
});
test('network failures are translated without exposing runtime details', async () => {
  const request = await helper(async () => { throw new TypeError('Failed to fetch'); });
  await assert.rejects(request('/api/aso'), error => error.code === 'network' && /з’єднатися/.test(error.message));
});
test('deadline aborts the request and performs no retries', async () => {
  let calls = 0, signal;
  const request = await helper((url, options) => {
    calls++; signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  });
  await assert.rejects(request('/api/aso', {}, { timeoutMs: 10 }), error => error.code === 'timeout');
  assert.equal(calls, 1); assert.equal(signal.aborted, true);
});
test('successful response returns data with the existing request body intact', async () => {
  const request = await helper(async (url, options) => {
    assert.equal(url, '/api/aso'); assert.equal(options.method, 'POST'); assert.equal(options.body, '{"appName":"Demo"}');
    return new Response('{"shortDescription":"Demo: Focus.","fullDescription":"Choose tasks."}');
  });
  const result = await request('/api/aso', { method: 'POST', body: '{"appName":"Demo"}' });
  assert.equal(result.shortDescription, 'Demo: Focus.');
});

test('AI readiness uses a no-cache free health request, not the paid endpoint', async () => {
  let calls = 0;
  const ready = await helper(async (url, options) => {
    calls++; assert.equal(url, '/api/health'); assert.equal(options.cache, 'no-store'); assert.equal(options.body, undefined);
    return new Response('{"ok":true,"aiConfigured":true}');
  }, 'ensureAIReady');
  await ready(); assert.equal(calls, 1);
});
for (const body of ['', '{"ok":false}', '{"ok":true,"aiConfigured":false}']) {
  test(`unready host stops before any AI call: ${body || 'empty'}`, async () => {
    const ready = await helper(async url => {
      assert.equal(url, '/api/health'); return new Response(body);
    }, 'ensureAIReady');
    await assert.rejects(ready(), /AI-запит не надсилався/);
  });
}
test('cold-start timeout has its own deadline and performs no paid POST', async () => {
  const ready = await helper((url, { signal }) => {
    assert.equal(url, '/api/health');
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  }, 'ensureAIReady');
  await assert.rejects(ready({ timeoutMs: 10 }), error => error.code === 'server_unavailable');
});
