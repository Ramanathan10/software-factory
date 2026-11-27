import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lanes, phases, roles } from '../mission-console/roles.mjs';

const loose = new Proxy(function () {}, {
  get: (target, key) => key === Symbol.iterator ? [][Symbol.iterator].bind([]) : key === Symbol.toPrimitive ? () => '' : loose,
  apply: () => loose,
  set: () => true,
});

class Node {
  constructor(tag) {
    Object.assign(this, { tag: String(tag).toLowerCase(), attributes: {}, children: [], className: '', style: {}, listeners: {}, value: '' });
    this.classList = {
      contains: name => this.classes().includes(name),
      toggle: (name, on = !this.classes().includes(name)) => { this.className = [...this.classes().filter(each => each !== name), ...(on ? [name] : [])].join(' '); return on; },
      add: (...names) => names.forEach(name => this.classList.toggle(name, true)),
      remove: (...names) => names.forEach(name => this.classList.toggle(name, false)),
    };
    return new Proxy(this, { get: (target, key) => key in target ? target[key] : typeof key === 'symbol' ? undefined : loose });
  }
  classes() { return this.className.split(/\s+/).filter(Boolean); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  getAttribute(key) { return this.attributes[key] ?? null; }
  removeAttribute(key) { delete this.attributes[key]; }
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  remove() {}
  replaceChildren(...nodes) { this.children = nodes.flat(); }
  get dataset() { return Object.fromEntries(Object.entries(this.attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value])); }
  matches(selector) { const [, tag, name] = selector.match(/^([a-z0-9]*)(?:\.([\w-]+))?$/) ?? []; return (!tag || this.tag === tag) && (!name || this.classes().includes(name)); }
  querySelectorAll(selector) { return this.children.filter(child => child instanceof Object).flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get textContent() { return this.children.map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : child.textContent).join(''); }
  set textContent(value) { this.children = [String(value)]; }
}

const ids = new Map();
const sources = [];
const saved = new Map();
const meta = { roles, phases, columns: lanes(phases, 2) };
const reply = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

Object.assign(globalThis, {
  document: {
    body: new Node('body'),
    createElement: tag => new Node(tag),
    createElementNS: (space, tag) => new Node(tag),
    getElementById: id => ids.get(id) ?? ids.set(id, new Node(id.startsWith('stat-') && id.endsWith('-button') ? 'button' : 'div')).get(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    addEventListener() {},
  },
  localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) },
  fetch: async url => reply(String(url) === '/api/meta' ? meta : String(url).startsWith('/api/history') ? [] : {}),
  EventSource: class { constructor() { this.listeners = {}; sources.push(this); } addEventListener(type, listener) { this.listeners[type] = listener; } close() {} },
  setInterval: () => 0,
  CSS: { escape: value => value },
  window: globalThis,
});
await import('./ui/app.js');

const at = new Date().toISOString();
const entry = (seq, type, detail) => ({ seq, at, type, phase: 'testing', detail });
const base = { branch: 'story/x', worktree: 'C:/w/x', harness: 'Claude Code', questions: [], artifacts: [], files: [], createdAt: at, updatedAt: at, phase: 'testing' };
const story = (id, repo, events) => ({ ...base, id, title: id + ' title', repo, events });
const alpha = events => story('AAA-1', 'acme/one', events);
const beta = events => story('BBB-1', 'acme/two', events);
const alphaEvents = [entry(12, 'handoff', 'Tests red'), entry(10, 'activity', 'Reading notes')];
const betaEvents = [entry(11, 'question', 'Which format?'), entry(5, 'create', 'Brief')];
const frame = stories => sources.at(-1).listeners.stories({ data: JSON.stringify({ stories }) });
const walk = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(walk)] : [];
const node = id => document.getElementById(id);
const rows = () => node('feed').children;
const rowWith = text => rows().find(row => row.textContent.includes(text));
const newRows = () => rows().filter(row => row.className === 'new');
const idButton = (row, id) => walk(row).find(each => each.tag === 'button' && each.classes().includes('feed-id') && each.textContent === id);
const fire = (target, name, extra = {}) => {
  let stopped = 0;
  for (const listener of target.listeners[name] ?? []) listener({ stopPropagation: () => { stopped++; }, preventDefault() {}, target, currentTarget: target, ...extra });
  return stopped;
};
const type = text => { node('feed-keyword').value = text; fire(node('feed-keyword'), 'input'); };
const reset = () => {
  type('');
  if (!node('feed-story').hidden) fire(node('feed-story-clear'), 'click');
};
const pickRepo = name => { fire(node('repo-filter'), 'change', { target: { value: name } }); };
const withFresh = [entry(13, 'activity', 'Fresh work'), ...alphaEvents];

