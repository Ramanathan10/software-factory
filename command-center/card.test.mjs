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
    Object.assign(this, { tag: String(tag).toLowerCase(), attributes: {}, children: [], className: '', style: {}, listeners: {} });
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
  addEventListener(type, listener) { (this.listeners[type] ??= []).push(listener); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes.flat(); }
  get dataset() { return Object.fromEntries(Object.entries(this.attributes).filter(([key]) => key.startsWith('data-')).map(([key, value]) => [key.slice(5), value])); }
  matches(selector) { const [, tag, name] = selector.match(/^([a-z0-9]*)(?:\.([\w-]+))?$/) ?? []; return (!tag || this.tag === tag) && (!name || this.classes().includes(name)); }
  querySelectorAll(selector) { return this.children.filter(child => child instanceof Object).flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  get textContent() { return this.children.map(child => typeof child === 'string' || typeof child === 'number' ? String(child) : child.textContent).join(''); }
  set textContent(value) { this.children = [String(value)]; }
}

const ids = new Map();
const intervals = [];
const sources = [];
const viewButtons = ['lanes', 'agents', 'track', 'archive'].map(name => { const button = new Node('button'); button.setAttribute('data-view', name); return button; });
const meta = { roles, phases, columns: lanes(phases, 2) };
Object.assign(globalThis, {
  document: {
    body: new Node('body'),
    createElement: tag => new Node(tag),
    createElementNS: (space, tag) => new Node(tag),
    getElementById: id => ids.get(id) ?? ids.set(id, new Node('div')).get(id),
    querySelectorAll: selector => selector === '.views button' ? viewButtons : [],
    querySelector: () => null,
    addEventListener() {},
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  fetch: async () => ({ ok: true, json: async () => meta }),
  EventSource: class { constructor() { this.listeners = {}; sources.push(this); } addEventListener(type, listener) { this.listeners[type] = listener; } close() {} },
  setInterval: callback => { intervals.push(callback); return 0; },
  window: globalThis,
});
await import('./ui/app.js');

const now = () => new Date().toISOString();
const base = { title: 'A story', branch: 'story/x', worktree: 'C:/w/x', harness: 'Claude Code', questions: [], artifacts: [], files: [], createdAt: now(), updatedAt: now() };
const turn = { pid: 1, log: 'x.log', at: now() };
const fixtures = {
  busy: { ...base, id: 'BUSY-1', repo: 'acme/one', phase: 'testing', worker: { id: 'w1', role: 'tester', session: 's1', turn } },
  idle: { ...base, id: 'IDLE-1', repo: 'acme/two', phase: 'testing', worker: { id: 'w2', role: 'tester', session: 's2', lastTurn: { outcome: 'ended', at: now(), code: 0 } } },
  publisher: { ...base, id: 'PUBL-1', repo: 'acme/one', phase: 'publishing', worker: { id: 'w5', role: 'watcher', session: 's5', lastTurn: { outcome: 'ended', at: now(), code: 0 } } },
  waiting: { ...base, id: 'WAIT-1', repo: 'acme/one', phase: 'approval', events: [{ seq: 1, at: now(), type: 'plan', detail: 'Plan ready.' }] },
  blocked: { ...base, id: 'BLOCK-1', repo: 'acme/two', phase: 'building', blocked: true, worker: { id: 'w3', role: 'implementer', session: 's3', turn }, events: [{ seq: 2, at: now(), type: 'blocked', detail: 'Stuck.' }] },
};
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const observation = review => ({ head: 'c'.repeat(40), status: 'passed', failedCount: 0, failures: [], at: now(),
  review: { approvals: [], changesRequested: [], unresolved: 0, earlier: 0, items: [], keys: [], more: false, ...review } });
const reviewed = {
  review: { ...base, id: 'REVIEW-1', phase: 'ci', pr: 'https://github.com/acme/widgets/pull/7',
    prObservation: observation({ changesRequested: ['reviewer-b'], unresolved: 3, earlier: 2, lastActivityAt: ago(26 * 60 + 1) }) },
  quiet: { ...base, id: 'QUIET-1', phase: 'merge', pr: 'https://github.com/acme/widgets/pull/8', readyHead: 'c'.repeat(40),
    prObservation: observation({ approvals: ['reviewer-a'], lastActivityAt: ago(120) }) },
  answering: { ...base, id: 'PRR-9', phase: 'pr-review', pr: 'https://github.com/acme/widgets/pull/9' },
};
const shipped = { ...base, id: 'DONE-1', repo: 'acme/one', phase: 'closed' };
const retros = {
  merged: { ...base, id: 'MRG-1', phase: 'retro', pr: 'https://github.com/acme/widgets/pull/10', retro: { returnPhase: 'ci', startedAt: now(), mergedAt: now(), detail: 'The PR merged.' } },
  open: { ...base, id: 'RET-1', phase: 'retro', pr: 'https://github.com/acme/widgets/pull/11', retro: { returnPhase: 'ci', startedAt: now(), detail: 'Review lessons.' } },
};
sources.at(-1).listeners.stories({ data: JSON.stringify({ stories: [...Object.values(fixtures), shipped, ...Object.values(reviewed), ...Object.values(retros)] }) });

const walk = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(walk)] : [];
const cards = new Map(walk(ids.get('board')).filter(node => node.tag === 'article' && node.classes().includes('card')).map(card => [card.children.find(child => child?.tag === 'header')?.textContent.match(/[A-Z]+-\d+/)?.[0], card]));
const card = state => {
  const found = cards.get(fixtures[state].id);
  assert.ok(found, 'the board rendered no card for the ' + state + ' story ' + fixtures[state].id);
  return found;
};
const headerOf = state => card(state).children.find(child => child?.tag === 'header');
const glyphOf = state => walk(headerOf(state)).find(node => node.classes?.().includes('avatar'));
const has = (state, name) => walk(card(state)).some(node => node.classes?.().includes(name));
const phaseLabel = phase => phases[phase][1];

test('the board renders a card for every story state the tests use', () => {
  for (const state of Object.keys(fixtures)) card(state);
});

