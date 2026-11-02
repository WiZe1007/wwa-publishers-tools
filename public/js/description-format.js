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

  function formatDescription(value) {
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
        stack.push(tag); open[tag]++; hasMarkup = true;
      } else if (close && open[close[1].toLowerCase()] > 0) {
        const index = stack.lastIndexOf(close[1].toLowerCase());
        while (stack.length > index) { const tag = stack.pop(); open[tag]--; html += `</${tag}>`; }
      } else if (/^<\s*br\s*\/?\s*>$/i.test(part)) {
        html += '\n'; text += '\n'; hasMarkup = true;
      } else {
        const visible = decode(part);
        html += escape(visible); text += visible;
      }
    }
    while (stack.length) html += `</${stack.pop()}>`;
    return { html, text, hasMarkup };
  }

  const api = { formatDescription };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.WWADescriptionFormat = Object.freeze(api);
})(globalThis);
