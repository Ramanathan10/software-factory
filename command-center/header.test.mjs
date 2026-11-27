import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const html = read('./ui/index.html');
const css = read('./ui/app.css');
const js = read('./ui/app.js');

const between = (text, open, close) => {
  const start = text.indexOf(open);
  assert.ok(start >= 0, `${open} is missing`);
  const end = text.indexOf(close, start);
  assert.ok(end > start, `${close} is missing after ${open}`);
  return text.slice(start, end + close.length);
};

const div = (text, open) => {
  const start = text.indexOf(open);
  assert.ok(start >= 0, `${open} is missing`);
  let depth = 0;
  for (const tag of text.slice(start).matchAll(/<div|<\/div>/g)) {
    depth += tag[0] === '</div>' ? -1 : 1;
    if (depth === 0) return text.slice(start, start + tag.index + tag[0].length);
  }
  assert.fail(`${open} is never closed`);
};

const header = between(html, '<header class="bar">', '</header>');
const boardWrap = between(html, '<section class="board-wrap">', '</section>');
const tablist = '<div class="views" role="tablist" aria-label="Layout">';
const views = ['lanes', 'agents', 'track', 'archive'];
const baseCss = css.slice(0, css.indexOf('@media (max-width: 1100px)'));
const narrowCss = between(css, '@media (max-width: 1100px)', '\n}');

const declarations = (scope, selector) => {
  const found = {};
  for (const [, selectors, body] of scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.split(',').map(each => each.trim()).includes(selector)) continue;
    for (const [, name, value] of body.matchAll(/([\w-]+)\s*:\s*([^;]+)/g)) found[name] = value.trim();
  }
  return found;
};

const headerRule = (scope, name) => ({ ...declarations(scope, name), ...declarations(scope, `.bar ${name}`) });

const rightGroup = () => {
  const match = header.match(/<div class="([\w-]+)"[^>]*>\s*<div class="stats">/);
  assert.ok(match, 'the stats, Notify me and the clock must sit in one wrapper div with its own class');
  return { className: match[1], html: div(header, '<div class="' + match[1] + '"'), start: match.index };
};

test('the tablist sits in the header with its four tabs in order', () => {
  assert.ok(header.includes(tablist), 'tablist with aria-label Layout is not in header.bar');
  const tabs = [...between(header, tablist, '</div>').matchAll(/<button type="button" role="tab" data-view="(\w+)" title="([^"]+)">(\w+)<\/button>/g)];
  assert.deepEqual(tabs.map(tab => tab[1]), views);
  assert.deepEqual(tabs.map(tab => tab[3]), ['Lanes', 'Agents', 'Track', 'Archive']);
  assert.deepEqual(tabs.map(tab => tab[2]), ['Columns per stage', 'One row per agent', 'One row per story with its stage progress', 'Shipped stories, and clearing them']);
});

