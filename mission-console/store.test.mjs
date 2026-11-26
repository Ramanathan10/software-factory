import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { seed, serve } from './jarvis.mjs';
import { openStore } from './store.mjs';
import { githubPr, summarizePr, waitForAny, waitForWake, watchOnce } from './watcher.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-console-'));
  const path = join(directory, 'stories.db');
  const stores = [];
  t.after(() => {
    stores.forEach(store => store.close());
    rmSync(directory, { recursive: true, force: true });
  });
  const open = () => {
    const store = openStore(path);
    stores.push(store);
    return store;
  };
  return open;
}

function start(store, story, harness = 'Codex') {
  const created = store.record({
    story, key: story + '-start', type: 'create', title: 'Implement ' + story,
    detail: 'Use an isolated branch.', branch: story, worktree: '/worktrees/' + story, harness,
  });
  store.record({ story, key: story + '-scout', type: 'handoff', revision: created.revision, detail: 'Context pack ready.' });
  return created;
}

function writer(store, story) {
  return (type, input = {}) => {
    const { revision } = store.snapshot().find(item => item.id === story);
    return store.record({ story, type, revision, key: story + '-' + revision, ...input });
  };
}

test('the wait across every story ends on the owner\'s decision when the story has no worker to receive it', async t => {
  const store = fixture(t)();
  start(store, 'one');
  const record = writer(store, 'one');
  const ask = { question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 };
  const assigned = record('assign-worker', { session: 'session-one' });
  record('release-worker', { assignment: 'one-' + (assigned.revision - 1), detail: 'Stopped at a blocker.' });
  const question = record('question', ask);
  const answer = record('answer', { question: 'scope', answer: 0 });
  assert.deepEqual((await waitForAny(store, { after: question.seq, seconds: 0 })).map(event => [event.type, event.seq]), [['answer', answer.seq]]);

  record('assign-worker', { session: 'session-two' });
  assert.deepEqual(await waitForAny(store, { after: question.seq, seconds: 0 }), []);
});

test('each time a worker releases before its question, the wait ends on that answer alone', async t => {
  const store = fixture(t)();
  start(store, 'one');
  const record = writer(store, 'one');
  let heard = store.pending().at(-1).seq;
  for (const blocker of ['bash', 'java']) {
    record('assign-worker', { session: 'session-' + blocker });
    assert.deepEqual(await waitForAny(store, { after: heard, seconds: 0 }), [], 'an earlier answer is the replacement\'s to take');
    record('release-worker', { assignment: store.snapshot()[0].worker.id, detail: 'Stopped at the ' + blocker + ' blocker.' });
    const question = record('question', { question: blocker, prompt: 'Repair ' + blocker + '?', options: ['Yes', 'Hold'], recommended: 0 });
    const answer = record('answer', { question: blocker, answer: 0 });
    assert.deepEqual((await waitForAny(store, { after: question.seq, seconds: 0 })).map(event => [event.type, event.seq]), [['answer', answer.seq]]);
    heard = question.seq;
  }
});

test('the wait across every story ends on an approval and a cleanup request, which no worker is assigned to take', async t => {
  const store = fixture(t)();
  start(store, 'one');
  const record = writer(store, 'one');
  const plan = record('plan', { detail: 'Export all eligible rows.' });
  const approval = record('approve');
  const cleanup = record('request-cleanup');
  assert.deepEqual((await waitForAny(store, { after: plan.seq, seconds: 0 })).map(event => [event.type, event.seq]),
    [['approve', approval.seq], ['request-cleanup', cleanup.seq]]);
});

test('a separate wait-any process reports the answer a released worker left behind, and nothing once the story is staffed', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-wait-any-'));
  const file = join(directory, 'stories.db');
  const waitAny = after => JSON.parse(execFileSync(process.execPath,
    [fileURLToPath(new URL('jarvis.mjs', import.meta.url)), 'wait-any', file, String(after), '0'], { encoding: 'utf8' }));
  const store = openStore(file);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  start(store, 'one');
  const record = writer(store, 'one');
  record('assign-worker', { session: 'session-one' });
  record('release-worker', { assignment: store.snapshot()[0].worker.id, detail: 'Stopped at a blocker.' });
  const question = record('question', { question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
  const answer = record('answer', { question: 'scope', answer: 0 });
  assert.deepEqual(waitAny(question.seq).map(event => [event.story, event.type, event.seq]), [['one', 'answer', answer.seq]]);

  record('assign-worker', { session: 'session-two' });
  assert.deepEqual(waitAny(question.seq), []);
});

test('the wait across every story ends on a worker\'s news, not on old events or the owner\'s own decision', async t => {
  const open = fixture(t);
  const store = open();
  start(store, 'one');
  start(store, 'two');
  const ask = { question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 };
  writer(store, 'one')('assign-worker', { session: 'session-one' });
  const question = writer(store, 'one')('question', ask);
  assert.deepEqual(await waitForAny(store, { seconds: 0 }), []);
  assert.deepEqual((await waitForAny(store, { after: question.seq - 1, seconds: 0 })).map(event => event.seq), [question.seq]);

  const waiting = waitForAny(open(), { seconds: 5, pollMs: 20 });
  writer(store, 'one')('answer', { question: 'scope', answer: 0 });
  await new Promise(resolve => setTimeout(resolve, 80));
  const asked = writer(store, 'two')('question', ask);
  const news = await waiting;
  assert.deepEqual(news.map(event => [event.story, event.type, event.seq]), [['two', 'question', asked.seq]]);
});

test('the demo seed follows the store\'s phase transitions', t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  seed(store);
  const [approved, asking] = store.snapshot();
  assert.deepEqual([approved.id, approved.phase, approved.files.length], ['TL-142', 'testing', 1]);
  assert.deepEqual([asking.id, asking.phase, asking.questions.length], ['TL-147', 'planning', 1]);
});

test('plan feedback returns the plan to planning with the owner\'s comments until a revised plan arrives', t => {
  const store = fixture(t)();
  start(store, 'fb');
  const record = writer(store, 'fb');
  const find = () => store.snapshot().find(item => item.id === 'fb');
  record('plan', { detail: '## Scope\n- Browse nested attributes' });
  assert.ok(Date.parse(find().createdAt) <= Date.parse(find().updatedAt));
  assert.throws(() => record('plan-feedback', {}), /comment or a note/);
  record('plan-feedback', { note: 'Tighten scope.', comments: [{ quote: 'Browse nested attributes', comment: 'Also cover write.' }] });
  const story = find();
  assert.equal(story.phase, 'planning');
  assert.equal(story.plan, undefined);
  assert.equal(story.draftPlan.text, '## Scope\n- Browse nested attributes');
  assert.match(story.events[0].detail, /Tighten scope\.[\s\S]*On "Browse nested attributes": Also cover write\./);
  assert.equal(store.pending().at(-1).type, 'plan-feedback');
  record('plan', { detail: '## Scope\n- Browse and write nested attributes' });
  assert.equal(find().feedback, undefined);
  assert.equal(find().phase, 'approval');
});

