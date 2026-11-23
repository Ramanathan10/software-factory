const inline = (text, el) => {
  const out = [];
  const pattern = /(`[^`]+`)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    if (match[1]) out.push(el('code', {}, match[1].slice(1, -1)));
    else if (match[2] || match[3]) out.push(el('strong', {}, ...inline(match[2] ?? match[3], el)));
    else if (match[4]) out.push(el('em', {}, ...inline(match[4], el)));
    else {
      const safe = /^(https?:|mailto:)/i.test(match[6]);
      out.push(safe ? el('a', { href: match[6], target: '_blank', rel: 'noopener' }, match[5]) : match[0]);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
};

const listItem = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());

function list(lines, start, el) {
  const indent = lines[start].match(listItem)[1].length;
  const ordered = /\d/.test(lines[start].match(listItem)[2]);
  const items = [];
  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(listItem);
    if (!match || match[1].length < indent) {
      if (match || !lines[i].trim() || !/^\s+/.test(lines[i]) || !items.length) break;
      items.at(-1).push(' ', ...inline(lines[i].trim(), el));
      i++;
      continue;
    }
    if (match[1].length > indent) {
      const [child, next] = list(lines, i, el);
      items.at(-1).push(child);
      i = next;
      continue;
    }
    const task = match[3].match(/^\[([ xX])\]\s+(.*)$/);
    items.push(task ? [el('input', { type: 'checkbox', disabled: true, checked: task[1] !== ' ' }), ' ', ...inline(task[2], el)] : inline(match[3], el));
    i++;
  }
  return [el(ordered ? 'ol' : 'ul', {}, items.map(children => el('li', {}, ...children))), i];
}

export function renderMarkdown(text, el) {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    const fence = line.match(/^\s*(```|~~~)/);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i]);
      blocks.push(el('pre', {}, el('code', {}, body.join('\n'))));
      i++;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) { blocks.push(el('h' + Math.min(6, heading[1].length + 2), {}, ...inline(heading[2], el))); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { blocks.push(el('hr')); i++; continue; }
    if (line.includes('|') && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '') && lines[i + 1].includes('-')) {
      const head = cells(line);
      const rows = [];
      for (i += 2; i < lines.length && lines[i].includes('|') && lines[i].trim(); i++) rows.push(cells(lines[i]));
      blocks.push(el('div', { class: 'md-table' }, el('table', {},
        el('thead', {}, el('tr', {}, head.map(cell => el('th', {}, ...inline(cell, el))))),
        el('tbody', {}, rows.map(row => el('tr', {}, head.map((_, n) => el('td', {}, ...inline(row[n] ?? '', el)))))))));
      continue;
    }
    if (listItem.test(line)) { const [node, next] = list(lines, i, el); blocks.push(node); i = next; continue; }
    if (/^\s*>/.test(line)) {
      const quote = [];
      for (; i < lines.length && /^\s*>/.test(lines[i]); i++) quote.push(lines[i].replace(/^\s*>\s?/, ''));
      blocks.push(el('blockquote', {}, ...renderMarkdown(quote.join('\n'), el)));
      continue;
    }
    const para = [];
    for (; i < lines.length && lines[i].trim() && !listItem.test(lines[i]) && !/^\s*(#{1,6}\s|```|~~~|>)/.test(lines[i]); i++) para.push(lines[i].trim());
    blocks.push(el('p', {}, ...inline(para.join(' '), el)));
  }
  return blocks;
}
