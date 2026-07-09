# WWA Publishers Tools

Внутрішній сайт з інструментами для публікації додатків:

- **ZIP Creating** — упаковка матеріалів додатку в .zip з AI-генерацією ASO описів (Claude)
- **Resize the Image** — зміна розміру зображень точно по px
- **Convert Images** — конвертація зображень між форматами
- **Merge Images** — об'єднання кількох зображень в одне

## Локальний запуск

1. Встановіть [Node.js](https://nodejs.org) (версія 18+)
2. У папці проєкту:
   ```bash
   npm install
   ```
3. Створіть файл `.env` (скопіюйте з `.env.example`) та вставте ваш Anthropic API ключ:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
4. Запустіть:
   ```bash
   npm start
   ```
5. Відкрийте http://localhost:3000

Без API ключа працюють усі сторінки, крім AI-генерації описів на ZIP Creating.

## Деплой на Render.com

1. Завантажте проєкт у GitHub репозиторій (`.env` НЕ комітиться — він у `.gitignore`)
2. На render.com: **New → Web Service** → підключіть репозиторій
3. Налаштування:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Environment → Add Environment Variable:** `ANTHROPIC_API_KEY` = ваш ключ
4. Deploy. Render сам призначить порт (сервер читає `process.env.PORT`)

## Структура

```
server.js          — Express сервер + endpoint /api/aso (Claude API)
public/index.html  — головна
public/zip.html    — ZIP Creating
public/resize.html — Resize the Image
public/convert.html— Convert Images
public/merge.html  — Merge Images
templates/         — шаблон How to Publish.txt (довідково; текст вбудовано в zip.html)
```

## Як працює ZIP Creating

1. Користувач заповнює форму та додає файли (скріншоти, apk, aab, banner, icon тощо)
2. Стиснуті копії скріншотів + назва + опис відправляються на сервер → Claude генерує short/full description і, якщо скріншотів > 8, обирає 8 найкращих
3. Довгий опис автоматично перевіряється на переспам (аналог ASOMobile Text Analyzer:
   слово не має вживатися більше ліміту разів, стоп-слова не рахуються). Якщо переспам є —
   Claude переписує опис (до 3 спроб). Ліміт налаштовується env-змінною `SPAM_LIMIT` (за замовчуванням 5)
4. На сторінці є кнопка «Перевірити на переспам» для ручної перевірки відредагованого тексту
   з таблицею частотності слів
5. ZIP збирається прямо в браузері (великі apk/aab на сервер не завантажуються):
   скріншоти нумеруються 1..8, заповнюється How to Publish.txt, додаються всі файли
