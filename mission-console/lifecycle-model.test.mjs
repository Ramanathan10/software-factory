import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { canReach, eventInputs, explore, follow, guarded, jarvisEvents, jarvisInputs, jarvisTable, unguarded } from './lifecycle-model.mjs';
import { phases } from './roles.mjs';
import { workerPhases } from './store.mjs';

const states = explore();
const live = [...states].filter(([, node]) => !node.state.deleted);
const story = node => node.path.join(' → ') || 'create';
const edgeTo = (id, type) => states.get(id).edges.find(edge => edge.type === type)?.to;

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

test('the merge of a registered pull request from ci, merge or pr-review holds the story in retro unless the retro finished, and the retro handoff then closes it', () => {
  const inShip = live.filter(([, { state }]) => state.pr && ['ci', 'merge', 'pr-review'].includes(state.phase) && !state.cleanup);
  assert.ok(inShip.some(([, { state }]) => !state.retro?.completed), 'the explorer reaches ci, merge or pr-review with no finished retro');
  const wrong = [];
  for (const [id, { state }] of inShip) {
    const release = state.worker ? ['release-worker'] : [];
    const result = follow(states, id, [...release, 'merged']);
    if (state.retro?.completed) {
      if (result?.phase !== 'closed') wrong.push('merged did not close after ' + story(states.get(id)));
    } else if (result?.phase !== 'retro' || !result.retro?.merged || result.worker || result.blocked) wrong.push('merged did not hold the story in retro after ' + story(states.get(id)));
    else if (follow(states, id, [...release, 'merged', 'handoff'])?.phase !== 'closed') wrong.push('the retro handoff did not close the story after ' + story(states.get(id)));
  }
  assert.deepEqual(wrong, [], 'these merges closed or held the story the wrong way');
});

const merging = live.filter(([, { state }]) => state.pr && state.phase !== 'closed' && !state.cleanup);
const closesDirectly = state => state.retro?.completed;

test('merged during other work closes a story whose retro finished and otherwise holds it in retro until the retro handoff closes it', () => {
  const midWork = merging.filter(([, { state }]) => state.phase !== 'retro' && !closesDirectly(state));
  assert.ok(midWork.some(([, { state }]) => state.phase === 'diagram') && midWork.some(([, { state }]) => state.phase === 'building'), 'the explorer reaches diagram and building with a registered PR');
  assert.ok(merging.some(([, { state }]) => !['ci', 'merge', 'pr-review', 'retro'].includes(state.phase) && state.retro?.completed), 'the explorer reaches open work after a finished retro');
  const wrong = [];
  for (const [id, { state }] of merging.filter(([, { state }]) => state.phase !== 'retro')) {
    const release = state.worker ? ['release-worker'] : [];
    const held = follow(states, id, [...release, 'merged']);
    if (!held) wrong.push('merged was refused after ' + story(states.get(id)));
    else if (closesDirectly(state) ? held.phase !== 'closed' : held.phase !== 'retro' || !held.retro?.merged || held.worker || held.blocked) wrong.push('merged did not close or hold the story after ' + story(states.get(id)));
    else if (!closesDirectly(state) && follow(states, id, [...release, 'merged', 'handoff'])?.phase !== 'closed') wrong.push('the retro handoff did not close the merged story after ' + story(states.get(id)));
  }
  assert.deepEqual(wrong, []);
});

test('an observation of the registered PR is accepted in every open phase, and outside ci, merge and pr-review only a merged or closed one changes the story', () => {
  const watching = ['ci', 'merge', 'pr-review'];
  const outside = merging.filter(([, { state }]) => !watching.includes(state.phase));
  assert.ok(outside.length, 'the explorer reaches open phases outside ci, merge and pr-review with a registered PR');
  const wrong = [];
  for (const [id, node] of merging) {
    const seen = status => node.edges.filter(edge => edge.type === 'pr-observed' && edge.input.observation.status === status);
    if (!seen('merged').length) wrong.push('a merge was not observable after ' + story(node));
    if (watching.includes(node.state.phase)) continue;
    for (const edge of [...seen('passed'), ...seen('failed')]) if (edge.to !== id) wrong.push(edge.input.observation.status + ' changed the story after ' + story(node));
    for (const edge of seen('merged')) if (states.get(edge.to).state.prObservation?.status !== 'merged') wrong.push('a merge was not stored after ' + story(node));
  }
  assert.deepEqual(wrong, []);
});

