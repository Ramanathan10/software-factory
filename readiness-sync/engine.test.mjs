import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { evaluate, onEvent } from './engine.mjs';

const profile = JSON.parse(readFileSync(new URL('./profiles/example-team.json', import.meta.url)));
const base = () => ({
  user: 'the owner',
  story: { id: 1, assignee: 'the owner', effort: 3 },
  tasks: [{ id: 10, title: 'PR', state: 'Closed' }],
  prs: [{ id: 5, status: 'completed', target: 'main', linked: true, reviewers: [] }],
  testsPass: true
});

test('merged PR with all checks asks only for handoff confirmation', () => {
  const r = evaluate(base(), profile);
  assert.deepEqual(r.actions, []);
  assert.equal(r.questions.length, 1);
  assert.equal(r.questions[0].rule, 'doneDone');
});

test('unestimated effort (-1) asks for effort instead of handoff', () => {
  const s = base(); s.story.effort = -1;
  assert.equal(evaluate(s, profile).questions[0].rule, 'effort');
});

test('story owned by someone else is untouched', () => {
  const s = base(); s.story.assignee = 'Other';
  const r = evaluate(s, profile);
  assert.deepEqual([r.actions, r.questions], [[], []]);
});

test('active PR creates PR task and review task for a reviewer who voted; no handoff question', () => {
  const s = base();
  s.tasks = [];
  s.prs = [{ id: 5, status: 'active', target: 'main', linked: true, reviewers: [{ name: 'Sam', vote: -5 }, { name: 'Group', isGroup: true, vote: 10 }, { name: 'Pat', vote: 0 }] }];
  const r = evaluate(s, profile);
  assert.deepEqual(r.actions.map(a => [a.rule, a.assignee, a.state]), [['prTask', 'the owner', 'Active'], ['reviewTask', 'Sam', 'Active']]);
  assert.equal(r.questions.length, 0);
});

test('approval closes review task; reset vote on active PR reopens it; completion alone is not approval', () => {
  const s = base();
  s.tasks = [{ id: 10, title: 'PR', state: 'Active' }, { id: 11, title: 'PR Review', assignee: 'Sam', state: 'Active' }, { id: 12, title: 'PR Review', assignee: 'Lee', state: 'Closed' }];
  s.prs = [{ id: 5, status: 'active', target: 'main', linked: true, reviewers: [{ name: 'Sam', vote: 10 }, { name: 'Lee', vote: 0, commented: true }] }];
  assert.deepEqual(evaluate(s, profile).actions.map(a => [a.task, a.state]), [[11, 'Closed'], [12, 'Active']]);
  s.prs[0].status = 'completed';
  s.prs[0].reviewers = [{ name: 'Sam', vote: 0 }];
  assert.deepEqual(evaluate(s, profile).actions.map(a => [a.task, a.state]), [[10, 'Closed']]);
});

test('PR with several candidate work items is never linked', () => {
  const s = base();
  s.prs = [{ id: 5, status: 'active', target: 'main', linked: false, candidateIds: [1, 2] }];
  const r = evaluate(s, profile);
  assert.deepEqual(r.actions, []);
  assert.equal(r.questions[0].rule, 'prLink');
});

test('events fetch exactly one story; irrelevant events cost no read', async () => {
  const calls = [];
  const fetch = async id => { calls.push(id); return base(); };
  assert.deepEqual(await onEvent({ source: 'console', story: 'PCS-1', phase: 'plan' }, profile, fetch), { ignored: true });
  assert.deepEqual(await onEvent({ source: 'ado', type: 'workitem.updated', workItemIds: [1, 2] }, profile, fetch), { ignored: true });
  const r = await onEvent({ source: 'ado', type: 'git.pullrequest.merged', workItemIds: [1] }, profile, fetch);
  const c = await onEvent({ source: 'console', story: 'PCS-1', phase: 'merge' }, profile, fetch);
  assert.deepEqual(calls, [1, 1]);
  assert.equal(r.mode, 'observe');
  assert.equal(c.questions[0].rule, 'doneDone');
});

test('engine never emits a delete action', () => {
  const s = base(); s.tasks = []; s.prs[0].status = 'active';
  assert.ok(evaluate(s, profile).actions.every(a => ['createTask', 'setState', 'linkPr'].includes(a.op)));
});
