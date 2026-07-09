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
  semi: `Стиль опису — НАПІВ-АГРЕСИВНИЙ (енергійний маркетинг):
- Динамічний, захопливий тон з сильними дієсловами (discover, unleash, master, boost).
- Яскраво підкресли переваги та відчуття від використання.
- 2-3 впевнені заклики до дії по тексту.
- Риторичні питання-хуки на початку доречні ("Ready to...?").
- Емодзі: активно — заголовки, списки, акценти на перевагах.`,
  aggressive: `Стиль опису — АГРЕСИВНИЙ (максимальний маркетинговий драйв):
- Потужний чіпляючий хук з першого рядка, який неможливо проігнорувати.
- Емоційні тригери: азарт, виклик, цікавість, страх пропустити ("your next adventure is waiting", "can you handle it?").
- Часті сильні заклики до дії, короткі ударні речення, відчуття терміновості.
- Емодзі: максимально яскраво — хук з емодзі, заголовки, списки, заклики до дії (але без хаосу, 1-2 поспіль).
- Але БЕЗ порушень правил Google Play: без обману, без КАПСУ, без "!!!", без фейкових обіцянок та вигаданих цифр — драйв досягається мовою, а не порушеннями.`
};

// ===== Обсяг повного опису =====
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
2. "full_description" — повний опис для Google Play, англійською. ${SIZE_INSTRUCTIONS[size] || SIZE_INSTRUCTIONS.small} ОБОВ'ЯЗКОВО використовуй доречні емодзі: на початку ключових абзаців, у заголовках секцій (наприклад "🎮 HOW TO PLAY", "⭐ GAME FEATURES") та як марери пунктів списку функцій (замість "•" — тематичні емодзі: 🧩 ⚡ 🏆 🎯 💎 🔥 тощо, підбирай під зміст). Емодзі мають виглядати органічно, не більше 1-2 поспіль.

${TONE_INSTRUCTIONS[tone] || TONE_INSTRUCTIONS.normal}

ОБОВ'ЯЗКОВО для будь-якого стилю (Google Play metadata policy):
- НАЙВАЖЛИВІШЕ: кожна функція, режим чи особливість, згадана в описі, має підтверджуватися АБО описом розробника, АБО тим, що видно на скріншотах. Якщо чогось немає ні там, ні там — НЕ згадуй це взагалі. Не додавай типові для жанру фічі "за замовчуванням" (мультиплеєр, лідерборди, щоденні нагороди, скіни тощо), якщо їх не видно. Краще коротший чесний опис, ніж вигаданий функціонал.
- Жодних вигаданих функцій чи неправдивих обіцянок.
- Без слів ПОВНІСТЮ КАПСОМ (окрім абревіатур), без повторюваної пунктуації (!!!, ???).
- Емодзі дозволені ТІЛЬКИ у full_description. У short_description — ЗАБОРОНЕНІ (політика Google Play), там лише текст і розділові знаки.
- Без неперевірених заяв типу "#1 app", "the best app", без згадок конкурентів, рейтингів чи цін.
- Опис має пройти модерацію Google Play без ризику блокування.
- АНТИ-ПЕРЕСПАМ: не повторюй жодне значуще слово (включно з усіма його формами: множина, -ing, -ed, у складених словах через дефіс) частіше ніж ~2 рази на кожні 100 слів тексту. Наприклад, у тексті на 220 слів — максимум 5 повторів одного слова. Активно використовуй синоніми.`;

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
    const MAX_FIX = 3;

    while (analysis.spam.length > 0 && fixAttempts < MAX_FIX) {
      fixAttempts++;
      console.log(`Spam fix attempt ${fixAttempts}:`, analysis.spam.map(s => `${s.word}(${s.count}, ${s.density}%)`).join(', '));
      try {
        const safeMax = Math.max(1, analysis.maxAllowed - 1); // запас міцності на різницю в підрахунку
        const fixPrompt = `Below is a full description for Google Play for the app "${appName}".
A keyword-spam check (ASOMobile Text Analyzer) found over-used words. Rule: a word's density must not exceed ${SPAM_DENSITY}% of the total word count. The text has ${analysis.totalWords} words. All forms of a word count together: singular + plural + -ing/-ed forms + inside hyphenated words (tap + taps + tapping + tapped + tap-to-win all count as "tap").

Over-used words:
${analysis.spam.map(s => `- "${s.word}" — used ${s.count} times (${s.density}%), allowed max ${safeMax}`).join('\n')}

Rewrite the description so that:
1. Each of these words (counting ALL its forms) appears no more than ${safeMax} times — replace extra occurrences with synonyms or rephrase. Do not simply delete sentences; keep overall length similar.
2. The meaning, features and overall length stay the same.
3. Do NOT add features that are not mentioned.
4. Keep it natural, high-quality English for Google Play.
5. Keep the same marketing tone and energy as the original text, including all emojis and formatting.

Description:
${fullDescription}

Respond STRICTLY as JSON without markdown:
{"full_description": "..."}`;
        const fixed = extractJSON(await callClaude([{ type: 'text', text: fixPrompt }]));
        if (fixed.full_description) fullDescription = String(fixed.full_description);
        analysis = analyzeText(fullDescription);
      } catch (e) {
        console.error('Spam fix failed:', e.message);
        break;
      }
    }

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
