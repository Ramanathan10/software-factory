import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { lanes, phases, roles } from '../mission-console/roles.mjs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');

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
const calls = [];
const meta = { roles, phases, columns: lanes(phases, 2) };
const now = Date.now();
const iso = minutes => new Date(now - minutes * 60000).toISOString();
const history = Array.from({ length: 45 }, (_, index) => ({ seq: 1000 - index, at: iso(index), type: 'activity', phase: 'closed', revision: 45 - index, detail: 'Past event ' + index }));
const previews = {
  'DONE-1': { story: 'DONE-1', worktree: { path: 'C:/wt/done-1', exists: true }, branch: { name: 'story/done-1', remove: true }, folders: ['C:/home/stories/DONE-1', 'C:/home/notes/DONE-1', 'C:/db/attachments/DONE-1'], logs: 3, record: true },
  'DONE-2': { story: 'DONE-2', worktree: { path: 'C:/wt/done-2', exists: false }, branch: { name: 'story/done-2', remove: false, reason: 'The worktree is gone, so the repository cannot be found.' }, folders: [], logs: 0, record: true },
};
const reply = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const viewButtons = ['lanes', 'agents', 'track', 'archive'].map(name => {
  const button = new Node('button');
  button.setAttribute('data-view', name);
  return button;
});

for (const id of ['detail', 'plan-reader']) {
  const dialog = new Node('dialog');
  const title = new Node('span');
  title.className = 'win-title';
  dialog.append(title);
  ids.set(id, dialog);
}

Object.assign(globalThis, {
  document: {
    body: new Node('body'),
    createElement: tag => new Node(tag),
    createElementNS: (space, tag) => new Node(tag),
    getElementById: id => ids.get(id) ?? ids.set(id, new Node(id.startsWith('stat-') && id.endsWith('-button') ? 'button' : 'div')).get(id),
    querySelectorAll: selector => selector === '.views button' ? viewButtons : [],
    querySelector: () => null,
    addEventListener() {},
  },
  localStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, String(value)), removeItem: key => saved.delete(key) },
  fetch: async (url, options = {}) => {
    const path = String(url);
    calls.push({ url: path, method: options.method ?? 'GET', body: options.body });
    if (path === '/api/meta') return reply(meta);
    if (path.startsWith('/api/history')) return reply(history);
    if (path.startsWith('/api/clear/preview')) return reply(previews[new URLSearchParams(path.split('?')[1]).get('story')]);
    if (path === '/api/clear') return reply({ results: JSON.parse(options.body).stories.map(story => ({ story, result: 'cleared', deleted: [], gone: [], left: [] })) });
    return reply({});
  },
  EventSource: class { constructor() { this.listeners = {}; sources.push(this); } addEventListener(type, listener) { this.listeners[type] = listener; } close() {} },
  setInterval: () => 0,
  CSS: { escape: value => value },
  window: globalThis,
});
await import('./ui/app.js');

const base = { title: 'A story', branch: 'story/x', worktree: 'C:/w/x', harness: 'Claude Code', questions: [], artifacts: [], files: [], createdAt: iso(600), updatedAt: iso(1) };
const turn = { pid: 1, log: 'x.log', at: iso(1) };
const open = { ...base, id: 'OPEN-1', title: 'Open work', repo: 'acme/one', phase: 'testing', worker: { id: 'w1', role: 'tester', session: 's1', turn } };
const older = { ...base, id: 'DONE-1', title: 'Older shipped work', repo: 'acme/one', phase: 'closed', pr: 'https://github.com/acme/one/pull/7', updatedAt: iso(1),
  events: [{ seq: 20, at: iso(1), type: 'jarvis-turn-ended', detail: 'Jarvis ended its turn.' }, { seq: 10, at: iso(300), type: 'merged', detail: 'Merged.' }] };
const newer = { ...base, id: 'DONE-2', title: 'Newer shipped work', repo: 'acme/two', phase: 'closed', pr: 'https://github.com/acme/two/pull/9', updatedAt: iso(30),
  cleanup: { requestedAt: iso(5), blocked: 'Uncommitted or untracked files in C:/wt/done-2' },
  events: [{ seq: 30, at: iso(5), type: 'cleanup-blocked', detail: 'Uncommitted or untracked files in C:/wt/done-2' }, { seq: 25, at: iso(60), type: 'merged', detail: 'Merged.' }] };
