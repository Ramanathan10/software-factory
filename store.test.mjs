import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serve } from './jarvis.mjs';
import { openStore } from './store.mjs';

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
  return store.record({
    story, key: story + '-start', type: 'create', title: 'Implement ' + story,
    detail: 'Use an isolated branch.', branch: story, worktree: '/worktrees/' + story, harness,
  });
}

function writer(store, story) {
  return (type, input = {}) => {
    const { revision } = store.snapshot().find(item => item.id === story);
    return store.record({ story, type, revision, key: story + '-' + revision, ...input });
  };
}

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
  record('handoff', { detail: 'Independent review completed.' });
  record('comparison-choice', { run: false });
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
    record('handoff', { detail: 'Review complete.' });
    record('comparison-choice', { run: false });
  };
  toPublishing();
  record('pr-opened', { url });
  record('replan', { detail: 'GrepLoop raised a scope decision.' });
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
  const event = { story: 'story', key: 'send-plan', revision: 1, type: 'plan', detail: 'Use the approved contract.' };
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
    start(store, 'other', 'Grok Build');
  } finally {
    store.close();
  }
  const record = (type, revision, details) =>
    run('record', [], { story: 'portable', key: 'handover-' + revision, type, revision, ...details });
  assert.throws(() => record('assign-worker', 1, { host: 'Grok Build', session: 'worker-1' }), /harness selected/);
  record('assign-worker', 1, { session: 'worker-1' });
  record('question', 2, { question: 'scope', prompt: 'What scope?', options: ['All', 'One page'], recommended: 0 });
  const packet = run('handover', ['portable']);
  assert.equal(packet.story.harness, 'Claude Code');
  assert.equal(packet.story.worker.role, 'planner');
  assert.equal(packet.story.revision, 3);
  assert.ok(packet.pending.some(event => event.type === 'question'));
  assert.ok(packet.pending.every(event => event.story === 'portable'));
  assert.throws(() => record('assign-worker', 3, { session: 'worker-1' }), /Release the previous worker/);
  record('release-worker', 3, { assignment: packet.story.worker.id, detail: 'Claude session stopped after asking the question.' });
  assert.throws(() => record('select-harness', 4, { harness: 'Grok Build' }), /only for an older/);
  assert.throws(() => record('activity', 4, { assignment: packet.story.worker.id, detail: 'Old update between assignments.' }), /current assignment/);
  record('assign-worker', 4, { session: 'worker-1' });
  assert.throws(() => record('activity', 5, { assignment: packet.story.worker.id, detail: 'Old update from same session label.' }), /current assignment/);
  assert.throws(() => record('release-worker', 5, { assignment: packet.story.worker.id, detail: 'Old release.' }), /assignment does not match/);
  record('answer', 5, { question: 'scope', answer: 0 });
  assert.throws(() => record('plan', 6, { detail: 'Export all eligible rows.' }), /Release the assigned worker/);
  const replacement = run('handover', ['portable']).story.worker;
  record('release-worker', 6, { assignment: replacement.id, detail: 'Claude finished reviewing the decision.' });
  record('plan', 7, { detail: 'Export all eligible rows.' });
  const resumed = run('handover', ['portable']);
  assert.equal(resumed.story.phase, 'approval');
  assert.equal(resumed.story.worker, undefined);
  assert.equal(resumed.story.questions[0].answer, 'All');
  assert.equal(resumed.story.harness, 'Claude Code');
  assert.equal(run('handover', ['other']).story.harness, 'Grok Build');
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
    const body = { story: 'local', type: 'approve', key: 'yes', revision: 2 };
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
