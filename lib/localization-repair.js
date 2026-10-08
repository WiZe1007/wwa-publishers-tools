const { tokenize } = require('./text-tokens');

const FIELDS = ['title', 'shortDescription', 'fullDescription'];
const copyFields = fields => ({ locale: fields.locale, profile: fields.profile,
  ...Object.fromEntries(FIELDS.map(field => [field, fields[field]])) });
const excess = checks => Object.values(checks.analyses).reduce((sum, analysis) =>
  sum + analysis.spam.reduce((n, item) => n + item.removeCount, 0), 0);
function scoreChecks(checks, qualityReview = false) {
  return (checks.issues.length + (checks.editor?.issues.length || 0) +
    (qualityReview && checks.editor?.status !== 'passed' ? 1 : 0)) * 1000 + excess(checks);
}

// Use surgical edits for a small residual problem, not another full rewrite.
// Offsets are UTF-16 indices into the ORIGINAL text; no regex-based replacement.
function createRepairPlan(fields, checks) {
  const analysis = checks.analyses.fullDescription;
  if (!analysis.spam.length || analysis.spam.length > 12 || excess(checks) > 40 ||
      checks.lengths.fullDescription > checks.limits.fullDescription ||
      checks.findings.some(item => item.severity === 'error' && item.field !== 'fullDescription') ||
      checks.issues.some(issue => issue.includes('письма')) ||
      checks.editor?.issues.length) return null;
  const flagged = new Set(analysis.spam.flatMap(item => item.forms.map(form => form.word)));
  const sentences = [];
  const segmenter = new Intl.Segmenter(fields.locale, { granularity: 'sentence' });
  let lineOffset = 0;
  for (const line of fields.fullDescription.split(/(?<=\n)/u)) {
    for (const { segment, index } of segmenter.segment(line)) {
      const text = segment.trim();
      const words = tokenize(text, fields.locale);
      const hits = words.filter(word => flagged.has(word));
      if (words.length < 4 || !hits.length) continue;
      const start = lineOffset + index + segment.indexOf(text);
      sentences.push({ start, end: start + text.length, text, hits });
    }
    lineOffset += line.length;
  }
  // Cover the actual reductions plus headroom with as FEW sentences as possible.
  // One residual possessive should not cost another 4,000-character rewrite.
  const remaining = new Map(analysis.spam.map(item => [item.word, item.count - analysis.budget.repairTarget]));
  const owner = new Map(analysis.spam.flatMap(item => item.forms.map(form => [form.word, item.word])));
  const gain = sentence => {
    const counts = new Map();
    for (const word of sentence.hits) counts.set(owner.get(word), (counts.get(owner.get(word)) || 0) + 1);
    return [...counts].reduce((sum, [word, count]) => sum + Math.min(count, remaining.get(word)), 0);
  };
  const selected = [];
  while (selected.length < 8 && [...remaining.values()].some(count => count > 0)) {
    const next = sentences.filter(item => !selected.includes(item)).sort((a, b) => gain(b) - gain(a) || a.text.length - b.text.length)[0];
    if (!next || !gain(next)) break;
    selected.push(next);
    for (const word of next.hits) remaining.set(owner.get(word), Math.max(0, remaining.get(owner.get(word)) - 1));
  }
  selected.sort((a, b) => a.start - b.start);
  if (!selected.length) return null;
  return { sentences: selected.map((item, index) => ({ ...item, id: `s${index + 1}` })),
    wordsToReduce: analysis.spam,
    // Show near-limit groups too: replacing tu with el must not create el spam.
    wordsToWatch: analysis.frequency.filter(item => item.count >= analysis.budget.repairTarget &&
      !analysis.spam.some(spam => spam.word === item.word)),
    maxAllowed: analysis.maxAllowed, repairTarget: analysis.budget.repairTarget };
}

function applyEdits(text, edits) {
  let result = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return result;
}
function numbers(text) {
  return [...text.normalize('NFKC').matchAll(/\p{N}+(?:[.,]\p{N}+)*/gu)].map(match => match[0]).sort().join('|');
}

function applyRepairPlan(fields, plan, response, check) {
  if (!Array.isArray(response.replacements) || response.replacements.length > plan.sentences.length)
    throw new Error('invalid AI repair response');
  const seen = new Set(), choices = new Map();
  for (const item of response.replacements) {
    const sentence = plan.sentences.find(part => part.id === item?.id);
    if (!sentence || seen.has(item.id) || !Array.isArray(item.alternatives) ||
        !item.alternatives.length || item.alternatives.length > 3 ||
        item.alternatives.some(text => typeof text !== 'string' || text.length > 2400))
      throw new Error('invalid AI repair response');
    seen.add(item.id);
    // Empty edits, fabricated quantities and invisible spelling tricks are not
    // acceptable shortcuts. Semantic/grammatical review remains an AI task.
    choices.set(item.id, [...new Set(item.alternatives.map(text => text.trim()))].filter(text =>
      text && text !== sentence.text && tokenize(text, fields.locale).length >= 3 &&
      !/[\u00ad\u200b\u2060\ufeff]/u.test(text) && numbers(text) === numbers(sentence.text)));
  }
  const initial = copyFields(fields), initialChecks = check(initial);
  let beam = [{ fields: initial, checks: initialChecks, edits: [], score: scoreChecks(initialChecks) }];
  // Bounded local search, no provider calls. Recheck the WHOLE listing for each
  // combination, including shortened budgets and newly repeated word families.
  for (const sentence of plan.sentences) {
    const next = [...beam];
    for (const state of beam) for (const text of choices.get(sentence.id) || []) {
      const edits = [...state.edits, { start: sentence.start, end: sentence.end, text }];
      const candidate = { ...initial, fullDescription: applyEdits(initial.fullDescription, edits) };
      const checks = check(candidate);
      next.push({ fields: candidate, checks, edits, score: scoreChecks(checks) });
    }
    const unique = new Map();
    for (const state of next.sort((a, b) => a.score - b.score || a.edits.length - b.edits.length))
      if (!unique.has(state.fields.fullDescription)) unique.set(state.fields.fullDescription, state);
    beam = [...unique.values()].slice(0, 6);
    if (beam[0].checks.clean) break;
  }
  return beam[0];
}

function repairProgress(before, after) {
  const beforeExcess = excess(before), afterExcess = excess(after);
  return { beforeExcess, afterExcess,
    status: after.clean ? 'fixed' : scoreChecks(after) < scoreChecks(before) ? 'improved' : 'unchanged' };
}

module.exports = { createRepairPlan, applyRepairPlan, copyFields, scoreChecks, repairProgress };
