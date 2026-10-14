const { randomUUID } = require('node:crypto');

const messages = {
  timeout: 'AI не встиг відповісти. Спробуйте пізніше. Ваші дані не змінено.',
  call_budget: 'Ліміт AI-запитів цієї спроби досягнуто. Додаткових автоматичних витрат не буде.',
  invalid_response: 'AI повернув неповну відповідь. Спробуйте ще раз.',
  configuration: 'AI тимчасово недоступний. Адміністратору потрібно перевірити налаштування сервера.',
  rate_limit: 'AI зараз перевантажений. Зачекайте хвилину та спробуйте ще раз.',
  provider_error: 'Не вдалося отримати відповідь AI. Спробуйте пізніше.'
};
function aiFailure(error) {
  const code = messages[error.code] ? error.code
    : [401, 403, 404].includes(error.status) ? 'configuration'
      : error.status === 429 ? 'rate_limit'
        : error instanceof SyntaxError ? 'invalid_response' : 'provider_error';
  return { code, error: messages[code], status: code === 'timeout' ? 504
    : code === 'configuration' ? 503 : code === 'rate_limit' ? 429 : 502 };
}

function createAiRequest({ callClaude, timeoutMs = 90000, maxCalls = 2, maxActive = 2 } = {}) {
  let active = 0;
  return (req, res, next) => {
    if (active >= maxActive) return res.status(429).json({ code: 'busy', error: 'Сервіс зайнятий. Спробуйте за хвилину.' });
    active++;
    const started = Date.now(), id = res.getHeader('X-Request-Id') || randomUUID(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(Object.assign(new Error('AI deadline exceeded'), { code: 'timeout' })), timeoutMs);
    const context = { calls: 0, limit: maxCalls, signal: controller.signal, code: 'ok',
      async run(content, options = {}) {
        if (controller.signal.aborted) throw controller.signal.reason;
        if (context.calls >= maxCalls) throw Object.assign(new Error('AI call budget exceeded'), { code: 'call_budget' });
        context.calls++;
        console.info('AI call started', JSON.stringify({ id, call: context.calls }));
        let onAbort;
        const cancelled = new Promise((resolve, reject) => {
          onAbort = () => reject(controller.signal.reason);
          controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
          // The race also bounds faulty/mock providers that ignore AbortSignal.
          return await Promise.race([Promise.resolve().then(() => {
            controller.signal.throwIfAborted();
            return callClaude(req)(content, { ...options, signal: controller.signal });
          }), cancelled]);
        } finally { controller.signal.removeEventListener('abort', onAbort); }
      }
    };
    let finished = false;
    function cleanup() {
      if (finished) return;
      finished = true; clearTimeout(timer); active--;
      if (!res.writableFinished) controller.abort(Object.assign(new Error('Client disconnected'), { code: 'disconnected' }));
      // Deliberately exclude descriptions, screenshots, names and credentials.
      console.info('AI request', JSON.stringify({ id, route: req.route?.path, status: res.statusCode,
        code: res.writableFinished ? context.code : 'disconnected', calls: context.calls, durationMs: Date.now() - started }));
    }
    res.setHeader('X-Request-Id', id);
    res.once('finish', cleanup); res.once('close', cleanup);
    req.ai = context;
    next();
  };
}
module.exports = { createAiRequest, aiFailure };
