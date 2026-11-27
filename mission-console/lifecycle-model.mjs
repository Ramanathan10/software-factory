import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore } from './store.mjs';

const ID = 's';
const WORKER = 'W';
const PR = 'https://github.com/acme/widgets/pull/1';
const HEADS = ['a'.repeat(40), 'b'.repeat(40)];

export const guarded = ['phase', 'harness', 'branch', 'questions', 'worker', 'blocked', 'cleanup', 'pr', 'prObservation', 'readyHead', 'diagram', 'retro', 'prReview', 'jarvis', 'deleted'];
export const unguarded = ['id', 'title', 'brief', 'worktree', 'revision', 'createdAt', 'updatedAt', 'activity', 'draftPlan', 'plan',
  'feedback', 'reviewRounds', 'comparisonRequested', 'files', 'artifacts', 'pipeline', 'repo', 'prPosted', 'prSeen'];

const blocking = review => review.changesRequested.length > 0 || review.unresolved > 0;

function review(blocked) {
  return { approvals: [], changesRequested: blocked ? ['reviewer-a'] : [], unresolved: blocked ? 1 : 0, earlier: blocked ? 0 : 1,
    items: [], keys: blocked ? ['PRRT_1:PRRC_1'] : [], more: false, lastActivityAt: '2026-01-01T00:00:00.000Z' };
}

export function abstract(story) {
  if (story.deleted) return { deleted: true };
  const state = { phase: story.phase, harness: story.harness, branch: story.branch,
    questions: story.questions.map(question => ({ id: question.id, ...(question.answer ? { answer: question.answer } : {}) })) };
  if (story.worker) state.worker = { id: WORKER, ...(story.worker.turn ? { turn: { pid: story.worker.turn.pid } } : {}) };
  if (story.blocked) state.blocked = true;
  if (story.cleanup) state.cleanup = true;
  if (story.pr) state.pr = story.pr;
  if (story.prObservation) state.prObservation = { head: story.prObservation.head, status: story.prObservation.status,
    ...(story.prObservation.review ? { blocking: blocking(story.prObservation.review) } : {}) };
  if (story.readyHead) state.readyHead = story.readyHead;
  if (story.diagram) state.diagram = { returnPhase: story.diagram.returnPhase };
  if (story.retro) state.retro = { ...(story.retro.returnPhase ? { returnPhase: story.retro.returnPhase } : {}), ...(story.retro.completedAt ? { completed: true } : {}), ...(story.retro.mergedAt ? { merged: true } : {}) };
  if (story.prReview) state.prReview = { returnPhase: story.prReview.returnPhase };
  if (story.jarvis?.turn) state.jarvis = { turn: { pid: story.jarvis.turn.pid } };
  else if (story.jarvis?.waking) state.jarvis = { waking: true };
  return state;
}

function concrete(state) {
  if (state.deleted) return { id: ID, deleted: true };
  const story = { id: ID, title: 'Story', brief: 'Brief.', worktree: '/worktrees/story', revision: 1, files: [], ...state,
    questions: state.questions.map(question => ({ ...question, prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 })) };
  if (state.worker) story.worker = { ...state.worker, role: 'scout', session: 'session-1', ...(state.worker.turn ? { turn: { ...state.worker.turn, log: 'turn.log' } } : {}) };
  if (state.blocked) story.blocked = 'Blocked.';
  if (state.cleanup) story.cleanup = {};
  if (state.retro) story.retro = { ...(state.retro.returnPhase ? { returnPhase: state.retro.returnPhase } : {}), startedAt: 'then', detail: 'Retro.', ...(state.retro.completed ? { completedAt: 'then' } : {}), ...(state.retro.merged ? { mergedAt: '2026-01-01T00:00:00.000Z' } : {}) };
  if (state.jarvis) story.jarvis = { session: 'jarvis-1', handled: 1, ...(state.jarvis.turn ? { turn: { ...state.jarvis.turn, log: 'jarvis.log' } } : { waking: 'now' }) };
  if (state.prObservation) {
    const { blocking: blocked, ...observed } = state.prObservation;
    story.prObservation = { ...observed, failedCount: observed.status === 'failed' ? 1 : 0,
      failures: observed.status === 'failed' ? ['test'] : [], ...(blocked === undefined ? {} : { review: review(blocked) }) };
  }
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
    ['pr-review-start', detail],
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
    ...HEADS.flatMap(head => ['failed', 'passed', 'merged', 'running', 'no-checks', 'closed'].map(status => ['pr-observed', {
      url: PR, observation: { head, status, failedCount: status === 'failed' ? 1 : 0, failures: status === 'failed' ? ['test'] : [] },
    }])),
    ...HEADS.flatMap(head => [true, false].map(blocked => ['pr-observed', {
      url: PR, observation: { head, status: 'passed', failedCount: 0, failures: [], review: review(blocked) },
    }])),
    ['request-cleanup', {}],
    ['cleanup-blocked', detail],
    ['complete-cleanup', detail],
  ];
}

export const jarvisEvents = ['jarvis-woken', 'jarvis-turn-started', 'jarvis-turn-ended'];

export function jarvisInputs(evidence) {
  const around = new Set(['question', 'answer', 'assign-worker', 'release-worker', 'turn-started', 'turn-ended', 'blocked', 'resume', 'request-cleanup', 'cleanup-blocked', 'complete-cleanup']);
  return [
    ...eventInputs(evidence).filter(([type]) => around.has(type)),
    ['question', { question: 'action-jarvis-1', prompt: 'Action for you: Jarvis could not run.', options: ['Done', 'Hold'], recommended: 0 }],
    ['answer', { question: 'action-jarvis-1', answer: 1 }],
    ['jarvis-woken', { handled: 1 }],
    ['jarvis-turn-started', { session: 'jarvis-1', pid: 4343, log: 'jarvis.log' }],
    ['jarvis-turn-ended', { outcome: 'failed', code: 1, detail: 'Evidence.' }],
  ];
}

export function explore({ open = openStore, limit = 200000, inputs: choose = eventInputs } = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'lifecycle-model-'));
  const evidence = join(folder, 'after.png');
  writeFileSync(evidence, 'png');
  const path = 'file:lifecycle-' + process.pid + '-' + Date.now() + '?mode=memory&cache=shared';
  const raw = new DatabaseSync(path);
  const store = open(path);
  const put = raw.prepare('INSERT INTO stories VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET state = excluded.state');
  const get = raw.prepare('SELECT state FROM stories WHERE id = ?');
  const inputs = choose(evidence);
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