test('a busy card shows its agent glyph in the header and the glyph moves', () => {
  const glyph = glyphOf('busy');
  assert.ok(glyph, 'the busy card has no glyph (.avatar) in its header');
  assert.ok(glyph.classes().includes('moving'), 'the busy card header glyph is built without "moving", so it stays still');
  assert.ok(walk(glyph).some(node => node.tag === 'svg'), 'the busy card header glyph is not the role badge');
});

test('a shipped story has no card on the board and the board has no Done or Archive lane', () => {
  assert.ok(!cards.has(shipped.id), 'the board still renders a card for the closed story ' + shipped.id);
  const lanes = walk(ids.get('board')).filter(node => node.tag === 'h2').map(node => node.children.find(child => typeof child === 'string'));
  assert.ok(lanes.length > 0, 'the board rendered no lanes');
  for (const name of ['Done', 'Archive']) assert.ok(!lanes.includes(name), 'the board still has a "' + name + '" lane');
});

test('the glyph stays still on idle, waiting and blocked cards', () => {
  for (const state of ['idle', 'waiting', 'blocked']) {
    const glyph = glyphOf(state);
    assert.ok(glyph, 'the ' + state + ' card has no glyph (.avatar) in its header');
    assert.ok(!glyph.classes().includes('moving'), 'the ' + state + ' card header glyph moves');
  }
});

test('the header has the story id on the left, the glyph on the right and no phase pill', () => {
  for (const state of Object.keys(fixtures)) {
    const header = headerOf(state);
    const first = header.children.find(child => child && typeof child === 'object');
    assert.ok(first?.classes().includes('id') && first.textContent === fixtures[state].id, 'the ' + state + ' card header does not open with the story id');
    const last = header.children.findLast(child => child && typeof child === 'object');
    assert.ok(walk(last).some(node => node.classes?.().includes('avatar')), 'the ' + state + ' card header does not end with the glyph');
    assert.ok(!walk(header).some(node => node.classes?.().includes('phase')), 'the ' + state + ' card header still has the phase pill');
    assert.ok(!header.textContent.includes(phaseLabel(fixtures[state].phase)), 'the ' + state + ' card header still shows the phase "' + phaseLabel(fixtures[state].phase) + '" as text');
  }
});

test('the glyph tooltip and accessible label name the agent and the phase', () => {
  const expected = roles.tester.alias + ' · ' + phaseLabel('testing');
  const nodes = walk(headerOf('busy'));
  assert.equal(nodes.find(node => node.getAttribute?.('title'))?.getAttribute('title'), expected, 'the busy card glyph tooltip should read "' + expected + '"');
  assert.equal(nodes.find(node => node.getAttribute?.('aria-label'))?.getAttribute('aria-label'), expected, 'the busy card glyph accessible label should read "' + expected + '"');
  for (const state of ['idle', 'waiting', 'blocked']) {
    const title = walk(headerOf(state)).find(node => node.getAttribute?.('title'))?.getAttribute('title') ?? '';
    assert.ok(title.endsWith(' · ' + phaseLabel(fixtures[state].phase)), 'the ' + state + ' card glyph tooltip "' + title + '" does not name the agent and the phase');
  }
});

test('cards show no repository line, even with stories in two repositories', () => {
  for (const state of Object.keys(fixtures)) {
    assert.ok(!has(state, 'repo'), 'the ' + state + ' card still has a .repo element');
    assert.ok(!card(state).textContent.includes(fixtures[state].repo), 'the ' + state + ' card still shows its repository ' + fixtures[state].repo);
  }
});

test('cards show one glyph, no agent name and no pulse dot', () => {
  for (const state of Object.keys(fixtures)) {
    const glyphs = walk(card(state)).filter(node => node.classes?.().includes('avatar'));
    assert.equal(glyphs.length, 1, 'the ' + state + ' card shows ' + glyphs.length + ' glyphs');
    assert.ok(!has(state, 'pulse'), 'the ' + state + ' card still has the pulse dot');
  }
  const body = card('busy').textContent;
  assert.ok(!body.includes(roles.tester.alias), 'the busy card still shows the agent name "' + roles.tester.alias + '" as text');
  assert.ok(!card('blocked').textContent.includes(roles.implementer.alias), 'the blocked card shows the agent name "' + roles.implementer.alias + '" as text');
});

test('the bottom row shows status words only when the story is not busy, and the time on the right', () => {
  const words = { idle: 'Idle · no tester session active', waiting: 'Waiting on you', blocked: 'Blocked' };
  for (const [state, text] of Object.entries(words)) assert.ok(card(state).textContent.includes(text), 'the ' + state + ' card does not say "' + text + '"');
  for (const text of Object.values(words)) assert.ok(!card('busy').textContent.includes(text), 'the busy card says "' + text + '"');
  assert.ok(!has('busy', 'who'), 'the busy card still renders a status-words element');
  for (const state of Object.keys(fixtures)) {
    const rows = card(state).children.filter(child => child && typeof child === 'object');
    const time = walk(card(state)).find(node => node.tag === 'time');
    assert.ok(time, 'the ' + state + ' card shows no time since the last update');
    const row = rows.find(child => walk(child).includes(time));
    assert.ok(row && rows.indexOf(row) > rows.findIndex(child => child.tag === 'h3'), 'the ' + state + ' card time is not below the title');
    assert.equal(walk(row).at(-1), time, 'the ' + state + ' card time is not at the right of its row');
  }
});

test('an unstaffed publishing card says no publisher session is active, not that it waits on a release pipeline', () => {
  const text = card('publisher').textContent;
  assert.ok(text.includes('Idle · no publisher session active'), 'the publishing card says: ' + text);
  assert.ok(!text.includes('release pipeline'), 'the publishing card still mentions a release pipeline');
});

test('app.css keeps no rule for the repository line, the phase pill or the pulse dot', () => {
  const css = read('./ui/app.css');
  for (const selector of ['.card .repo', '.card header .phase', '.pulse']) {
    assert.ok(!css.includes(selector), 'app.css still has a "' + selector + '" rule');
  }
  assert.doesNotMatch(css, /\.card[\w.]* \.owner \.avatar/, 'app.css still styles a glyph in the card owner row');
});

test('the toolbar repository filter and the story detail Repository row remain', () => {
  assert.match(read('./ui/index.html'), /id="repo-filter"/);
  const app = read('./ui/app.js');
  assert.match(app, /\$\('repo-filter'\)/);
  assert.match(app, /row\('Repository', story\.repo\)/);
});

