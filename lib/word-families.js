// Stemming groups related surface forms; it is not a dictionary lemmatizer.
// Keep these results transparent in the report rather than claiming ASOMobile parity.
const STEMMERS = Object.fromEntries(Object.entries({
  ar: 'arabic', hy: 'armenian', bg: 'bulgarian', da: 'danish', nl: 'dutch',
  fi: 'finnish', fr: 'french', de: 'german', el: 'greek', hu: 'hungarian',
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

function wordKey(word, base, stop, normalizeEnglish) {
  const family = familyMaps[base]?.get(word);
  if (family) return `family:${family}`;
  // Avoid stemming short grammatical words into unrelated empty/small roots.
  if (stop.has(word)) return `exact:${word}`;
  const stem = base === 'en' ? normalizeEnglish(word) : STEMMERS[base]?.(word);
  return stem ? `stem:${stem}` : `exact:${word}`;
}
module.exports = { wordKey, STEMMERS, FAMILIES };