frame([alpha(alphaEvents), beta(betaEvents)]);

test('the first frame lists every event newest first and marks none as new', () => {
  assert.equal(rows().length, 4);
  const order = ['Tests red', 'Which format?', 'Reading notes', 'Brief'];
  assert.deepEqual(rows().map(row => order.findIndex(part => row.textContent.includes(part))), [0, 1, 2, 3]);
  assert.equal(newRows().length, 0);
});

test('only an event above the previous watermark is marked new', () => {
  frame([alpha(withFresh), beta(betaEvents)]);
  assert.equal(rows().length, 5);
  assert.equal(newRows().length, 1);
  assert.equal(rowWith('Fresh work').className, 'new');
  frame([alpha([entry(14, 'activity', 'Later work'), ...withFresh]), beta(betaEvents)]);
  assert.equal(newRows().length, 1);
  assert.equal(rowWith('Later work').className, 'new');
  assert.equal(rowWith('Fresh work').className, '');
  frame([alpha(withFresh), beta(betaEvents)]);
});

test('typing in the keyword box filters the list by story id, type and detail', () => {
  type('question');
  assert.equal(rows().length, 1);
  assert.ok(rowWith('Which format?'));
  type('AAA-1');
  assert.equal(rows().length, 3);
  assert.ok(rows().every(row => row.textContent.includes('AAA-1')));
  type('Reading');
  assert.equal(rows().length, 1);
  type('');
  assert.equal(rows().length, 5);
});

test('the filtered marker shows for a keyword or a story, and not for blank text', () => {
  assert.equal(node('feed-filtered').hidden, true);
  type('   ');
  assert.equal(node('feed-filtered').hidden, true);
  assert.equal(rows().length, 5);
  type('format');
  assert.equal(node('feed-filtered').hidden, false);
  type('');
  fire(idButton(rowWith('Which format?'), 'BBB-1'), 'click');
  assert.equal(node('feed-filtered').hidden, false);
  type('   ');
  assert.equal(node('feed-filtered').hidden, false);
  reset();
  assert.equal(node('feed-filtered').hidden, true);
});

test('each row has a story id button that offers to show only that story', () => {
  for (const row of rows()) {
    const button = walk(row).find(each => each.tag === 'button' && each.classes().includes('feed-id'));
    assert.equal(button.getAttribute('title'), 'Show only ' + button.textContent);
  }
});

test('clicking a story id picks the story, shows the chip, filters the rows and focuses the clear button', () => {
  assert.equal(node('feed-story').hidden, true);
  const focused = [];
  node('feed-story-clear').focus = () => focused.push('clear');
  node('feed-keyword').focus = () => focused.push('keyword');
  const stopped = fire(idButton(rowWith('Which format?'), 'BBB-1'), 'click');
  assert.equal(stopped, 1);
  assert.deepEqual(focused, ['clear']);
  assert.equal(node('feed-story').hidden, false);
  assert.equal(node('feed-story-id').textContent, 'BBB-1');
  assert.equal(rows().length, 2);
  assert.ok(rows().every(row => row.textContent.includes('BBB-1')));
  for (const row of rows()) assert.equal(idButton(row, 'BBB-1').getAttribute('title'), 'Show all stories');
});

test('the keyword and the story filters combine', () => {
  type('Brief');
  assert.equal(rows().length, 1);
  type('Tests red');
  assert.equal(rows().length, 1);
  assert.ok(rows()[0].classes().includes('feed-empty'));
  type('');
});

test('clicking the picked story id again shows all stories and focuses the keyword box', () => {
  const focused = [];
  node('feed-story-clear').focus = () => focused.push('clear');
  node('feed-keyword').focus = () => focused.push('keyword');
  const stopped = fire(idButton(rows()[0], 'BBB-1'), 'click');
  assert.equal(stopped, 1);
  assert.deepEqual(focused, ['keyword']);
  assert.equal(node('feed-story').hidden, true);
  assert.equal(node('feed-story-id').textContent, '');
  assert.equal(rows().length, 5);
});