test('a decision raised after planning waits on the owner without changing the phase', t => {
  const store = fixture(t)();
  start(store, 'mid');
  const record = writer(store, 'mid');
  record('plan', { detail: 'Plan.' });
  record('approve');
  record('activity', { detail: 'Queued the release run.', pipeline: 'https://dev.azure.com/org/project/_build/results?buildId=1' });
  assert.equal(store.snapshot().find(item => item.id === 'mid').pipeline, 'https://dev.azure.com/org/project/_build/results?buildId=1');
  assert.throws(() => record('activity', { detail: 'x', pipeline: 'javascript:alert(1)' }), /https pipeline/);
  record('question', { question: 'pipeline', prompt: 'Queue the release run?', options: ['Yes', 'No'], recommended: 0 });
  assert.equal(store.pending().at(-1).type, 'question');
  record('answer', { question: 'pipeline', answer: 0 });
  const story = store.snapshot().find(item => item.id === 'mid');
  assert.equal(story.phase, 'testing');
  assert.equal(story.questions[0].answer, 'Yes');
});

test('approval, red evidence, and PR transitions hold independently across stories', t => {
  const store = fixture(t)();
  start(store, 'first');
  start(store, 'second');
  const record = writer(store, 'first');
  assert.throws(() => record('approve'), /Expected phase approval/);
  record('question', { question: 'scope', prompt: 'Which rows?', options: ['All', 'One page', 'Selected'], recommended: 0 });
  assert.throws(() => record('plan', { detail: 'Draft' }), /open questions/);
  record('answer', { question: 'scope', answer: 'Rows I selected this week' });
  record('plan', { detail: 'Export selected rows from this week.' });
  record('approve');
  record('activity', { file: 'tests/export.test.ts', change: 'Added', diff: '+ verifyExport();', detail: 'Wrote the contract tests.' });
  record('handoff', { detail: 'Test changes are ready.' });
  assert.throws(() => record('handoff', { detail: 'Red' }), /verification command/);
  record('handoff', { detail: 'Expected CSV response, received unsupported format.', command: 'npm test -- export' });
  record('blocked', { detail: 'Test database unavailable.' });
  assert.throws(() => record('handoff', { detail: 'Green', command: 'npm test' }), /Resume or replan/);
  record('resume', { detail: 'Test database is ready.' });
  record('handoff', { detail: 'Focused and broader tests passed.', command: 'npm test' });
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  record('handoff', { detail: 'No surviving mutants.', command: 'npx stryker run' });
  record('handoff', { detail: 'Independent review completed.' });
  record('comparison-choice', { run: true });
  assert.throws(() => record('pr-opened', { url: 'https://github.com/example/repo/pull/2' }), /Expected phase publishing/);
  record('assign-worker', { session: 'comparison-session' });
  const comparison = store.handover('first').story.worker;
  assert.equal(comparison.role, 'verifier');
  record('release-worker', { assignment: comparison.id, detail: 'The comparison session finished.' });
  record('handoff', { detail: 'The same scenario succeeds after the change. Captured both runs.' });
  record('pr-opened', { url: 'https://github.com/example/repo/pull/2' });
  record('pr-ready', { detail: 'Checks and review passed for head xyz.' });
  record('pr-recheck', { detail: 'GitHub reports a new head.' });
  assert.equal(store.snapshot()[0].phase, 'ci');
  record('pr-ready', { detail: 'Checks and review passed for head abc.' });
  record('merged', { detail: 'GitHub reports that head abc was merged.' });
  const [first, second] = store.snapshot();
  assert.equal(first.phase, 'closed');
  assert.equal(first.activity, undefined);
  assert.equal(first.files[0].path, 'tests/export.test.ts');
  assert.equal(first.questions[0].answer, 'Rows I selected this week');
  assert.equal(second.phase, 'planning');
});

test('a PR-stage scope decision can replan, recover the worktree, and reuse the PR', t => {
  const store = fixture(t)();
  start(store, 'story');
  const record = writer(store, 'story');
  const url = 'https://github.com/example/repo/pull/3';
  const toPublishing = () => {
    record('plan', { detail: 'Cap’s proposed plan.' });
    record('approve');
    record('handoff', { detail: 'Tests ready.' });
    record('handoff', { detail: 'Expected failure observed.', command: 'npm test' });
    record('handoff', { detail: 'Relevant checks passed.', command: 'npm test' });
    record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
    record('handoff', { detail: 'No surviving mutants.', command: 'npx stryker run' });
    record('handoff', { detail: 'Review complete.' });
    record('comparison-choice', { run: false });
  };
  toPublishing();
  record('pr-opened', { url });
  record('replan', { detail: 'PR review raised a scope decision.' });
  assert.throws(() => record('assign-worktree', { branch: 'other', worktree: '/tmp/recovered' }), /existing PR branch/);
  record('assign-worktree', { branch: 'story', worktree: '/tmp/recovered' });
  assert.equal(store.snapshot()[0].worktree, '/tmp/recovered');
  toPublishing();
  assert.throws(() => record('pr-opened', { url: url + '0' }), /existing pull request/);
  record('pr-opened', { url });
  record('merged', { detail: 'External merge observed before the next check poll.' });
  const [story] = store.snapshot();
  assert.equal(story.pr, url);
  assert.equal(story.phase, 'closed');
});

test('a second connection can recover and acknowledge wakes without deleting evidence', t => {
  const open = fixture(t);
  const a = open();
  start(a, 'story');
  const b = open();
  const event = { story: 'story', key: 'send-plan', revision: 2, type: 'plan', detail: 'Use the approved contract.' };
  const first = a.record(event);
  assert.deepEqual(b.record(event), { seq: first.seq, replayed: true });
  assert.throws(() => b.record({ ...event, detail: 'Different plan' }), /different request/);
  assert.throws(() => b.record({ ...event, key: 'stale', type: 'approve' }), /Read the latest/);
  assert.equal(b.pending().at(-1).seq, first.seq);
  assert.equal(b.ack(first.seq).acknowledged, true);
  const c = open();
  assert.equal(c.snapshot()[0].phase, 'approval');
  assert.equal(c.pending().some(wake => wake.seq === first.seq), false);
  assert.equal(c.ack(first.seq).acknowledged, false);
  assert.equal(c.snapshot()[0].events[0].seq, first.seq);
});

