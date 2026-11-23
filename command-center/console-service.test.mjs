import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_DB_PATH, createConsoleService } from './console-service.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-console-'));
  const service = createConsoleService({ dbPath: join(directory, 'stories.db') });
  t.after(() => {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return service;
}

const base = { story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', worktree: '/wt/tl-1', harness: 'Codex' };
const find = (service, id) => service.snapshot().find(item => item.id === id);
const ask = { story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 };

test('createStory records a story in scout and returns a receipt', t => {
  const service = fixture(t);
  const receipt = service.createStory(base);
  assert.ok(receipt.seq);
  const story = find(service, 'tl-1');
  assert.equal(story.phase, 'scout');
  assert.equal(story.title, 'Add export');
  assert.equal(service.snapshot('Codex').length, 1);
});

test('a story keeps the repository it was created for, and one created without a repository has none', t => {
  const service = fixture(t);
  service.createStory({ ...base, repo: 'acme/orders' });
  service.createStory({ ...base, story: 'tl-2' });
  assert.deepEqual([find(service, 'tl-1').repo, find(service, 'tl-2').repo], ['acme/orders', undefined]);
  assert.throws(() => service.createStory({ ...base, story: 'tl-3', repo: ' ' }), /repository is required/);
});

test('createStory rejects missing story, title, or harness', t => {
  const service = fixture(t);
  for (const field of ['story', 'title', 'harness']) {
    assert.throws(() => service.createStory({ ...base, [field]: undefined }), undefined, field);
  }
  assert.equal(service.snapshot().length, 0);
});

test('createStory generates unique keys so two stories can be created', t => {
  const service = fixture(t);
  service.createStory(base);
  service.createStory({ ...base, story: 'tl-2' });
  assert.equal(service.snapshot().length, 2);
});

test('recordEvent auto-fills key and revision through question, answer, plan', t => {
  const service = fixture(t);
  service.createStory(base);
  service.recordEvent({ story: 'tl-1', type: 'handoff', detail: 'Context pack ready.' });
  service.recordEvent(ask);
  assert.throws(() => service.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Draft' }), /open questions/);
  service.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 'Selected' });
  const receipt = service.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Export selected rows.' });
  assert.ok(receipt.seq);
  assert.equal(find(service, 'tl-1').phase, 'approval');
});

test('recordEvent rejects a stale explicit revision', t => {
  const service = fixture(t);
  service.createStory(base);
  service.recordEvent(ask);
  assert.throws(
    () => service.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 'All', revision: 0 }),
    /Story changed/,
  );
});

test('pending and handover delegate to the store', t => {
  const service = fixture(t);
  service.createStory(base);
  assert.ok(Array.isArray(service.pending()));
  assert.equal(service.handover('tl-1').story.id, 'tl-1');
});

test('startServer serves html and /api/stories reflecting later events', async t => {
  const service = fixture(t);
  service.createStory(base);
  const { url, close } = await service.startServer(0);
  t.after(close);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /html/);
  const before = JSON.stringify(await (await fetch(url + 'api/stories')).json());
  assert.ok(before.includes('tl-1'));
  service.recordEvent(ask);
  const after = JSON.stringify(await (await fetch(url + 'api/stories')).json());
  assert.ok(after.includes('Which rows?'));
});

test('/events streams a story frame immediately and again after a new event', async t => {
  const service = fixture(t);
  service.createStory(base);
  const { url, close } = await service.startServer(0);
  const controller = new AbortController();
  t.after(() => { controller.abort(); return close(); });
  const response = await fetch(url + 'events', { signal: controller.signal });
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const reader = response.body.getReader();
  let text = '';
  const until = async pattern => {
    while (!pattern.test(text)) text += new TextDecoder().decode((await reader.read()).value);
  };
  await until(/"id":"tl-1"/);
  service.recordEvent(ask);
  await until(/Which rows\?/);
});

test('/api/decision accepts a same-origin human answer and rejects agent events or other origins', async t => {
  const service = fixture(t);
  service.createStory(base);
  service.recordEvent(ask);
  const { url, close } = await service.startServer(0);
  t.after(close);
  const origin = url.slice(0, -1);
  const post = (body, from = origin) => fetch(url + 'api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: from }, body: JSON.stringify(body),
  });
  assert.equal((await post({ story: 'tl-1', type: 'plan', detail: 'x' })).status, 403);
  assert.equal((await post({ story: 'tl-1', type: 'answer', question: 'scope', answer: 0 }, 'http://evil.test')).status, 403);
  assert.equal((await post({ story: 'tl-1', type: 'answer', question: 'scope', answer: 0 })).status, 200);
  assert.equal(find(service, 'tl-1').questions[0].answer, 'All');
});

