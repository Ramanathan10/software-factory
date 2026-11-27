import assert from 'node:assert/strict';
import { test } from 'node:test';

const loose = new Proxy(function () {}, {
  get: (target, key) => key === Symbol.iterator ? [][Symbol.iterator].bind([]) : key === Symbol.toPrimitive ? () => '' : loose,
  apply: () => loose,
  set: () => true,
});

class Node {
  constructor(tag) {
    Object.assign(this, { tag, children: [], className: '', attributes: {}, dataset: {}, listeners: {} });
    return new Proxy(this, { get: (target, key) => key in target ? target[key] : typeof key === 'symbol' ? undefined : loose });
  }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.children = nodes.flat(); }
  replaceWith() {}
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener() {}
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  set textContent(value) { this.children = [String(value)]; }
}

const ids = new Map();
const now = new Date().toISOString();
const base = { title: 'A story', branch: 'story/x', worktree: 'C:/w/x', harness: 'Claude Code', questions: [], artifacts: [], files: [], events: [], revision: 1, createdAt: now, updatedAt: now, pr: 'https://github.com/acme/widgets/pull/10' };
const stories = [
  { ...base, id: 'MRG-1', phase: 'retro', retro: { returnPhase: 'ci', startedAt: now, mergedAt: now, detail: 'The PR merged.' } },
  { ...base, id: 'MRG-B', phase: 'retro', blocked: 'Waiting on the owner.', retro: { returnPhase: 'ci', startedAt: now, mergedAt: now, detail: 'The PR merged.' } },
  { ...base, id: 'MRG-D', phase: 'retro', pendingDecision: { seq: 3 }, retro: { returnPhase: 'ci', startedAt: now, mergedAt: now, detail: 'The PR merged.' } },
  { ...base, id: 'LEFT-1', phase: 'ci', retro: { returnPhase: 'ci', startedAt: now, mergedAt: now, detail: 'The PR merged.' } },
  { ...base, id: 'RET-1', phase: 'retro', retro: { returnPhase: 'ci', startedAt: now, detail: 'Review lessons.' } },
];
const filter = new Node('select');
filter.value = '';
ids.set('harness-filter', filter);
Object.assign(globalThis, {
  document: {
    createElement: tag => new Node(tag),
    getElementById: id => ids.get(id) ?? ids.set(id, new Node('div')).get(id),
    querySelectorAll: () => [],
  },
  fetch: async () => ({ ok: true, json: async () => stories }),
  setInterval: () => 0,
});
await import('./console.mjs');

const rows = () => Object.fromEntries(ids.get('overview').children.map(button => [button.children[0].textContent.split(' · ')[0], button.children[1].textContent]));

test('the console labels a story in retro after its merge as merged with the finishing retro, owned by the coordinator', () => {
  const merged = rows()['MRG-1'];
  assert.ok(merged.includes('Merged · finishing retro'), merged);
  assert.ok(merged.startsWith('Jarvis'), merged);
});

test('the console does not call a story in retro with its PR still open merged', () => {
  const open = rows()['RET-1'];
  assert.ok(!open.includes('Merged'), open);
});

test('a blocked merged retro shows Blocked, not merged', () => {
  const blocked = rows()['MRG-B'];
  assert.ok(blocked.includes('Blocked'), blocked);
  assert.ok(!blocked.includes('Merged · finishing retro'), blocked);
});

test('a merged retro with a saved decision shows it is waiting for Jarvis, with an alert', () => {
  const waiting = rows()['MRG-D'];
  assert.ok(waiting.includes('Decision saved · waiting for Jarvis'), waiting);
  assert.ok(!waiting.includes('Merged · finishing retro'), waiting);
  const button = ids.get('overview').children.find(each => each.children[0].textContent.startsWith('MRG-D'));
  assert.ok(String(button.children[1].className).includes('attention-text'), 'no alert on the decision row');
});

test('a story that left the retro does not read as merged and finishing the retro, even if it kept retro.mergedAt', () => {
  const left = rows()['LEFT-1'];
  assert.ok(!left.includes('Merged · finishing retro'), left);
});