test('reduced motion stops every animation, the card glyph included', () => {
  const block = read('./ui/app.css').match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/)?.[1];
  assert.ok(block, 'app.css has no prefers-reduced-motion block');
  assert.match(block, /\*, \*::before, \*::after \{[^}]*animation: none !important/);
});

const reviewCard = state => {
  const found = cards.get(reviewed[state].id);
  assert.ok(found, 'the board rendered no card for the ' + state + ' story ' + reviewed[state].id);
  return found;
};

test('a story with an open PR shows its review state, and the stall flag after 24 hours without review activity', () => {
  const text = reviewCard('review').textContent;
  for (const label of ['Changes requested · 1 reviewer', '3 unresolved threads', 'Earlier-head feedback · 2', 'No review activity for 1d 2h']) {
    assert.ok(text.includes(label), 'the card in ci does not say "' + label + '": ' + text);
  }
  const quiet = reviewCard('quiet').textContent;
  for (const label of ['Changes requested', 'unresolved', 'Earlier-head', 'No review activity']) {
    assert.ok(!quiet.includes(label), 'a clear review two hours old still says "' + label + '": ' + quiet);
  }
});

test('a story in PR review sits in the PR review lane and waits for the PR review worker', () => {
  const lane = walk(ids.get('board')).find(node => node.classes?.().includes('lane') && walk(node).includes(reviewCard('answering')));
  assert.ok(lane?.children.find(child => child?.tag === 'h2')?.textContent.startsWith('PR review'), 'the pr-review story is not in the PR review lane');
  assert.ok(reviewCard('answering').textContent.includes('Idle · waiting for the PR review worker'));
});

test('the stall flag appears on the next tick once 24 hours pass without review activity, and its age keeps counting', () => {
  const realNow = Date.now;
  try {
    const nearly = { ...base, id: 'STALL-1', phase: 'ci', pr: 'https://github.com/acme/widgets/pull/10',
      prObservation: observation({ lastActivityAt: ago(24 * 60 - 1) }) };
    sources.at(-1).listeners.stories({ data: JSON.stringify({ stories: [...Object.values(fixtures), ...Object.values(reviewed), nearly] }) });
    const card = () => walk(ids.get('board')).find(node => node.tag === 'article' && node.textContent.includes('STALL-1'));
    assert.ok(!card().textContent.includes('No review activity'), 'a PR quiet for 23h 59m is not flagged yet');
    Date.now = () => realNow() + 2 * 60000;
    assert.ok(intervals.length, 'app.js ticks on an interval');
    for (const tick of intervals) tick();
    assert.ok(card().textContent.includes('No review activity for 1d 0h'), 'the flag appears without a new frame: ' + card().textContent);
    const since = walk(card()).find(node => node.tag === 'time' && node.attributes['data-since']);
    assert.equal(since?.attributes['data-since'], nearly.prObservation.review.lastActivityAt, 'the age of the flag is a time node the tick keeps current');
  } finally {
    Date.now = realNow;
  }
});

const show = list => sources.at(-1).listeners.stories({ data: JSON.stringify({ stories: list }) });
const press = node => node.listeners.click.forEach(listener => listener({ preventDefault() {}, stopPropagation() {}, currentTarget: node }));
const useView = name => press(viewButtons.find(button => button.getAttribute('data-view') === name));
const boardCard = id => walk(ids.get('board')).find(node => node.tag === 'article' && node.classes().includes('card') && walk(node).some(child => child.classes?.().includes('id') && child.textContent === id));
const tile = role => walk(ids.get('crew')).find(node => node.tag === 'button' && node.attributes['data-role'] === role);
const tileState = role => ['busy', 'queued', 'idle', 'needs'].find(name => tile(role).classes().includes(name));
const boardIds = () => walk(ids.get('board')).filter(node => node.tag === 'article' && node.classes().includes('card')).map(node => walk(node).find(child => child.classes?.().includes('id')).textContent);
const wordsOf = id => walk(boardCard(id)).find(node => node.classes?.().includes('who'))?.textContent;
const glyph = id => walk(boardCard(id).children.find(child => child?.tag === 'header')).find(node => node.classes?.().includes('avatar'));
const jarvisTurn = { session: 'jarvis-1', handled: 1, turn: { pid: 2, log: 'jarvis.log', at: now() } };
const waitingFor = { since: ago(4), why: 'tester handed off red' };
const waitingWords = 'Waiting on Jarvis · 4m · tester handed off red';
const ownerWords = roles.coordinator.alias + ' · ' + roles.coordinator.job;
const hold = {
  checking: { ...base, id: 'JCHK-1', phase: 'building', jarvis: jarvisTurn },
  waking: { ...base, id: 'JWAK-1', phase: 'building', jarvis: { session: 'jarvis-1', handled: 1, waking: now() } },
  both: { ...base, id: 'JBTH-1', phase: 'building', jarvis: jarvisTurn, waitingOnJarvis: waitingFor },
  waiting: { ...base, id: 'JWAI-1', phase: 'review', waitingOnJarvis: waitingFor, activity: { at: now() } },
  control: { ...base, id: 'JCTL-1', phase: 'building', worker: { id: 'w9', role: 'implementer', session: 's9', turn } },
};
const jarvisBadge = id => {
  const found = glyph(id);
  assert.ok(found, id + ' has no glyph');
  assert.ok(walk(found).some(node => node.tag === 'svg'), id + ' glyph is not a badge: ' + found.textContent);
  assert.ok((found.getAttribute('title') ?? '').startsWith(roles.coordinator.alias + ' · '), id + ' glyph is not the Jarvis badge: ' + found.getAttribute('title'));
  return found;
};

test('a story with no worker and a Jarvis turn running or about to start carries the moving Jarvis badge and says Jarvis is checking', () => {
  show([hold.checking, hold.waking, hold.both]);
  for (const key of ['checking', 'waking', 'both']) {
    const id = hold[key].id;
    assert.ok(jarvisBadge(id).classes().includes('moving'), id + ' Jarvis badge is still');
    assert.equal(boardCard(id).attributes['data-role'], 'coordinator', id + ' is not attributed to Jarvis');
    assert.ok(boardCard(id).classes().includes('busy'), id + ' card is not busy');
    assert.equal(wordsOf(id), 'Jarvis is checking', id + ' card words');
    assert.ok(!boardCard(id).textContent.includes('··'), id + ' card still shows the placeholder');
  }
});

