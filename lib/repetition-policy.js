const { normalizeText } = require('./text-tokens');

// ASOMobile black-box probes (2026-09-29): the allowed count changes with
// character length, not just density. This is a conservative internal guard,
// not a claim to reproduce their proprietary tokenization or lemmatization.
const STRICT_DENSITY = 2.5;
const CHARACTERS_PER_USE = 250;
function repetitionBudget(text, locale, totalWords, profile = 'strict') {
  // Collapse whitespace and normalize invisible spelling tricks so padding
  // cannot inflate the character budget. Code points avoid double-counting emoji.
  const characters = Array.from(normalizeText(text, locale).replace(/\s+/gu, ' ').trim()).length;
  const densityMax = Math.max(1, Math.floor(totalWords * STRICT_DENSITY / 100));
  const characterMax = Math.max(1, Math.floor(characters / CHARACTERS_PER_USE));
  const strictMaxAllowed = Math.min(densityMax, characterMax);
  return { characters, densityMax, characterMax, strictMaxAllowed,
    maxAllowed: profile === 'natural' ? Math.max(3, Math.floor(totalWords * .04)) : strictMaxAllowed,
    // Aim below the CURRENT boundary: shortening a repair can lower its budget.
    repairTarget: profile === 'natural' ? Math.max(3, Math.floor(totalWords * .9 * .04))
      : Math.max(1, Math.min(Math.floor(totalWords * .9 * STRICT_DENSITY / 100), Math.floor(characters * .9 / CHARACTERS_PER_USE))) };
}
module.exports = { repetitionBudget, STRICT_DENSITY, CHARACTERS_PER_USE };
