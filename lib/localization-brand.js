const { randomUUID } = require('node:crypto');
const DESCRIPTION_FIELDS = ['shortDescription', 'fullDescription'];
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const word = /[\p{L}\p{M}\p{N}]/u;
const joinedScript = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const latin = /\p{Script=Latin}/u;
function attached(edge, neighbor) {
  if (!neighbor || !word.test(edge) || !word.test(neighbor) || joinedScript.test(edge) || joinedScript.test(neighbor)) return false;
  // A Latin proper name can touch Arabic conjunctions or CJK text, but Cat
  // inside Catapult is not evidence that a description mentions the brand Cat.
  if (/\p{L}/u.test(edge) && /\p{L}/u.test(neighbor) && latin.test(edge) !== latin.test(neighbor)) return false;
  return true;
}
function replaceName(text, name, replacement) {
  return text.replace(new RegExp(escape(name), 'giu'), (match, offset) => {
    const before = Array.from(text.slice(0, offset)).at(-1);
    const after = Array.from(text.slice(offset + match.length))[0];
    return attached(Array.from(match)[0], before) || attached(Array.from(match).at(-1), after) ? match : replacement;
  });
}
const mentions = (text, name) => replaceName(text, name, '\u0000') !== text;

function createBrandProtection(source, reference = source) {
  if (!source.preserveTitle) return null;
  const title = reference.title;
  // Use only names evidenced by BOTH the title and original descriptions.
  // Regional titles such as "Egypt : Global Casino" mention just the suffix
  // in their copy. Do not guess arbitrary capitalized words or translate names.
  const candidates = [...new Set([title, ...title.split(/\s*[:：|]\s*/u)].filter(Boolean))];
  const names = candidates.filter(name => DESCRIPTION_FIELDS.some(field => mentions(reference[field], name)))
    .sort((a, b) => b.length - a.length);
  const required = Object.fromEntries(DESCRIPTION_FIELDS.map(field => [field,
    names.filter(name => mentions(reference[field], name)).filter(name =>
      !names.some(longer => longer !== name && mentions(longer, name) && mentions(reference[field], longer)))]));
  let prefix;
  do { prefix = '__' + randomUUID().slice(0, 8); }
  while ([source, reference].some(fields => Object.values(fields).some(text => typeof text === 'string' && text.toLowerCase().includes(prefix))));
  const entries = names.map((name, index) => ({ name, token: `${prefix}${index.toString(16).padStart(2, '0')}__` }));
  const mapFields = (fields, transform) => ({ ...fields,
    ...Object.fromEntries(DESCRIPTION_FIELDS.map(field => [field, transform(fields[field])])) });
  return {
    title, names, required,
    contract: { title, names: entries, required,
      rule: 'Keep at least one exact original name in each required field. Repeated brand mentions may be reduced, never translated, transliterated or all removed. Tokens are restored to the listed names before character and repetition checks.' },
    maskText: text => entries.reduce((value, { name, token }) => replaceName(value, name, token), text),
    mask(fields) { return mapFields(fields, this.maskText); },
    restore(fields) {
      return mapFields(fields, text => entries.reduce((value, { name, token }) =>
        replaceName(value.split(token).join(name), name, name), text));
    },
    missing(fields) {
      const missing = fields.title !== title ? [{ field: 'title', name: title }] : [];
      for (const field of DESCRIPTION_FIELDS) for (const name of required[field])
        if (!mentions(fields[field], name) || replaceName(fields[field], name, name) !== fields[field]) missing.push({ field, name });
      return missing;
    }
  };
}

module.exports = { createBrandProtection };
