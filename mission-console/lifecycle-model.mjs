import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.mjs';

const ID = 's';
const WORKER = 'W';
const PR = 'https://github.com/acme/widgets/pull/1';
const HEADS = ['a'.repeat(40), 'b'.repeat(40)];

export const guarded = ['phase', 'harness', 'branch', 'questions', 'worker', 'blocked', 'cleanup', 'pr', 'prObservation', 'readyHead', 'diagram', 'retro', 'deleted'];
export const unguarded = ['id', 'title', 'brief', 'worktree', 'revision', 'createdAt', 'updatedAt', 'activity', 'draftPlan', 'plan',
  'feedback', 'reviewRounds', 'comparisonRequested', 'files', 'artifacts', 'pipeline', 'repo'];

export function abstract(story) {
  if (story.deleted) return { deleted: true };
  const state = { phase: story.phase, harness: story.harness, branch: story.branch,
    questions: story.questions.map(question => ({ id: question.id, ...(question.answer ? { answer: question.answer } : {}) })) };
  if (story.worker) state.worker = { id: WORKER, ...(story.worker.turn ? { turn: { pid: story.worker.turn.pid } } : {}) };
  if (story.blocked) state.blocked = true;
  if (story.cleanup) state.cleanup = true;
  if (story.pr) state.pr = story.pr;
  if (story.prObservation) state.prObservation = { head: story.prObservation.head, status: story.prObservation.status };
  if (story.readyHead) state.readyHead = story.readyHead;
  if (story.diagram) state.diagram = { returnPhase: story.diagram.returnPhase };
  if (story.retro) state.retro = { returnPhase: story.retro.returnPhase };
  return state;
}

function concrete(state) {
  if (state.deleted) return { id: ID, deleted: true };
  const story = { id: ID, title: 'Story', brief: 'Brief.', worktree: '/worktrees/story', revision: 1, files: [], ...state,
    questions: state.questions.map(question => ({ ...question, prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 })) };
  if (state.worker) story.worker = { ...state.worker, role: 'scout', session: 'session-1', ...(state.worker.turn ? { turn: { ...state.worker.turn, log: 'turn.log' } } : {}) };
  if (state.blocked) story.blocked = 'Blocked.';
  if (state.cleanup) story.cleanup = {};
  if (state.prObservation) story.prObservation = { ...state.prObservation, failedCount: state.prObservation.status === 'failed' ? 1 : 0,
    failures: state.prObservation.status === 'failed' ? ['test'] : [] };
  return story;
}

export function eventInputs(evidence) {
  const detail = { detail: 'Evidence.' };
  const worker = { assignment: WORKER };
  return [
    ['select-harness', { harness: 'Codex' }],
    ['question', { question: 'q1', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 }],
    ['answer', { question: 'q1', answer: 0 }],
    ['draft-plan', { ...worker, detail: 'Draft.' }],
    ['plan', { detail: 'Plan.' }],
    ['approve', {}],
    ['plan-feedback', { note: 'Change it.' }],
    ['activity', { ...worker, ...detail }],
    ['activity', detail],
    ['artifact', { ...worker, kind: 'after', path: evidence, ...detail }],
    ['assign-worker', { session: 'session-1' }],
    ['release-worker', { ...worker, ...detail }],
    ['turn-started', { ...worker, pid: 4242, log: 'turn.log' }],
    ['turn-ended', { ...worker, outcome: 'ended', ...detail }],
    ['handoff', { ...detail, command: 'node --test' }],
    ['diagram-start', detail],
    ['retro-start', detail],
    ['return-to-build', detail],
    ['return-to-testing', detail],
    ['replan', detail],
    ['assign-worktree', { branch: 'story', worktree: '/worktrees/story' }],
    ['blocked', detail],
    ['resume', detail],
    ['comparison-choice', { run: true }],
    ['comparison-choice', { run: false }],
    ['pr-opened', { url: PR }],
    ['pr-ready', detail],
    ...HEADS.map(head => ['pr-ready', { ...detail, head }]),
    ['pr-recheck', detail],
    ['merged', detail],
    ...HEADS.flatMap(head => ['failed', 'passed', 'merged'].map(status => ['pr-observed', {
      url: PR, observation: { head, status, failedCount: status === 'failed' ? 1 : 0, failures: status === 'failed' ? ['test'] : [] },
    }])),
    ['request-cleanup', {}],
    ['cleanup-blocked', detail],
    ['complete-cleanup', detail],
  ];
}

export function explore({ open = openStore, limit = 200000 } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'lifecycle-model-'));
  const evidence = join(folder, 'after.png');
  writeFileSync(evidence, 'png');
  const path = 'file:lifecycle-' + process.pid + '-' + Date.now() + '?mode=memory&cache=shared';
  const raw = new DatabaseSync(path);
  const store = open(path);
  const put = raw.prepare('INSERT INTO stories VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state');
  const get = raw.prepare('SELECT state FROM stories WHERE id = ?');
  const inputs = eventInputs(evidence);
  let key = 0;
  try {
    store.record({ story: ID, key: 'k' + key++, type: 'create', title: 'Story', detail: 'Brief.', branch: 'story', worktree: '/worktrees/story', harness: 'Codex' });
    const first = abstract(JSON.parse(get.get(ID).state));
    const states = new Map([[JSON.stringify(first), { state: first, path: [], edges: [] }]]);
    const queue = [JSON.stringify(first)];
    while (queue.length) {
      const id = queue.shift();
      const node = states.get(id);
      if (node.state.deleted) continue;
      for (const [type, input] of inputs) {
        put.run(ID, JSON.stringify(concrete(node.state)));
        try {
          store.record({ ...input, story: ID, type, key: 'k' + key++, revision: 1 });
        } catch (error) {
          if (!error.status) throw error;
          continue;
        }
        const next = abstract(JSON.parse(get.get(ID).state));
        const nextId = JSON.stringify(next);
        node.edges.push({ type, input, to: nextId });
        if (!states.has(nextId)) {
          if (states.size >= limit) throw new Error('More than ' + limit + ' story states: the abstraction no longer bounds the store.');
          states.set(nextId, { state: next, path: [...node.path, type], edges: [] });
          queue.push(nextId);
        }
      }
    }
    return states;
  } finally {
    raw.close();
    store.close();
    rmSync(folder, { recursive: true, force: true });
  }
}

export function canReach(states, goal) {
  const into = new Map([...states.keys()].map(id => [id, []]));
  for (const [id, node] of states) for (const edge of node.edges) into.get(edge.to).push(id);
  const reached = new Set([...states].filter(([, node]) => goal(node.state)).map(([id]) => id));
  const queue = [...reached];
  while (queue.length) for (const from of into.get(queue.shift())) if (!reached.has(from)) { reached.add(from); queue.push(from); }
  return reached;
}

export function follow(states, id, types) {
  for (const type of types) {
    const edge = states.get(id).edges.find(item => item.type === type);
    if (!edge) return null;
    id = edge.to;
  }
  return states.get(id).state;
}

export function jarvisTable(markdown) {
  const rows = markdown.split('\n').filter(line => /^\| \d+\. /.test(line));
  const names = text => [...text.matchAll(/`([a-z-]+)`/g)].map(match => match[1]);
  return rows.map(line => {
    const [, row, phases, record] = line.split('|').map(cell => cell.trim());
    return { row, phases: names(phases), events: names(record) };
  });
}
