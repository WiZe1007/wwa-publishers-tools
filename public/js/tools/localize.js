const fields = ['title', 'shortDescription', 'fullDescription'];
const sourceIds = ['sourceTitle', 'sourceShort', 'sourceFull'];
const resultIds = ['resultTitle', 'resultShort', 'resultFull'];
const countIds = ['titleCount', 'shortCount', 'fullCount'];
const limits = [30, 80, 4000];
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
    $('editorSummary').textContent = 'AI-редактура поточної версії ще не підтверджена.';
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
    $('checkSummary').textContent = checks.clean
      ? `✓ Профіль «${checks.profile === 'natural' ? 'Природний текст' : 'Строгий'}»: обов’язкових правок немає.${checks.warnings?.length ? ' Перегляньте рекомендації нижче.' : ''}`
      : 'Потрібні правки: результат ще не пройшов перевірку.';
    $('checkIssues').replaceChildren(...checks.issues.map(issue => {
      const li = document.createElement('li'); li.textContent = issue; return li;
    }));
    $('editorSummary').textContent = checks.editor?.status === 'passed' ? 'AI-редактор завершив перевірку: конкретних проблем із мовою та збереженням фактів не виявлено.'
      : checks.editor?.status === 'needs_revision' ? 'AI-редактор виявив проблеми зі змістом або мовою — дивіться зауваження.'
      : checks.editor?.status === 'unavailable' ? 'AI-редактор не завершив перевірку. Це не підтвердження якості тексту.'
      : 'AI-редактура не виконана для цієї версії. Кнопка «Покращити текст з AI» запускає її, якщо відповідну опцію увімкнено.';
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
    counters(); stale('Текст змінено. Натисніть «Перевірити правки» перед копіюванням або завантаженням.');
  });
  $('sourceFields').addEventListener('input', () => {
    if (hasResult && JSON.stringify(source()) !== sourceSnapshot)
      $('generationStatus').textContent = 'Джерело або мову змінено. Натисніть «Адаптувати та перевірити», щоб створити новий варіант. Поточний результат належить попередньому запиту.';
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
    $('generationStatus').textContent = `Адаптуємо тексти й перевіряємо повтори.${payload.qualityReview ? ' Після цього AI-редактор перевірить мову та факти.' : ''} За потреби виконаємо додаткові правки — це може зайняти до 2,5 хвилин.`;
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
      $('generationStatus').textContent = data.warning || (data.ready
        ? `Адаптовано: ${language?.label || resultLocale}. Спроб: ${data.attempts}. Перегляньте переклад перед публікацією.`
        : `Після ${data.attempts} спроб залишились зауваження. Натисніть «Покращити текст з AI» або відредагуйте результат за звітом і перевірте правки.`);
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
      $('generationStatus').textContent = 'Вихідні тексти перевірено без AI та скопійовано праворуч без змін. Це перевірка повторів, не переклад.';
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
    $('profileHelp').textContent = profile() === 'natural' ? 'Змістові групи: до 4%, щонайменше 3 вживання у повному описі. Службові слова не блокують результат. Це не строгий режим.' : 'Усі групи, включно зі службовими: до 2,5%. На коротких текстах цей режим може вимагати неприродних правок — перевіряйте граматику.';
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
        if (hasResult) $('generationStatus').textContent = 'Мову джерела змінено. Наявний результат залишився попередньою мовою; для нового перекладу натисніть «Адаптувати та перевірити».';
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
