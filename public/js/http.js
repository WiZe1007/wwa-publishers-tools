// Read the body once: hosts/proxies can return empty or HTML error pages.
// Never automatically retry a POST: an interrupted AI call may already be billed.
export async function requestJson(url, options = {}, { timeoutMs = 120000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {
      const message = response.status === 413
        ? 'Забагато даних у запиті. Зменште кількість скріншотів.'
        : response.status === 429
          ? 'Забагато запитів. Зачекайте хвилину та спробуйте ще раз.'
          : 'Сервер не повернув повну відповідь. Спробуйте пізніше. Ваші дані не змінено.';
      throw Object.assign(new Error(message), { code: text.trim() ? 'invalid_response' : 'empty_response', status: response.status });
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw Object.assign(new Error('Сервер повернув некоректну відповідь. Ваші дані не змінено.'), { code: 'invalid_response' });
    if (!response.ok) throw Object.assign(new Error(typeof data.error === 'string' ? data.error : 'Сервер тимчасово недоступний. Спробуйте пізніше.'),
      { code: data.code || 'server_error', status: response.status });
    return data;
  } catch (error) {
    if (controller.signal.aborted)
      throw Object.assign(new Error('Сервер не відповів вчасно. Спробуйте пізніше. Ваші дані не змінено.'), { code: 'timeout' });
    if (error instanceof TypeError)
      throw Object.assign(new Error('Не вдалося з’єднатися із сервером. Перевірте інтернет і спробуйте пізніше. Ваші дані не змінено.'), { code: 'network' });
    throw error;
  } finally { clearTimeout(timer); }
}
