import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canReach, explore, follow, guarded, jarvisEvents, jarvisInputs, jarvisTable, unguarded } from './lifecycle-model.mjs';
import { phases } from './roles.mjs';
import { workerPhases } from './store.mjs';

const states = explore();
const live = [...states].filter(([, node]) => !node.state.deleted);
const story = node => node.path.join(' → ') || 'create';

test('the explorer covers every field a store guard reads', () => {
  const read = new Set([...readFileSync(new URL('./store.mjs', import.meta.url), 'utf8').matchAll(/\bstory\.(\w+)/g)].map(match => match[1]));
  const unknown = [...read].filter(field => !guarded.includes(field) && !unguarded.includes(field));
  assert.deepEqual(unknown, [], 'store.mjs reads story.' + unknown.join(', story.') + '. Add it to `guarded` in lifecycle-model.mjs ' +
    'and to `abstract` and `concrete` if a guard reads it, or to `unguarded` if only the dashboard does.');
});

test('every reachable phase is a console phase, and every console phase is reachable', () => {
  const reached = new Set(live.map(([, node]) => node.state.phase));
  assert.deepEqual([...reached].filter(phase => !phases[phase]), [], 'store.mjs moves a story to a phase roles.mjs does not list');
  assert.deepEqual(Object.keys(phases).filter(phase => !reached.has(phase)), [], 'roles.mjs lists a phase no event reaches');
});

test('a story that is not being cleaned up can always still merge', () => {
  const shipping = new Map([...states].map(([id, node]) => [id, { ...node, edges: node.edges.filter(edge => !edge.type.includes('cleanup')) }]));
  const ships = canReach(shipping, state => state.phase === 'closed');
  const stuck = live.filter(([id, node]) => !node.state.cleanup && !ships.has(id));
  assert.deepEqual(stuck.map(([, node]) => story(node)), [], 'these stories can never reach closed');
});

test('the merge of a registered pull request closes the story from any open PR phase', () => {
  const refused = live.filter(([, { state }]) => state.pr && ['ci', 'merge', 'retro'].includes(state.phase) && !state.cleanup)
    .filter(([id, { state }]) => follow(states, id, [...(state.worker ? ['release-worker'] : []), 'merged'])?.phase !== 'closed');
  assert.deepEqual(refused.map(([, node]) => story(node)), [], 'merged was refused after these events');
});

test('a worker is assigned only in a phase that has one, and a phase never changes under it', () => {
  assert.deepEqual(live.filter(([, { state }]) => state.worker && !workerPhases.has(state.phase)).map(([, node]) => story(node)), []);
  for (const [, node] of live) {
    for (const edge of node.edges) {
      const next = states.get(edge.to).state;
      if (node.state.worker && !next.deleted && next.phase !== node.state.phase) assert.fail(edge.type + ' changed the phase with a worker assigned, after ' + story(node));
    }
  }
});

test('a story awaiting cleanup never changes phase', () => {
  for (const [, node] of live.filter(([, { state }]) => state.cleanup)) {
    for (const edge of node.edges) {
      const next = states.get(edge.to).state;
      if (!next.deleted) assert.equal(next.phase, node.state.phase, edge.type + ' moved a story awaiting cleanup, after ' + story(node));
    }
  }
});

test('the store accepts every event the Jarvis phase table records, in or into its phases', () => {
  const table = jarvisTable(readFileSync(new URL('../skills/jarvis/SKILL.md', import.meta.url), 'utf8'));
  assert.ok(table.length >= 9, 'the Jarvis phase table was not found');
  const notEvents = new Set(['before', 'after', 'diagram', 'recording', 'document', 'pipeline']);
  const missing = [];
  for (const { row, phases: rowPhases, events } of table) {
    for (const type of events.filter(type => !notEvents.has(type) && type !== 'create')) {
      const accepted = live.some(([, node]) => node.edges.some(edge => edge.type === type &&
        (rowPhases.includes(node.state.phase) || rowPhases.includes(states.get(edge.to).state.phase))));
      if (!accepted) missing.push(row + ': ' + type);
    }
  }
  assert.deepEqual(missing, [], 'skills/jarvis/SKILL.md tells Jarvis to record events the store refuses in those phases');
});

