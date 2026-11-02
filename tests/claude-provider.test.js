const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');

// Never contact a paid provider or depend on a developer's real credentials.
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
// Pin the tested model so a developer's optional .env override cannot change it.
process.env.ANTHROPIC_MODEL = 'claude-sonnet-5-5';
const { app } = require('../server');
const actualFetch = global.fetch;
const text = Array.from({ length: 80 }, (_, i) => `detail${i}`).join(' ');
const usage = { input_tokens: 120, output_tokens: 35 };
const response = (value, stopReason = 'end_turn') => new Response(JSON.stringify({
  id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
  content: [{ type: 'thinking', thinking: '', signature: 'test' }, { type: 'text', text: value }],
  stop_reason: stopReason, stop_sequence: null, usage
}));

const scenarios = [
  ['/api/aso', { appName: 'Demo', description: 'An offline garden guide.', screenshots: [] },
    { short_description: 'Demo: Explore.', full_description: text }, 'fullDescription'],
  ['/api/fix-spam', { appName: 'Demo', text: 'orchard '.repeat(8) + text },
    { full_description: text }, 'fullDescription'],
  ['/api/localize', { locale: 'en-US', title: 'Demo', shortDescription: 'Explore gardens.', fullDescription: 'An offline garden guide.' },
    { title: 'Demo', shortDescription: 'Explore gardens.', fullDescription: text }, 'fullDescription']
];
for (const [route, payload, output, field] of scenarios) {
  test(`${route} sends Sonnet 5.5 compatible bounded requests through the real provider boundary`, async t => {
    const requests = [];
    t.mock.method(global, 'fetch', async (url, options) => {
      if (url !== 'https://api.anthropic.com/v1/messages') return actualFetch(url, options);
      requests.push(JSON.parse(options.body));
      return response(JSON.stringify(output));
    });
    const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    t.after(() => { server.closeAllConnections(); server.close(); });
    const result = await actualFetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    assert.equal(result.status, 200);
    assert.equal((await result.json())[field], output.full_description || output.fullDescription);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, 'claude-sonnet-5-5');
    assert.deepEqual(requests[0].thinking, { type: 'between_tools' });
    assert.equal(requests[0].max_tokens, 4000);
    assert.equal(requests[0].temperature, undefined);
    if (route !== '/api/localize') {
      const expectedProperties = route === '/api/aso'
        ? { short_description: { type: 'string' }, full_description: { type: 'string' } }
        : { full_description: { type: 'string' } };
      assert.deepEqual(requests[0].output_config?.format, {
        type: 'json_schema', schema: {
          type: 'object', properties: expectedProperties,
          required: Object.keys(expectedProperties), additionalProperties: false
        }
      });
    }
  });
}

test('health identifies the effective model without making a paid request', async t => {
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await actualFetch(`http://127.0.0.1:${server.address().port}/api/health`);
  const data = await result.json();
  assert.equal(data.model, 'claude-sonnet-5-5');
  assert.equal(data.ok, true);
  assert.equal(data.aiConfigured, true);
});

test('truncated provider output is rejected even when it happens to contain valid JSON; usage is retained', async t => {
  let recorded;
  t.mock.method(global, 'fetch', async () => response('{"title":"Incomplete draft"}', 'max_tokens'));
  await assert.rejects(app.locals.callClaude('A listing', { onUsage: value => { recorded = value; } }),
    error => error.code === 'output_limit');
  assert.deepEqual(recorded, usage);
});

test('ASO screenshot selection is included in the enforced provider schema', async t => {
  let request;
  t.mock.method(global, 'fetch', async (url, options) => {
    if (url !== 'https://api.anthropic.com/v1/messages') return actualFetch(url, options);
    request = JSON.parse(options.body);
    return response(JSON.stringify({ short_description: 'Demo: Explore.', full_description: text, selected: [9, 8, 7, 6, 5, 4, 3, 2] }));
  });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await actualFetch(`http://127.0.0.1:${server.address().port}/api/aso`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appName: 'Demo', description: 'A garden guide.', screenshots: Array.from({ length: 9 }, () => ({ data: 'fixture', mediaType: 'image/jpeg' })) })
  });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).selected, [8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(request.output_config?.format.schema.properties.selected, { type: 'array', items: { type: 'integer' } });
  assert.deepEqual(request.output_config?.format.schema.required, ['short_description', 'full_description', 'selected']);
});

test('provider diagnostics identify truncation without exposing listing text or credentials', async t => {
  const logs = [];
  t.mock.method(console, 'info', (...args) => logs.push(args));
  t.mock.method(global, 'fetch', async () => response('private listing content', 'max_tokens'));
  await assert.rejects(app.locals.callClaude('private prompt'), error => error.code === 'output_limit');
  const diagnostic = logs.find(args => args[0] === 'Claude response');
  assert.ok(diagnostic);
  assert.deepEqual(JSON.parse(diagnostic[1]), {
    model: 'claude-sonnet-5-5', stopReason: 'max_tokens',
    inputTokens: 120, outputTokens: 35, textChars: 23
  });
  assert.doesNotMatch(JSON.stringify(logs), /private|test-key/);
});

test('Localize reports a token-limit interruption without spending a second paid request', async t => {
  let calls = 0;
  t.mock.method(global, 'fetch', async (url, options) => {
    if (url !== 'https://api.anthropic.com/v1/messages') return actualFetch(url, options);
    calls++;
    return response('{"title":"Incomplete draft"}', 'max_tokens');
  });
  const server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const result = await actualFetch(`http://127.0.0.1:${server.address().port}/api/localize`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ locale: 'es-ES', title: 'Demo', shortDescription: 'Explore gardens.', fullDescription: 'An offline garden guide.' })
  });
  assert.equal(result.status, 502);
  assert.equal((await result.json()).code, 'output_limit');
  assert.equal(calls, 1);
});

test('explicit alternate model overrides remain supported without Sonnet 5.5-only settings', () => {
  const code = `const { app } = require('./server');
    console.info = () => {};
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      process.stdout.write(JSON.stringify({model:body.model, thinking:body.thinking}));
      return new Response(JSON.stringify({content:[{type:'text',text:'ok'}]}));
    };
    app.locals.callClaude('Test').catch(() => { process.exitCode = 1; });`;
  const result = execFileSync(process.execPath, ['-e', code], { cwd: process.cwd(), encoding: 'utf8',
    env: { ...process.env, ANTHROPIC_MODEL: 'claude-sonnet-4-5' } });
  assert.deepEqual(JSON.parse(result), { model: 'claude-sonnet-4-5' });
});
