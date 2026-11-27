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
  { ...base, id: 'MRG-1', phase: 'retro', retro: { returnPhase: 'closed', startedAt: now, detail: 'The PR merged.' } },
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

test('the console labels a story in retro after its merge as merged with the retro in progress, owned by the coordinator', () => {
  const merged = rows()['MRG-1'];
  assert.ok(merged.includes('Merged · retro in progress'), merged);
  assert.ok(merged.startsWith('Jarvis'), merged);
});

test('the console does not call a story in retro with its PR still open merged', () => {
  const open = rows()['RET-1'];
  assert.ok(!open.includes('Merged'), open);
});
