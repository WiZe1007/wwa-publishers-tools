# Localize verification — 2026-09-28

## French regression — 2026-10-08

- Read both live textarea values: the WWA result and ASOMobile input were
  byte-for-byte identical JavaScript strings (3226 UTF-16 units).
- Saved that exact listing in `fixtures/french-blackjack.js`. External groups:
  `de 19`, `un 18`, `votre 14`. The old checker split `du`, `des`, `vos` off and
  incorrectly passed the listing. The new French family budgets detect all three.
- Standalone numbers explain 464 external words vs 456 lexical words internally;
  the conservative max remains 11, rather than increasing it to the external 12.
- Independent ASOMobile probe confirmed `votre/vos`, `notre/nos` grouping and
  contraction handling. It also assigned isolated `des` to `de`, while the
  actual listing assigned its `des` to `un`: these explicit budget rules are
  NOT a claim of context-sensitive French lemmatization or universal parity.
- 14 new tests cover all four French regional options, exact surface counts,
  function-word exemptions in natural/short fields, apostrophes, family uniqueness,
  surgical repair input, no-progress rejection, two-call cap, and export blocking.
- `npm test`: 891 passed. AI/provider tests use mocks; no paid Claude requests
  were made for this change. Successful real-model French rewriting is not claimed.
- Chrome localhost flow: select French, paste the exact three fields, click
  free repetition check. The three issues appear, the complete text remains
  unchanged, copy/download are disabled, and console warnings/errors are empty.
- Native browser input controls verified independently of the VM tests. The
  existing user tabs/form values were not reloaded or overwritten.

## Reproduction and fix

The actual Spanish listing in `fixtures/spanish-listing.js` previously passed
the internal exact-form checker. ASOMobile reported `el ×11`: it grouped
`el ×2`, `la ×4`, `los ×3`, `las ×2`. The new check flags this group and
also groups `ronda/rondas` (5) and `símbolo/símbolos` (4).

Reference examined interactively: https://app.asomobile.net/text-analyzer
and its official help https://intercom.help/asomobile/ru/articles/4480132-text-analyzer.
An independent 32-word Spanish probe confirmed article/plural grouping.
ASOMobile did NOT flag its 8 article occurrences at 25% density; consequently
its proprietary spam rule is NOT represented here as a universal 2.5% formula.
Our stricter rule remains explicitly labeled an internal heuristic.

## Automated checks

Run `npm test` (Node 20+, full ICU). Coverage includes:

- Actual failing Spanish listing, morphological families, individual form counts.
- All 107 locale codes: token-count invariants, normalization, search round trips.
- Ukrainian/Russian/English/native names, accentless searches, reordered country
  queries, underscore locale codes, zero matches, selection retention, keyboard events.
- Density boundaries, invisible characters, Chinese segmentation, Unicode lengths.
- AI repair payload includes grouped counts and the CURRENT localized result.
- Bounded retries, latest-candidate feedback, unavailable provider, partial-result
  preservation, timeout, validation, stale asynchronous responses and export guards.
- Copy full description without wrappers; all existing tools' regression tests.

## Real browser/provider checks (not mocks)

- Chrome: visible search results; Japanese via Russian query + Enter;
  Colombia via `Spanish Colombia` + click; `pt_BR`; zero-result query retains
  selected locale. No console errors observed.
- Responsive 390×844 viewport: search result readable/clickable; no horizontal
  document overflow (375px content width including the browser scrollbar).
- The actual failing Spanish listing was checked, then repaired through the
  new UI using the configured Anthropic provider. One attempt passed internally.
  Pasting that exact result into ASOMobile yielded **no spam**: leading groups
  `de`, `tu`, `con`, each 6/247 words = 2.43%.
- Separate live AI localization calls for a synthetic offline task/timer app:
  German passed after 5 attempts; Ukrainian after 3; Japanese remained flagged
  after 5 and was correctly NOT labeled ready.

## Known limits, deliberately not hidden

- ASOMobile counted the Spanish source as 256 words, our ICU tokenizer as 257;
  the repaired text as 247 vs 248. Counts are not claimed identical.
- The short Japanese sample was 73 segmented words internally but 12 sentence
  fragments in ASOMobile. Our strict 2.5% threshold still flagged it; ASOMobile did
  not. Users may need further edits under the strict internal rule. Do not remove
  legitimate grammar merely to satisfy a percentage.
- Stemming is approximate, not context-sensitive lemmatization; unsupported
  morphology is explicitly labeled exact-form only. Human review of translation,
  regional usage and factual accuracy remains necessary.
- `npm audit --omit=dev` reports 3 existing moderate advisories in the Express /
  body-parser / qs dependency chain. The added stemmer has no reported advisory;
  unrelated dependency upgrades were not included in this change.

Screenshots captured outside the repository:
`/tmp/wwa-asomobile-after-repair.png`, `/tmp/wwa-localize-search-mobile.png`.