test('console decisions wake the coordinator once per burst with the worker session', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ai-sdlc-console-'));
  const calls = [];
  const service = createConsoleService({ dbPath: join(directory, 'stories.db'), decisionDelayMs: 50, onDecision: call => calls.push(call) });
  t.after(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  service.createStory(base);
  service.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'worker-1' });
  service.recordEvent(ask);
  service.recordEvent({ ...ask, question: 'format', prompt: 'Which format?' });
  const { url, close } = await service.startServer(0);
  t.after(close);
  const post = body => fetch(url + 'api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: url.slice(0, -1) }, body: JSON.stringify(body),
  });
  await post({ story: 'tl-1', type: 'answer', question: 'scope', answer: 0 });
  await post({ story: 'tl-1', type: 'answer', question: 'format', answer: 1 });
  await new Promise(done => setTimeout(done, 150));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].story, 'tl-1');
  assert.equal(calls[0].seqs.length, 2);
  assert.deepEqual(calls[0].types, ['answer']);
  assert.equal(calls[0].session, 'worker-1');
});

// delivery-model.mjs: `serve.mjs deliver` overlapping the dashboard's own hand-off handed one answer twice.
test('overlapping deliveries hand each decision to the worker once', async t => {
  const handed = [];
  const directory = mkdtempSync(join(tmpdir(), 'console-deliver-'));
  const service = createConsoleService({
    dbPath: join(directory, 'stories.db'), decisionDelayMs: 5,
    onDecision: async decision => { handed.push(...decision.seqs); await new Promise(resolve => setTimeout(resolve, 50)); return 'worker'; },
  });
  t.after(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  service.createStory({ story: 'tl-1', title: 'T', detail: 'B', branch: 'b', worktree: '/w', harness: 'Codex' });
  service.recordEvent({ story: 'tl-1', type: 'question', question: 'q', prompt: 'Which?', options: ['a', 'b'], recommended: 0 });
  service.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'worker-1' });
  const answer = service.recordEvent({ story: 'tl-1', type: 'answer', question: 'q', answer: 0 });
  const [first, second] = await Promise.all([service.deliverPending('tl-1'), service.deliverPending('tl-1')]);
  assert.deepEqual(handed, [answer.seq]);
  assert.deepEqual([first.seqs, second.seqs], [[answer.seq], []]);
});

test('a decision that did not reach the worker is handed again on the next delivery', async t => {
  let told = 'coordinator';
  const handed = [];
  const directory = mkdtempSync(join(tmpdir(), 'console-deliver-'));
  const service = createConsoleService({ dbPath: join(directory, 'stories.db'), onDecision: async decision => { handed.push(...decision.seqs); return told; } });
  t.after(() => { service.close(); rmSync(directory, { recursive: true, force: true }); });
  service.createStory({ story: 'tl-1', title: 'T', detail: 'B', branch: 'b', worktree: '/w', harness: 'Codex' });
  service.recordEvent({ story: 'tl-1', type: 'question', question: 'q', prompt: 'Which?', options: ['a', 'b'], recommended: 0 });
  const answer = service.recordEvent({ story: 'tl-1', type: 'answer', question: 'q', answer: 0 });
  await service.deliverPending('tl-1');
  told = 'worker';
  await service.deliverPending('tl-1');
  await service.deliverPending('tl-1');
  assert.deepEqual(handed, [answer.seq, answer.seq]);
});

test('/api/attachment stores a same-origin screenshot per story, serves it, and rejects non-images or other origins', async t => {
  const service = fixture(t);
  service.createStory(base);
  const { url, close } = await service.startServer(0);
  t.after(close);
  const origin = url.slice(0, -1);
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);
  const upload = (body, { type = 'image/png', from = origin, story = 'tl-1' } = {}) => fetch(url + 'api/attachment?story=' + story, {
    method: 'POST', headers: { 'Content-Type': type, Origin: from }, body,
  });

  const saved = await upload(png);
  assert.equal(saved.status, 200);
  const receipt = await saved.json();
  assert.match(receipt.path, /tl-1[\\/][^\\/]+\.png$/);
  const served = await fetch(url + receipt.url.slice(1));
  assert.equal(served.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), png);
  assert.deepEqual(service.listAttachments('tl-1').map(file => file.path), [receipt.path]);

  assert.equal((await upload(Buffer.from('<script>'), { type: 'image/png' })).status, 400);
  assert.equal((await upload(png, { from: 'http://evil.test' })).status, 403);
  assert.equal((await upload(png, { story: 'missing' })).status, 404);
  assert.equal((await fetch(url + 'attachments/tl-1/..%2F..%2Fstories.db')).status, 404);
});

test('DEFAULT_DB_PATH points at jarvis-missions.sqlite', () => {
  assert.ok(DEFAULT_DB_PATH.endsWith('jarvis-missions.sqlite'));
});
