import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newlyWaiting, titleFor } from './ui/attention.js';
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

test('each thing that starts waiting on the owner is announced once, and never on the first frame', () => {
  const a = { key: 'TL-1|planning|q1' };
  const b = { key: 'TL-2|approval' };
  const first = newlyWaiting(null, [a]);
  assert.deepEqual(first.fresh, []);
  const second = newlyWaiting(first.seen, [a, b]);
  assert.deepEqual(second.fresh, [b]);
  assert.deepEqual(newlyWaiting(second.seen, [a, b]).fresh, []);
  const secondQuestionOnWaitingStory = { key: 'TL-1|planning|q1|q2' };
  assert.deepEqual(newlyWaiting(second.seen, [secondQuestionOnWaitingStory, b]).fresh, [secondQuestionOnWaitingStory]);
});

test('the tab title carries the number of stories waiting on the owner', () => {
  assert.equal(titleFor(0), 'AI SDLC Command Center');
  assert.equal(titleFor(2), '(2) AI SDLC Command Center');
});