test('separate CLI processes resume one story in its pinned harness', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-handover-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'stories.db');
  const cli = fileURLToPath(new URL('jarvis.mjs', import.meta.url));
  const run = (command, argument = [], input) => JSON.parse(execFileSync(
    process.execPath, [cli, command, file, ...argument],
    { input: JSON.stringify(input), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ));
  const store = openStore(file);
  try {
    start(store, 'portable', 'Claude Code');
    start(store, 'other', 'Cursor');
  } finally {
    store.close();
  }
  const record = (type, revision, details) =>
    run('record', [], { story: 'portable', key: 'handover-' + revision, type, revision, ...details });
  assert.throws(() => record('assign-worker', 2, { host: 'Cursor', session: 'worker-1' }), /harness selected/);
  record('assign-worker', 2, { session: 'worker-1' });
  record('question', 3, { question: 'scope', prompt: 'What scope?', options: ['All', 'One page'], recommended: 0 });
  const packet = run('handover', ['portable']);
  assert.equal(packet.story.harness, 'Claude Code');
  assert.equal(packet.story.worker.role, 'planner');
  assert.equal(packet.story.revision, 4);
  assert.ok(packet.pending.some(event => event.type === 'question'));
  assert.ok(packet.pending.every(event => event.story === 'portable'));
  assert.throws(() => record('assign-worker', 4, { session: 'worker-1' }), /Release the previous worker/);
  record('release-worker', 4, { assignment: packet.story.worker.id, detail: 'Claude session stopped after asking the question.' });
  assert.throws(() => record('select-harness', 5, { harness: 'Cursor' }), /only for an older/);
  assert.throws(() => record('activity', 5, { assignment: packet.story.worker.id, detail: 'Old update between assignments.' }), /current assignment/);
  record('assign-worker', 5, { session: 'worker-1' });
  assert.throws(() => record('activity', 6, { assignment: packet.story.worker.id, detail: 'Old update from same session label.' }), /current assignment/);
  assert.throws(() => record('release-worker', 6, { assignment: packet.story.worker.id, detail: 'Old release.' }), /assignment does not match/);
  record('answer', 6, { question: 'scope', answer: 0 });
  assert.throws(() => record('plan', 7, { detail: 'Export all eligible rows.' }), /Release the assigned worker/);
  const replacement = run('handover', ['portable']).story.worker;
  record('release-worker', 7, { assignment: replacement.id, detail: 'Claude finished reviewing the decision.' });
  record('plan', 8, { detail: 'Export all eligible rows.' });
  const resumed = run('handover', ['portable']);
  assert.equal(resumed.story.phase, 'approval');
  assert.equal(resumed.story.worker, undefined);
  assert.equal(resumed.story.questions[0].answer, 'All');
  assert.equal(resumed.story.harness, 'Claude Code');
  assert.equal(run('handover', ['other']).story.harness, 'Cursor');
  assert.deepEqual(run('snapshot', ['cursor']).map(story => story.id), ['other']);
  assert.deepEqual(run('snapshot', ['Claude Code']).map(story => story.id), ['portable']);
  assert.equal(run('snapshot').length, 2);
});