test('a story waiting on Jarvis carries the still Jarvis badge, even with activity in the last ten minutes', () => {
  show([hold.waiting]);
  const id = hold.waiting.id;
  assert.ok(!jarvisBadge(id).classes().includes('moving'), 'the waiting badge moves');
  assert.equal(boardCard(id).attributes['data-role'], 'coordinator');
  assert.ok(!boardCard(id).classes().includes('busy'), 'the waiting card is busy');
  assert.equal(wordsOf(id), waitingWords);
});

test('the crew tile of Jarvis lists a story it is checking as busy and the tile of the phase role drops it', () => {
  show([hold.checking, hold.waking]);
  assert.equal(tileState('coordinator'), 'busy');
  assert.ok(tile('coordinator').textContent.includes('JCHK-1') && tile('coordinator').textContent.includes('JWAK-1'), 'the Jarvis tile does not list both stories: ' + tile('coordinator').textContent);
  assert.ok(!tile('implementer').textContent.includes('JCHK-1') && !tile('implementer').textContent.includes('JWAK-1'), 'the implementer tile still lists them');
  assert.equal(tileState('implementer'), 'idle');
});

test('the crew tile of Jarvis lists a story waiting on it as queued and the tile of the phase role drops it', () => {
  show([hold.waiting]);
  assert.equal(tileState('coordinator'), 'queued');
  assert.ok(tile('coordinator').textContent.includes('JWAI-1'), 'the Jarvis tile does not list the waiting story');
  assert.ok(!tile('reviewer').textContent.includes('JWAI-1'), 'the reviewer tile still lists it');
  assert.equal(tileState('reviewer'), 'idle');
});

test('the Agents-working stat counts Jarvis while it is checking and not while a story only waits on it', () => {
  show([hold.checking, hold.control]);
  assert.equal(ids.get('stat-agents').textContent, '2');
  show([hold.waiting, hold.control]);
  assert.equal(ids.get('stat-agents').textContent, '1');
});

test('the Jarvis filter shows exactly the stories Jarvis holds', () => {
  show([hold.checking, hold.waking, hold.waiting, hold.control]);
  press(tile('coordinator'));
  try {
    assert.deepEqual(boardIds().sort(), ['JCHK-1', 'JWAI-1', 'JWAK-1']);
  } finally {
    press(tile('coordinator'));
  }
  assert.equal(boardIds().length, 4, 'the filter did not clear');
});

test('a lane is hot while Jarvis checks a story in it and not while a story there only waits on Jarvis', () => {
  const laneOf = id => walk(ids.get('board')).find(node => node.classes?.().includes('lane') && walk(node).includes(boardCard(id)));
  show([hold.checking]);
  assert.ok(laneOf('JCHK-1').classes().includes('hot'), 'the lane of the checked story is not hot');
  show([hold.waiting]);
  assert.ok(!laneOf('JWAI-1').classes().includes('hot'), 'the lane of the waiting story is hot');
});

test('the Agents swimlanes place a story under Jarvis, hot while checking, and keep the control under its worker', () => {
  useView('agents');
  try {
    show([hold.checking, hold.waiting, hold.control]);
    const swim = role => walk(ids.get('board')).find(node => node.classes?.().includes('swim') && node.attributes['data-role'] === role);
    const listed = role => walk(swim(role)).filter(node => node.classes?.().includes('id')).map(node => node.textContent).sort();
    assert.deepEqual(listed('coordinator'), ['JCHK-1', 'JWAI-1']);
    assert.deepEqual(listed('implementer'), ['JCTL-1']);
    assert.ok(swim('coordinator').classes().includes('hot'), 'the Jarvis swimlane is not hot');
    show([hold.waiting]);
    assert.ok(!swim('coordinator').classes().includes('hot'), 'a swimlane holding only a waiting story is hot');
  } finally {
    useView('lanes');
  }
});

test('the track view says Jarvis is checking, or what Jarvis waits for, without repeating the story id', () => {
  useView('track');
  try {
    show([hold.checking, hold.waiting]);
    const row = id => walk(ids.get('board')).find(node => node.tag === 'article' && node.classes().includes('track') && walk(node).some(child => child.classes?.().includes('id') && child.textContent === id));
    assert.ok(row('JCHK-1').textContent.includes('Jarvis is checking'), 'the track row does not say Jarvis is checking: ' + row('JCHK-1').textContent);
    assert.ok(!row('JCHK-1').textContent.includes('Jarvis is checking JCHK-1'), 'the track row repeats the story id');
    assert.equal(row('JCHK-1').attributes['data-role'], 'coordinator');
    assert.ok(row('JWAI-1').textContent.includes(waitingWords));
    assert.equal(row('JWAI-1').attributes['data-role'], 'coordinator');
  } finally {
    useView('lanes');
  }
});

const detailRows = async story => {
  const win = document.getElementById('detail');
  if (!win.querySelector('.win-title')) { const title = new Node('span'); title.className = 'win-title'; win.append(title); }
  show([story]);
  press(boardCard(story.id));
  await new Promise(resolve => setTimeout(resolve, 0));
  return Object.fromEntries(walk(ids.get('detail-body')).filter(node => node.classes?.().includes('row')).map(node => [node.children[0].textContent, node.children[1].textContent]));
};

test('the story window names Jarvis as the owner while it checks or waits, and its Jarvis row has no story id', async () => {
  const checking = await detailRows(hold.checking);
  assert.equal(checking.Owner, ownerWords);
  assert.equal(checking.Jarvis, 'Jarvis is checking');
  const waiting = await detailRows(hold.waiting);
  assert.equal(waiting.Owner, ownerWords);
  assert.equal(waiting.Jarvis, waitingWords);
});

