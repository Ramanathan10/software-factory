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
  const center = await start({ port: 0, dbPath });
  // Close before the folder is removed: the store holds the database file open.
  try {
    const meta = await fetch(center.url + 'api/meta').then(response => response.json());
    assert.ok(meta.phases.scout);
    await assert.rejects(start({ port: Number(new URL(center.url).port), dbPath }), { code: 'EADDRINUSE' });
  } finally {
    await center.close();
  }
});

test('a decision recorded outside the dashboard reaches the worker when delivery is requested', async t => {
  const dbPath = join(folder(t), 'stories.sqlite');
  const sent = [];
  const center = await start({ port: 0, dbPath, adapters: new Map([['codex', { messageWorker: async message => sent.push(message) }]]) });
  // Jarvis and workers record through their own connection to the same database.
  const recorder = createConsoleService({ dbPath });
  const port = Number(new URL(center.url).port);
  try {
    recorder.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', harness: 'Codex', worktree: '/work/tl-1' });
    recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'worker-1' });
    recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
    assert.deepEqual((await requestDelivery('tl-1', port)).seqs, [], 'a worker question is not a decision to deliver');

    const answer = recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 0 });
    assert.deepEqual(await requestDelivery('tl-1', port), { story: 'tl-1', seqs: [answer.seq], told: 'worker' });
    assert.deepEqual([sent.length, sent[0].session, sent[0].worktree], [1, 'worker-1', '/work/tl-1']);
    assert.match(sent[0].prompt, /answer on story tl-1/);
    assert.deepEqual([(await requestDelivery('tl-1', port)).seqs, sent.length], [[], 1], 'a decision the worker already has is not sent twice');

    recorder.ack(answer.seq);
    assert.deepEqual((await requestDelivery('tl-1', port)).seqs, [], 'an acknowledged decision is finished');
    await assert.rejects(requestDelivery('missing', port), /does not exist/);
  } finally {
    recorder.close();
    await center.close();
  }
});

test('each command-line harness in the table gets an adapter, found by the name stories record', async () => {
  const sent = [];
  const adapters = loadAdapters({ 'Claude Code': { workers: 'command-line' }, Codex: { workers: 'command-line' }, 'GitHub Copilot app': { workers: 'in-app' }, Cursor: { workers: 'none' } }, message => sent.push(message));
  assert.deepEqual([...adapters.keys()], ['claude code', 'codex']);
  await deliver({ ...decision, worktree: '/work/tl-1' }, adapters.get('codex'));
  assert.deepEqual([sent[0].harness, sent[0].session, sent[0].worktree], ['Codex', 'worker-1', '/work/tl-1']);
});