test('the chip clear button shows all stories and focuses the keyword box', () => {
  fire(idButton(rowWith('Tests red'), 'AAA-1'), 'click');
  assert.equal(rows().length, 3);
  const focused = [];
  node('feed-keyword').focus = () => focused.push('keyword');
  fire(node('feed-story-clear'), 'click');
  assert.deepEqual(focused, ['keyword']);
  assert.equal(node('feed-story').hidden, true);
  assert.equal(rows().length, 5);
});

test('Escape in the keyword box clears the keyword only, empties the box and stops the key reaching the page', () => {
  fire(idButton(rowWith('Tests red'), 'AAA-1'), 'click');
  type('Reading');
  assert.equal(rows().length, 1);
  const stopped = fire(node('feed-keyword'), 'keydown', { key: 'Escape' });
  assert.equal(stopped, 1);
  assert.equal(node('feed-keyword').value, '');
  assert.equal(rows().length, 3);
  assert.equal(node('feed-story').hidden, false);
  assert.equal(node('feed-story-id').textContent, 'AAA-1');
  reset();
});

test('other keys leave the keyword and the box alone', () => {
  type('Reading');
  for (const key of ['a', 'Enter', 'Tab', 'escape']) assert.equal(fire(node('feed-keyword'), 'keydown', { key }), 0, key + ' stopped propagation');
  assert.equal(node('feed-keyword').value, 'Reading');
  assert.equal(rows().length, 1);
  reset();
});

test('with no filter and no events the feed is empty and shows no empty-state row', () => {
  frame([]);
  assert.equal(rows().length, 0);
  assert.equal(node('feed').textContent.includes('No entries match'), false);
  frame([alpha(withFresh), beta(betaEvents)]);
  assert.equal(rows().length, 5);
});

test('when a filter matches nothing the feed says so and Clear resets the keyword, the box and the story', () => {
  fire(idButton(rowWith('Tests red'), 'AAA-1'), 'click');
  type('zzzz');
  assert.equal(rows().length, 1);
  assert.ok(rows()[0].classes().includes('feed-empty'));
  assert.ok(rows()[0].textContent.includes('No entries match'));
  const clear = walk(rows()[0]).find(each => each.tag === 'button' && each.textContent === 'Clear');
  assert.ok(clear, 'no Clear button');
  assert.equal(fire(clear, 'click'), 1);
  assert.equal(node('feed-keyword').value, '');
  assert.equal(node('feed-story').hidden, true);
  assert.equal(node('feed-filtered').hidden, true);
  assert.equal(rows().length, 5);
});

test('an empty feed with only a keyword filter also offers Clear', () => {
  type('zzzz');
  assert.ok(rows()[0].textContent.includes('No entries match'));
  fire(walk(rows()[0]).find(each => each.tag === 'button'), 'click');
  assert.equal(node('feed-keyword').value, '');
  assert.equal(rows().length, 5);
});

test('events hidden by the story filter are not new once the filter widens', () => {
  fire(idButton(rowWith('Tests red'), 'AAA-1'), 'click');
  frame([alpha([entry(20, 'activity', 'Alpha fresh'), ...withFresh]), beta([entry(30, 'activity', 'Beta hidden'), ...betaEvents])]);
  assert.equal(rowWith('Beta hidden'), undefined);
  assert.equal(rowWith('Alpha fresh').className, 'new');
  assert.equal(newRows().length, 1);
  fire(node('feed-story-clear'), 'click');
  assert.ok(rowWith('Beta hidden'));
  assert.equal(newRows().length, 0);
});

test('events hidden by the repository filter are not new once the filter widens', () => {
  const current = [alpha([entry(20, 'activity', 'Alpha fresh'), ...withFresh]), beta([entry(30, 'activity', 'Beta hidden'), ...betaEvents])];
  frame(current);
  pickRepo('acme/one');
  assert.equal(rowWith('Beta hidden'), undefined);
  frame([alpha([entry(40, 'activity', 'Alpha newest'), ...current[0].events]), beta([entry(50, 'activity', 'Beta newest'), ...current[1].events])]);
  assert.equal(rowWith('Beta newest'), undefined);
  assert.equal(rowWith('Alpha newest').className, 'new');
  pickRepo('');
  assert.ok(rowWith('Beta newest'));
  assert.equal(newRows().length, 0);
});