const frame = stories => sources.at(-1).listeners.stories({ data: JSON.stringify({ stories }) });
frame([open, older, newer]);

const walk = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(walk)] : [];
const everything = () => [...new Set([...ids.values(), document.body].flatMap(walk))];
const board = () => ids.get('board');
const settle = async () => { for (let index = 0; index < 5; index++) await new Promise(done => setTimeout(done, 0)); };
const click = async node => {
  assert.ok(node?.listeners.click?.length, 'nothing to click on ' + (node?.textContent ?? 'a missing element'));
  for (const listener of node.listeners.click) await listener({ preventDefault() {}, stopPropagation() {}, currentTarget: node, target: node });
  await settle();
};
const show = async name => click(viewButtons.find(button => button.getAttribute('data-view') === name));
const rowOf = id => walk(board()).find(node => node !== board() && node.textContent.includes(id) && !['DONE-1', 'DONE-2', 'OPEN-1'].filter(other => other !== id).some(other => node.textContent.includes(other)));
const buttonIn = (root, pattern) => walk(root).find(node => node.tag === 'button' && pattern.test(node.textContent.trim()));
const confirmation = () => everything().filter(node => node.textContent.includes('This cannot be undone.') && buttonIn(node, /^Delete permanently$/)).at(-1);
const posts = () => calls.filter(call => call.method === 'POST' && call.url === '/api/clear');
const pickRepo = async name => {
  for (const listener of ids.get('repo-filter').listeners.change ?? []) listener({ target: { value: name } });
  await settle();
};

test('index.html has an Archive tab and a shipped counter that is a button', () => {
  const html = read('./ui/index.html');
  assert.match(html, /<button[^>]*data-view="archive"[^>]*>Archive<\/button>/);
  assert.match(html, /<button[^>]*id="stat-shipped-button"[^>]*>\s*<strong id="stat-shipped">/);
});

test('the shipped counter counts the closed stories still kept', () => {
  assert.equal(ids.get('stat-shipped').textContent, '2');
  assert.equal(ids.get('stat-active').textContent, '1');
});

test('closed stories are left out of Lanes, Agents and Track', async () => {
  for (const name of ['lanes', 'agents', 'track']) {
    await show(name);
    const text = board().textContent;
    assert.ok(text.includes('OPEN-1'), name + ' does not show the open story');
    for (const id of ['DONE-1', 'DONE-2']) assert.ok(!text.includes(id), name + ' still shows the closed story ' + id);
    for (const lane of ['Done', 'Archive']) assert.ok(!walk(board()).some(node => node.tag === 'h2' && node.children[0] === lane), name + ' still has a ' + lane + ' column');
  }
  await show('track');
  assert.ok(!walk(board()).some(node => node.tag === 'li' && node.textContent === 'Archive'), 'the Track legend still has an Archive step');
});

test('the agent strip leaves out closed stories', () => {
  assert.ok(!ids.get('crew').textContent.includes('DONE-'), 'the crew strip still names a closed story');
});

test('clicking the shipped counter opens the Archive tab and remembers it', async () => {
  await show('lanes');
  await click(document.getElementById('stat-shipped-button'));
  assert.equal(saved.get('aisdlc-view'), 'archive');
  assert.equal(viewButtons[3].getAttribute('aria-selected'), 'true');
  assert.ok(board().textContent.includes('DONE-1'), 'the Archive tab does not list DONE-1');
});

test('the Archive tab lists only closed stories, newest merge first, with title, repository, merged date and PR link', async () => {
  await show('archive');
  const text = board().textContent;
  assert.ok(!text.includes('OPEN-1'), 'the Archive tab lists an open story');
  assert.ok(text.indexOf('DONE-2') >= 0 && text.indexOf('DONE-2') < text.indexOf('DONE-1'), 'DONE-2 merged later but is not listed first');
  for (const story of [older, newer]) {
    const row = rowOf(story.id);
    assert.ok(row, 'no row for ' + story.id);
    assert.ok(row.textContent.includes(story.title), story.id + ' row has no title');
    assert.ok(row.textContent.includes(story.repo), story.id + ' row has no repository');
    assert.ok(walk(row).some(node => node.tag === 'a' && node.getAttribute('href') === story.pr), story.id + ' row has no PR link');
    const merged = story.events.find(event => event.type === 'merged').at;
    assert.ok(walk(row).some(node => Object.values(node.attributes ?? {}).includes(merged)) || row.textContent.includes(new Date(merged).toLocaleDateString()), story.id + ' row does not show its merged date ' + merged);
  }
});

