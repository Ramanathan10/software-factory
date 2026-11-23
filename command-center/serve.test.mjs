import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createConsoleService } from './console-service.mjs';
import { deliver, loadAdapters, requestDelivery, start } from './serve.mjs';

const decision = { story: 'TL-1', seqs: [4, 5], types: ['answer'], session: 'worker-1' };

test('a decision is sent to the story worker, naming the story and its events', async () => {
  const sent = [];
  const logged = [];
  assert.equal(await deliver(decision, { messageWorker: async message => sent.push(message) }, line => logged.push(line)), 'worker');
  assert.equal(sent[0].session, 'worker-1');
  assert.match(sent[0].prompt, /answer on story TL-1 \(event seq 4, 5\)/);
  assert.deepEqual(logged, []);
});

test('a decision that cannot reach its worker goes to Jarvis with the reason', async () => {
  const told = [];
  const adapter = {
    messageWorker: async () => { throw new Error('session closed'); },
    wakeCoordinator: async message => told.push(message.prompt),
  };
  assert.equal(await deliver({ ...decision, session: undefined }, adapter), 'coordinator');
  assert.equal(await deliver(decision, adapter), 'coordinator');
  assert.match(told[0], /story TL-1.*no worker is assigned.*tell the owner what to do next/);
  assert.match(told[1], /could not be messaged \(session closed\)/);
});

test('when Jarvis cannot be told either, the decision is left pending and the reason is logged', async () => {
  const logged = [];
  const log = line => logged.push(line);
  const deaf = { messageWorker: async () => {}, wakeCoordinator: async () => { throw new Error('chat closed'); } };
  assert.equal(await deliver(decision, undefined, log), 'nobody');
  assert.equal(await deliver({ ...decision, session: undefined }, deaf, log), 'nobody');
  assert.match(logged[0], /its harness has no adapter.*stays pending/);
  assert.match(logged[1], /chat closed/);
  assert.match(logged[2], /no worker is assigned/);
});

function folder(t) {
  const directory = mkdtempSync(join(tmpdir(), 'factory-serve-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('the launcher serves the dashboard, and a second one on the same port is refused', async t => {
  const dbPath = join(folder(t), 'stories.sqlite');
  const plan = { phaseTiers: { scout: 'deep' }, models: { codex: { deep: 'big' } } };
  const asked = [];
  const ran = (harness, session) => { asked.push(harness + ' ' + session); return session === 'worker-1' ? { model: 'big-1', effort: 'high' } : undefined; };
  const center = await start({ port: 0, dbPath, models: () => plan, ran });
  try {
    const meta = await fetch(center.url + 'api/meta').then(response => response.json());
    assert.ok(meta.phases.scout);
    assert.deepEqual([meta.phaseTiers, meta.models], [plan.phaseTiers, plan.models], 'the dashboard is told which model each phase runs on');
    const recorder = createConsoleService({ dbPath });
    try {
      for (const story of ['tl-1', 'tl-2']) recorder.createStory({ story, title: 'Add export', detail: 'Export rows.', branch: story, harness: 'Codex', worktree: '/work/' + story });
      recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'worker-1' });
    } finally {
      recorder.close();
    }
    const shown = async () => Object.fromEntries((await fetch(center.url + 'api/stories').then(response => response.json())).map(story => [story.id, story.worker?.ran]));
    assert.deepEqual(await shown(), { 'tl-1': { model: 'big-1', effort: 'high' }, 'tl-2': undefined }, 'a story is shown what its worker session ran on');
    await shown();
    assert.deepEqual(asked, ['Codex worker-1'], 'a session whose turn is over is read once, and a story with no worker never');
    await assert.rejects(start({ port: Number(new URL(center.url).port), dbPath }), { code: 'EADDRINUSE' });
  } finally {
    await center.close();
  }
});

test('a decision recorded outside the dashboard reaches the worker when delivery is requested', async t => {
  const dbPath = join(folder(t), 'stories.sqlite');
  const sent = [];
  const center = await start({ port: 0, dbPath, adapters: new Map([['codex', { messageWorker: async message => sent.push(message) }]]) });
  const jarvisConnection = createConsoleService({ dbPath });
  const port = Number(new URL(center.url).port);
  try {
    jarvisConnection.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', harness: 'Codex', worktree: '/work/tl-1' });
    jarvisConnection.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'worker-1' });
    jarvisConnection.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
    assert.deepEqual((await requestDelivery('tl-1', port)).seqs, [], 'a worker question is not a decision to deliver');

    const answer = jarvisConnection.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 0 });
    assert.deepEqual(await requestDelivery('tl-1', port), { story: 'tl-1', seqs: [answer.seq], told: 'worker' });
    assert.deepEqual([sent.length, sent[0].session, sent[0].worktree, sent[0].phase], [1, 'worker-1', '/work/tl-1', 'scout']);
    assert.match(sent[0].prompt, /answer on story tl-1/);
    assert.deepEqual([(await requestDelivery('tl-1', port)).seqs, sent.length], [[], 1], 'a decision the worker already has is not sent twice');

    jarvisConnection.ack(answer.seq);
    assert.deepEqual((await requestDelivery('tl-1', port)).seqs, [], 'an acknowledged decision is finished');
    await assert.rejects(requestDelivery('missing', port), /does not exist/);
  } finally {
    jarvisConnection.close();
    await center.close();
  }
});

test('each command-line harness in the table gets an adapter, found by the name stories record', async () => {
  const sent = [];
  const adapters = loadAdapters({ 'Claude Code': { workers: 'command-line' }, Codex: { workers: 'command-line' }, 'GitHub Copilot app': { workers: 'in-app' }, Cursor: { workers: 'none' } }, message => sent.push(message));
  assert.deepEqual([...adapters.keys()], ['claude code', 'codex']);
  await deliver({ ...decision, worktree: '/work/tl-1', phase: 'planning' }, adapters.get('codex'));
  assert.deepEqual([sent[0].harness, sent[0].session, sent[0].worktree, sent[0].phase], ['Codex', 'worker-1', '/work/tl-1', 'planning']);
});
