// WWA Publishers Tools — server
// Local run:  ANTHROPIC_API_KEY=sk-... node server.js   (or use .env, see README)
// Render.com: set ANTHROPIC_API_KEY in Environment settings

const express = require('express');
const path = require('path');
const fs = require('fs');

// Simple .env loader (no dependency needed)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';

app.use(express.json({ limit: '80mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, aiConfigured: Boolean(API_KEY) });
});

// ===== Спам-аналіз тексту (точна логіка ASOMobile Text Analyzer) =====
// Форми слова об'єднуються (tap + taps + tapping + tapped = "tap"),
// переспам = щільність слова > SPAM_DENSITY % від загальної кількості слів
const SPAM_DENSITY = Number(process.env.SPAM_DENSITY || 2.5);
const STOP_WORDS = new Set(('a,an,the,and,or,but,if,then,else,when,while,for,to,of,in,on,at,by,with,from,up,down,' +
  'out,off,over,under,again,further,once,here,there,all,any,both,each,few,more,most,other,some,such,no,nor,not,' +
  'only,own,same,so,than,too,very,can,will,just,should,now,is,are,was,were,be,been,being,have,has,had,do,does,' +
  'did,doing,would,could,might,must,shall,may,it,its,this,that,these,those,you,your,yours,we,our,ours,they,' +
  'them,their,he,she,his,her,i,me,my,as,about,into,through,after,before,between,during,without,within,also,' +
  'get,let,us,via,per,vs,etc,s,t,re,ll,d,m').split(','));

// Нормалізація слова: об'єднання форм (множина, -ing, -ed), як в ASOMobile
// tiles→tile, boxes→box, berries→berry, tapping→tap, tapped→tap, matched→match
function stripPlural(w) {
  if (w.length > 3 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (w.length > 3 && w.endsWith('es') && /(s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 2 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}
function undouble(s) {
  // tapp→tap, runn→run (подвоєна приголосна після зняття суфікса)
  if (s.length > 2 && s.at(-1) === s.at(-2) && !'aeiou'.includes(s.at(-1))) return s.slice(0, -1);
  return s;
}
function normalize(w) {
  if (w.length > 5 && w.endsWith('ying')) return w.slice(0, -4) + 'y';       // studying→study
  if (w.length > 4 && w.endsWith('ing')) {
    const s = undouble(w.slice(0, -3));                                       // tapping→tap
    if (s.length >= 3) return stripPlural(s);
  }
  if (w.length > 4 && w.endsWith('ied')) return w.slice(0, -3) + 'y';         // carried→carry
  if (w.length > 4 && w.endsWith('ed') && !w.endsWith('eed')) {
    const s = undouble(w.slice(0, -2));                                       // tapped→tap, matched→match... (matche→match нижче)
    if (s.length >= 3) return stripPlural(s);
  }
  return stripPlural(w);
}

// Токенізація: дефіси розбивають слово (tile-matching → tile + matching), як в ASOMobile
function tokenize(text) {
  return String(text).toLowerCase()
    .replace(/[^\p{L}\p{N}'’]+/gu, ' ')
    .split(/\s+/)
    .map(w => w.replace(/^['’]+|['’]+$/g, ''))
    .filter(w => w.length > 0);
}

function analyzeText(text) {
  const tokens = tokenize(text);
  const totalWords = tokens.length; // всі слова, включно зі стоп-словами (як в ASOMobile)
  const freq = {};
  const forms = {};
  for (const t of tokens) {
    if (t.length < 2 || STOP_WORDS.has(t) || /^\d+$/.test(t)) continue;
    const n = normalize(t);
    freq[n] = (freq[n] || 0) + 1;
    forms[n] = forms[n] || {};
    forms[n][t] = (forms[n][t] || 0) + 1;
  }
  const frequency = Object.entries(freq)
    .map(([stem, count]) => {
      // показуємо найчастішу реальну форму слова, а не обрубок-стем
      const display = Object.entries(forms[stem]).sort((a, b) => b[1] - a[1])[0][0];
      return {
        word: display, count,
        density: totalWords ? +(count / totalWords * 100).toFixed(2) : 0
      };
    })
    .sort((a, b) => b.count - a.count);
  const spam = frequency.filter(w => w.density > SPAM_DENSITY);
  return { totalWords, frequency, spam, maxAllowed: Math.floor(totalWords * SPAM_DENSITY / 100) };
}

const wordFrequency = text => analyzeText(text).frequency;
const findSpam = text => analyzeText(text).spam;

// ===== Стилі опису =====
const TONE_INSTRUCTIONS = {
  normal: `Стиль опису — ЗВИЧАЙНИЙ:
- Спокійний, дружній, інформативний тон.
- Чітко і чесно описуй функції, без маркетингового тиску.
- М'який заклик до дії наприкінці (наприклад "Download now and enjoy").
- Емодзі: помірно, переважно в заголовках секцій та списку функцій.`,
  normal_plus: `Стиль опису — ЗВИЧАЙНИЙ З УТОЧНЕННЯМИ ДЛЯ GOOGLE PLAY:
- Спокійний, дружній, інформативний тон. Чітко і чесно описуй функції, без маркетингового тиску.
- М'який заклик до дії наприкінці. Емодзі: помірно, в заголовках секцій та списку функцій.
- ДОДАТКОВО (критично важливо): Google Play відхиляє подібні ігри за неповні описи (вимоги 4.1–4.9 для ігор, які можуть бути сприйняті як азартні). Тому опис ОБОВ'ЯЗКОВО має містити чіткі однозначні відповіді на такі пункти (вплети органічно та/або додай наприкінці секцію "ℹ️ GOOD TO KNOW"):
  1. Точний і повний опис гри та ВСІХ її функцій — нічого не замовчуй (вимога 4.1).
  2. Чітко вкажи, від чого залежить результат: якщо з опису розробника випливає гра на навички — прямо напиши, що результат залежить виключно від умінь і дій гравця (skill-based), а не від удачі. Якщо в грі є елементи випадковості — чесно вкажи, що це симульована ігрова механіка без реальних виграшів (вимога 4.2).
  3. НЕ використовуй жодних тем і слів, пов'язаних з удачею, казино чи азартом: luck, lucky, fortune, jackpot, casino, slots, bet, win money тощо (вимога 4.3).
  4. Якщо в грі є винагороди — чітко вкажи, що вони нараховуються строго за результати/досягнення гравця (вимога 4.4).
  5. Точно вкажи, ЩО саме отримує гравець: віртуальні бали/монети/бонуси, які є симульованими, не мають реальної грошової цінності та використовуються лише всередині гри (вимога 4.7).
  6. Явно зазнач, що виведення реальних грошей неможливе: гра не передбачає грошових виграшів, обміну чи виводу коштів (вимога 4.8). Формулювання типу: "All points and rewards are virtual, have no real-world value and cannot be exchanged for real money."
  7. Щодо покупок (вимога 4.9): якщо в описі розробника згадані внутрішні покупки — чітко вкажи, що саме можна придбати; якщо покупки не згадані — напиши, що гра не вимагає покупок.
- Всі ці твердження мають відповідати опису розробника і скріншотам — нічого не вигадуй; якщо якийсь пункт суперечить наданій інформації, сформулюй його правдиво на основі того, що надано.`,
  semi: `Стиль опису — НАПІВ-АГРЕСИВНИЙ (енергійний маркетинг):
- Динамічний, захопливий тон з сильними дієсловами (discover, unleash, master, boost).
- Яскраво підкресли переваги та відчуття від використання.
- 2-3 впевнені заклики до дії по тексту.
- Риторичні питання-хуки на початку доречні ("Ready to...?").
- Емодзі: активно — заголовки, списки, акценти на перевагах.`,
  aso_pro: `Стиль опису — ASO PRO (професійна методологія оптимізації для Google Play, де full description індексується пошуком):
КРОК 1 — КЛЮЧОВІ СЛОВА: спочатку визнач з назви, опису розробника та скріншотів 3–5 цільових ключових слів/фраз (які реальні користувачі шукають у Play Store для такої гри/додатку).

КРОК 2 — SHORT DESCRIPTION (80 симв., індексується): в основній частині (після назви) природно вклади 2–3 найважливіші ключові слова одним переконливим реченням. Не повторюй головне ключове слово з назви додатку.

КРОК 3 — FULL DESCRIPTION, строго за структурою (алгоритм + конверсія):
1. Хук-абзац (2–3 речення): головна цінність додатку. Головне ключове слово ОБОВ'ЯЗКОВО в перших 167 символах (це видимо без натискання "more"). НІКОЛИ не починай з "Welcome to..." — це слабкий хук.
2. Буліти функцій (5–8 пунктів): формат "емодзі [Функція]: [Вигода для користувача]". Вигоди, а не сухі функції ("Sleep better tonight", а не "White noise generator"). Ключові слова природно, фразування варіюй.
3. Як грати/користуватись: 2–3 прості кроки.
4. Соціальний доказ: ТІЛЬКИ якщо розробник надав реальні дані (нагороди, кількість користувачів). НІЧОГО не вигадуй — якщо даних немає, пропусти цей блок.
5. CTA: "Download [назва] today — [цінність]".
6. Ключовий абзац наприкінці: природний текст із варіантами ключових слів, синонімами та long-tail фразами (Google розуміє семантичну близькість).

ОБОВ'ЯЗКОВЕ УТОЧНЕННЯ ПРО ГРОШІ: опис має чітко давати зрозуміти, що це НЕ гра на реальні гроші: всі бали/монети/винагороди — віртуальні, не мають реальної грошової цінності, вивід реальних грошей неможливий (наприклад, коротким блоком або фразою на кшталт "All points and rewards are virtual, have no real-world value and cannot be exchanged for real money."). Жодних тем удачі/казино/азарту у формулюваннях.
ПРАВИЛА ЩІЛЬНОСТІ: головне ключове слово 3–5 разів на весь опис (точна форма + варіанти). Ніякого перенасичення — Google карає за keyword stuffing.
СТРУКТУРА: у цьому стилі структуру задає методологія вище, але ВЕСЬ зміст (функції, механіки, особливості) бери виключно з опису розробника та скріншотів.
ТОН: впевнений, професійний, орієнтований на вигоди. Емодзі — в булітах та заголовках.`,
  aso_pro_alt: `Стиль опису — ASO PRO ALTERNATIVE (та сама ASO-методологія, але ПРИНЦИПОВО ІНШИЙ формат подачі — так, ніби опис писала інша компанія-видавець):

SEO-БАЗА (незмінна): визнач 3–5 цільових ключових слів з назви, опису розробника та скріншотів; головне ключове слово ОБОВ'ЯЗКОВО в перших 167 символах full description; щільність головного ключа 3–5 разів (точна форма + варіанти); без keyword stuffing; short description — 2–3 ключові слова природно.

ФОРМАТ (головна відмінність — НЕ повторюй структуру звичайного ASO Pro):
1. Відкриття: 1–2 короткі речення від другої особи ("You", "Your") — сцена або ситуація гравця, БЕЗ фрази-хука типу "Discover/Welcome/Enter" і без назви додатку на початку речення.
2. Далі текст ділиться на 3–4 ТЕМАТИЧНІ СЕКЦІЇ з власними заголовками (пиши заголовки як короткі фрази з великої літери, наприклад "Inside the game", "What makes it different", "Built for short sessions"). Заголовки формулюй під конкретний додаток, не шаблонні.
3. Кожна секція — суцільний абзац на 2–4 речення (НЕ буліт-списки!). Функції описуй у зв'язному тексті, а не переліком.
4. Максимум ОДИН короткий список на весь опис — і лише якщо без нього ніяк; тоді це має бути перелік у 3–4 рядки в кінці однієї з секцій.
5. Наприкінці — міні-блок питань і відповідей у 2–3 пункти (формат "Q: ... A: ..." або "Питання одним рядком, відповідь наступним"), який закриває практичні моменти: чи потрібен інтернет, скільки триває сесія, для кого гра, чи є покупки — але тільки те, що підтверджується описом розробника чи скріншотами.
6. Фінал: одне спокійне речення-запрошення без слова "Download" на початку.
7. У кінці — короткий рядок з природними ключовими словами та синонімами (без стаффінгу), оформлений як звичайне речення, а не як перелік через кому.

УТОЧНЕННЯ ПРО ГРОШІ (обов'язково): опис має чітко давати зрозуміти, що це НЕ гра на реальні гроші — всі бали/монети/винагороди віртуальні, не мають реальної грошової цінності, вивід реальних грошей неможливий. Вплети це органічно у відповідну секцію або в Q&A. Жодних тем удачі/казино/азарту.

ЕМОДЗІ: мінімально — максимум 2–3 на весь опис, лише поруч із заголовками секцій (не в кожному). НЕ використовуй емодзі як марери списків.
ТОН: спокійний, оповідний, "редакційний" — інша інтонація, ніж у стандартному ASO Pro. Весь фактичний зміст — виключно з опису розробника та скріншотів.`,
  tiktok_aso_pro: `Стиль опису — TIKTOK ASO PRO (методологія ASO Pro + шаблон social casino compliance):

БАЗА — методологія ASO Pro: спочатку визнач 3–5 цільових ключових слів з назви, опису та скріншотів; у short description (після назви) — 2–3 ключові слова природно; головне ключове слово в перших 167 символах full description; щільність головного ключа 3–5 разів (точна форма + варіанти), без keyword stuffing.

СТРУКТУРА FULL DESCRIPTION — строго за цим шаблоном (як у прикладі нижче):
1. Хук-абзац: "[Назва додатку] — ..." + опиши додаток як "social casino experience" з "simulated" механікою (simulated chance / simulated luck), для розваги (entertainment), з "virtual challenge" та "in-app progress" і ЯВНО "without any real-money gambling".
2. "How to Play:" — як проходить сесія, обов'язково з фразою "Players interact with virtual elements". Опиши реальні механіки з опису розробника/скріншотів.
3. "Skill vs. Luck:" — чітко вкажи, що це social casino experience, centered on simulated luck; що результати virtual та "do not represent real-money gambling"; рішення гравця можуть впливати на сесію, але не гарантують виграш.
4. "Prizes/Rewards:" — гравці отримують "virtual progress" та результати всередині додатку; "These have no real-world monetary value."
5. "Cash Out Rules:" — ДОСЛІВНО цей текст: "Real-money cash-outs are strictly blocked. Virtual progress and results cannot be withdrawn, exchanged for cash, or redeemed for gift cards."
6. "In-App Purchases:" — якщо в описі розробника покупки НЕ згадані, ДОСЛІВНО: "No in-app purchases are available. 18+. For entertainment purposes only." Якщо покупки згадані — чесно вкажи, що саме купується, і збережи "18+. For entertainment purposes only."

ОБОВ'ЯЗКОВІ ФРАЗИ (мають бути в тексті): "social casino experience", "simulated luck" (або simulated chance), "virtual progress", "Players interact with virtual elements", "do not represent real-money gambling".
ЕМОДЗІ: у цьому стилі НЕ використовуй емодзі — чистий формальний текст, як у шаблоні.
ТОН: спокійний, професійний, розважальний контекст. Конкретні механіки та деталі — тільки з опису розробника і скріншотів.

ПРИКЛАД РЕЗУЛЬТАТУ (для розуміння формату; зміст адаптуй під свій додаток):
"７７７ Sl0ts — Enter a neon-inspired social casino experience where simulated chance meets an engaging virtual challenge. Take part for entertainment, pursue successful outcomes, and build your in-app progress without any real-money gambling.

How to Play: Players interact with virtual elements, make choices during each session, and work toward completing the presented challenge. Successful solutions contribute to in-app progress and accuracy, while the available moves and conditions shape each attempt.

Skill vs. Luck: ７７７ Sl0ts is presented as a social casino experience centered on simulated luck. Outcomes within the experience are virtual and do not represent real-money gambling. Player decisions may influence the session, but they do not guarantee a winning result.

Prizes/Rewards: Players receive virtual progress and performance results within the app. These have no real-world monetary value.

Cash Out Rules: Real-money cash-outs are strictly blocked. Virtual progress and results cannot be withdrawn, exchanged for cash, or redeemed for gift cards.

In-App Purchases: No in-app purchases are available. 18+. For entertainment purposes only."`,
  aggressive: `Стиль опису — АГРЕСИВНИЙ (максимальний маркетинговий драйв):
- Потужний чіпляючий хук з першого рядка, який неможливо проігнорувати.
- Емоційні тригери: азарт, виклик, цікавість, страх пропустити ("your next adventure is waiting", "can you handle it?").
- Часті сильні заклики до дії, короткі ударні речення, відчуття терміновості.
- Емодзі: максимально яскраво — хук з емодзі, заголовки, списки, заклики до дії (але без хаосу, 1-2 поспіль).
- Але БЕЗ порушень правил Google Play: без обману, без КАПСУ, без "!!!", без фейкових обіцянок та вигаданих цифр — драйв досягається мовою, а не порушеннями.`
};

// ===== Обсяг повного опису =====
// Максимум повторів одного слова: щільність ≤ SPAM_DENSITY% від очікуваної кількості слів,
// мінус 1 як запас міцності (слова ≈ 6.2 символи з пробілом)
const SIZE_MAX_REPEATS = {
  small: 4,   // ~1400 симв. ≈ 225 слів → 5, з запасом 4
  medium: 8,  // ~2400 симв. ≈ 385 слів → 9, з запасом 8
  large: 12   // ~3400 симв. ≈ 545 слів → 13, з запасом 12
};

const SIZE_INSTRUCTIONS = {
  small: 'Обсяг повного опису: 1300–1500 символів ВКЛЮЧНО З ПРОБІЛАМИ. Не менше 1300 і не більше 1500.',
  medium: 'Обсяг повного опису: до 2500 символів ВКЛЮЧНО З ПРОБІЛАМИ (орієнтовно 2000–2500).',
  large: 'Обсяг повного опису: до 3500 символів ВКЛЮЧНО З ПРОБІЛАМИ (орієнтовно 2800–3500).'
};

// Виклик Claude API
async function callClaude(content) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      messages: [{ role: 'user', content }]
    })
  });
  if (!resp.ok) {
    const errText = await resp.text();
    console.error('Anthropic API error:', resp.status, errText);
    throw Object.assign(new Error(`Помилка Claude API (${resp.status}). Перевірте API ключ/модель.`), { api: true });
  }
  const data = await resp.json();
  return (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
}

function extractJSON(text) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : text);
}