test('a row whose clear was blocked shows the reason', () => {
  assert.ok(rowOf('DONE-2').textContent.includes('Clear blocked: Uncommitted or untracked files in C:/wt/done-2'));
  assert.ok(!rowOf('DONE-1').textContent.includes('Clear blocked'));
});

test('each row has Clear, and Clear all counts the listed rows', () => {
  for (const id of ['DONE-1', 'DONE-2']) assert.ok(buttonIn(rowOf(id), /^Clear$/), id + ' row has no Clear button');
  assert.ok(buttonIn(board(), /^Clear all \(2\)$/) ?? everything().find(node => node.tag === 'button' && node.textContent.trim() === 'Clear all (2)'), 'no "Clear all (2)" button');
});

test('the Archive tab follows the repository filter, and so does Clear all', async () => {
  await pickRepo('acme/one');
  assert.ok(board().textContent.includes('DONE-1'));
  assert.ok(!board().textContent.includes('DONE-2'), 'the Archive tab ignores the repository filter');
  const all = everything().find(node => node.tag === 'button' && /^Clear all \(\d+\)$/.test(node.textContent.trim()));
  assert.equal(all?.textContent.trim(), 'Clear all (1)');
  const before = calls.length;
  await click(all);
  const previewed = calls.slice(before).filter(call => call.url.startsWith('/api/clear/preview')).map(call => new URLSearchParams(call.url.split('?')[1]).get('story'));
  assert.deepEqual(previewed, ['DONE-1']);
  const before2 = posts().length;
  await click(buttonIn(confirmation(), /^Delete permanently$/));
  assert.deepEqual(posts().slice(before2).map(call => JSON.parse(call.body).stories), [['DONE-1']]);
  await pickRepo('');
});

test('Clear asks first, naming everything it deletes, and Cancel deletes nothing', async () => {
  await show('archive');
  const before = posts().length;
  await click(buttonIn(rowOf('DONE-1'), /^Clear$/));
  assert.ok(calls.some(call => call.url === '/api/clear/preview?story=DONE-1'), 'Clear did not ask the server what it would delete');
  const dialog = confirmation();
  assert.ok(dialog, 'Clear showed no confirmation saying "This cannot be undone."');
  const text = dialog.textContent;
  for (const part of ['C:/wt/done-1', 'story/done-1', ...previews['DONE-1'].folders]) assert.ok(text.includes(part), 'the confirmation does not name ' + part);
  assert.match(text, /3 (turn )?log files?/i);
  assert.match(text, /story database/i);
  assert.ok(buttonIn(dialog, /^Delete permanently$/), 'no "Delete permanently" button');
  const cancel = buttonIn(dialog, /^Cancel$/);
  assert.ok(cancel, 'no "Cancel" button');
  if (cancel.listeners.click?.length) await click(cancel);
  assert.equal(posts().length, before, 'Cancel sent a clear');
});

test('Delete permanently clears that one story', async () => {
  await show('archive');
  const before = posts().length;
  await click(buttonIn(rowOf('DONE-1'), /^Clear$/));
  await click(buttonIn(confirmation(), /^Delete permanently$/));
  assert.deepEqual(posts().slice(before).map(call => JSON.parse(call.body)), [{ stories: ['DONE-1'] }]);
});

test('the confirmation says why a branch stays', async () => {
  await show('archive');
  await click(buttonIn(rowOf('DONE-2'), /^Clear$/));
  assert.ok(confirmation().textContent.includes(previews['DONE-2'].branch.reason));
});

test('opening an archived story shows its full history', async () => {
  await show('archive');
  const row = rowOf('DONE-1');
  const opener = walk(row).find(node => node.listeners.click?.length && !['button', 'a'].includes(node.tag));
  await click(opener);
  assert.ok(calls.some(call => call.url === '/api/history?story=DONE-1'), 'the detail did not load the full history');
  const timeline = walk(ids.get('detail-body')).find(node => node.tag === 'ol' && node.classes().includes('timeline'));
  assert.ok(timeline, 'the detail has no timeline');
  assert.equal(timeline.children.length, 45);
  assert.ok(timeline.textContent.includes('Past event 44'));
});

test('with nothing shipped the Archive tab says so', async () => {
  frame([open]);
  await show('archive');
  assert.ok(board().textContent.includes('No shipped stories.'));
  assert.equal(ids.get('stat-shipped').textContent, '0');
});