const idleWorker = { id: 'w5', role: 'implementer', session: 's5', lastTurn: { outcome: 'ended', at: now(), code: 0 } };
const keeps = {
  idleWorker: { story: { ...base, id: 'KEEP-1', phase: 'building', worker: idleWorker, jarvis: jarvisTurn }, role: 'implementer', words: 'Jarvis is checking' },
  idleWorkerWaiting: { story: { ...base, id: 'KEEP-2', phase: 'building', worker: idleWorker, waitingOnJarvis: waitingFor }, role: 'implementer', words: waitingWords },
  question: { story: { ...base, id: 'KEEP-3', phase: 'building', questions: [{ id: 'q', prompt: 'Which way?', options: [] }], jarvis: jarvisTurn, waitingOnJarvis: waitingFor }, role: 'approver', words: 'Waiting on you' },
  blocked: { story: { ...base, id: 'KEEP-4', phase: 'building', blocked: true, jarvis: jarvisTurn, waitingOnJarvis: waitingFor }, role: 'implementer', words: 'Blocked' },
  approval: { story: { ...base, id: 'KEEP-5', phase: 'approval', jarvis: jarvisTurn, waitingOnJarvis: waitingFor }, role: 'approver', words: 'Waiting on you' },
};

test('an assigned worker, an open question, a blocker and approval keep their owner while Jarvis checks or is waited on', () => {
  show(Object.values(keeps).map(each => each.story));
  for (const [name, { story, role }] of Object.entries(keeps)) {
    assert.equal(boardCard(story.id).attributes['data-role'], role, name + ' changed owner');
    assert.ok(!(glyph(story.id).getAttribute('title') ?? '').startsWith(roles.coordinator.alias), name + ' shows the Jarvis badge');
    assert.ok(!glyph(story.id).classes().includes('moving'), name + ' glyph moves');
    assert.ok(!boardCard(story.id).classes().includes('busy'), name + ' card is busy');
  }
  assert.ok(!/KEEP-/.test(tile('coordinator').textContent), 'the Jarvis tile lists a story it does not hold: ' + tile('coordinator').textContent);
});

test('an idle assigned worker keeps the story and its placeholder glyph beside the shorter Jarvis words', () => {
  show(Object.values(keeps).map(each => each.story));
  for (const name of ['idleWorker', 'idleWorkerWaiting']) assert.equal(glyph(keeps[name].story.id).textContent, '··', name + ' glyph');
  for (const [name, { story, words }] of Object.entries(keeps)) assert.equal(wordsOf(story.id), words, name + ' words');
});

test('a running worker turn keeps the story and its moving badge while Jarvis is waited on', () => {
  show([{ ...hold.control, id: 'KEEP-7', waitingOnJarvis: waitingFor, jarvis: jarvisTurn }]);
  assert.equal(boardCard('KEEP-7').attributes['data-role'], 'implementer');
  assert.ok(glyph('KEEP-7').classes().includes('moving'));
  assert.equal(tileState('coordinator'), 'idle');
});

test('once the Jarvis turn ends and nothing waits on Jarvis, the story returns to its phase role', () => {
  show([hold.checking, hold.waiting]);
  assert.equal(boardCard('JCHK-1').attributes['data-role'], 'coordinator');
  const ended = { ...hold.checking, jarvis: { session: 'jarvis-1', handled: 1, lastTurn: { outcome: 'ended', at: now(), code: 0 } } };
  const answered = { ...hold.waiting, waitingOnJarvis: undefined };
  show([ended, answered]);
  assert.equal(boardCard('JCHK-1').attributes['data-role'], 'implementer');
  assert.equal(glyph('JCHK-1').textContent, '··');
  assert.equal(boardCard('JWAI-1').attributes['data-role'], 'reviewer');
  assert.equal(tileState('coordinator'), 'idle');
  assert.ok(tile('coordinator').textContent.includes('standing by'));
});

test('the track view marks a story with no hold as idle and a story waiting on Jarvis as not idle', () => {
  useView('track');
  try {
    show([hold.waiting, { ...base, id: 'JIDL-1', phase: 'building' }]);
    const row = id => walk(ids.get('board')).find(node => node.tag === 'article' && node.classes().includes('track') && walk(node).some(child => child.classes?.().includes('id') && child.textContent === id));
    assert.ok(row('JIDL-1').classes().includes('idle'), 'a story with no hold is not idle');
    assert.ok(!row('JWAI-1').classes().includes('idle'), 'a story waiting on Jarvis is idle');
  } finally {
    useView('lanes');
  }
});

const laneNameOf = new Map(walk(ids.get('board')).filter(node => node.classes?.().includes('lane'))
  .flatMap(lane => walk(lane).filter(node => node.tag === 'article').map(article => [article, lane.children.find(child => child?.tag === 'h2')?.children[0]])));

test('a merged story whose retro is running stays in the Ship lane labelled "Merged · finishing retro", and an open PR in retro does not', () => {
  const merged = cards.get(retros.merged.id);
  assert.ok(merged, 'the board rendered no card for the merged story in retro');
  assert.ok(merged.textContent.includes('Merged · finishing retro'), 'the merged card says: ' + merged.textContent);
  assert.equal(laneNameOf.get(merged), 'Ship');
  const open = cards.get(retros.open.id);
  assert.ok(open, 'the board rendered no card for the story in retro with its PR open');
  assert.ok(!open.textContent.includes('Merged'), 'the retro card with an open PR says: ' + open.textContent);
  assert.ok(!cards.has(shipped.id), 'a closed story has no card on the board');
});

const mergedWords = 'Merged · finishing retro';
const retroPair = [retros.merged, retros.open];
const trackRow = id => walk(ids.get('board')).find(node => node.tag === 'article' && node.classes().includes('track') && walk(node).some(child => child.classes?.().includes('id') && child.textContent === id));

test('the card glyph tooltip and accessible label say merged with the finishing retro, and an open PR in retro keeps the plain phase name', () => {
  show(retroPair);
  const glyph = id => walk(boardCard(id)).find(node => node.getAttribute?.('title'));
  assert.ok(glyph(retros.merged.id).getAttribute('title').endsWith(' · ' + mergedWords), glyph(retros.merged.id).getAttribute('title'));
  assert.ok(glyph(retros.merged.id).getAttribute('aria-label').endsWith(' · ' + mergedWords));
  assert.ok(!glyph(retros.open.id).getAttribute('title').includes('Merged'), glyph(retros.open.id).getAttribute('title'));
});

