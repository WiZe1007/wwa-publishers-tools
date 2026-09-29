// One Unicode pipeline for word counts, phrase counts and duplicate sentences.
// Do not globally strip accents: they distinguish words in many languages.
const segmenters = new Map();
function normalizeText(text, locale) {
  const base = locale.split('-')[0];
  let value = text.normalize('NFKC').toLocaleLowerCase(locale)
    .replace(/[\u00ad\u200b\u200e\u200f\u202a-\u202e\u2060-\u2069\ufeff]/g, '')
    .replace(/[’‘ʼ]/g, "'");
  // Joiners are legitimate in Persian and Indic orthography. Remove them only
  // between letters in scripts where they otherwise conceal an ordinary word.
  value = value.replace(/([\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}])[\u200c\u200d]+(?=[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}])/gu, '$1')
    .replace(/([\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}])[\u200c\u200d]+(?=\s|$|\p{P})/gu, '$1');
  if (['ar', 'fa', 'ur', 'ps'].includes(base)) {
    value = value.replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g, '');
  }
  if (base === 'fa') value = value.replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  if (base === 'uz') value = value.replace(/ʻ/g, "'");
  if (base === 'he') value = value.replace(/[\u0591-\u05bd\u05bf-\u05c2\u05c4-\u05c5\u05c7]/g, '');
  return value.normalize('NFC');
}

function tokenize(text, locale, { includeNumbers = false } = {}) {
  if (!segmenters.has(locale)) segmenters.set(locale, new Intl.Segmenter(locale, { granularity: 'word' }));
  // Underscores and dashes are separators, not a way to turn repeated words
  // into a single token. Apostrophes and language-specific vowel marks survive.
  let normalized = normalizeText(text, locale).replace(/[\p{Pd}\p{Pc}]/gu, ' ');
  const base = locale.split('-')[0];
  if (base === 'fr') normalized = normalized.replace(/\b(l|d|j|t|s|n|c|m|qu|jusqu|lorsqu|puisqu|quoiqu)'(?=\p{L})/gu, '$1 ');
  if (base === 'it') normalized = normalized.replace(/\b(l|dell|all|nell|sull|dall|un)'(?=\p{L})/gu, '$1 ');
  return [...segmenters.get(locale).segment(normalized)]
    .filter(item => item.isWordLike && (includeNumbers ? /[\p{L}\p{N}]/u : /\p{L}/u).test(item.segment))
    .map(item => item.segment);
}

module.exports = { normalizeText, tokenize };