test('from retro, merged then the retro handoff closes the story, and a merged retro takes neither a second merge nor a replan', () => {
  const after = (id, type) => states.get(id).edges.find(edge => edge.type === type)?.to;
  const retros = live.filter(([, { state }]) => state.phase === 'retro' && state.pr && !state.cleanup && !state.blocked);
  assert.ok(retros.some(([, { state }]) => state.worker) && retros.some(([, { state }]) => !state.worker), 'the explorer reaches retro with and without a worker');
  const wrong = [];
  for (const [id, { state }] of retros) {
    const merged = state.retro?.merged;
    if (merged) {
      for (const type of ['merged', 'replan']) if (after(id, type)) wrong.push(type + ' was accepted on a merged retro after ' + story(states.get(id)));
    } else {
      const held = after(id, 'merged');
      const heldState = held && states.get(held).state;
      if (heldState?.phase !== 'retro' || !heldState.retro?.merged) wrong.push('merged did not hold the retro after ' + story(states.get(id)));
      else if (Boolean(heldState.worker) !== Boolean(state.worker)) wrong.push('merged changed the retro worker after ' + story(states.get(id)));
    }
    if (merged || after(id, 'merged')) {
      const held = merged ? id : after(id, 'merged');
      const idle = states.get(held).state.worker ? after(held, 'release-worker') : held;
      const closed = idle && after(idle, 'handoff');
      if (!closed || states.get(closed).state.phase !== 'closed') wrong.push('the retro handoff did not close the story after ' + story(states.get(id)) + ' then merged');
    }
  }
  assert.deepEqual(wrong, []);
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

test('the Jarvis phase table sends a publishing story back to build, and the store accepts it', () => {
  const table = jarvisTable(readFileSync(new URL('../skills/jarvis/SKILL.md', import.meta.url), 'utf8'));
  const row = table.find(item => item.phases.includes('publishing') && item.phases.includes('ci'));
  assert.ok(row, 'no Jarvis phase table row covers publishing and ci');
  for (const type of ['return-to-build', 'question', 'blocked', 'pr-opened']) assert.ok(row.events.includes(type), 'the publishing row does not name ' + type);
  assert.ok(live.some(([, node]) => node.state.phase === 'publishing' && node.edges.some(edge => edge.type === 'return-to-build')), 'the store refuses return-to-build in publishing');
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
  const refused = reviewing.filter(([, { state }]) => !state.cleanup).filter(([id, { state }]) => {
    const release = state.worker ? ['release-worker'] : [];
    const merged = follow(states, id, [...release, 'merged']);
    return state.retro?.completed ? merged?.phase !== 'closed' : merged?.phase !== 'retro' || follow(states, id, [...release, 'merged', 'handoff'])?.phase !== 'closed';
  });
  assert.deepEqual(refused.map(([, node]) => story(node)), [], 'a merge in pr-review did not hold the story in retro, or close it after a finished retro, after these events');
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

test('readiness with a head needs a passed observation of that head, and without one only works before any observation', () => {
  const ci = live.filter(([, { state }]) => state.phase === 'ci' && !state.worker && !state.blocked && !state.cleanup);
  const accepted = (node, headed) => node.edges.filter(edge => edge.type === 'pr-ready' && Boolean(edge.input.head) === headed && states.get(edge.to).state.phase === 'merge');
  const wrong = ci.flatMap(([, node]) => accepted(node, true).filter(edge => {
    const seen = node.state.prObservation;
    return !(seen && seen.status === 'passed' && seen.head === edge.input.head);
  }).map(() => story(node)));
  assert.deepEqual(wrong, [], 'pr-ready with a head was accepted without a passed observation of that head');
  assert.ok(ci.some(([, node]) => node.state.prObservation?.status === 'passed' && node.state.prObservation.blocking === false && accepted(node, true).length),
    'pr-ready is never accepted from a ci state with a passed, clear observation');
  const headless = ci.filter(([, node]) => accepted(node, false).length && node.state.prObservation);
  assert.deepEqual(headless.map(([, node]) => story(node)), [], 'pr-ready without a head was accepted after an observation');
});

test('diagram work starts only from publishing, ci or merge and always returns to the phase it started from', () => {
  const open = ['publishing', 'ci', 'merge'];
  const started = live.flatMap(([, node]) => node.edges.filter(edge => edge.type === 'diagram-start').map(edge => ({ node, next: states.get(edge.to).state })));
  assert.ok(started.length, 'no event starts diagram work');
  const wrong = started.filter(({ node, next }) => !open.includes(node.state.phase) || next.phase !== 'diagram' || next.diagram?.returnPhase !== node.state.phase)
    .map(({ node }) => node.state.phase + ' diagram-start after ' + story(node));
  assert.deepEqual(wrong, [], 'diagram-start was accepted outside publishing, ci and merge, or stored another return phase');
  const early = live.filter(([, { state }]) => ['review', 'comparison'].includes(state.phase));
  assert.ok(early.some(([, { state }]) => state.phase === 'review') && early.some(([, { state }]) => state.phase === 'comparison'), 'the explorer reaches review and comparison');
  assert.deepEqual(early.filter(([, node]) => node.edges.some(edge => edge.type === 'diagram-start')).map(([, node]) => story(node)), [], 'diagram-start was accepted in review or comparison after these events');
  const returns = live.filter(([, { state }]) => state.phase === 'diagram').flatMap(([, node]) => node.edges.filter(edge => edge.type === 'handoff').map(edge => ({ node, next: states.get(edge.to).state })));
  assert.ok(returns.length, 'no handoff leaves diagram');
  assert.deepEqual(returns.filter(({ node, next }) => next.phase !== node.state.diagram.returnPhase).map(({ node }) => story(node)), [], 'a diagram handoff landed on a phase other than its return phase');
  const entered = new Set(started.map(({ node }) => node.state.phase));
  assert.deepEqual(open.filter(phase => !entered.has(phase)), [], 'diagram-start is never accepted in these phases');
  const back = new Set(returns.map(({ next }) => next.phase));
  assert.deepEqual([...back].sort(), [...open].sort(), 'a diagram handoff returns to each of publishing, ci and merge');
});

test('the explorer observes every status the store accepts for a pull request', () => {
  const statuses = eventInputs('evidence').filter(([type, input]) => type === 'pr-observed' && !input.observation.review).map(([, input]) => input.observation.status);
  assert.deepEqual([...new Set(statuses)].sort(), ['closed', 'failed', 'merged', 'no-checks', 'passed', 'running'], 'pr-observed inputs miss a status observePr accepts');
});

const publishing = live.filter(([, { state }]) => state.phase === 'publishing');
const staffed = publishing.filter(([, { state }]) => state.worker && !state.blocked && !state.cleanup);
const bare = publishing.filter(([, { state }]) => !state.worker && !state.blocked && !state.cleanup);

test('a worker can be assigned in publishing, and return-to-build leaves publishing for building only', () => {
  assert.ok(bare.some(([id]) => edgeTo(id, 'assign-worker')), 'assign-worker is never accepted in publishing');
  const back = publishing.filter(([id]) => edgeTo(id, 'return-to-build'));
  assert.ok(back.length, 'return-to-build is never accepted in publishing');
  const wrong = back.filter(([id]) => states.get(edgeTo(id, 'return-to-build')).state.phase !== 'building');
  assert.deepEqual(wrong.map(([, node]) => story(node)), [], 'return-to-build from publishing landed outside building');
  const refused = live.filter(([id, { state }]) => ['ci', 'merge'].includes(state.phase) && edgeTo(id, 'return-to-build'));
  assert.deepEqual(refused.map(([, node]) => story(node)), [], 'return-to-build was accepted in ci or merge');
});

test('pr-opened is refused while a publisher is assigned and accepted once it is released', () => {
  assert.ok(staffed.length, 'no reachable story has a worker in publishing');
  assert.deepEqual(staffed.filter(([id]) => edgeTo(id, 'pr-opened')).map(([, node]) => story(node)), [], 'pr-opened was accepted with a publisher assigned');
  assert.ok(bare.some(([id]) => states.get(edgeTo(id, 'pr-opened') ?? id).state.phase === 'ci'), 'pr-opened is never accepted in publishing once the worker is released');
});

test('a publisher can release and start diagram work, and the diagram handoff returns to publishing where a worker is assigned again', () => {
  assert.ok(staffed.length, 'no reachable story has a worker in publishing');
  const path = (id, types) => types.reduce((at, type) => at && edgeTo(at, type), id);
  const drawing = staffed.map(([id]) => path(id, ['release-worker', 'diagram-start'])).filter(Boolean);
  assert.ok(drawing.length, 'a publisher cannot release and then start diagram work');
  assert.deepEqual(drawing.filter(id => states.get(id).state.phase !== 'diagram' || states.get(id).state.diagram?.returnPhase !== 'publishing'), [], 'diagram work from publishing did not store publishing as its return phase');
  const returned = drawing.map(id => edgeTo(id, 'handoff')).filter(Boolean);
  assert.ok(returned.length, 'the diagram handoff is never accepted');
  assert.deepEqual(returned.filter(id => states.get(id).state.phase !== 'publishing'), [], 'a diagram handoff from publishing landed elsewhere');
  assert.ok(returned.some(id => edgeTo(id, 'assign-worker')), 'assign-worker is refused in publishing after the diagram returns');
});

const MODEL_PR = 'https://github.com/acme/widgets/pull/1';
const spellings = eventInputs('evidence.png').filter(([type, input]) => type === 'pr-opened' && input.url !== MODEL_PR).map(([, input]) => input.url);

test('the explorer records the pull request in a suffixed spelling and again in another spelling', () => {
  assert.ok(spellings.some(url => url.startsWith(MODEL_PR + '/')), 'no pr-opened input carries a path suffix after ' + MODEL_PR);
  assert.ok(spellings.some(url => !url.startsWith(MODEL_PR + '/') && url.split('#')[0].toLowerCase() === MODEL_PR.toLowerCase()),
    'no pr-opened input spells the pull request another way (case or fragment)');
});

test('a registered pull request is re-recorded in each spelling, accepted, and stays in its first spelling', () => {
  assert.ok(spellings.length, 'the explorer has no pr-opened input in another spelling');
  const registered = publishing.filter(([, { state }]) => state.pr && !state.worker && !state.blocked && !state.cleanup);
  assert.ok(registered.length, 'no reachable story is back in publishing with a registered pull request');
  const refused = [];
  for (const [id, node] of registered) {
    for (const url of spellings) {
      const edge = node.edges.find(candidate => candidate.type === 'pr-opened' && candidate.input.url === url);
      if (!edge || states.get(edge.to).state.phase !== 'ci' || states.get(edge.to).state.pr !== MODEL_PR) refused.push(story(node) + ' with ' + url);
    }
  }
  assert.deepEqual(refused, [], 'pr-opened refused or rewrote the stored pull request for the same pull request');
  assert.deepEqual(live.filter(([, { state }]) => state.pr && state.pr !== MODEL_PR).map(([, node]) => story(node)), [], 'a story holds a pull request that is not the canonical one');
});
