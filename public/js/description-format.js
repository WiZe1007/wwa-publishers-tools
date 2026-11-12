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
  function parts(value) {
    const source = String(value || ''), result = [];
    let start = 0, index = 0;
    while (index < source.length) {
      if (source[index] !== '<' || !/^<\s*\/?\s*[a-z]/i.test(source.slice(index))) { index++; continue; }
      let end = index + 1, malformed = false;
      while (end < source.length && !['<', '>'].includes(source[end])) {
        if (source[end] === '"' || source[end] === "'") {
          const quoteEnd = source.indexOf(source[end], end + 1);
          const colorAttribute = /\bcolor\s*=\s*$/i.test(source.slice(index, end));
          if (quoteEnd < 0 || !/[\s/>]/.test(source[quoteEnd + 1] || '>') ||
              (colorAttribute && /[<>]/.test(source.slice(end + 1, quoteEnd)))) {
            // Recover at the next delimiter; never swallow the visible body.
            const delimiters = [source.indexOf('>', end + 1), source.indexOf('<', end + 1)].filter(at => at >= 0);
            end = delimiters.length ? Math.min(...delimiters) : source.length;
            malformed = true; break;
          }
          end = quoteEnd;
        }
        end++;
      }
      if (start < index) result.push({ raw: source.slice(start, index), tag: false });
      const closed = end < source.length && source[end] === '>';
      const next = closed ? end + 1 : end;
      result.push({ raw: source.slice(index, next), tag: true, malformed: malformed || !closed });
      index = start = next;
    }
    if (start < source.length) result.push({ raw: source.slice(start), tag: false });
    return result;
  }

  function formatDescription(value, { continuation = false } = {}) {
    const chunks = parts(value);
    const stack = [];
    const open = { b: 0, i: 0, u: 0, font: 0 };
    let html = '', text = '', hasMarkup = false;
    for (const { raw: part } of chunks) {
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

  function emphasizeOpening(value, { locale = 'en', preserveWhitespace = false } = {}) {
    const source = preserveWhitespace ? String(value || '') : String(value || '').trim();
    const boundary = source.search(/\r?\n[ \t]*\r?\n/);
    const first = formatDescription(boundary < 0 ? source : source.slice(0, boundary), { continuation: true });
    const intro = first.text.trim();
    if (!intro) return source;
    const leading = preserveWhitespace ? first.text.match(/^\s*/)[0] : '';
    const trailing = preserveWhitespace ? first.text.match(/\s*$/)[0] : '';
    const sentences = new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(intro);
    let opening = '', count = 0;
    for (const sentence of sentences) {
      opening += sentence.segment;
      if (++count === 2) break;
    }
    opening = opening.trimEnd();
    return escape(leading) + `<b><font color="#D32F2F">${escape(opening)}</font></b>` + escape(intro.slice(opening.length)) + escape(trailing) +
      (boundary < 0 ? '' : source.slice(boundary).replace(/^(\r?\n[ \t]*\r?\n)/, `$1${first.reopen}`));
  }

  const isRed = color => ['red', '#f00', '#ff0000', '#d32f2f'].includes(color);
  function token(part) {
    const simple = part.match(/^<\s*(b|i|u)\s*>$/i);
    const font = part.match(/^<\s*font\s+color\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)'|([^\s<>]+))\s*>$/i);
    const color = font && (font[1] || font[2] || font[3] || '').toLowerCase();
    if (simple) return { tag: simple[1].toLowerCase() };
    if (font && (/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(color) || colors.has(color))) return { tag: 'font', color };
    const close = part.match(/^<\s*\/\s*(b|i|u|font)\s*>$/i);
    if (close) return { tag: close[1].toLowerCase(), close: true };
    if (/^<\s*br\s*\/?\s*>$/i.test(part)) return { tag: 'br' };
    return null;
  }
  function inspect(value, locale) {
    const stack = [], spans = [], issues = [], codes = new Set();
    const counts = { b: 0, i: 0, u: 0, font: 0 };
    let text = '', hasMarkup = false;
    const add = (code, message) => { if (!codes.has(code)) { codes.add(code); issues.push({ code, message }); } };
    const finish = item => spans.push({ ...item, end: text.length });
    for (const { raw: part, tag, malformed } of parts(value)) {
      if (malformed) { add('incomplete_tag', 'HTML-тег обірвано або не закрито лапки атрибута.'); hasMarkup = true; continue; }
      const item = tag ? token(part) : null;
      if (!item) {
        if (/^<\s*\/?\s*[a-z][\s\S]*>$/i.test(part)) add('unsupported_tag', 'Є непідтримувані HTML-теги або атрибути.');
        else text += decode(part);
      } else if (item.tag === 'br') { text += '\n'; hasMarkup = true; }
      else if (item.close) {
        if (!counts[item.tag]) { add('stray_close', 'Є зайвий закривальний тег.'); continue; }
        if (stack.at(-1).tag !== item.tag) add('crossed_tags', 'Теги вкладено в неправильному порядку.');
        let opened;
        do { opened = stack.pop(); counts[opened.tag]--; finish(opened); } while (opened.tag !== item.tag);
      } else {
        hasMarkup = true;
        stack.push({ ...item, start: text.length }); counts[item.tag]++;
        if (stack.length > 64) {
          add('deep_nesting', 'Забагато вкладених тегів. Спростіть оформлення.');
          return { valid: false, issues, text, spans: [], hasMarkup };
        }
      }
    }
    if (stack.length) add('unclosed_tag', 'Є незакриті теги — оформлення може перейти на решту опису.');
    while (stack.length) finish(stack.pop());
    const boundary = text.search(/\r?\n[ \t]*\r?\n/);
    const intro = text.slice(0, boundary < 0 ? text.length : boundary);
    let openingEnd = 0, count = 0;
    for (const sentence of new Intl.Segmenter(locale, { granularity: 'sentence' }).segment(intro)) {
      openingEnd = sentence.index + sentence.segment.trimEnd().length;
      if (++count === 2) break;
    }
    for (const item of spans) {
      const content = text.slice(item.start, item.end);
      if (/\r?\n[ \t]*\r?\n/.test(content)) add(item.tag === 'font' ? 'color_spill' : 'emphasis_spill',
        item.tag === 'font' ? 'Колір переходить на кілька абзаців.' : 'Виділення переходить на кілька абзаців.');
      if (item.tag !== 'font' || !content.trim()) continue;
      if (isRed(item.color)) {
        if (text.slice(Math.max(openingEnd, item.start), item.end).trim()) add('red_body', 'Червоним мають бути лише перші 1–2 речення.');
      } else {
        const before = text.slice(0, item.start).split('\n').at(-1);
        const after = text.slice(item.end).split('\n')[0];
        item.heading = !/[\r\n]/.test(content) && Array.from(content.trim()).length <= 120 && !before.trim() && !after.trim();
        if (!item.heading) add('colored_body', 'Залиште кольоровими лише короткі заголовки; основний текст — звичайним.');
      }
    }
    return { valid: !issues.length, issues, text, spans, hasMarkup };
  }
  function checkDescriptionFormat(value, { locale = 'en' } = {}) {
    const { valid, issues, hasMarkup } = inspect(value, locale);
    return { valid, issues, hasMarkup };
  }
  function repairDescriptionFormat(value, { locale = 'en' } = {}) {
    const source = parts(value).map(({ raw, tag, malformed }) => malformed ? (raw.endsWith('>') ? '' : escape(raw))
      : tag && token(raw)?.tag === 'br' ? '\n'
      : tag && /^<\s*\/?\s*(?:p|div|section|article|h[1-6]|li|ul|ol|blockquote)(?=[\s/>])/i.test(raw) ? '\n\n' : raw).join('');
    const inspection = inspect(source, locale);
    const headings = new Map(inspection.spans.filter(item => item.heading)
      .map(item => [inspection.text.slice(item.start, item.end).trim(), item.color]));
    const stack = [], counts = { b: 0, i: 0, u: 0 };
    let html = '', afterNewline = false;
    const closeAll = () => { while (stack.length) { const tag = stack.pop(); if (--counts[tag] === 0) html += `</${tag}>`; } };
    for (const { raw: part, tag: isTag } of parts(source)) {
      const item = isTag ? token(part) : null;
      if (item?.tag === 'font') continue;
      if (item && item.tag !== 'br') {
        if (item.close) {
          if (!counts[item.tag]) continue;
          let tag;
          do { tag = stack.pop(); if (--counts[tag] === 0) html += `</${tag}>`; } while (tag !== item.tag);
        } else { stack.push(item.tag); if (++counts[item.tag] === 1) html += `<${item.tag}>`; }
      } else if (!isTag || !/^<\s*\/?\s*[a-z][\w:-]*(?=[\s/>])[\s\S]*>$/i.test(part)) {
        for (const piece of decode(part).split(/(\r?\n[ \t]*\r?\n)/)) {
          if (/^\r?\n[ \t]*\r?\n$/.test(piece) || (afterNewline && /^[ \t]*\r?\n/.test(piece))) closeAll();
          html += escape(piece);
          for (const char of piece) { if (char === '\n') afterNewline = true; else if (!/[ \t\r]/.test(char)) afterNewline = false; }
        }
      }
    }
    closeAll();
    html = html.split('\n').map(line => {
      const formatted = formatDescription(line), color = headings.get(formatted.text.trim());
      return color && formatted.html === line ? `<font color="${color}">${line}</font>` : line;
    }).join('\n');
    if (inspection.spans.some(item => isRed(item.color))) {
      html = emphasizeOpening(html, { locale, preserveWhitespace: true });
    }
    return html;
  }

  const api = { formatDescription, emphasizeOpening, checkDescriptionFormat, repairDescriptionFormat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else scope.WWADescriptionFormat = Object.freeze(api);
})(globalThis);