test('the track view row and its current step say merged with the finishing retro, and an open PR in retro does not', () => {
  useView('track');
  try {
    show(retroPair);
    const merged = trackRow(retros.merged.id);
    const owner = walk(merged).find(node => node.classes?.().includes('owner'));
    assert.ok(owner.textContent.startsWith(mergedWords), owner.textContent);
    const now = walk(merged).find(node => node.tag === 'li' && node.classes().includes('now'));
    assert.equal(now.textContent, mergedWords);
    const open = trackRow(retros.open.id);
    assert.ok(!open.textContent.includes('Merged'), open.textContent);
  } finally {
    useView('lanes');
  }
});

test('the story window heading and title say merged with the finishing retro, and an open PR in retro does not', async () => {
  await detailRows(retros.merged);
  const heading = walk(ids.get('detail-body')).find(node => node.tag === 'small');
  assert.equal(heading.textContent, retros.merged.id + ' · ' + mergedWords);
  assert.equal(document.getElementById('detail').querySelector('.win-title').textContent, retros.merged.id + ' · ' + mergedWords);
  await detailRows(retros.open);
  const openHeading = walk(ids.get('detail-body')).find(node => node.tag === 'small');
  assert.ok(!openHeading.textContent.includes('Merged'), openHeading.textContent);
  assert.ok(!document.getElementById('detail').querySelector('.win-title').textContent.includes('Merged'));
});

const strange = { ...base, id: 'ODD-1', repo: 'acme/one', phase: 'mystery' };

test('a story in a phase the board does not know shows the raw phase name on its card and in the story window', async () => {
  useView('agents');
  try {
    show([strange]);
    const title = walk(boardCard(strange.id)).find(node => node.getAttribute?.('title')).getAttribute('title');
    assert.ok(title.endsWith(' · mystery'), title);
    await detailRows(strange);
    const heading = walk(ids.get('detail-body')).find(node => node.tag === 'small');
    assert.equal(heading.textContent, strange.id + ' · mystery');
    assert.equal(document.getElementById('detail').querySelector('.win-title').textContent, strange.id + ' · mystery');
  } finally {
    useView('lanes');
  }
});

test('the track view shows the raw phase name for an unknown phase and the column name when the phase has no label', () => {
  useView('track');
  const testing = meta.phases.testing;
  try {
    show([strange]);
    const owner = walk(trackRow(strange.id)).find(node => node.classes?.().includes('owner'));
    assert.ok(owner.textContent.startsWith('mystery'), owner.textContent);
    const column = meta.columns.find(each => each.phases.includes('testing')).name;
    delete meta.phases.testing;
    show([{ ...strange, id: 'ODD-2', phase: 'testing' }]);
    const unlabelled = walk(trackRow('ODD-2')).find(node => node.classes?.().includes('owner'));
    assert.ok(unlabelled.textContent.startsWith(column), unlabelled.textContent);
    const now = walk(trackRow('ODD-2')).find(node => node.tag === 'li' && node.classes().includes('now'));
    assert.equal(now.textContent, column);
  } finally {
    meta.phases.testing = testing;
    useView('lanes');
  }
});

const held = {
  idle: { ...base, id: 'HELD-1', repo: 'acme/one', phase: 'retro', pr: 'https://github.com/acme/one/pull/7',
    retro: { returnPhase: 'ci', startedAt: ago(30), mergedAt: ago(5), detail: 'Merged.' },
    worker: { id: 'w9', role: 'coordinator', session: 's9', lastTurn: { outcome: 'ended', at: now(), code: 0 } } },
  asking: { ...base, id: 'HELD-2', repo: 'acme/one', phase: 'retro', pr: 'https://github.com/acme/one/pull/8',
    retro: { returnPhase: 'ci', startedAt: ago(30), mergedAt: ago(5), detail: 'Merged.' },
    questions: [{ id: 'retro-1', prompt: 'Keep the lesson?', options: ['Keep', 'Drop'], recommended: 0 }],
    worker: { id: 'w10', role: 'coordinator', session: 's10', lastTurn: { outcome: 'ended', at: now(), code: 0 } } },
  running: { ...base, id: 'HELD-3', repo: 'acme/one', phase: 'retro', pr: 'https://github.com/acme/one/pull/9',
    retro: { returnPhase: 'ci', startedAt: ago(30) },
    worker: { id: 'w11', role: 'coordinator', session: 's11', lastTurn: { outcome: 'ended', at: now(), code: 0 } } },
};

test('a story held in the retro after its merge is labelled as merged and finishing the retro, and an unmerged retro is not', () => {
  show([held.idle, held.running]);
  assert.ok(boardCard('HELD-1').textContent.includes('Merged · finishing retro'), 'the held story card does not say it is merged and finishing the retro: ' + boardCard('HELD-1').textContent);
  assert.ok(!boardCard('HELD-3').textContent.includes('Merged · finishing retro'), 'a retro with no merge is labelled as merged');
});

test('only a story in the retro phase reads as merged and finishing the retro, even if it kept retro.mergedAt', () => {
  show([{ ...held.idle, id: 'HELD-4', phase: 'ci' }]);
  assert.ok(boardCard('HELD-4'), 'the story outside the retro has no card');
  assert.ok(!boardCard('HELD-4').textContent.includes('Merged · finishing retro'), 'a story that left the retro is labelled as finishing it: ' + boardCard('HELD-4').textContent);
});

test('a held retro is in Waiting on you only while a question is open, and it is not in the Archive until it closes', () => {
  show([held.idle]);
  assert.ok(!boardCard('HELD-1').classes().includes('waiting'), 'a held retro with no open question is waiting on the owner');
  assert.equal(ids.get('stat-waiting').textContent, '0');
  assert.equal(ids.get('stat-shipped').textContent, '0', 'a held retro is counted as shipped');
  show([held.asking]);
  assert.ok(boardCard('HELD-2').classes().includes('waiting'), 'a held retro with an open question is not waiting on the owner');
  assert.equal(wordsOf('HELD-2'), 'Waiting on you');
  assert.equal(ids.get('stat-waiting').textContent, '1');
  assert.equal(ids.get('stat-shipped').textContent, '0', 'a held retro is counted as shipped');
  show([{ ...held.asking, phase: 'closed' }]);
  assert.equal(ids.get('stat-shipped').textContent, '1');
  assert.equal(ids.get('stat-waiting').textContent, '0');
});

