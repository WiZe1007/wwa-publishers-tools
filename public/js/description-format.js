// One small, dependency-free formatter for Node analysis and browser previews.
// Escape everything first; only the exact formatting grammar below becomes HTML.
(function (scope) {
  const entities = new Map(Object.entries({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }));
  const colors = new Set(['red', 'blue', 'green', 'purple', 'orange', 'teal', 'navy', 'brown', 'black']);
  const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, key) => {
    if (key[0] !== '#') return entities.get(key.toLowerCase()) || entity;
    const point = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1));
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff) ? String.fromCodePoint(point) : '\ufffd';
  });
  const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  function formatDescription(value, { continuation = false } = {}) {
    const parts = String(value || '').match(/<[^<>]*>|[^<]+|</g) || [];
    const stack = [];
    const open = { b: 0, i: 0, u: 0, font: 0 };
    let html = '', text = '', hasMarkup = false;
    for (const part of parts) {
      const simple = part.match(/^<\s*(b|i|u)\s*>$/i);
      const font = part.match(/^<\s*font\s+color\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'|([^\s<>]+))\s*>$/i);
      const color = font && (font[1] || font[2] || font[3] || '').toLowerCase();
      const close = part.match(/^<\s*\/\s*(b|i|u|font)\s*>$/i);
      if (simple || (font && (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) || colors.has(color)))) {
        const tag = simple ? simple[1].toLowerCase() : 'font';
        html += tag === 'font' ? `<font color="${color}">` : `<${tag}>`;
        stack.push({ tag, markup: tag === 'font' ? `<font color="${color}">` : `<${tag}>` }); open[tag]++; hasMarkup = true;
      } else if (close && open[close[1].toLowerCase()] > 0) {
        let tag;
        do { ({ tag } = stack.pop()); open[tag]--; html += `</${tag}>`; } while (tag !== close[1].toLowerCase());
      } else if (/^<\s*br\s*\/?\s*>$/i.test(part)) {
        html += '\n'; text += '\n'; hasMarkup = true;
      } else {
        const visible = decode(part);
        html += escape(visible); text += visible;
      }
    }
    const reopen = continuation ? stack.map(item => item.markup).join('') : '';
    while (stack.length) html += `</${stack.pop().tag}>`;
    return { html, text, hasMarkup, ...(continuation ? { reopen } : {}) };
  }

  function emphasizeOpening(value) {
    const source = String(value || '').trim();
    const boundary = source.search(/\r?\n[ \t]*\r?\n/);
    const first = formatDescription(boundary < 0 ? source : source.slice(0, boundary), { continuation: true });
    const intro = first.text.trim();
    if (!intro) return source;
    const sentences = new Intl.Segmenter('en', { granularity: 'sentence' }).segment(intro);
    let opening = '', count = 0;
    for (const sentence of sentences) {
      opening += sentence.segment;
      if (++count === 2) break;
    }
    opening = opening.trimEnd();
    return `<b><font color="#D32F2F">${escape(opening)}</font></b>` + escape(intro.slice(opening.length)) +
      (boundary < 0 ? '' : source.slice(boundary).replace(/^(\r?\n[ \t]*\r?\n)/, `$1${first.reopen}`));
  }

  const api = { formatDescription, emphasizeOpening };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.WWADescriptionFormat = Object.freeze(api);
})(globalThis);
