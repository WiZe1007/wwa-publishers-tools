const fields = ['title', 'shortDescription', 'fullDescription'];
const sourceIds = ['sourceTitle', 'sourceShort', 'sourceFull'];
const resultIds = ['resultTitle', 'resultShort', 'resultFull'];
const countIds = ['titleCount', 'shortCount', 'fullCount'];
const limits = [30, 80, 4000];

export function mount(root) {
  const $ = id => root.querySelector('#' + id);
  let languages = [], controller, busy = false, hasResult = false;
  let resultLocale = '', checkedSnapshot = '', sourceSnapshot = '';
  let checkVersion = 0;
  const values = ids => Object.fromEntries(fields.map((field, index) => [field, $(ids[index]).value.trim()]));
  const source = () => ({ ...values(sourceIds), locale: $('locale').value, preserveTitle: $('preserveTitle').checked });
  const result = () => ({ ...values(resultIds), locale: resultLocale });
  const snapshot = () => JSON.stringify(result());

  async function request(path, body, signal) {
    const response = await fetch('/api/localize' + path, { ...(body ? { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal });
    let data;
    try { data = await response.json(); }
    catch (error) {
      if (error.name === 'AbortError') throw error;
      throw new Error('Сервер повернув некоректну відповідь. Спробуйте ще раз.');
    }
    if (!response.ok) throw new Error(data.error || 'Не вдалося виконати запит.');
    return data;
  }
  function buttons() {
    $('sourceFields').disabled = busy;
    $('resultFields').disabled = busy || !hasResult;
    $('generate').disabled = busy || !languages.length;
    $('cancelGeneration').hidden = !busy;
    $('checkResult').disabled = busy || !hasResult;
    const ready = !busy && hasResult && checkedSnapshot === snapshot();
    $('copyResult').disabled = !ready;
    $('downloadResult').disabled = !ready;
    $('resultPanel').setAttribute('aria-busy', String(busy));
  }
  function counters() {
    resultIds.forEach((id, index) => {
      const count = Array.from($(id).value.trim()).length;
      $(countIds[index]).textContent = `${count} / ${limits[index]}`;
      $(countIds[index]).classList.toggle('over-limit', count > limits[index]);
      $(id).setAttribute('aria-invalid', String(count > limits[index]));
    });
  }
  function stale(message) {
    checkVersion++;
    checkedSnapshot = '';
    $('checkReport').hidden = !hasResult;
    $('checkReport').dataset.state = 'warning';
    $('checkSummary').textContent = message;
    $('checkIssues').replaceChildren();
    $('frequencyDetails').hidden = true;
    $('resultStatus').textContent = '';
    buttons();
  }
  function renderCheck(checks) {
    checkedSnapshot = checks.clean ? snapshot() : '';
    $('checkReport').hidden = false;
    $('checkReport').dataset.state = checks.clean ? 'clean' : 'warning';
    $('checkSummary').textContent = checks.clean
      ? '✓ Ліміти дотримано. Надмірних повторів за правилами перевірки не знайдено.'
      : 'Потрібні правки: результат ще не пройшов перевірку.';
    $('checkIssues').replaceChildren(...checks.issues.map(issue => {
      const li = document.createElement('li'); li.textContent = issue; return li;
    }));
    $('frequencyDetails').hidden = false;
    const analysis = checks.analyses.fullDescription;
    $('frequencyBody').replaceChildren(...analysis.frequency.map(item => {
      const tr = document.createElement('tr');
      tr.dataset.spam = String(item.count > analysis.maxAllowed);
      for (const value of [item.word, item.count, item.density + '%']) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      return tr;
    }));
    counters(); buttons();
  }
  for (const id of resultIds) $(id).addEventListener('input', () => {
    counters(); stale('Текст змінено. Натисніть «Перевірити правки» перед копіюванням або завантаженням.');
  });
  $('sourceFields').addEventListener('input', () => {
    if (hasResult && JSON.stringify(source()) !== sourceSnapshot)
      $('generationStatus').textContent = 'Джерело або мову змінено. Натисніть «Адаптувати та перевірити», щоб створити новий варіант. Поточний результат належить попередньому запиту.';
  });
  $('localizeForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (busy) return;
    const payload = source();
    const currentSource = JSON.stringify(payload);
    busy = true; controller = new AbortController();
    stale('Очікування нового результату…');
    $('generationStatus').textContent = 'Адаптуємо тексти й перевіряємо повтори. За потреби AI виконає додаткові правки — це може зайняти до 2,5 хвилин.';
    try {
      const data = await request('', payload, controller.signal);
      resultLocale = data.locale;
      sourceSnapshot = currentSource;
      const language = languages.find(item => item.code === resultLocale);
      resultIds.forEach((id, index) => {
        $(id).value = data[fields[index]];
        $(id).lang = resultLocale;
        $(id).dir = language?.dir || 'auto';
      });
      hasResult = true;
      $('resultEmpty').hidden = true;
      $('resultLocale').textContent = language?.label || resultLocale;
      renderCheck(data.checks);
      $('generationStatus').textContent = data.ready
        ? `Адаптовано: ${language?.label || resultLocale}. Спроб: ${data.attempts}. Перегляньте переклад перед публікацією.`
        : `Після ${data.attempts} спроб залишились зауваження. Відредагуйте результат за звітом нижче та перевірте правки.`;
    } catch (error) {
      $('generationStatus').textContent = error.name === 'AbortError' ? 'Запит скасовано.' : error.message;
      if (hasResult) stale('Новий результат не отримано. Попередній текст збережено; перевірте його перед експортом.');
    } finally { busy = false; controller = null; buttons(); }
  });
  $('cancelGeneration').onclick = () => controller?.abort();
  $('checkResult').onclick = async () => {
    const version = ++checkVersion;
    const data = result();
    $('checkResult').disabled = true;
    checkedSnapshot = ''; buttons(); $('checkResult').disabled = true;
    $('resultStatus').textContent = 'Перевіряємо правки…';
    try {
      const checks = await request('/check', data);
      if (version !== checkVersion) return;
      renderCheck(checks);
      $('resultStatus').textContent = '';
    } catch (error) { if (version === checkVersion) $('resultStatus').textContent = error.message; }
    finally { if (version === checkVersion) buttons(); }
  };
  const exportText = () => {
    const data = result();
    return `Language: ${resultLocale}\n\nTitle\n${data.title}\n\nShort description\n${data.shortDescription}\n\nFull description\n${data.fullDescription}\n`;
  };
  $('copyResult').onclick = async () => {
    if (busy || checkedSnapshot !== snapshot()) return;
    try { await navigator.clipboard.writeText(exportText()); $('resultStatus').textContent = 'Скопійовано всі три поля.'; }
    catch { $('resultStatus').textContent = 'Браузер не дозволив копіювання. Виділіть текст вручну або завантажте .txt.'; }
  };
  $('downloadResult').onclick = () => {
    if (busy || checkedSnapshot !== snapshot()) return;
    const url = URL.createObjectURL(new Blob([exportText()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `aso-${resultLocale}.txt`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    $('resultStatus').textContent = 'Файл підготовлено до завантаження.';
  };
  request('/languages').then(data => {
    languages = data.languages;
    $('locale').replaceChildren(...languages.map(language => {
      const option = document.createElement('option'); option.value = language.code; option.textContent = language.label; return option;
    }));
    $('locale').disabled = false;
    $('generationStatus').textContent = 'Готово до адаптації. Оберіть мову та заповніть усі три поля.';
    buttons();
  }).catch(error => { $('generationStatus').textContent = error.message + ' Оновіть сторінку, щоб повторити.'; });
}
