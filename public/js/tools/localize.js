const fields = ['title', 'shortDescription', 'fullDescription'];
const sourceIds = ['sourceTitle', 'sourceShort', 'sourceFull'];
const resultIds = ['resultTitle', 'resultShort', 'resultFull'];
const countIds = ['titleCount', 'shortCount', 'fullCount'];
const limits = [30, 80, 4000];
const fieldNames = { title: 'Назва', shortDescription: 'Короткий опис', fullDescription: 'Повний опис' };
const plural = (count, one, few, many) => count % 100 >= 11 && count % 100 <= 14 ? many : count % 10 === 1 ? one : count % 10 >= 2 && count % 10 <= 4 ? few : many;

// Plain-language actions for the main view; the complete report stays in details.
export function simpleFixes(checks) {
  const fixes = [];
  for (const field of fields) {
    const label = fieldNames[field], analysis = checks.analyses[field];
    if (!checks.lengths[field]) fixes.push(`${label}: додайте текст.`);
    else if (checks.lengths[field] > checks.limits[field]) fixes.push(`${label}: скоротіть на ${checks.lengths[field] - checks.limits[field]} символів.`);
    for (const item of analysis.spam) fixes.push(`${label}: «${item.word}»${item.forms?.length > 1 ? ' та його форми' : ''} — ${item.count} ${plural(item.count, 'раз', 'рази', 'разів')}. Приберіть ${item.removeCount} ${plural(item.removeCount, 'зайвий повтор', 'зайві повтори', 'зайвих повторів')}.`);
    for (const item of analysis.sentences || []) fixes.push(`${label}: речення «${item.text.length > 100 ? item.text.slice(0, 100) + '…' : item.text}» повторюється. Залиште один раз.`);
    for (const item of analysis.phrases || []) if (item.excessive) fixes.push(`${label}: фраза «${item.text}» повторюється ${item.count} ${plural(item.count, 'раз', 'рази', 'разів')}. Перефразуйте частину речень.`);
    if (checks.editor?.issues.some(item => item.field === field)) fixes.push(`${label}: AI знайшов неточності в мові або змісті. Натисніть «Виправити з AI» або перегляньте деталі.`);
  }
  if (checks.issues.some(issue => issue.includes('письма'))) fixes.push('Повний опис написано не обраною мовою. Перекладіть його ще раз.');
  if (!checks.clean && !fixes.length) fixes.push('Перевірку не завершено. Спробуйте ще раз — ваш текст збережено.');
  return fixes;
}
export function matchingLanguages(languages, query) {
  const normalize = text => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[_()\-]/g, ' ');
  const tokens = normalize(query.trim()).split(/\s+/).filter(Boolean);
  return languages.filter(language => {
    const haystack = normalize(`${language.label} ${language.searchLabel || ''} ${language.code}`);
    return tokens.every(token => haystack.includes(token));
  }).sort((a, b) => Number(normalize(b.code) === normalize(query.trim())) - Number(normalize(a.code) === normalize(query.trim())));
}

