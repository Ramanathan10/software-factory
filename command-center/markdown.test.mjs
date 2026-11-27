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
  ['closing hashes after two spaces stay as in the first column', '  ###   Risks  ##  ', [['h5', 'Risks  ##']]],
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

test('a heading in the first column keeps its text before closing hashes and trailing space', () => {
  assert.deepEqual(shape(bounded('### Risks ##  ')), [['h5', 'Risks ##']]);
  assert.deepEqual(shape(bounded('### Risks ##')), [['h5', 'Risks']]);
});

test('a heading line with thousands of spaces renders in well under a second', () => {
  for (const input of ['# a' + ' '.repeat(5000) + 'x', '   # a' + ' '.repeat(5000) + 'x']) {
    const started = performance.now();
    bounded(input);
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 500, 'took ' + Math.round(elapsed) + ' ms');
  }
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

const withBreaks = input => renderMarkdown(input, el, { breaks: true });
const kids = node => node.children;

test('with breaks, consecutive lines of a paragraph are joined by a br element', () => {
  const [para, ...rest] = withBreaks('(a) first\n(b) second\n(c) third');
  assert.equal(rest.length, 0);
  assert.equal(para.tag, 'p');
  assert.deepEqual(kids(para).map(child => typeof child === 'string' ? child : child.tag), ['(a) first', 'br', '(b) second', 'br', '(c) third']);
});

test('with breaks, a blank line still starts a new paragraph and adds no br', () => {
  const blocks = withBreaks('one\ntwo\n\nthree');
  assert.deepEqual(blocks.map(block => block.tag), ['p', 'p']);
  assert.equal(kids(blocks[0]).filter(child => child.tag === 'br').length, 1);
  assert.equal(kids(blocks[1]).filter(child => child.tag === 'br').length, 0);
});

test('without the option a paragraph still joins its lines with a space and has no br', () => {
  for (const blocks of [renderMarkdown('one\ntwo', el), renderMarkdown('one\ntwo', el, {}), renderMarkdown('one\ntwo', el, { breaks: false })]) {
    assert.equal(blocks.length, 1);
    assert.equal(text(blocks[0]), 'one two');
    assert.ok(!kids(blocks[0]).some(child => child.tag === 'br'));
  }
});

test('with breaks, inline marks on each line still render and the text stays literal', () => {
  const [para] = withBreaks('**bold** line\n<img src=x onerror=alert(1)>\n`code` [x](javascript:alert(1))');
  assert.deepEqual(kids(para).filter(child => typeof child !== 'string').map(child => child.tag), ['strong', 'br', 'br', 'code']);
  assert.match(text(para), /<img src=x onerror=alert\(1\)>/);
  assert.match(text(para), /\[x\]\(javascript:alert\(1\)\)/);
});

test('with breaks, lists, fences, quotes, headings and tables render as without it', () => {
  const input = '## Head\n\n1. one\n2. two\n\n- a\n  - nested\n\n> quote\n\n```\ncode\nmore\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |';
  assert.deepEqual(withBreaks(input), renderMarkdown(input, el));
});

test('with breaks, a list item continuation line and a paragraph after a list keep their shape', () => {
  const blocks = withBreaks('- item\n  continues\n\nafter\nlines');
  assert.deepEqual(blocks.map(block => block.tag), ['ul', 'p']);
  assert.equal(text(blocks[0]), 'item continues');
  assert.equal(kids(blocks[1]).filter(child => child.tag === 'br').length, 1);
});

test('with breaks, every short sequence of lines from a fixed fragment set renders and ends', () => {
  const fragments = ['# Title', '- item', '1. first', '> quote', '```', '| a | b |', '|---|---|', 'plain', 'more plain', ''];
  const failures = [];
  const walk = prefix => {
    if (failures.length) return;
    if (prefix.length) {
      try { assert.ok(renderMarkdown(prefix.join('\n'), el, { breaks: true }).length >= 0); } catch (error) { failures.push(error.message); }
    }
    if (prefix.length < 3) for (const fragment of fragments) walk([...prefix, fragment]);
  };
  walk([]);
  assert.deepEqual(failures, []);
});

const strongs = node => kids(node).filter(child => typeof child !== 'string' && child.tag === 'strong');

test('double underscores inside a word stay literal, and standing alone or after a space they make strong', () => {
  const [inWord] = renderMarkdown('x__y__ z', el);
  assert.equal(strongs(inWord).length, 0);
  assert.equal(text(inWord), 'x__y__ z');
  const [afterSpace] = renderMarkdown('see __y__ here', el);
  assert.deepEqual(strongs(afterSpace).map(text), ['y']);
  const [alone] = renderMarkdown('__y__', el);
  assert.deepEqual(strongs(alone).map(text), ['y']);
});

test('four underscores between spaces stay literal text with no strong element', () => {
  const [para] = renderMarkdown('a ____ b', el);
  assert.equal(strongs(para).length, 0);
  assert.equal(text(para), 'a ____ b');
  assert.deepEqual(kids(para), ['a ____ b']);
});

test('double underscores stay literal when an underscore or a digit sits on either side', () => {
  for (const source of ['___x__ y', '2__x__ y', '__x___ y', '__x__2 y']) {
    const [para] = renderMarkdown(source, el);
    assert.equal(strongs(para).length, 0, source + ' made a strong element');
    assert.equal(text(para), source);
    assert.deepEqual(kids(para), [source], source + ' was split into parts');
  }
});