const formatted = [
  'Which docs should change?', '',
  '1. First **bold** step', '2. Second step with `code`', '',
  '- bullet one', '- bullet two', '',
  '(a) lettered one', '(b) lettered two', '',
  '<img src=x onerror=alert(1)>', '<script>alert(1)</script>', '[bad](javascript:alert(1))',
].join('\n');
const asking = { ...base, id: 'QFMT-9', repo: 'acme/one', phase: 'planning', questions: [{ id: 'docs', prompt: formatted, options: ['All', 'None'], recommended: 0 }] };

const openQuestionCard = () => {
  show([asking]);
  press(tile('approver'));
  const section = walk(ids.get('decisions')).find(node => node.tag === 'section' && node.classes().includes('question'));
  assert.ok(section, 'the inbox rendered no question card');
  const labelled = section.getAttribute('aria-labelledby');
  const prompt = walk(section).find(node => node.attributes?.id === labelled);
  return { section, labelled, prompt };
};

test('a question card renders its prompt as lists, paragraphs, line breaks, bold and code', () => {
  const { prompt } = openQuestionCard();
  try {
    assert.ok(prompt, 'no element in the card has the id that the question group is labelled by');
    const inside = tag => walk(prompt).filter(node => node.tag === tag);
    assert.deepEqual(inside('ol').flatMap(list => list.children.map(item => item.textContent)), ['First bold step', 'Second step with code']);
    assert.deepEqual(inside('ul').flatMap(list => list.children.map(item => item.textContent)), ['bullet one', 'bullet two']);
    assert.ok(inside('p').length >= 3, 'blank lines did not make separate paragraphs: ' + inside('p').length + ' p');
    assert.deepEqual(inside('strong').map(node => node.textContent), ['bold']);
    assert.deepEqual(inside('code').map(node => node.textContent), ['code']);
    const lettered = inside('p').find(node => node.textContent.includes('(a) lettered one'));
    assert.ok(lettered && walk(lettered).some(node => node.tag === 'br'), 'the (a) and (b) lines have no br between them');
    assert.ok(prompt.classes().includes('md') && prompt.classes().includes('q-prompt'), 'the prompt block lost q-prompt or lacks md: ' + prompt.className);
  } finally {
    press(tile('approver'));
  }
});

test('a question card shows injected HTML and a javascript: link in a prompt as text and keeps the group labelled by the prompt', () => {
  const { section, labelled, prompt } = openQuestionCard();
  try {
    assert.equal(labelled, 'q-QFMT-9-docs');
    assert.ok(prompt, 'no element in the card has the id that the question group is labelled by');
    assert.ok(!walk(section).some(node => ['img', 'script'].includes(node.tag)), 'an img or script node was built from the prompt');
    assert.ok(!walk(section).some(node => node.tag === 'a' && /^javascript:/i.test(node.attributes?.href ?? '')), 'a javascript: link was rendered');
    assert.ok(prompt.textContent.includes('<img src=x onerror=alert(1)>'), 'the img text is not shown literally');
    assert.ok(prompt.textContent.includes('<script>alert(1)</script>'), 'the script text is not shown literally');
    assert.ok(prompt.textContent.includes('[bad](javascript:alert(1))'), 'the javascript: link is not shown as text');
  } finally {
    press(tile('approver'));
  }
});

test('a question card keeps its option buttons as plain text', () => {
  const { section } = openQuestionCard();
  try {
    const choices = walk(section).find(node => node.classes?.().includes('choices'));
    assert.deepEqual(choices.children.map(button => button.children[0]), ['All', 'None']);
  } finally {
    press(tile('approver'));
  }
});

const shown = { ...base, id: 'CMPN-1', phase: 'comparison-choice' };
const cmp = {
  waiting: { ...base, id: 'CMPW-1', phase: 'comparison-choice', waitingOnJarvis: waitingFor },
  checking: { ...base, id: 'CMPC-1', phase: 'comparison-choice', jarvis: jarvisTurn },
  waking: { ...base, id: 'CMPK-1', phase: 'comparison-choice', jarvis: { session: 'jarvis-1', handled: 1, waking: now() } },
  failed: { ...base, id: 'CMPF-1', phase: 'comparison-choice', jarvis: jarvisTurn, waitingOnJarvis: waitingFor,
    questions: [{ id: 'action-jarvis-9', prompt: 'The Jarvis turn failed.', options: ['Retry'], recommended: 0 }] },
};
const cardTitle = 'Before-and-after for A story: capture it or skip?';
const cardHint = "Jarvis records the approved spec's choice itself. Answer here only if the spec left it open.";
const inboxRows = () => walk(ids.get('decisions')).filter(node => node.classes?.().includes('pending-row'));
const rowFor = id => inboxRows().find(row => row.textContent.startsWith(id + ' · '));
const compareCards = () => walk(ids.get('decisions')).filter(node => node.attributes?.['data-kind'] === 'compare');
const cardKinds = id => walk(ids.get('decisions')).filter(node => node.attributes?.['data-story'] === id && node.attributes['data-kind']).map(node => node.attributes['data-kind']);
const inFocus = run => {
  press(tile('approver'));
  try { return run(); } finally { press(tile('approver')); }
};
const notices = [];
globalThis.Notification = class { static permission = 'granted'; constructor(title, options) { notices.push({ title, options }); } };
const noticesFor = id => notices.filter(notice => notice.options.tag === id);

test('a comparison-choice story Jarvis waits on or checks has no card, no inbox row and no Waiting on you count', () => {
  for (const key of ['waiting', 'checking', 'waking']) {
    const story = cmp[key];
    show([story]);
    assert.ok(!rowFor(story.id), key + ': the inbox lists ' + story.id);
    assert.equal(inboxRows().length, 0, key + ': the inbox has rows');
    assert.equal(ids.get('stat-waiting').textContent, '0', key + ': the Waiting on you stat counts it');
    assert.equal(document.title, 'AI SDLC Command Center', key + ': the tab title counts it: ' + document.title);
    assert.ok(!boardCard(story.id).classes().includes('waiting'), key + ': the board card is waiting on you');
    inFocus(() => assert.equal(compareCards().length, 0, key + ': the inbox shows the comparison card'));
  }
});