test('a background Jarvis turn changes nothing but its own record, is never refused by a blocker or cleanup, and never runs twice', () => {
  const around = explore({ inputs: jarvisInputs });
  const others = state => JSON.stringify({ ...state, jarvis: undefined });
  const wrong = [];
  for (const [, node] of around) {
    if (node.state.deleted) continue;
    const accepted = new Set(node.edges.map(edge => edge.type));
    const jarvis = node.state.jarvis;
    const expected = { 'jarvis-woken': !jarvis, 'jarvis-turn-started': !jarvis?.turn, 'jarvis-turn-ended': Boolean(jarvis) };
    for (const type of jarvisEvents) if (accepted.has(type) !== expected[type]) wrong.push(type + (expected[type] ? ' refused' : ' accepted') + ' after ' + story(node));
    for (const edge of node.edges.filter(edge => jarvisEvents.includes(edge.type))) {
      if (others(around.get(edge.to).state) !== others(node.state)) wrong.push(edge.type + ' changed the story after ' + story(node));
    }
    const asked = node.state.questions.some(question => question.id === 'action-jarvis-1');
    if (!asked && !node.edges.some(edge => edge.type === 'question' && edge.input.question === 'action-jarvis-1')) wrong.push('the Jarvis failure question was refused after ' + story(node));
  }
  assert.ok([...around.values()].some(node => node.state.blocked && node.state.jarvis?.turn), 'no blocked story with a Jarvis turn was reached');
  assert.ok([...around.values()].some(node => node.state.cleanup && node.state.jarvis?.turn), 'no story awaiting cleanup with a Jarvis turn was reached');
  assert.deepEqual(wrong, []);
});

test('PR review is reached from an open PR, a merge closes it, and a retro never starts from it', () => {
  const reviewing = live.filter(([, { state }]) => state.phase === 'pr-review');
  assert.ok(reviewing.length, 'no event moves a story into pr-review');
  const entries = live.flatMap(([, node]) => node.edges.filter(edge => states.get(edge.to).state.phase === 'pr-review' && node.state.phase !== 'pr-review')
    .map(edge => node.state.phase + ' ' + edge.type));
  assert.deepEqual([...new Set(entries)].sort(), ['ci pr-review-start', 'merge pr-review-start']);
  const refused = reviewing.filter(([, { state }]) => !state.cleanup)
    .filter(([id, { state }]) => follow(states, id, [...(state.worker ? ['release-worker'] : []), 'merged'])?.phase !== 'closed');
  assert.deepEqual(refused.map(([, node]) => story(node)), [], 'merged was refused in pr-review after these events');
  const retro = reviewing.filter(([, node]) => node.edges.some(edge => edge.type === 'retro-start'));
  assert.deepEqual(retro.map(([, node]) => story(node)), [], 'a retro started from pr-review');
  const handoffs = new Set(reviewing.flatMap(([, node]) => node.edges.filter(edge => edge.type === 'handoff').map(edge => states.get(edge.to).state.phase)));
  assert.deepEqual([...handoffs], ['ci'], 'the PR review handoff returns to ci');
});

test('readiness is refused while the observed review blocks it, and allowed once it does not', () => {
  const ci = live.filter(([, { state }]) => state.phase === 'ci' && !state.worker && !state.blocked && !state.cleanup && state.prObservation?.status === 'passed');
  const blocked = ci.filter(([, { state }]) => state.prObservation.blocking === true);
  const clear = ci.filter(([, { state }]) => state.prObservation.blocking === false);
  assert.ok(blocked.length && clear.length, 'the explorer reaches ci with both a blocking and a clear review');
  const ready = ([, node]) => node.edges.some(edge => edge.type === 'pr-ready' && states.get(edge.to).state.phase === 'merge');
  assert.deepEqual(blocked.filter(ready).map(([, node]) => story(node)), [], 'pr-ready was accepted while the review blocks it');
  assert.ok(clear.some(ready), 'pr-ready is never accepted once the review is clear');
});
