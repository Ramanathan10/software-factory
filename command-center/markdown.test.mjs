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

const NODE_BOUND = 10000;

const bounded = input => {
  let nodes = 0;
  const counting = (tag, attrs, ...children) => {
    if (++nodes > NODE_BOUND) throw new Error('renderer passed ' + NODE_BOUND + ' nodes without ending on ' + JSON.stringify(input));
    return el(tag, attrs, ...children);
  };
  const blocks = renderMarkdown(input, counting);
  assert.ok(nodes < 1000, 'rendered ' + nodes + ' nodes for ' + JSON.stringify(input));
  return blocks;
};

const shape = blocks => blocks.map(block => [block.tag, text(block)]);

const headingCases = [
  ['three spaces before ### after a paragraph line', 'intro\n   ### Risks', [['p', 'intro'], ['h5', 'Risks']]],
  ['two spaces before ### after a list item and a blank line', '- item\n\n  ### Risks', [['ul', 'item'], ['h5', 'Risks']]],
  ['a tab before #', 'intro\n\t# Title', [['p', 'intro'], ['h3', 'Title']]],
  ['an indented heading alone', '   ## Scope', [['h4', 'Scope']]],
  ['a no-break space before ##', '\u00a0## Scope', [['h4', 'Scope']]],
  ['a byte order mark before #', '\uFEFF# Title', [['h3', 'Title']]],
  ['four spaces before ##', '    ## Scope', [['h4', 'Scope']]],
  ['trailing space and closing hashes are trimmed from an indented heading', '  ###   Risks  ##  ', [['h5', 'Risks']]],
];

for (const [name, input, expected] of headingCases) {
  test('indented heading renders as a heading and ends: ' + name, () => {
    assert.deepEqual(shape(bounded(input)), expected);
  });
}

test('indented heading behind a blockquote with two spaces after > renders as a heading and ends', () => {
  const [quote, ...rest] = bounded('>  ## Scope');
  assert.equal(rest.length, 0);
  assert.equal(quote.tag, 'blockquote');
  assert.deepEqual(shape(quote.children), [['h4', 'Scope']]);
});

test('indented heading behind a nested blockquote renders as a heading and ends', () => {
  const [outer, ...rest] = bounded('> >  ### Risks');
  assert.equal(rest.length, 0);
  assert.equal(outer.tag, 'blockquote');
  const [inner, ...innerRest] = outer.children;
  assert.equal(innerRest.length, 0);
  assert.equal(inner.tag, 'blockquote');
  assert.deepEqual(shape(inner.children), [['h5', 'Risks']]);
});

test('lines before and after an indented heading stay their own paragraphs', () => {
  assert.deepEqual(shape(bounded('before\n   ### Risks\nafter')), [['p', 'before'], ['h5', 'Risks'], ['p', 'after']]);
});

test('a heading in the first column still renders as before', () => {
  assert.deepEqual(shape(bounded('intro\n### Risks')), [['p', 'intro'], ['h5', 'Risks']]);
});

test('every short sequence of lines from a fixed fragment set renders and ends', () => {
  const fragments = [
    '# Title', '   ### Risks', '  ## Scope', '\t# Tab', '\u00a0## Nbsp', '\uFEFF# Bom', '    ## Four',
    '- item', '  - child', '1. first',
    '> quote', '>  ## Quoted', '> >  ### Nested',
    '```', '~~~', '---',
    '| a | b |', '|---|---|',
    'plain text', '',
  ];
  const failures = [];
  let sequences = 0;
  const walk = prefix => {
    if (failures.length >= 5) return;
    if (prefix.length) {
      sequences++;
      const input = prefix.join('\n');
      try { bounded(input); } catch (error) { if (failures.length < 5) failures.push(error.message); }
    }
    if (prefix.length < 3) for (const fragment of fragments) walk([...prefix, fragment]);
  };
  walk([]);
  assert.deepEqual(failures, []);
  assert.equal(sequences, fragments.length + fragments.length ** 2 + fragments.length ** 3);
});