test('the HTTP surface accepts human decisions from the loopback origin only', async t => {
  const { close, ...store } = fixture(t)();
  start(store, 'local');
  const record = writer(store, 'local');
  record('plan', { detail: 'Plan for Fury.' });
  const server = serve(store, 0);
  await once(server, 'listening');
  try {
    const origin = 'http://127.0.0.1:' + server.address().port;
    const endpoint = origin + '/api/decision';
    const body = { story: 'local', type: 'approve', key: 'yes', revision: 3 };
    const post = (from, event) => fetch(endpoint, {
      method: 'POST', headers: { Origin: from, 'Content-Type': 'application/json' }, body: JSON.stringify(event),
    });
    assert.equal((await fetch(origin)).status, 200);
    assert.equal((await post('https://example.com', body)).status, 403);
    assert.equal((await post(origin, { ...body, type: 'handoff' })).status, 403);
    assert.equal((await post(origin, body)).status, 200);
    const [story] = await (await fetch(origin + '/api/stories')).json();
    assert.equal(story.phase, 'testing');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('Hawkeye distinguishes absent, incomplete, and completed GitHub checks', () => {
  const headRefOid = 'a'.repeat(40);
  const check = statusCheckRollup => summarizePr({ state: 'OPEN', headRefOid, statusCheckRollup });
  assert.equal(check([]).status, 'no-checks');
  assert.equal(check([{ status: 'IN_PROGRESS', conclusion: 'SUCCESS' }]).status, 'running');
  assert.equal(check([{ status: 'COMPLETED', conclusion: 'SUCCESS' }, { state: 'SUCCESS' }]).status, 'passed');
  assert.deepEqual(check([{ status: 'COMPLETED', conclusion: 'FAILURE', name: 'Build' }, { state: 'PENDING' }]), {
    head: headRefOid, status: 'failed', failedCount: 1, failures: ['Build'],
  });
  assert.throws(() => summarizePr({ state: 'OPEN', headRefOid }), /incomplete/);
  assert.throws(() => summarizePr({ state: 'OPEN', headRefOid: [headRefOid], statusCheckRollup: [] }), /incomplete/);
  assert.equal(githubPr('https://github.com/example/repo/pull/12#discussion_r1'), 'https://github.com/example/repo/pull/12');
  assert.equal(githubPr('https://example.com/example/repo/pull/12'), null);
  assert.equal(githubPr('https://user@github.com/example/repo/pull/12'), null);
});

test('Hawkeye queues durable CI wakes once per observation, without advancing the story', async t => {
  const open = fixture(t);
  const store = open();
  start(store, 'watched');
  start(store, 'other');
  const record = writer(store, 'watched');
  record('plan', { detail: 'Plan ready.' });
  record('approve');
  record('handoff', { detail: 'Tests ready.' });
  record('handoff', { detail: 'Test failed for expected reason.', command: 'npm test' });
  record('handoff', { detail: 'Test passes.', command: 'npm test' });
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  record('handoff', { detail: 'No surviving mutants.', command: 'npx stryker run' });
  record('handoff', { detail: 'Reviewed.' });
  record('comparison-choice', { run: false });
  const url = 'https://github.com/example/repo/pull/12';
  record('pr-opened', { url });
  const head = 'a'.repeat(40);
  let observed = { head, status: 'running', failedCount: 0, failures: [] };
  const readPr = async actualUrl => {
    assert.equal(actualUrl, url);
    return observed;
  };
  assert.deepEqual(await watchOnce(store, { readPr }), []);
  let warnings = 0;
  assert.deepEqual(await watchOnce(store, {
    readPr: async () => { throw Error('Unable to contact GitHub'); }, warn: () => warnings++,
  }), []);
  assert.equal(warnings, 1);
  assert.equal(store.handover('watched').story.prObservation.status, 'running');
  observed = { ...observed, status: 'failed', failedCount: 1, failures: ['Build'] };
  const next = open();
  for (const { seq } of next.pendingFor('watched')) next.ack(seq);
  const waiting = waitForWake(next, 'watched', 2);
  const [failure] = await watchOnce(store, { readPr });
  const [wake] = await waiting;
  assert.equal(wake.seq, failure.seq);
  assert.equal(wake.type, 'pr-observed');
  assert.equal(wake.observation.status, 'failed');
  assert.match(wake.detail, /Hawkeye.*CI failed.*Build/);
  assert.equal(next.handover('watched').story.phase, 'ci');
  assert.deepEqual(await watchOnce(next, { readPr }), []);
  assert.equal(next.ack(failure.seq).acknowledged, true);
  assert.deepEqual(await waitForWake(next, 'watched', 0), []);
  observed = { ...observed, head: 'b'.repeat(40) };
  assert.equal((await watchOnce(store, { readPr }))[0].head, 'b'.repeat(40));
  observed = { ...observed, status: 'passed', failedCount: 0, failures: [] };
  assert.equal((await watchOnce(store, { readPr }))[0].status, 'passed');
  assert.equal(next.handover('watched').story.phase, 'ci');
  observed = { ...observed, status: 'merged' };
  record('blocked', { detail: 'Waiting for a review that has not appeared.' });
  assert.equal((await watchOnce(store, { readPr }))[0].status, 'merged');
  assert.equal(next.handover('watched').story.phase, 'ci');
  assert.deepEqual(await watchOnce(next, { readPr }), []);
  record('merged', { detail: 'GitHub reports the registered PR merged.' });
  assert.equal(next.handover('watched').story.phase, 'closed');
  assert.equal(next.handover('watched').story.blocked, undefined);
  assert.ok(next.pendingFor('other').every(event => event.type !== 'pr-observed'));
});

test('the first watch detects a new head even when readiness predates the watcher', async t => {
  const store = fixture(t)();
  start(store, 'ready');
  const record = writer(store, 'ready');
  record('plan', { detail: 'Plan ready.' });
  record('approve');
  record('handoff', { detail: 'Tests ready.' });
  record('handoff', { detail: 'Expected red.', command: 'npm test' });
  record('handoff', { detail: 'Passing checks.', command: 'npm test' });
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  record('handoff', { detail: 'No surviving mutants.', command: 'npx stryker run' });
  record('handoff', { detail: 'Review passed.' });
  record('comparison-choice', { run: false });
  const url = 'https://github.com/example/repo/pull/31';
  record('pr-opened', { url });
  record('pr-observed', { url, observation: { head: 'a'.repeat(40), status: 'passed', failedCount: 0, failures: [] } });
  record('pr-ready', { head: 'a'.repeat(40), detail: 'Head A reviewed.' });
  const observed = { head: 'b'.repeat(40), status: 'running', failedCount: 0, failures: [] };
  assert.throws(() => record('pr-observed', { url, observation: { ...observed, head: [observed.head] } }), /observed PR head/);
  const [wake] = await watchOnce(store, { readPr: async () => observed });
  assert.equal(wake.head, observed.head);
  const packet = store.handover('ready');
  assert.equal(packet.story.readyHead, 'a'.repeat(40));
  assert.match(packet.pending.find(event => event.seq === wake.seq).detail, /New head/);
  record('pr-recheck', { detail: 'Confirm head B after its checks and review.' });
  assert.throws(() => record('pr-ready', { head: 'a'.repeat(40), detail: 'Old evidence.' }), /does not cover/);
  assert.equal(store.handover('ready').story.phase, 'ci');
});

test('planning drafts preserve saved decisions and expose pending handoffs without approval', t => {
  const store = fixture(t)();
  start(store, 'draft');
  const record = writer(store, 'draft');
  record('draft-plan', { detail: 'Goal and open design choice.' });
  record('question', { question: 'format', prompt: 'Which format?', options: ['CSV', 'JSON'], recommended: 0 });
  const answer = record('answer', { question: 'format', answer: 0 });
  let [story] = store.snapshot();
  assert.equal(story.phase, 'planning');
  assert.equal(story.draftPlan.answers, 0);
  assert.equal(story.questions[0].answer, 'CSV');
  assert.equal(story.pendingDecision.seq, answer.seq);
  record('draft-plan', { detail: 'Goal and approved CSV format.' });
  [story] = store.snapshot();
  assert.equal(story.draftPlan.answers, 1);
  assert.match(story.draftPlan.text, /CSV/);
  record('assign-worker', { session: 'planner' });
  const assignment = store.snapshot()[0].worker.id;
  record('release-worker', { assignment, detail: 'Done for this round.' });
  assert.throws(() => record('draft-plan', { assignment, detail: 'Late draft.' }), /current assignment/);
  store.ack(answer.seq);
  assert.equal(store.snapshot()[0].pendingDecision, null);
  record('plan', { detail: 'Proposed CSV plan.' });
  assert.equal(store.snapshot()[0].draftPlan, undefined);
  assert.equal(store.snapshot()[0].phase, 'approval');
});

test('Rocket diagram work returns to its original PR phase after a verified handoff', t => {
  const store = fixture(t)();
  start(store, 'diagram');
  const record = writer(store, 'diagram');
  assert.throws(() => record('diagram-start', { detail: 'Architecture delta.' }), /from publishing, CI or merge, after the review and the comparison/);
  record('plan', { detail: 'Plan.' });
  record('approve');
  record('handoff', { detail: 'Tests ready.' });
  record('handoff', { detail: 'Valid red.', command: 'npm test' });
  record('handoff', { detail: 'Verified green.', command: 'npm test' });
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  record('handoff', { detail: 'No surviving mutants.', command: 'npx stryker run' });
  record('handoff', { detail: 'Review passed.' });
  record('comparison-choice', { run: false });
  record('pr-opened', { url: 'https://github.com/example/repo/pull/5' });
  record('diagram-start', { detail: 'Show the new data flow.' });
  assert.equal(store.handover('diagram').story.comparisonRequested, false);
  record('assign-worker', { session: 'rocket' });
  const assignment = store.handover('diagram').story.worker.id;
  assert.equal(store.handover('diagram').story.worker.role, 'diagrammer');
  assert.throws(() => record('handoff', { detail: 'Diagram ready.' }), /Release the assigned worker/);
  record('activity', { assignment, detail: 'Drawing data ownership boundaries.' });
  record('release-worker', { assignment, detail: 'Diagram finished.' });
  record('handoff', { detail: 'Diagram reviewed and added to the PR description.' });
  const story = store.handover('diagram').story;
  assert.equal(story.phase, 'ci');
  assert.ok(story.diagram.completedAt);
  assert.equal(story.pr, 'https://github.com/example/repo/pull/5');
});

test('deletion stays queued until verified cleanup and preserves other stories and wake identities', t => {
  const store = fixture(t)();
  const initial = start(store, 'cancelled');
  start(store, 'other');
  const record = writer(store, 'cancelled');
  record('assign-worker', { session: 'planner' });
  const assignment = store.handover('cancelled').story.worker.id;
  const cleanup = record('request-cleanup');
  assert.throws(() => record('plan', { detail: 'Unexpected continuation.' }), /awaiting cleanup/);
  assert.throws(() => record('complete-cleanup', { detail: 'Not complete.' }), /release the worker/);
  record('cleanup-blocked', { detail: 'Checking the worktree.' });
  assert.equal(store.handover('cancelled').story.cleanup.blocked, 'Checking the worktree.');
  assert.ok(store.pendingFor('cancelled').some(wake => wake.seq === cleanup.seq));
  record('release-worker', { assignment, detail: 'Planner is stopped.' });
  const completion = {
    type: 'complete-cleanup', story: 'cancelled', key: 'verified-cleanup',
    revision: store.handover('cancelled').story.revision,
    detail: 'Verified worktree and branch are absent and no PR exists.',
  };
  const receipt = store.record(completion);
  assert.equal(receipt.deleted, true);
  assert.equal(store.record(completion).replayed, true);
  assert.throws(() => store.record({ ...completion, detail: 'Different evidence.' }), /different request/);
  assert.deepEqual(store.snapshot().map(story => story.id), ['other']);
  assert.throws(() => store.handover('cancelled'), /does not exist/);
  assert.throws(() => start(store, 'cancelled'), /already exists/);
  assert.equal(store.ack(initial.seq).acknowledged, false);
  assert.equal(store.pending().some(wake => wake.story === 'cancelled'), false);
  assert.ok(start(store, 'next').seq > receipt.seq);
});

test('registered evidence is streamed with video ranges, limited to the registered story and file', async t => {
  const store = fixture(t)();
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-media-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const image = join(directory, 'before.png');
  const video = join(directory, 'capture.mp4');
  writeFileSync(image, Buffer.from('89504e470d0a1a0a', 'hex'));
  writeFileSync(video, '0123456789');
  start(store, 'media');
  const record = writer(store, 'media');
  assert.throws(() => record('artifact', { path: '../not-registered.png', kind: 'before', detail: 'Before' }), /absolute/);
  record('artifact', { path: image, kind: 'before', detail: 'Before capture.' });
  record('artifact', { path: video, kind: 'recording', detail: 'Video capture.' });
  const [png, mp4] = store.handover('media').story.artifacts;
  const server = serve(store, 0);
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const url = artifact => origin + '/api/media?' + new URLSearchParams({ story: 'media', id: artifact.id });
  try {
    const response = await fetch(url(png));
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal((await response.arrayBuffer()).byteLength, 8);
    const partial = await fetch(url(mp4), { headers: { Range: 'bytes=2-5' } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal(await partial.text(), '2345');
    assert.equal((await fetch(url(mp4), { headers: { Range: 'bytes=30-' } })).status, 416);
    assert.equal((await fetch(origin + '/api/media?story=media&id=unknown')).status, 404);
    writeFileSync(image, 'changed');
    assert.equal((await fetch(url(png))).status, 409);
    record('request-cleanup');
    record('complete-cleanup', { detail: 'Test files retained by the test harness until teardown.' });
    assert.equal((await fetch(url(mp4))).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});


function toGreen(record) {
  record('plan', { detail: 'Plan.' });
  record('approve');
  record('handoff', { detail: 'Tests ready.' });
  record('handoff', { detail: 'Valid red.', command: 'npm test' });
  record('handoff', { detail: 'Verified green.', command: 'npm test' });
}

test('gates and mutation sit between build and review, and survivors return to testing', t => {
  const store = fixture(t)();
  const created = store.record({ story: 'mut', key: 'mut-start', type: 'create', title: 'T', detail: 'Brief.', branch: 'b', worktree: '/w', harness: 'Codex' });
  assert.equal(store.snapshot()[0].phase, 'scout');
  const record = writer(store, 'mut');
  assert.throws(() => record('plan', { detail: 'Too early.' }), /Expected phase planning/);
  record('handoff', { detail: 'Context pack saved.' });
  toGreen(record);
  const phase = () => store.snapshot()[0].phase;
  assert.equal(phase(), 'gates');
  assert.throws(() => record('handoff', { detail: 'Gates passed.' }), /verification command/);
  assert.throws(() => record('return-to-testing', { detail: 'x' }), /Expected phase mutation/);
  record('return-to-build', { detail: 'Gitleaks found a secret.' });
  assert.equal(phase(), 'building');
  assert.equal(store.snapshot()[0].reviewRounds, undefined);
  record('handoff', { detail: 'Green.', command: 'npm test' });
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  assert.equal(phase(), 'mutation');
  record('return-to-testing', { detail: '3 mutants survived in export.ts.' });
  assert.equal(phase(), 'testing');
  assert.equal(store.pending().at(-1).type, 'return-to-testing');
  record('handoff', { detail: 'Tests strengthened.' });
  record('handoff', { detail: 'Red on mutant.', command: 'npm test' });
  record('handoff', { detail: 'Green.', command: 'npm test' });
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  assert.equal(phase(), 'review');
  record('return-to-build', { detail: 'Round 1 finding.' });
  assert.equal(store.snapshot()[0].reviewRounds, 1);
  assert.ok(created.seq);
});

test('the owner can send a story back to build from the comparison', t => {
  const store = fixture(t)();
  start(store, 'look');
  const record = writer(store, 'look');
  toGreen(record);
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  record('handoff', { detail: 'Reviewed.' });
  record('comparison-choice', { run: true });
  record('return-to-build', { detail: 'The owner wants the divider kept.' });
  assert.equal(store.snapshot()[0].phase, 'building');
  assert.equal(store.snapshot()[0].reviewRounds, undefined);
});

test('Rocket diagram work is refused in review and comparison and round-trips from publishing', t => {
  const store = fixture(t)();
  start(store, 'early');
  const record = writer(store, 'early');
  toGreen(record);
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  assert.equal(store.snapshot()[0].phase, 'review');
  assert.throws(() => record('diagram-start', { detail: 'Show the new flow.' }), error => error.status === 409 && /Start diagram work from publishing, CI or merge, after the review and the comparison./.test(error.message));
  assert.equal(store.snapshot()[0].phase, 'review');
  record('handoff', { detail: 'Reviewed.' });
  record('comparison-choice', { run: true });
  assert.throws(() => record('diagram-start', { detail: 'Show the new flow.' }), error => error.status === 409 && /Start diagram work from publishing, CI or merge, after the review and the comparison./.test(error.message));
  assert.equal(store.snapshot()[0].phase, 'comparison');
  record('handoff', { detail: 'Owner accepted the comparison.' });
  assert.equal(store.snapshot()[0].phase, 'publishing');
  record('diagram-start', { detail: 'Show the new flow.' });
  assert.equal(store.snapshot()[0].phase, 'diagram');
  record('handoff', { detail: 'Diagram done.' });
  assert.equal(store.snapshot()[0].phase, 'publishing');
});

test('the retro runs while the PR is open and may be followed by the merge', t => {
  const store = fixture(t)();
  start(store, 'retro');
  const record = writer(store, 'retro');
  toGreen(record);
  record('handoff', { detail: 'Gates passed.', command: 'npm run lint' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  record('handoff', { detail: 'Review passed.' });
  record('comparison-choice', { run: false });
  assert.throws(() => record('retro-start', { detail: 'Too early.' }), /pull request is open/);
  record('pr-opened', { url: 'https://github.com/example/repo/pull/9' });
  record('retro-start', { detail: 'Review lessons.' });
  assert.equal(store.snapshot()[0].phase, 'retro');
  record('handoff', { detail: 'Logged two lessons.' });
  assert.equal(store.snapshot()[0].phase, 'ci');
  record('retro-start', { detail: 'Second pass.' });
  record('merged', { detail: 'Merged during the retro.' });
  assert.equal(store.snapshot()[0].phase, 'closed');
});

test('document evidence accepts markdown, json, and text only', t => {
  const store = fixture(t)();
  const directory = mkdtempSync(join(tmpdir(), 'jarvis-doc-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const design = join(directory, 'design.md');
  const exe = join(directory, 'tool.exe');
  writeFileSync(design, '# Design\n- Approved.');
  writeFileSync(exe, 'MZ');
  start(store, 'docs');
  const record = writer(store, 'docs');
  record('artifact', { path: design, kind: 'document', detail: 'Approved design.' });
  assert.throws(() => record('artifact', { path: exe, kind: 'document', detail: 'No.' }), /Markdown, JSON, or text/);
  assert.throws(() => record('artifact', { path: design, kind: 'before', detail: 'No.' }), /PNG/);
  assert.equal(store.handover('docs').story.artifacts[0].kind, 'document');
});

test('the handover carries the 10 most recent events while the snapshot keeps 40 and the history keeps all', t => {
  const store = fixture(t)();
  start(store, 'long');
  const record = writer(store, 'long');
  record('question', { question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 1 });
  const answer = record('answer', { question: 'scope', answer: 1 });
  for (let step = 0; step < 50; step += 1) record('activity', { detail: 'Step ' + step + '.' });
  const all = store.history('long');
  assert.equal(all.length, 54);
  const packet = store.handover('long');
  assert.deepEqual(packet.story.events.map(event => event.seq), all.slice(0, 10).map(event => event.seq));
  assert.deepEqual(store.snapshot()[0].events.map(event => event.seq), all.slice(0, 40).map(event => event.seq));
  assert.ok(packet.pending.some(event => event.seq === answer.seq), 'unacknowledged news is not capped');
  assert.equal(packet.story.questions[0].answer, 'Selected');
});

const REVIEW_PR = 'https://github.com/acme/widgets/pull/7';
const REVIEW_HEAD = 'c'.repeat(40);

function toCi(store, story) {
  start(store, story);
  const record = writer(store, story);
  toGreen(record);
  record('handoff', { detail: 'Gates passed.', command: 'node --test' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  record('handoff', { detail: 'Reviewed.' });
  record('comparison-choice', { run: false });
  record('pr-opened', { url: REVIEW_PR });
  return record;
}

function review(keys = [], extra = {}) {
  return {
    approvals: [], changesRequested: [], unresolved: keys.filter(key => key.startsWith('PRRT_')).length, earlier: 0,
    items: keys.slice(0, 10).map(key => ({ key, kind: key.startsWith('PRRT_') ? 'thread' : 'comment', author: 'reviewer-a', bot: false,
      excerpt: 'Please rename this helper.', url: REVIEW_PR + '#' + key })),
    keys, more: false, lastActivityAt: '2026-01-01T12:00:00.000Z', ...extra,
  };
}

const observed = (keys, extra) => ({ url: REVIEW_PR, observation: { head: REVIEW_HEAD, status: 'running', failedCount: 0, failures: [], review: review(keys, extra) } });

test('Hawkeye stores the review it observed with the checks', t => {
  const store = fixture(t)();
  const record = toCi(store, 'seen');
  record('pr-observed', observed(['PRRT_1:PRRC_1'], { approvals: ['reviewer-c'], changesRequested: ['reviewer-b'], earlier: 2 }));
  const stored = store.handover('seen').story.prObservation.review;
  assert.ok(stored, 'the observation keeps its review');
  assert.deepEqual([stored.approvals, stored.changesRequested, stored.unresolved, stored.earlier, stored.keys],
    [['reviewer-c'], ['reviewer-b'], 1, 2, ['PRRT_1:PRRC_1']]);
  assert.equal(stored.items[0].bot, false);
  assert.equal(stored.lastActivityAt, '2026-01-01T12:00:00.000Z');
  assert.throws(() => record('pr-observed', observed(['x'], { keys: 'x' })), error => error.status === 400, 'a review without a key list is refused');
  assert.throws(() => record('pr-observed', observed(['x'], { unresolved: -1 })), error => error.status === 400, 'a negative count is refused');
});

test('new current-head feedback wakes Jarvis once; a resolved thread, a later activity time or a returning key does not', t => {
  const store = fixture(t)();
  const record = toCi(store, 'woken');
  const quiet = record('pr-observed', observed([]));
  assert.equal(quiet.wake, false, 'a first observation with running checks and no feedback does not wake');
  const fresh = record('pr-observed', observed(['PRRT_1:PRRC_1']));
  assert.equal(fresh.wake, true, 'a new thread wakes Jarvis');
  const event = store.pendingFor('woken').find(item => item.seq === fresh.seq);
  assert.ok(event, 'the review wake is pending for Jarvis');
  assert.equal(event.observation.review.items[0].key, 'PRRT_1:PRRC_1', 'the comments travel with the wake');
  assert.ok(record('pr-observed', observed(['PRRT_1:PRRC_1'])).unchanged, 'an identical observation records nothing');
  const later = record('pr-observed', observed(['PRRT_1:PRRC_1'], { lastActivityAt: '2026-01-02T12:00:00.000Z' }));
  assert.ok(later.seq && later.wake === false, 'a newer activity time alone is recorded without waking');
  const resolved = record('pr-observed', observed([]));
  assert.ok(resolved.seq && resolved.wake === false, 'a resolved thread is recorded without waking');
  assert.equal(record('pr-observed', observed(['PRRT_1:PRRC_1'])).wake, false, 'a key seen before never looks new');
  assert.equal(record('pr-observed', observed(['PRRT_1:PRRC_2'])).wake, true, 'a reply in the thread is new feedback');
  assert.equal(store.handover('woken').story.phase, 'ci', 'the observation never changes the phase');
});

test('a new head still wakes as before when the review is unchanged', t => {
  const store = fixture(t)();
  const record = toCi(store, 'heads');
  record('pr-observed', observed(['IC_1']));
  const moved = record('pr-observed', { url: REVIEW_PR, observation: { head: 'e'.repeat(40), status: 'running', failedCount: 0, failures: [], review: review(['IC_1']) } });
  assert.equal(moved.wake, true);
  assert.match(store.pendingFor('heads').find(item => item.seq === moved.seq).detail, /New head/);
});

test('PR review is a detour from ci or merge that returns to ci', t => {
  const store = fixture(t)();
  const record = toCi(store, 'detour');
  record('pr-observed', observed(['PRRT_1:PRRC_1']));
  assert.throws(() => record('pr-review-start', {}), error => error.status === 400, 'pr-review-start names the feedback');
  const started = record('pr-review-start', { detail: 'One new thread from reviewer-a.' });
  let story = store.handover('detour').story;
  assert.equal(story.phase, 'pr-review');
  assert.deepEqual([story.prReview.returnPhase, story.prReview.detail], ['ci', 'One new thread from reviewer-a.']);
  assert.ok(store.pendingFor('detour').some(event => event.seq === started.seq), 'pr-review-start wakes Jarvis to staff the worker');
  assert.ok(store.watchTargets().some(item => item.id === 'detour'), 'Hawkeye keeps watching during PR review');
  record('assign-worker', { session: 'hawkeye-1' });
  story = store.handover('detour').story;
  assert.equal(story.worker.role, 'watcher', 'Hawkeye runs PR review');
  assert.throws(() => record('retro-start', { detail: 'Too early.' }), error => error.status === 409, 'a retro starts only from ci or merge');
  record('release-worker', { assignment: story.worker.id, detail: 'Replies posted, threads resolved.' });
  record('handoff', { detail: 'Two fixes pushed; both threads answered and resolved.' });
  story = store.handover('detour').story;
  assert.equal(story.phase, 'ci');
  assert.equal(story.prReview.detail, 'Two fixes pushed; both threads answered and resolved.');
  record('pr-observed', { url: REVIEW_PR, observation: { head: REVIEW_HEAD, status: 'passed', failedCount: 0, failures: [], review: review([]) } });
  record('pr-ready', { head: REVIEW_HEAD, detail: 'Checks passed; review clear.' });
  record('pr-review-start', { detail: 'A comment arrived after readiness.' });
  story = store.handover('detour').story;
  assert.equal(story.phase, 'pr-review', 'PR review starts from merge too');
  assert.equal(story.readyHead, undefined, 'PR review clears readiness');
  record('handoff', { detail: 'Answered.' });
  assert.equal(store.handover('detour').story.phase, 'ci', 'PR review returns to ci even when started from merge');
});

test('PR review starts only while a PR is open, and can go back to build or close on a merge', t => {
  const store = fixture(t)();
  start(store, 'early');
  const early = writer(store, 'early');
  toGreen(early);
  assert.throws(() => early('pr-review-start', { detail: 'No PR yet.' }), error => error.status === 409);
  const record = toCi(store, 'back');
  record('pr-review-start', { detail: 'reviewer-a asks for a redesign.' });
  record('return-to-build', { detail: 'The owner asked for a larger change.' });
  assert.equal(store.handover('back').story.phase, 'building');
  const merged = toCi(store, 'merged');
  merged('pr-review-start', { detail: 'One comment.' });
  merged('merged', { detail: 'GitHub reports the PR merged.' });
  assert.equal(store.handover('merged').story.phase, 'closed');
});

test('Hawkeye records review during PR review but never wakes Jarvis; only what the worker handed off as seen stays quiet later', t => {
  const store = fixture(t)();
  const record = toCi(store, 'inside');
  record('pr-observed', observed(['PRRT_1:PRRC_1']));
  record('pr-review-start', { detail: 'One new thread.' });
  const during = record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2']));
  assert.ok(during.seq, 'the observation is recorded in pr-review');
  assert.equal(during.wake, false, 'nothing wakes while the story is in pr-review');
  assert.ok(record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2'])).unchanged, 'an identical observation in pr-review records nothing');
  assert.equal(record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2', 'IC_4'])).wake, false, 'feedback after the re-read does not wake in pr-review');
  assert.throws(() => record('handoff', { detail: 'Answered.', seen: 'IC_2' }), error => error.status === 400, 'seen is a list of review keys');
  record('handoff', { detail: 'Answered both.', seen: ['PRRT_1:PRRC_1', 'IC_2'] });
  const after = record('pr-observed', observed(['IC_2', 'IC_4']));
  assert.equal(after.wake, true, 'feedback the worker did not hand off as seen wakes after the detour');
  assert.match(store.pendingFor('inside').find(event => event.seq === after.seq).detail, /New feedback · 1 item/, 'the feedback the worker handled is not counted again');
  assert.equal(record('pr-observed', observed(['IC_2', 'IC_4', 'IC_3'])).wake, true);
});

test('feedback first seen in a PR review that went back to build wakes on the first observation afterwards, even when unchanged', t => {
  const store = fixture(t)();
  const record = toCi(store, 'rebuilt');
  record('pr-observed', observed(['PRRT_1:PRRC_1']));
  record('pr-review-start', { detail: 'One new thread.' });
  record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2']));
  record('return-to-build', { detail: 'The owner asked for a larger change.' });
  record('handoff', { detail: 'Verified green.', command: 'npm test' });
  record('handoff', { detail: 'Gates pass.', command: 'node --test' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  record('handoff', { detail: 'Reviewed.' });
  record('comparison-choice', { run: false });
  record('pr-opened', { url: REVIEW_PR });
  assert.equal(store.handover('rebuilt').story.phase, 'ci');
  const again = record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2']));
  assert.equal(again.wake, true, 'the identical observation still wakes for the comment never brought to Jarvis');
  assert.ok(record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2'])).unchanged, 'once woken, the same observation records nothing');
});

test('feedback a PR review handled before going back to build stays quiet once the story is back in ci', t => {
  const store = fixture(t)();
  const record = toCi(store, 'handled');
  record('pr-observed', observed(['PRRT_1:PRRC_1']));
  record('pr-review-start', { detail: 'One new thread.' });
  record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2', 'IC_3']));
  assert.throws(() => record('return-to-build', { detail: 'Larger change.', seen: 'IC_2' }), error => error.status === 400, 'seen is a list of review keys');
  assert.throws(() => record('return-to-build', { detail: 'Larger change.', seen: [''] }), error => error.status === 400, 'a blank review key is refused');
  record('return-to-build', { detail: 'The owner asked for a larger change.', seen: ['PRRT_1:PRRC_1', 'IC_2'] });
  record('handoff', { detail: 'Verified green.', command: 'npm test' });
  record('handoff', { detail: 'Gates pass.', command: 'node --test' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  record('handoff', { detail: 'Reviewed.' });
  record('comparison-choice', { run: false });
  record('pr-opened', { url: REVIEW_PR });
  assert.equal(record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2'])).wake, false, 'the conversation comment the worker answered does not wake Jarvis again');
  const unhandled = record('pr-observed', observed(['PRRT_1:PRRC_1', 'IC_2', 'IC_3']));
  assert.equal(unhandled.wake, true, 'feedback the worker did not hand off as seen still wakes');
  assert.match(store.pendingFor('handled').find(event => event.seq === unhandled.seq).detail, /New feedback · 1 item/);
});

test('a still-current key never wakes again, however many keys the story has seen', t => {
  const store = fixture(t)();
  const record = toCi(store, 'pruned');
  record('pr-observed', observed(['PRRT_keep:PRRC_1']));
  for (let round = 0; round < 3; round += 1) {
    const batch = Array.from({ length: 500 }, (_, n) => 'IC_' + round + '_' + n);
    const woken = record('pr-observed', observed(['PRRT_keep:PRRC_1', ...batch]));
    assert.match(store.pendingFor('pruned').find(event => event.seq === woken.seq).detail, /New feedback · 500 items$/, 'round ' + round + ' counts only its new comments');
  }
  assert.equal(record('pr-observed', observed(['PRRT_keep:PRRC_1'])).wake, false, 'the thread seen first is still not new');
});

test('a review wake still names the assigned worker', t => {
  const store = fixture(t)();
  const record = toCi(store, 'named');
  record('assign-worker', { session: 'hawkeye-1' });
  const woken = record('pr-observed', observed(['IC_1']));
  const event = store.pendingFor('named').find(item => item.seq === woken.seq);
  assert.equal(event.feedback, true);
  assert.equal(event.worker?.id, store.handover('named').story.worker.id);
});

test('the worker records the comment ids it posts, and Hawkeye passes them to the reader', async t => {
  const store = fixture(t)();
  const record = toCi(store, 'posted');
  record('pr-review-start', { detail: 'One new thread.' });
  record('assign-worker', { session: 'hawkeye-1' });
  const assignment = store.handover('posted').story.worker.id;
  record('activity', { assignment, detail: 'Replied in two threads.', posted: ['PRRC_9', 'IC_9'] });
  assert.deepEqual(store.handover('posted').story.prPosted, ['PRRC_9', 'IC_9']);
  const many = Array.from({ length: 600 }, (_, n) => 'IC_' + n);
  record('activity', { assignment, detail: 'Replied everywhere.', posted: many.slice(0, 300) });
  record('activity', { assignment, detail: 'Replied everywhere again.', posted: many.slice(300) });
  const kept = store.handover('posted').story.prPosted;
  assert.equal(kept.length, 500, 'posted ids are capped at 500');
  assert.ok(kept.includes('IC_599'), 'the newest ids are kept');
  let seen;
  await watchOnce(store, { readPr: async (url, signal, posted) => {
    seen = posted;
    return { head: REVIEW_HEAD, status: 'running', failedCount: 0, failures: [], review: review([]) };
  } });
  assert.deepEqual(seen, kept, 'watchOnce hands the posted ids to the reader');
});

test('readiness is refused while the observed head has changes requested or unresolved threads, but not for earlier-head feedback', t => {
  const store = fixture(t)();
  const record = toCi(store, 'gate');
  const passed = extra => ({ url: REVIEW_PR, observation: { head: REVIEW_HEAD, status: 'passed', failedCount: 0, failures: [], review: review([], extra) } });
  record('pr-observed', passed({ changesRequested: ['reviewer-b'] }));
  assert.throws(() => record('pr-ready', { head: REVIEW_HEAD, detail: 'Checks passed.' }),
    error => error.status === 409 && /change/i.test(error.message), 'changes requested on the observed head block readiness');
  record('pr-observed', passed({ unresolved: 3, keys: ['PRRT_1:a', 'PRRT_2:b', 'PRRT_3:c'] }));
  assert.throws(() => record('pr-ready', { head: REVIEW_HEAD, detail: 'Checks passed.' }),
    error => error.status === 409 && /3/.test(error.message), 'unresolved threads block readiness, and the refusal names the count');
  record('pr-observed', passed({ earlier: 2 }));
  record('pr-ready', { head: REVIEW_HEAD, detail: 'Checks passed; only earlier-head feedback remains.' });
  assert.equal(store.handover('gate').story.phase, 'merge');
});

test('a review read failure during PR review records nothing and only warns', async t => {
  const store = fixture(t)();
  const record = toCi(store, 'unread');
  record('pr-review-start', { detail: 'One new thread.' });
  const before = store.handover('unread').story.revision;
  let warnings = 0;
  assert.deepEqual(await watchOnce(store, { readPr: async () => { throw Error('GraphQL: rate limited'); }, warn: () => warnings++ }), []);
  assert.equal(warnings, 1, 'Hawkeye warns about a story it watches in pr-review');
  assert.equal(store.handover('unread').story.revision, before);
});

const observedStatus = (status, extra = {}) => ({
  url: REVIEW_PR,
  observation: { head: REVIEW_HEAD, status, failedCount: status === 'failed' ? 1 : 0, failures: status === 'failed' ? ['test'] : [], review: review([]), ...extra },
});

test('readiness is refused unless the observed head passed, and the refusal names the status', t => {
  const labels = {
    failed: /CI failed/, running: /Checks still running/, 'no-checks': /No checks reported/,
    merged: /merged/i, closed: /closed without merge/i,
  };
  for (const [status, message] of Object.entries(labels)) {
    const store = fixture(t)();
    const record = toCi(store, 'status-' + status);
    record('pr-observed', observedStatus(status));
    assert.throws(() => record('pr-ready', { head: REVIEW_HEAD, detail: 'Checks passed.' }),
      error => error.status === 409 && message.test(error.message) && /on the observed head/.test(error.message),
      'pr-ready was accepted or refused with the wrong message after a ' + status + ' observation');
    const stored = store.handover('status-' + status).story;
    assert.equal(stored.phase, 'ci', 'the story stays in ci after a ' + status + ' observation');
    assert.equal(stored.readyHead, undefined, 'no readyHead after a ' + status + ' observation');
  }
});

test('readiness is accepted once the observed head passed with a clear review', t => {
  const store = fixture(t)();
  const record = toCi(store, 'passes');
  record('pr-observed', observedStatus('running'));
  assert.throws(() => record('pr-ready', { head: REVIEW_HEAD, detail: 'Too early.' }), error => error.status === 409);
  record('pr-observed', observedStatus('passed'));
  record('pr-ready', { head: REVIEW_HEAD, detail: 'Checks passed; review clear.' });
  const story = store.handover('passes').story;
  assert.equal(story.phase, 'merge');
  assert.equal(story.readyHead, REVIEW_HEAD);
});

test('readiness that names a head is refused until Hawkeye has observed the pull request', t => {
  const store = fixture(t)();
  const record = toCi(store, 'unseen');
  assert.throws(() => record('pr-ready', { head: REVIEW_HEAD, detail: 'Checks passed.' }),
    error => error.status === 409 && /not observed/.test(error.message));
  const story = store.handover('unseen').story;
  assert.equal(story.phase, 'ci');
  assert.equal(story.readyHead, undefined);
});

test('readiness with no head is accepted while there is no observation', t => {
  const store = fixture(t)();
  const record = toCi(store, 'unwatched');
  record('pr-ready', { detail: 'The pull request is not on github.com.' });
  assert.equal(store.handover('unwatched').story.phase, 'merge');
});
