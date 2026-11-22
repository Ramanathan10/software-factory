import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderMarkdown } from './ui/markdown.js';

const el = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat().filter(child => child !== null && child !== undefined && child !== false) });
const text = node => typeof node === 'string' ? node : node.children.map(text).join('');

test('plan markdown renders structure without treating text as HTML', () => {
  const [heading, list, table, para] = renderMarkdown([
    '## Scope', '- **Nested** `A|B`', '  - child', '', '| AC | Test |', '|---|---|', '| 1 | Browse |', '',
    '<img src=x onerror=alert(1)> [doc](javascript:alert(1)) [ok](https://example.com)',
  ].join('\n'), el);
  assert.equal(heading.tag, 'h4');
  assert.equal(list.tag, 'ul');
  assert.equal(list.children[0].children[0].tag, 'strong');
  assert.equal(list.children[0].children.at(-1).tag, 'ul');
  assert.equal(table.children[0].children[1].children[0].children[1].children[0], 'Browse');
  assert.equal(para.tag, 'p');
  assert.match(text(para), /^<img src=x onerror=alert\(1\)> \[doc\]\(javascript:alert\(1\)\) ok$/);
  assert.equal(para.children.at(-1).attrs.href, 'https://example.com');
});
