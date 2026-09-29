// Stemming groups related surface forms; it is not a dictionary lemmatizer.
// Keep these results transparent in the report rather than claiming ASOMobile parity.
const STEMMERS = Object.fromEntries(Object.entries({
  en: 'english', ar: 'arabic', hy: 'armenian', bg: 'bulgarian', da: 'danish', nl: 'dutch',
  fi: 'finnish', fr: 'french', de: 'german', el: 'greek', hu: 'hungarian', hi: 'indian',
  id: 'indonesian', ga: 'irish', it: 'italian', lt: 'lithuanian', ne: 'nepali',
  nb: 'norwegian', nn: 'norwegian', pt: 'portuguese', ro: 'romanian', ru: 'russian',
  sr: 'serbian', es: 'spanish', sv: 'swedish', ta: 'tamil', tr: 'turkish', uk: 'ukrainian'
}).map(([code, name]) => [code, require(`@orama/stemmers/${name}`).stemmer]));

const FAMILIES = {
  es: ['el la los las', 'uno un una unos unas', 'tu tus', 'su sus', 'este esta estos estas', 'ese esa esos esas'],
  fr: ['le la les', 'un une', 'ce cet cette ces', 'son sa ses', 'ton ta tes', 'mon ma mes', 'jeu jeux'],
  pt: ['o a os as', 'um uma uns umas', 'seu sua seus suas', 'este esta estes estas'],
  it: ['il lo la i gli le', 'uno un una', 'questo questa questi queste', 'tuo tua tuoi tue'],
  de: ['der die das den dem des', 'ein eine einen einem einer eines'],
};
const familyMaps = Object.fromEntries(Object.entries(FAMILIES).map(([code, families]) => [code,
  new Map(families.flatMap(group => group.split(' ').map(word => [word, group.split(' ')[0]])))]));

const CONTEXTUAL = new Set(['ko', 'fa']);
const suffixes = {
  ko: ['에서는', '에게서', '으로', '에서', '에게', '까지', '부터', '처럼', '보다', '하고', '이며', '은', '는', '이', '가', '을', '를', '와', '과', '도', '만', '에', '로'],
  fa: ['های', 'ها']
};
function wordKey(word, base, stop, vocabulary = new Set()) {
  const family = familyMaps[base]?.get(word);
  if (family) return `family:${family}`;
  // Avoid stemming short grammatical words into unrelated empty/small roots.
  if (stop.has(word)) return `exact:${word}`;
  if (CONTEXTUAL.has(base)) {
    const canonical = base === 'fa' ? word.replace(/\u200c/g, '') : word;
    for (const suffix of suffixes[base]) {
      if (!canonical.endsWith(suffix)) continue;
      const root = canonical.slice(0, -suffix.length);
      if (Array.from(root).length >= (base === 'ko' ? 2 : 3) && vocabulary.has(root)) return `exact:${root}`;
    }
    return `exact:${canonical}`;
  }
  if (base === 'en') word = word.replace(/'s$|'+$/g, '');
  const stem = STEMMERS[base]?.(word);
  return stem ? `stem:${stem}` : `exact:${word}`;
}
module.exports = { wordKey, STEMMERS, FAMILIES, CONTEXTUAL };