export function mount(root) {
  const $ = id => root.querySelector('#' + id);
  let languages = [], controller, busy = false, hasResult = false;
  let resultLocale = '', checkedSnapshot = '', sourceSnapshot = '';
  let selectedLocale = 'en-US';
  let checkVersion = 0;
  let lastChecks = null;
  let referenceSource = null;
  let reportLimit = 50;
  const profile = () => $('checkProfile').value || 'strict';
  const values = ids => Object.fromEntries(fields.map((field, index) => [field, $(ids[index]).value.trim()]));
  const source = () => ({ ...values(sourceIds), locale: $('locale').value, profile: profile(), qualityReview: $('qualityReview').checked, preserveTitle: $('preserveTitle').checked });
  const result = () => ({ ...values(resultIds), locale: resultLocale, profile: profile() });
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
    $('checkProfile').disabled = busy;
    $('resultFields').disabled = busy || !hasResult;
    $('generate').disabled = busy || !languages.length || !$('locale').value;
    $('checkSource').disabled = busy || !languages.length || !$('locale').value;
    $('cancelGeneration').hidden = !busy;
    $('checkResult').disabled = busy || !hasResult;
    $('repairResult').disabled = busy || !hasResult;
    const ready = !busy && hasResult && checkedSnapshot === snapshot();
    $('copyResult').disabled = !ready;
    $('downloadResult').disabled = !ready;
    $('copyFull').disabled = !ready;
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
    $('checkMetrics').textContent = '';
    lastChecks = null;
    $('editorSummary').textContent = '';
    $('moreIssues').hidden = true;
    $('adviceDetails').hidden = true;
    $('frequencyDetails').hidden = true;
    $('resultStatus').textContent = '';
    buttons();
  }
  function renderCheck(checks) {
    lastChecks = checks;
    reportLimit = 50;
    checkedSnapshot = checks.clean ? snapshot() : '';
    $('checkReport').hidden = false;
    $('checkReport').dataset.state = checks.clean ? 'clean' : 'warning';
    const fixes = simpleFixes(checks);
    $('checkSummary').textContent = checks.clean ? '✓ Зайвих повторів не знайдено'
      : Object.values(checks.analyses).some(item => item.spam.length || item.sentences?.length || item.phrases?.some(phrase => phrase.excessive))
        ? 'Є зайві повтори' : 'Потрібні правки';
    $('checkIssues').replaceChildren(...fixes.slice(0, 3).map(issue => {
      const li = document.createElement('li'); li.textContent = issue; return li;
    }));
    $('checkIssues').hidden = !fixes.length;
    $('moreIssues').hidden = fixes.length <= 3;
    $('moreIssues').textContent = `Ще зауважень: ${fixes.length - 3}. Усі — у деталях нижче.`;
    $('detailIssues').replaceChildren(...checks.issues.map(issue => {
      const li = document.createElement('li'); li.textContent = issue; return li;
    }));
    $('editorSummary').textContent = (checks.profile === 'natural' ? 'Перевірено основні слова. ' : '') +
      (checks.editor?.status === 'passed' ? 'AI також перевірив мову та зміст.'
      : checks.editor?.status === 'needs_revision' ? 'Мову або зміст також потрібно покращити.'
      : checks.editor?.status === 'unavailable' ? 'AI-перевірка мови не завершилась. Можна спробувати ще раз.'
      : 'Перевірено лише повтори, не якість перекладу.') + (checks.warnings?.length ? ' Додаткові поради — у деталях.' : '');
    $('repairResult').textContent = checks.clean ? 'Покращити з AI' : 'Виправити з AI';
    $('adviceDetails').hidden = !checks.warnings?.length;
    $('checkAdvice').replaceChildren(...(checks.warnings || []).map(message => { const li = document.createElement('li'); li.textContent = message; return li; }));
    renderAnalysis();
    counters(); buttons();
  }
  function renderAnalysis() {
    if (!lastChecks) return;
    $('frequencyDetails').hidden = false;
    const field = $('reportField').value || 'fullDescription', view = $('reportView').value || 'families';
    const analysis = lastChecks.analyses[field];
    const strictCount = analysis.frequency.filter(item => item.count > Math.max(1, Math.floor(analysis.totalWords * .025))).length;
    $('checkMetrics').textContent = `Слів: ${analysis.totalWords}. ${field === 'fullDescription' ? `Поріг профілю: ${lastChecks.densityLimit}%.` : 'Коротке поле: перевірка дублікатів змістових слів.'} Максимум на групу форм: ${analysis.maxAllowed}. Слів із перевищенням: ${analysis.spam.length}. ${analysis.grouping === 'stemmed' ? 'Групування словоформ увімкнено.' : 'Для цієї мови — точні форми.'}${field === 'fullDescription' && lastChecks.profile === 'natural' ? ` За строгим порогом усіх слів: ${strictCount} груп із перевищенням (інший профіль).` : ''}`;
    const rows = view === 'exact' ? analysis.exactFrequency : view === 'phrases' ? analysis.phrases : view === 'sentences' ? analysis.sentences : analysis.frequency;
    $('reportTermHeading').textContent = view === 'phrases' ? 'Фраза' : view === 'sentences' ? 'Речення' : view === 'exact' ? 'Точне слово' : 'Слово / форми';
    $('reportDensityHeading').textContent = view === 'phrases' ? 'Покриття' : 'Частка';
    $('reportActionHeading').textContent = view === 'sentences' ? 'Зайві копії' : 'Зменшити на';
    const normalize = value => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const query = normalize($('reportSearch').value.trim());
    const filtered = (rows || []).map(item => {
      const groupedIssue = analysis.spam.find(spam => view === 'exact' ? spam.forms.some(form => form.word === item.word) : spam.word === item.word);
      const issue = view === 'sentences' || (view === 'phrases' ? item.excessive : Boolean(groupedIssue));
      const name = item.text || (item.forms?.length > 1 ? `${item.word} (${item.forms.map(form => `${form.word} ×${form.count}`).join(', ')})` : item.word);
      return { item, issue, name, groupedIssue };
    }).filter(row => (!$('onlyIssues').checked || row.issue) && normalize(row.name).includes(query));
    $('reportEmpty').hidden = Boolean(filtered.length);
    $('reportCount').textContent = `Показано ${Math.min(reportLimit, filtered.length)} із ${filtered.length}. Пошук охоплює весь звіт.`;
    $('reportMore').hidden = reportLimit >= filtered.length;
    $('frequencyBody').replaceChildren(...filtered.slice(0, reportLimit).map(({ item, issue, name, groupedIssue }) => {
      const tr = document.createElement('tr');
      tr.dataset.spam = String(issue);
      const type = view === 'sentences' ? 'Дублікат' : view === 'phrases' ? (issue ? 'Частий шаблон' : 'Рекомендація') : item.kind === 'function' ? 'Службове' : item.kind === 'unknown' ? 'Не класифіковано' : 'Змістове';
      const reduction = view === 'sentences' ? item.count - 1 : view === 'phrases' ? (issue ? 'Перефразувати' : '—') : groupedIssue ? (view === 'exact' && item.count <= analysis.maxAllowed ? 'У групі ↑' : groupedIssue.removeCount) : '—';
      for (const value of [name, item.count, view === 'sentences' ? '—' : (item.coverage ?? item.density) + '%', type, reduction]) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      return tr;
    }));
  }
  const resetReport = () => { reportLimit = 50; renderAnalysis(); };
  for (const id of ['reportField', 'reportView', 'onlyIssues']) $(id).addEventListener('change', resetReport);
  $('reportSearch').addEventListener('input', resetReport);
  $('reportMore').onclick = () => { reportLimit += 50; renderAnalysis(); };
  for (const id of resultIds) $(id).addEventListener('input', () => {
    counters(); stale('Текст змінено. Натисніть «Перевірити ще раз».');
  });
  $('sourceFields').addEventListener('input', () => {
    if (hasResult && JSON.stringify(source()) !== sourceSnapshot)
      $('generationStatus').textContent = 'Ви змінили текст або мову. Натисніть «Перекласти та перевірити», щоб оновити результат.';
  });
  async function generate(repair = false) {
    if (busy) return;
    const payload = repair ? { ...result(), mode: 'repair',
      qualityReview: $('qualityReview').checked,
      ...(referenceSource ? { reference: referenceSource } : {}),
      preserveTitle: $('preserveTitle').checked && Array.from(result().title).length <= limits[0] } : source();
    const currentSource = JSON.stringify(source());
    busy = true; controller = new AbortController();
    stale('Очікування нового результату…');
    $('generationStatus').textContent = repair ? 'Виправляємо текст… Це може зайняти до 2,5 хвилин.' : 'Перекладаємо й перевіряємо… Це може зайняти до 2,5 хвилин.';
    try {
      const data = await request('', payload, controller.signal);
      resultLocale = data.locale;
      if (!repair) { sourceSnapshot = currentSource; referenceSource = payload; }
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
      $('generationStatus').textContent = data.warning ? 'Не всі правки завершено. Отриманий текст збережено праворуч.' : (data.ready
        ? `Готово: ${language?.label || resultLocale}. Результат — праворуч.`
        : 'Текст готовий, але потребує правок. Підказки — під результатом.');
    } catch (error) {
      $('generationStatus').textContent = error.name === 'AbortError' ? 'Запит скасовано.' : error.message;
      if (hasResult) stale('Новий результат не отримано. Попередній текст збережено; перевірте його перед експортом.');
    } finally { busy = false; controller = null; buttons(); }
  }
  $('localizeForm').addEventListener('submit', event => { event.preventDefault(); return generate(); });
  $('repairResult').onclick = () => hasResult && generate(true);
  $('cancelGeneration').onclick = () => controller?.abort();
  $('checkSource').onclick = async () => {
    if (busy || !$('localizeForm').reportValidity()) return;
    const payload = source();
    busy = true; controller = new AbortController(); stale('Перевіряємо вихідний текст…');
    $('generationStatus').textContent = 'Перевіряємо без перекладу та без AI-виклику…';
    try {
      const checks = await request('/check', payload, controller.signal);
      resultLocale = payload.locale; sourceSnapshot = JSON.stringify(payload); referenceSource = payload; hasResult = true;
      const language = languages.find(item => item.code === resultLocale);
      resultIds.forEach((id, index) => { $(id).value = payload[fields[index]]; $(id).lang = resultLocale; $(id).dir = language?.dir || 'auto'; });
      $('resultEmpty').hidden = true; $('resultLocale').textContent = language?.label || resultLocale;
      renderCheck(checks);
      $('generationStatus').textContent = 'Повтори перевірено. Текст праворуч залишився без змін.';
    } catch (error) { $('generationStatus').textContent = error.name === 'AbortError' ? 'Перевірку скасовано.' : error.message; }
    finally { busy = false; controller = null; buttons(); }
  };
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
  $('checkProfile').addEventListener('change', () => {
    $('profileHelp').textContent = profile() === 'natural' ? 'Перевіряємо основні слова. Часті «і», «в», «на» та подібні слова не вважаємо проблемою.' : 'Перевіряємо всі слова, навіть «і», «в» та «на». Це суворіший режим.';
    if (hasResult) { stale('Профіль змінено. Перевіряємо текст за новими правилами…'); return $('checkResult').onclick(); }
  });
  const exportText = () => {
    const data = result();
    return `Language: ${resultLocale}\n\nTitle\n${data.title}\n\nShort description\n${data.shortDescription}\n\nFull description\n${data.fullDescription}\n`;
  };
  $('copyResult').onclick = async () => {
    if (busy || checkedSnapshot !== snapshot()) return;
    try { await navigator.clipboard.writeText(exportText()); $('resultStatus').textContent = 'Скопійовано всі три поля.'; }
    catch { $('resultStatus').textContent = 'Браузер не дозволив копіювання. Виділіть текст вручну або завантажте .txt.'; }
  };
  $('copyFull').onclick = async () => {
    if (busy || checkedSnapshot !== snapshot()) return;
    try { await navigator.clipboard.writeText(result().fullDescription); $('resultStatus').textContent = 'Повний опис скопійовано без заголовків і службових підписів — для перевірки в іншому аналізаторі.'; }
    catch { $('resultStatus').textContent = 'Не вдалося скопіювати. Виділіть текст вручну.'; }
  };
  $('downloadResult').onclick = () => {
    if (busy || checkedSnapshot !== snapshot()) return;
    const url = URL.createObjectURL(new Blob([exportText()], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = `aso-${resultLocale}.txt`;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    $('resultStatus').textContent = 'Файл підготовлено до завантаження.';
  };
  function renderLanguages() {
    const query = $('languageSearch').value.trim();
    const matches = matchingLanguages(languages, query);
    $('languageResults').hidden = !query || !matches.length;
    $('languageResults').replaceChildren(...matches.map(language => {
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = `${language.label} · ${language.code}`;
      button.onclick = () => {
        selectedLocale = language.code; $('locale').value = language.code;
        $('languageSearch').value = ''; renderLanguages(); $('locale').focus();
        if (hasResult) $('generationStatus').textContent = 'Мову змінено. Натисніть «Перекласти та перевірити», щоб оновити результат.';
      };
      return button;
    }));
    $('languageCount').textContent = query ? (matches.length ? `Знайдено: ${matches.length}. Натисніть потрібну мову вище. Поточний вибір не змінено.` : 'Мову не знайдено. Спробуйте назву українською, російською, англійською або код мови. Поточний вибір збережено.') : `Доступно: ${languages.length} мов і регіональних варіантів.`;
    buttons();
  }
  $('languageSearch').addEventListener('input', renderLanguages);
  $('languageSearch').addEventListener('keydown', event => {
    if (event.key === 'Escape') { $('languageSearch').value = ''; renderLanguages(); }
    if (event.key === 'Enter' || event.key === 'ArrowDown') {
      event.preventDefault();
      const results = $('languageResults').children;
      if (results.length) $('languageResults').hidden = false;
      if (event.key === 'Enter' && results.length === 1) results[0].click();
      else results[0]?.focus();
    }
  });
  $('locale').addEventListener('change', () => { selectedLocale = $('locale').value; buttons(); });
  request('/languages').then(data => {
    languages = data.languages;
    $('locale').replaceChildren(...languages.map(language => {
      const option = document.createElement('option'); option.value = language.code; option.textContent = `${language.label} · ${language.code}`; return option;
    }));
    $('locale').value = selectedLocale;
    renderLanguages();
    $('locale').disabled = false;
    $('generationStatus').textContent = 'Готово до адаптації. Оберіть мову та заповніть усі три поля.';
    buttons();
  }).catch(error => { $('generationStatus').textContent = error.message + ' Оновіть сторінку, щоб повторити.'; });
}
