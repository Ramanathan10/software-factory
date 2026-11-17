import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
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

function start(store, story) {
  return store.record({
    story, key: story + '-start', type: 'create', title: 'Implement ' + story,
    detail: 'Use an isolated branch.', branch: story, worktree: '/worktrees/' + story,
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