test('a held comparison-choice story with no worker and no blocker shows Jarvis as its owner on the board', () => {
  show([cmp.waiting, cmp.checking, cmp.waking]);
  const expected = { 'CMPW-1': waitingWords, 'CMPC-1': 'Jarvis is checking', 'CMPK-1': 'Jarvis is checking' };
  for (const [id, words] of Object.entries(expected)) {
    assert.equal(boardCard(id).attributes['data-role'], 'coordinator', id + ' is not attributed to Jarvis');
    assert.equal(wordsOf(id), words, id + ' card words');
  }
  assert.ok(tile('coordinator').textContent.includes('CMPW-1'), 'the Jarvis tile does not list the waiting story');
  assert.ok(!tile('approver').textContent.includes('CMP'), 'the approver tile still lists a held story: ' + tile('approver').textContent);
});

test('a comparison-choice story with no hold waits on you, counts, and gets an inbox row and the neutral card', () => {
  show([shown]);
  assert.ok(rowFor(shown.id), 'the inbox has no row for ' + shown.id);
  assert.ok(rowFor(shown.id).textContent.includes(cardTitle), 'the inbox row says: ' + rowFor(shown.id).textContent);
  assert.equal(ids.get('stat-waiting').textContent, '1');
  assert.equal(document.title, '(1) AI SDLC Command Center');
  assert.equal(boardCard(shown.id).attributes['data-role'], 'approver');
  assert.equal(wordsOf(shown.id), 'Waiting on you');
  inFocus(() => {
    const [found, ...rest] = compareCards();
    assert.ok(found && !rest.length, 'expected one comparison card, found ' + compareCards().length);
    assert.equal(walk(found).find(node => node.classes?.().includes('title')).textContent, cardTitle);
    assert.equal(walk(found).find(node => node.classes?.().includes('hint')).textContent, cardHint);
    assert.ok(walk(found).some(node => node.classes?.().includes('shots')), 'the baseline screenshot picker is gone');
    const buttons = walk(found.querySelector('.send')).filter(node => node.tag === 'button');
    assert.deepEqual(buttons.map(node => node.textContent), ['Capture it', 'Skip']);
    for (const button of buttons) assert.ok(!button.classes().includes('primary'), button.textContent + ' is the primary button');
  });
});

test('Capture it sends comparison-choice run true and Skip sends run false', async () => {
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => { sent.push(JSON.parse(init.body)); return { ok: true, json: async () => ({}) }; };
  try {
    show([shown]);
    for (const [label, run] of [['Capture it', true], ['Skip', false]]) {
      inFocus(() => press(walk(compareCards()[0].querySelector('.send')).find(node => node.tag === 'button' && node.textContent === label)));
      await new Promise(resolve => setTimeout(resolve, 0));
      const event = sent.at(-1);
      assert.equal(event?.type, 'comparison-choice', label + ' sent ' + JSON.stringify(event));
      assert.equal(event.story, shown.id);
      assert.equal(event.run, run);
      show([shown]);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('the notification for a comparison-choice story fires when no hold applies, and never while Jarvis holds it', () => {
  notices.length = 0;
  show([]);
  show([cmp.waiting, cmp.checking]);
  assert.equal(notices.length, 0, 'a held story raised a notification: ' + JSON.stringify(notices));
  show([cmp.waiting, cmp.checking, shown]);
  assert.equal(noticesFor(shown.id).length, 1, 'the story with no hold raised no notification');
  assert.equal(noticesFor(cmp.waiting.id).length + noticesFor(cmp.checking.id).length, 0);
});

test('the notification fires when a hold ends', () => {
  notices.length = 0;
  show([]);
  show([cmp.waiting]);
  assert.equal(notices.length, 0);
  show([{ ...cmp.waiting, waitingOnJarvis: undefined }]);
  assert.equal(noticesFor(cmp.waiting.id).length, 1, 'the end of the hold raised no notification');
  assert.equal(ids.get('stat-waiting').textContent, '1');
});

test('the inbox gains the card and its row when a hold clears, and loses them when a hold begins, with nothing else changed', () => {
  const cleared = { ...cmp.waiting, waitingOnJarvis: undefined };
  show([cmp.waiting]);
  assert.equal(inboxRows().length, 0);
  show([cleared]);
  assert.ok(rowFor(cmp.waiting.id), 'the row did not appear when the hold cleared');
  inFocus(() => assert.equal(compareCards().length, 1, 'the card did not appear when the hold cleared'));
  inFocus(() => {
    show([cleared]);
    assert.equal(compareCards().length, 1);
    show([cmp.waiting]);
    assert.equal(compareCards().length, 0, 'the card stayed after a hold began');
    show([cleared]);
    assert.equal(compareCards().length, 1, 'the card did not return when the hold cleared in the open inbox');
  });
  show([cmp.waiting]);
  assert.ok(!rowFor(cmp.waiting.id), 'the row stayed after a hold began');
  assert.equal(ids.get('stat-waiting').textContent, '0');
});

test('a comparison-choice story with an open question waits on you even while Jarvis holds it, and shows only the question', () => {
  show([cmp.failed]);
  assert.equal(ids.get('stat-waiting').textContent, '1');
  assert.equal(wordsOf(cmp.failed.id), 'Waiting on you');
  assert.equal(boardCard(cmp.failed.id).attributes['data-role'], 'approver');
  inFocus(() => assert.deepEqual(cardKinds(cmp.failed.id), ['grooming']));
});

test('in the open inbox, a comparison-choice story with an open question loses the compare card when a hold begins and regains it when the hold ends', () => {
  const cleared = { ...cmp.failed, waitingOnJarvis: undefined, jarvis: undefined };
  inFocus(() => {
    show([cleared]);
    assert.deepEqual(cardKinds(cleared.id), ['grooming', 'compare']);
    show([cmp.failed]);
    assert.deepEqual(cardKinds(cleared.id), ['grooming'], 'the compare card stayed after a hold began');
    show([cleared]);
    assert.deepEqual(cardKinds(cleared.id), ['grooming', 'compare'], 'the compare card stayed missing after the hold ended');
  });
});