// Виправлення переспаму в довільному (в т.ч. відредагованому вручну) тексті
app.post('/api/fix-spam', async (req, res) => {
  try {
    if (!API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY не налаштований на сервері.' });
    let text = String((req.body || {}).text || '').trim();
    const appName = String((req.body || {}).appName || 'the app');
    if (!text) return res.status(400).json({ error: 'Текст порожній.' });

    let analysis = analyzeText(text);
    if (analysis.spam.length === 0) {
      return res.json({ fullDescription: text, fixAttempts: 0, spamCheck: buildSpamCheck(analysis, 0) });
    }

    const scoreOf = a => a.spam.reduce((s, w) => s + (w.density - SPAM_DENSITY), 0) + a.spam.length * 0.01;
    let best = { text, analysis };
    let attempts = 0;

    while (analysis.spam.length > 0 && attempts < 5) {
      attempts++;
      const safeMax = Math.max(1, analysis.maxAllowed - 1);
      const prompt = `Below is a Google Play full description for the app "${appName}".
A keyword-spam check found over-used words. All forms of a word count together (singular + plural + -ing/-ed + inside hyphenated words). The text has ${analysis.totalWords} words.

Over-used words:
${analysis.spam.map(s => `- "${s.word}" — used ${s.count} times (${s.density}%), must appear at most ${safeMax} times`).join('\n')}

Rewrite so every listed word appears at most ${safeMax} times. Keep the meaning, features, structure, emojis, formatting and overall length unchanged. Do not add features. Before answering, count the occurrences in your rewrite and fix again if any is still above the limit.

Description:
${text}

Respond STRICTLY as JSON without markdown:
{"full_description": "..."}`;
      const fixed = extractJSON(await callClaude([{ type: 'text', text: prompt }]));
      if (fixed.full_description) text = String(fixed.full_description);
      analysis = analyzeText(text);
      if (scoreOf(analysis) < scoreOf(best.analysis)) best = { text, analysis };
    }

    if (scoreOf(analysis) > scoreOf(best.analysis)) { text = best.text; analysis = best.analysis; }
    res.json({ fullDescription: text, fixAttempts: attempts, spamCheck: buildSpamCheck(analysis, attempts) });
  } catch (err) {
    console.error(err);
    res.status(err.api ? 502 : 500).json({ error: err.message });
  }
});

function buildSpamCheck(a, fixAttempts) {
  return {
    densityLimit: SPAM_DENSITY,
    totalWords: a.totalWords,
    maxAllowed: a.maxAllowed,
    fixAttempts,
    clean: a.spam.length === 0,
    remaining: a.spam,
    frequency: a.frequency.slice(0, 50)
  };
}

// Окремий endpoint: перевірка тексту на переспам (для кнопки на сторінці)
app.post('/api/spam-check', (req, res) => {
  const a = analyzeText(String((req.body || {}).text || ''));
  res.json({
    densityLimit: SPAM_DENSITY,
    totalWords: a.totalWords,
    maxAllowed: a.maxAllowed,
    spam: a.spam,
    frequency: a.frequency.slice(0, 50)
  });
});

// ASO generation + best-8 screenshot selection
app.post('/api/aso', async (req, res) => {
  try {
    if (!API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY не налаштований на сервері.' });
    }
    const { appName, description, category, tone = 'normal', size = 'small', screenshots = [] } = req.body || {};
    if (!appName || !description) {
      return res.status(400).json({ error: 'Потрібні назва додатку та опис.' });
    }

    const needSelection = screenshots.length > 8;

    const content = [];
    screenshots.forEach((s, i) => {
      content.push({ type: 'text', text: `Screenshot #${i + 1}:` });
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: s.mediaType || 'image/jpeg', data: s.data }
      });
    });

    let task = `Напиши гарний ASO опис на Англійській мові для Google Play Market для додатка "${appName}", який буде відповідати всім вимогам і не обманювати користувача. Бери за основу мій опис. Не потрібно додавати лишній функціонал, якого в мене немає, щоб я не отримав блокування. Скріншоти гри прикріплені.

Опис: ${description}
${category ? `\nКатегорія: ${category}` : ''}

Вимоги до результату:
1. "short_description" — короткий опис для Google Play, англійською, СТРОГО не більше 80 символів включно (порахуй символи!). Формат обов'язковий: назва додатку, потім двокрапка або знак оклику, потім основна частина, а В КІНЦІ — знак оклику або крапка. Приклад: "${appName}: main catchy part here!" або "${appName}! main catchy part here."
2. "full_description" — повний опис для Google Play, англійською. ${SIZE_INSTRUCTIONS[size] || SIZE_INSTRUCTIONS.small} Якщо інструкція стилю нижче не вказує інакше — ОБОВ'ЯЗКОВО використовуй доречні емодзі: на початку ключових абзаців, у заголовках секцій (наприклад "🎮 HOW TO PLAY", "⭐ GAME FEATURES") та як марери пунктів списку функцій (замість "•" — тематичні емодзі: 🧩 ⚡ 🏆 🎯 💎 🔥 тощо, підбирай під зміст). Емодзі мають виглядати органічно, не більше 1-2 поспіль.

${TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.normal}

ОБОВ'ЯЗКОВО для будь-якого стилю (Google Play metadata policy):
- НАЙВАЖЛИВІШЕ: кожна функція, режим чи особливість, згадана в описі, має підтверджуватися АБО описом розробника, АБО тим, що видно на скріншотах. Якщо чогось немає ні там, ні там — НЕ згадуй це взагалі. Не додавай типові для жанру фічі "за замовчуванням" (мультиплеєр, лідерборди, щоденні нагороди, скіни тощо), якщо їх не видно. Краще коротший чесний опис, ніж вигаданий функціонал.
- МАКСИМАЛЬНА БЛИЗЬКІСТЬ ДО ОРИГІНАЛУ: опис розробника — це основа, а не просто джерело натхнення. Зберігай його зміст, структуру подачі, акценти та порядок думок настільки, наскільки це можливо. Твоя робота — якісно перекласти й відполірувати текст розробника до рівня Google Play, а не написати новий опис з нуля. Все, що є в оригіналі — має бути у результаті; нічого важливого не викидай і не перекручуй.
- Жодних вигаданих функцій чи неправдивих обіцянок.
- Без слів ПОВНІСТЮ КАПСОМ (окрім абревіатур), без повторюваної пунктуації (!!!, ???).
- Емодзі дозволені ТІЛЬКИ у full_description. У short_description — ЗАБОРОНЕНІ (політика Google Play), там лише текст і розділові знаки.
- Без неперевірених заяв типу "#1 app", "the best app", без згадок конкурентів, рейтингів чи цін.
- Опис має пройти модерацію Google Play без ризику блокування.
- АНТИ-ПЕРЕСПАМ (дуже важливо, перевіряється автоматично): жодне значуще слово не має вживатися більше ніж ${SIZE_MAX_REPEATS[size] || SIZE_MAX_REPEATS.small} разів на весь опис. Рахуються РАЗОМ усі форми слова: однина+множина (tile/tiles), дієслівні форми (tap/taps/tapping/tapped), а також входження у складені слова через дефіс (tile-matching = tile + matching). Перед відповіддю подумки перелічи входження найчастіших слів і, якщо якесь перевищує ліміт, перепиши через синоніми, займенники або інше формулювання. Це стосується і назви додатку, якщо вона складається зі звичайних слів.`;

    if (needSelection) {
      task += `
3. Скріншотів більше 8. Обери 8 НАЙКРАЩИХ для сторінки Google Play (найінформативніші, найякісніші, різноманітні сцени) та поверни їх номери у полі "selected" у порядку, в якому їх варто показувати (номери скріншотів як вони пронумеровані вище, починаючи з 1).`;
    }

    task += `

Відповідь дай СТРОГО у форматі JSON без markdown:
{"short_description": "...", "full_description": "..."${needSelection ? ', "selected": [1,2,3,4,5,6,7,8]' : ''}}`;

    content.push({ type: 'text', text: task });

    let parsed;
    try {
      parsed = extractJSON(await callClaude(content));
    } catch (e) {
      if (e.api) return res.status(502).json({ error: e.message });
      console.error('Failed to parse model response:', e);
      return res.status(502).json({ error: 'Не вдалося розібрати відповідь AI. Спробуйте ще раз.' });
    }

    let selected = null;
    if (needSelection) {
      selected = Array.isArray(parsed.selected)
        ? parsed.selected.map(n => Number(n) - 1).filter(i => i >= 0 && i < screenshots.length).slice(0, 8)
        : null;
      if (!selected || selected.length === 0) selected = screenshots.slice(0, 8).map((_, i) => i);
      // Top up to 8 if the model returned fewer
      for (let i = 0; selected.length < Math.min(8, screenshots.length) && i < screenshots.length; i++) {
        if (!selected.includes(i)) selected.push(i);
      }
    }

    // ===== Перевірка довгого опису на переспам + автовиправлення =====
    let fullDescription = String(parsed.full_description || '');
    let analysis = analyzeText(fullDescription);
    let fixAttempts = 0;
    const MAX_FIX = 5;

    // Запам'ятовуємо найкращий варіант (раптом чергова спроба зробить гірше)
    let best = { text: fullDescription, analysis };
    const score = a => a.spam.reduce((s, w) => s + (w.density - SPAM_DENSITY), 0) + a.spam.length * 0.01;

    while (analysis.spam.length > 0 && fixAttempts < MAX_FIX) {
      fixAttempts++;
      console.log(`Spam fix attempt ${fixAttempts}:`, analysis.spam.map(s => `${s.word}(${s.count}, ${s.density}%)`).join(', '));
      try {
        const safeMax = Math.max(1, analysis.maxAllowed - 1); // запас міцності на різницю в підрахунку
        // Слова на межі — теж просимо трохи розвантажити, щоб не з'явився переспам після правок
        const borderline = analysis.frequency.filter(w =>
          !analysis.spam.some(s => s.word === w.word) && w.count >= safeMax
        ).slice(0, 6);
        const fixPrompt = `Below is a full description for Google Play for the app "${appName}".
A keyword-spam check (ASOMobile Text Analyzer) found over-used words. Rule: a word's density must not exceed ${SPAM_DENSITY}% of the total word count. The text has ${analysis.totalWords} words. All forms of a word count together: singular + plural + -ing/-ed forms + inside hyphenated words (tap + taps + tapping + tapped + tap-to-win all count as "tap").

Over-used words (MUST be reduced):
${analysis.spam.map(s => `- "${s.word}" — used ${s.count} times (${s.density}%), must appear at most ${safeMax} times (remove at least ${s.count - safeMax})`).join('\n')}
${borderline.length ? `\nBorderline words (close to the limit — reduce by 1 if possible):\n${borderline.map(w => `- "${w.word}" — used ${w.count} times`).join('\n')}\n` : ''}
Rewrite the description so that:
1. Each of these words (counting ALL its forms) appears no more than ${safeMax} times — replace extra occurrences with synonyms or rephrase. Do not simply delete sentences; keep overall length similar.
1a. BEFORE answering, mentally count every occurrence of each listed word in your rewritten text (including plural, -ing/-ed forms and occurrences inside hyphenated words). If any is still above ${safeMax}, rewrite again before responding.
1b. Prefer replacing a repeated noun with a pronoun ("it", "they") or a synonym, merging two sentences, or rephrasing the idea — rather than deleting content.
2. The meaning, features and overall length stay the same.
3. Do NOT add features that are not mentioned.
4. Keep it natural, high-quality English for Google Play.
5. Keep the same marketing tone and energy as the original text, including all emojis and formatting.${tone === 'tiktok_aso_pro' ? `
6. CRITICAL: Do NOT modify the mandatory compliance sentences ("Cash Out Rules: Real-money cash-outs are strictly blocked..." and "In-App Purchases: ...") and do NOT remove the required phrases: "social casino experience", "simulated luck", "virtual progress", "Players interact with virtual elements", "do not represent real-money gambling". Reduce word repetition ONLY in other parts of the text.` : ''}

Description:
${fullDescription}

Respond STRICTLY as JSON without markdown:
{"full_description": "..."}`;
        const fixed = extractJSON(await callClaude([{ type: 'text', text: fixPrompt }]));
        if (fixed.full_description) fullDescription = String(fixed.full_description);
        analysis = analyzeText(fullDescription);
        if (score(analysis) < score(best.analysis)) best = { text: fullDescription, analysis };
      } catch (e) {
        console.error('Spam fix failed:', e.message);
        break;
      }
    }

    // Якщо остання спроба гірша за найкращу — повертаємо найкращу
    if (score(analysis) > score(best.analysis)) {
      fullDescription = best.text;
      analysis = best.analysis;
    }
    console.log(`Spam check result: ${analysis.spam.length === 0 ? 'CLEAN' : 'STILL SPAM: ' + analysis.spam.map(s => `${s.word}(${s.count})`).join(', ')} after ${fixAttempts} fix(es)`);

    let shortDescription = String(parsed.short_description || '').trim();
    if (shortDescription.length > 80) {
      shortDescription = shortDescription.slice(0, 80);
      const cut = shortDescription.lastIndexOf(' ');
      if (cut > 40) shortDescription = shortDescription.slice(0, cut);
      shortDescription = shortDescription.replace(/[,;:\s-]+$/, '');
    }
    // В кінці має бути знак оклику або крапка
    if (shortDescription && !/[.!]$/.test(shortDescription)) {
      shortDescription = shortDescription.replace(/[,;:\s-]+$/, '');
      shortDescription = (shortDescription.length >= 80 ? shortDescription.slice(0, 79).replace(/[,;:\s-]+$/, '') : shortDescription) + '.';
    }

    res.json({
      shortDescription,
      fullDescription,
      selected,
      spamCheck: {
        densityLimit: SPAM_DENSITY,
        totalWords: analysis.totalWords,
        maxAllowed: analysis.maxAllowed,
        fixAttempts,
        clean: analysis.spam.length === 0,
        remaining: analysis.spam,
        frequency: analysis.frequency.slice(0, 50)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Внутрішня помилка сервера: ' + err.message });
  }
});

app.listen(PORT, () => {
  console.log(`WWA Publishers Tools running on http://localhost:${PORT}`);
  if (!API_KEY) console.warn('⚠  ANTHROPIC_API_KEY не заданий — сторінка ZIP Creating не зможе генерувати описи.');
});