test('the header holds brand, tabs, picker, chip, then the stats, in that order', () => {
  const order = ['<div class="brand">', tablist, 'id="repo-filter"', 'id="filter"', '<div class="stats">'].map(marker => header.indexOf(marker));
  assert.ok(order.every(index => index >= 0), `a header part is missing: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('the picker and the chip keep their ids, classes, labels and hidden state', () => {
  assert.ok(header.includes('<select class="repo-filter" id="repo-filter" aria-label="Repository" title="Show one repository\'s stories" hidden></select>'));
  assert.ok(header.includes('<div class="filter" id="filter" hidden></div>'));
});

test('the picker and the chip sit together with the tabs in one toolbar in the header', () => {
  const toolbar = div(header, '<div class="toolbar">');
  assert.ok(toolbar.includes(tablist));
  assert.ok(toolbar.includes('id="repo-filter"'));
  assert.ok(toolbar.includes('<div class="filter" id="filter" hidden></div>'));
});

test('the main pane holds no toolbar, tabs, picker or chip', () => {
  for (const gone of ['toolbar', 'class="views"', 'role="tablist"', 'role="tab"', 'repo-filter', 'id="filter"', 'aria-label="Layout"', 'aria-label="Repository"']) {
    assert.ok(!boardWrap.includes(gone), `board-wrap still contains ${gone}`);
  }
});

test('the main pane keeps the decisions banner before the board, then the empty note', () => {
  const order = ['id="decisions"', 'id="board"', 'id="empty"'].map(marker => boardWrap.indexOf(marker));
  assert.ok(order.every(index => index >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('the stats, Notify me and the clock sit in one right-hand group after the toolbar', () => {
  const group = rightGroup();
  assert.ok(header.indexOf('id="filter"') < group.start);
  assert.ok(group.html.includes('<div class="stats">'));
  assert.ok(group.html.includes('id="notify"'));
  assert.ok(group.html.includes('id="clock"'));
  assert.ok(group.html.indexOf('id="notify"') < group.html.indexOf('id="clock"'));
});

test('the stats, Notify me and the clock keep their ids, classes and titles', () => {
  for (const kept of [
    '<strong id="stat-active">', '<strong id="stat-agents">',
    '<button type="button" class="warn" id="stat-waiting-button" title="Open your inbox">',
    '<button type="button" id="stat-shipped-button" title="Open the archive">',
    '<button type="button" class="link" id="notify" title="Show a desktop notification when a story starts waiting on you" hidden>Notify me</button>',
    '<time id="clock"></time>',
  ]) assert.ok(header.includes(kept), `${kept} is missing from the header`);
});

test('app.js still finds the moved controls by class and id', () => {
  assert.ok(js.includes("document.querySelectorAll('.views button')"));
  assert.ok(js.includes("$('filter')"));
  assert.ok(js.includes("$('repo-filter')"));
});

test('the header wraps with a 10px row gap and a 16px column gap', () => {
  const bar = declarations(baseCss, '.bar');
  assert.equal(bar['flex-wrap'], 'wrap');
  assert.equal(bar.gap, '10px 16px');
});

test('the header toolbar shrinks to its content and breaks only inside itself', () => {
  const toolbar = headerRule(baseCss, '.toolbar');
  assert.equal(toolbar.flex, '0 1 auto');
  assert.equal(toolbar['min-width'], '0');
  assert.equal(toolbar['flex-wrap'], 'wrap');
  assert.equal(toolbar.gap, '8px');
});

test('the four tabs stay one control that never breaks', () => {
  const viewsRule = declarations(baseCss, '.views');
  assert.equal(viewsRule.display, 'inline-flex');
  assert.ok(!/wrap/.test(viewsRule['flex-wrap'] ?? ''));
});

test('the right-hand group pushes right, with a 16px gap', () => {
  const group = declarations(baseCss, `.${rightGroup().className}`);
  assert.equal(group['margin-left'], 'auto');
  assert.equal(group.display, 'flex');
  assert.equal(group.gap, '16px');
});

test('the stats keep a 14px gap and no margin of their own', () => {
  const stats = declarations(baseCss, '.stats');
  assert.equal(stats.gap, '14px');
  assert.equal(stats['margin-left'], undefined);
});

test('the picker is capped at 170px', () => {
  assert.equal(declarations(baseCss, '.repo-filter')['max-width'], '170px');
});

test('the 1100px rule still hides the clock and tightens the stats', () => {
  assert.equal(declarations(narrowCss, '#clock').display, 'none');
  assert.equal(declarations(narrowCss, '.stats').gap, '14px');
  assert.equal(declarations(narrowCss, '.stats span')['font-size'], '11px');
});

const feedPanel = between(html, '<aside class="feed" id="feed-panel">', '</aside>');
const feedHeading = between(feedPanel, '<h2>', '</h2>');

test('the feed panel holds the heading, then the filter row, then the list', () => {
  const order = ['<h2>', '<div class="feed-filters">', '<ol id="feed">'].map(marker => feedPanel.indexOf(marker));
  assert.ok(order.every(index => index >= 0), `a feed part is missing: ${order}`);
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
  assert.ok(feedPanel.indexOf('</h2>') < feedPanel.indexOf('<div class="feed-filters">'), 'the filter row sits below the heading, not in it');
});

test('the filter row has a labelled search box and a chip for the picked story', () => {
  const row = div(feedPanel, '<div class="feed-filters">');
  assert.match(row, /<input[^>]*\btype="search"[^>]*>/);
  assert.match(row, /<input[^>]*\bid="feed-keyword"[^>]*>/);
  assert.match(row, /<input[^>]*\baria-label="Filter live feed"[^>]*>/);
  assert.match(row, /id="feed-story"/);
  assert.match(row.slice(row.indexOf('id="feed-story"')), /^id="feed-story"[^>]*\bhidden\b/, 'the chip starts hidden');
});

test('the filtered marker sits in the heading, hidden until a filter is on', () => {
  assert.match(feedHeading, /<b[^>]*\bid="feed-filtered"[^>]*\bhidden\b[^>]*>filtered<\/b>/);
  assert.ok(feedHeading.indexOf('id="feed-unread"') >= 0 && feedHeading.indexOf('id="feed-filtered"') >= 0);
});

test('the feed grid has a row for the filters and the filter row is hidden while minimized', () => {
  assert.equal(declarations(baseCss, '.feed')['grid-template-rows'], 'auto auto 1fr');
  assert.match(baseCss, /body\.feed-min [^{}]*\.feed-filters[^{}]*\{[^{}]*display:\s*none/);
});

test('the filtered marker stays out of sight unless the feed is minimized', () => {
  assert.ok(/#feed-filtered[^{}]*\{[^{}]*display:\s*none/.test(baseCss), 'the marker needs a rule that hides it by default');
  assert.match(baseCss, /body\.feed-min #feed-filtered[^{}]*\{[^{}]*display:\s*(inline|block|inline-block|flex|inline-flex)/);
  assert.ok(!/body\.feed-min [^{}]*\.feed-title[^{}]*,[^{}]*#feed-filtered/.test(baseCss));
});

test('the narrow layout does not drop the filter row unless minimized', () => {
  for (const [, selectors, body] of narrowCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (/\.feed-filters/.test(selectors) && /display:\s*none/.test(body)) assert.match(selectors, /feed-min/, 'only the minimized feed may hide the row');
  }
});

test('app.js wires the keyword box and keeps the filters out of localStorage', () => {
  assert.ok(js.includes("$('feed-keyword')"), 'app.js reads the keyword box by id');
  assert.ok(js.includes("$('feed-filtered')"), 'app.js shows the filtered marker by id');
  const keys = [...js.matchAll(/localStorage\.(?:setItem|getItem)\('([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(keys)].sort(), ['aisdlc-feed-min', 'aisdlc-view']);
});

test('the keyword box and the story id button keep their keys from the page handlers', () => {
  assert.match(js, /feed-keyword[\s\S]*?Escape[\s\S]*?stopPropagation/, 'the keyword box handles Escape itself and stops it reaching the document handler');
  assert.match(js, /Show only [\s\S]*?Show all stories/, 'the story id button has both titles');
  assert.ok(js.includes('No entries match'));
});
