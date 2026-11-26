import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { waitForAny } from '../mission-console/watcher.mjs';
import { createConsoleService } from './console-service.mjs';
import { deliver, loadAdapters, requestDelivery, requestStart, start, testAuthorSections } from './serve.mjs';

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

const stale = () => Object.assign(new Error('The assignment changed before the message could be sent.'), { code: 'STALE_ASSIGNMENT' });

test('a decision handed to a worker is sent with a way to ask whether that worker is still the one assigned', async () => {
  const seen = [];
  const current = () => true;
  assert.equal(await deliver({ ...decision, current }, { messageWorker: async (message, options) => seen.push(options.current) }), 'worker');
  assert.deepEqual(seen, [current]);
});

test('a message that went stale is reported as stale, not as a failure to reach the worker', async () => {
  const told = [];
  const logged = [];
  const adapter = { messageWorker: async () => { throw stale(); }, wakeCoordinator: async message => told.push(message.prompt) };
  assert.equal(await deliver({ ...decision, current: () => false }, adapter, line => logged.push(line)), 'stale');
  assert.deepEqual([told, logged], [[], []], 'nobody was told the decision was undelivered; it is handed again');
});

test('an error that is not a stale assignment still sends the decision to Jarvis with its reason', async () => {
  const told = [];
  const adapter = { messageWorker: async () => { throw new Error('session closed'); }, wakeCoordinator: async message => told.push(message.prompt) };
  assert.equal(await deliver({ ...decision, current: () => true }, adapter), 'coordinator');
  assert.match(told[0], /could not be messaged \(session closed\)/);
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

test('an answer to a worker that released before asking is handed to the background Jarvis, then reaches the replacement it staffs', async t => {
  const dbPath = join(folder(t), 'stories.sqlite');
  const sent = [];
  const logged = t.mock.method(console, 'log', () => {});
  const launched = [];
  const center = await start({ port: 0, dbPath, launch: async input => { launched.push(input); return { session: 'jarvis-1' }; }, adapters: loadAdapters({ Codex: { workers: 'command-line' } }, message => sent.push(message)) });
  const jarvisConnection = createConsoleService({ dbPath });
  const port = Number(new URL(center.url).port);
  const heard = after => waitForAny(jarvisConnection.store, { after, seconds: 0 });
  try {
    jarvisConnection.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', harness: 'Codex', worktree: '/work/tl-1' });
    jarvisConnection.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'worker-1' });
    const assignment = jarvisConnection.snapshot()[0].worker.id;
    jarvisConnection.recordEvent({ story: 'tl-1', type: 'release-worker', assignment, detail: 'Stopped at a blocker.' });
    const question = jarvisConnection.recordEvent({ story: 'tl-1', type: 'question', question: 'bash', prompt: 'Repair Bash?', options: ['Yes', 'Hold'], recommended: 0 });
    const answer = jarvisConnection.recordEvent({ story: 'tl-1', type: 'answer', question: 'bash', answer: 0 });

    assert.deepEqual(await requestDelivery('tl-1', port), { story: 'tl-1', seqs: [answer.seq], told: 'nobody',
      reason: 'No worker is assigned to tl-1, so no worker was told; the decisions stay pending. Staff the phase, then deliver.' });
    assert.equal(sent.length, 0);
    assert.ok(!logged.mock.calls.some(call => /no worker is assigned/.test(call.arguments[0])), 'an answer with no worker is no longer only logged');
    assert.deepEqual((await heard(question.seq)).map(event => [event.type, event.seq]), [['answer', answer.seq]], 'Jarvis hears the answer nobody could take');

    jarvisConnection.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'worker-2' });
    assert.deepEqual(await requestDelivery('tl-1', port), { story: 'tl-1', seqs: [answer.seq], told: 'worker' });
    assert.deepEqual([sent.length, sent[0].harness, sent[0].session], [1, 'Codex', 'worker-2']);
    assert.match(sent[0].prompt, new RegExp('answer on story tl-1 \\(event seq ' + answer.seq + '\\)'));
    assert.deepEqual(await heard(question.seq), [], 'the replacement has the answer, so it is no longer news for Jarvis');
  } finally {
    jarvisConnection.close();
    await center.close();
  }
});

function racing(directory) {
  const dbPath = join(directory, 'stories.sqlite');
  const attempts = [];
  const gates = [];
  const launched = [];
  const send = async (message, options) => {
    const attempt = { session: message.session, phase: message.phase, asked: Boolean(options?.current) };
    attempts.push(attempt);
    const gate = gates.shift();
    if (gate) await gate;
    if (options?.current && !options.current()) {
      attempt.outcome = 'stale';
      throw stale();
    }
    attempt.outcome = 'delivered';
  };
  const hold = () => {
    let open;
    gates.push(new Promise(resolve => { open = resolve; }));
    return open;
  };
  const adapters = loadAdapters({ Codex: { workers: 'command-line' } }, send);
  const launch = async input => {
    launched.push(input);
    return { session: 'jarvis-1' };
  };
  const waitFor = async (what, check) => {
    for (let waited = 0; !check(); waited += 20) {
      if (waited > 8000) throw new Error('Timed out waiting for ' + what + '.');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  };
  return { dbPath, attempts, launched, hold, adapters, launch, waitFor };
}

async function midTurn(t, session = 'worker-1') {
  const directory = mkdtempSync(join(tmpdir(), 'factory-serve-'));
  const race = racing(directory);
  const center = await start({ port: 0, dbPath: race.dbPath, launch: race.launch, adapters: race.adapters, quietMs: 60000 });
  const recorder = createConsoleService({ dbPath: race.dbPath });
  t.after(async () => {
    recorder.close();
    await center.close();
    rmSync(directory, { recursive: true, force: true });
  });
  recorder.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', harness: 'Codex', worktree: '/work/tl-1' });
  recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session });
  recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
  const swap = next => {
    recorder.recordEvent({ story: 'tl-1', type: 'release-worker', assignment: recorder.snapshot()[0].worker.id, detail: 'Finished.' });
    if (next) recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: next });
  };
  return { ...race, recorder, swap, port: Number(new URL(center.url).port), assigned: () => recorder.snapshot()[0].worker?.id };
}

test('an answer recorded while a worker is mid-turn goes to the worker assigned when the wait ends, not to the one that released', async t => {
  const mid = await midTurn(t);
  const open = mid.hold();
  const answer = mid.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 1 });
  const delivery = requestDelivery('tl-1', mid.port);
  await mid.waitFor('the message to the first worker to wait', () => mid.attempts.length === 1);
  mid.swap('worker-2');
  open();
  assert.deepEqual(await delivery, { story: 'tl-1', seqs: [answer.seq], told: 'worker' });
  assert.deepEqual(mid.attempts.map(attempt => [attempt.session, attempt.outcome]), [['worker-1', 'stale'], ['worker-2', 'delivered']]);
  assert.deepEqual(mid.launched, [], 'a worker took the answer, so Jarvis was not woken');
});

test('an answer is handed on again when its replacement also released before the wait ended, and a delivery request meanwhile gets nothing', async t => {
  const mid = await midTurn(t);
  const first = mid.hold();
  const second = mid.hold();
  const answer = mid.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 1 });
  const delivery = requestDelivery('tl-1', mid.port);
  await mid.waitFor('the first message to wait', () => mid.attempts.length === 1);
  mid.swap('worker-2');
  first();
  await mid.waitFor('the second message to wait', () => mid.attempts.length === 2);
  assert.deepEqual((await requestDelivery('tl-1', mid.port)).seqs, [], 'the answer is still reserved while it is handed again');
  mid.swap('worker-3');
  second();
  assert.deepEqual(await delivery, { story: 'tl-1', seqs: [answer.seq], told: 'worker' });
  assert.deepEqual(mid.attempts.map(attempt => [attempt.session, attempt.outcome]), [['worker-1', 'stale'], ['worker-2', 'stale'], ['worker-3', 'delivered']]);
});

test('a new assignment that reuses the released session still counts as a change', async t => {
  const mid = await midTurn(t, 'shared-session');
  const open = mid.hold();
  mid.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 1 });
  const first = mid.assigned();
  const delivery = requestDelivery('tl-1', mid.port);
  await mid.waitFor('the message to wait', () => mid.attempts.length === 1);
  mid.swap('shared-session');
  assert.notEqual(mid.assigned(), first);
  open();
  assert.equal((await delivery).told, 'worker');
  assert.deepEqual(mid.attempts.map(attempt => [attempt.asked, attempt.outcome]), [[true, 'stale'], [true, 'delivered']]);
});

test('an answer to a worker still assigned when the wait ends is delivered once, to that worker', async t => {
  const mid = await midTurn(t);
  const open = mid.hold();
  const answer = mid.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 1 });
  const delivery = requestDelivery('tl-1', mid.port);
  await mid.waitFor('the message to wait', () => mid.attempts.length === 1);
  open();
  assert.deepEqual(await delivery, { story: 'tl-1', seqs: [answer.seq], told: 'worker' });
  assert.deepEqual(mid.attempts.map(attempt => [attempt.session, attempt.asked, attempt.outcome]), [['worker-1', true, 'delivered']]);
});

test('each command-line harness in the table gets an adapter, found by the name stories record', async () => {
  const sent = [];
  const adapters = loadAdapters({ 'Claude Code': { workers: 'command-line' }, Codex: { workers: 'command-line' }, 'GitHub Copilot app': { workers: 'in-app' }, Cursor: { workers: 'none' } }, message => sent.push(message));
  assert.deepEqual([...adapters.keys()], ['claude code', 'codex']);
  await deliver({ ...decision, worktree: '/work/tl-1', phase: 'planning' }, adapters.get('codex'));
  assert.deepEqual([sent[0].harness, sent[0].session, sent[0].worktree, sent[0].phase], ['Codex', 'worker-1', '/work/tl-1', 'planning']);
});

function approvedFixture(t, harness = 'Codex') {
  const directory = mkdtempSync(join(tmpdir(), 'factory-approved-'));
  const dbPath = join(directory, 'stories.sqlite');
  const recorder = createConsoleService({ dbPath });
  let center;
  const close = async () => { await center?.close(); center = undefined; };
  t.after(async () => {
    await close();
    recorder.close();
    rmSync(directory, { recursive: true, force: true });
  });
  recorder.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export selected rows.', branch: 'tl-1', harness, worktree: directory });
  recorder.recordEvent({ story: 'tl-1', type: 'handoff', detail: 'Context pack ready.' });
  recorder.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Export selected rows; keep unselected rows private.' });
  return { directory, dbPath, recorder, close, story: () => recorder.snapshot()[0], start: async options => (center = await start({ port: 0, dbPath, ...options })) };
}

test('approving a plan with no assigned planner starts a Codex test worker from the approved handover', async t => {
  const { start: open, recorder, story } = approvedFixture(t);
  const launched = [];
  const center = await open({ launch: async input => { launched.push(input); return { session: 'test-author' }; } });
  const response = await fetch(center.url + 'api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: center.url.slice(0, -1) },
    body: JSON.stringify({ story: 'tl-1', type: 'approve', revision: story().revision }),
  });
  assert.equal(response.status, 200);
  await requestDelivery('tl-1', Number(new URL(center.url).port));
  assert.equal(launched.length, 1);
  assert.deepEqual([launched[0].harness, launched[0].phase, launched[0].worktree], ['Codex', 'testing', story().worktree]);
  assert.match(launched[0].prompt, /Bruce Banner/);
  assert.match(launched[0].prompt, /Export selected rows; keep unselected rows private/);
  assert.match(launched[0].prompt, /tests and necessary fixtures only/);
  assert.equal(story().worker.role, 'tester');
  assert.equal(story().worker.session, 'test-author');
  assert.ok(recorder.pending().some(event => event.type === 'approve'), 'delivery does not acknowledge work for the agent');
  await requestDelivery('tl-1', Number(new URL(center.url).port));
  assert.equal(launched.length, 1);
});

test('the test author reads only the test-first and Gates sections, the spec for the context pack, and its handover', async t => {
  const { start: open, recorder, story, directory } = approvedFixture(t);
  const pack = join(directory, 'context-pack.md');
  writeFileSync(pack, '# Context pack');
  recorder.recordEvent({ story: 'tl-1', type: 'artifact', kind: 'document', path: pack, detail: 'Context pack from the scout.' });
  const launched = [];
  const center = await open({ launch: async input => { launched.push(input); return { session: 'test-author' }; } });
  await fetch(center.url + 'api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: center.url.slice(0, -1) },
    body: JSON.stringify({ story: 'tl-1', type: 'approve', revision: story().revision }),
  });
  await requestDelivery('tl-1', Number(new URL(center.url).port));
  const kickoff = launched[0].prompt;
  assert.doesNotMatch(kickoff, /Read completely/);
  assert.match(kickoff, /ai-sdlc[\\/]SKILL\.md/);
  assert.match(kickoff, /2\. Test-first handoff/);
  assert.match(kickoff, /\bGates\b/);
  assert.match(kickoff, /the spec contains the context pack/);
  assert.doesNotMatch(kickoff, /registered context pack/i);
  assert.doesNotMatch(kickoff, /Registered context/);
  assert.doesNotMatch(kickoff, /Context pack from the scout/, 'the registered artifact list is not inlined');
  assert.match(kickoff, /Approved plan \(use only if the spec file is missing\):\n.*Export selected rows; keep unselected rows private/);
  assert.match(kickoff, /If missing, record and commit the approved spec/);
  assert.match(kickoff, /Read this story's handover/);
  assert.doesNotMatch(kickoff, /snapshot/i);
  assert.match(kickoff, /tests and necessary fixtures only/i);
});

test('the ai-sdlc skill keeps the two sections the test author is sent to, as whole heading lines', () => {
  const lines = readFileSync(new URL('../skills/ai-sdlc/SKILL.md', import.meta.url), 'utf8').split(/\r?\n/);
  assert.ok(lines.includes('## 2. Test-first handoff'), 'heading "## 2. Test-first handoff" is missing');
  assert.ok(lines.includes('## Gates'), 'heading "## Gates" is missing');
});

test('every section the test author is sent to is a whole heading in the ai-sdlc skill and is quoted in its kickoff', async t => {
  const lines = readFileSync(new URL('../skills/ai-sdlc/SKILL.md', import.meta.url), 'utf8').split(/\r?\n/);
  const { start: open, story } = approvedFixture(t);
  const launched = [];
  const center = await open({ launch: async input => { launched.push(input); return { session: 'test-author' }; } });
  await fetch(center.url + 'api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: center.url.slice(0, -1) },
    body: JSON.stringify({ story: 'tl-1', type: 'approve', revision: story().revision }),
  });
  await requestDelivery('tl-1', Number(new URL(center.url).port));
  assert.ok(testAuthorSections.length > 0);
  for (const name of testAuthorSections) {
    assert.ok(lines.includes('## ' + name), 'heading "## ' + name + '" is missing');
    assert.ok(launched[0].prompt.includes('"' + name + '"'), 'the kickoff does not name "' + name + '"');
  }
});

test('an approval already pending when the daemon restarts starts its missing test worker', async t => {
  const { start: open, recorder, story } = approvedFixture(t);
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  const launched = [];
  await open({ launch: async input => { launched.push(input); return { session: 'recovered-tester' }; } });
  for (let attempt = 0; !story().worker && attempt < 50; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(launched.length, 1);
  assert.equal(story().worker.session, 'recovered-tester');
});

test('an unlaunchable approved test worker leaves its decision pending and shows the failure on the story', async t => {
  const { start: open, recorder, story } = approvedFixture(t);
  const center = await open({ launch: async () => { throw new Error('Harness sign-in expired.'); } });
  const approval = recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  assert.equal((await requestDelivery('tl-1', Number(new URL(center.url).port))).told, 'nobody');
  assert.equal(story().worker, undefined);
  assert.match(story().blocked, /Bruce Banner.*Harness sign-in expired/s);
  assert.ok(recorder.pending().some(event => event.seq === approval.seq));
});

test('ordinary answers without a worker cannot start tests without plan approval', async t => {
  const { start: open, recorder } = approvedFixture(t);
  recorder.recordEvent({ story: 'tl-1', type: 'replan', detail: 'One more decision.' });
  recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 1 });
  recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 1 });
  let launched = 0;
  const center = await open({ launch: async input => { if (input.phase === 'testing') launched += 1; return { session: 'wrong' }; } });
  const reply = await requestDelivery('tl-1', Number(new URL(center.url).port));
  assert.equal(reply.told, 'nobody', 'no worker is assigned, so nobody was told');
  assert.match(reply.reason, /^No worker is assigned to tl-1, so no worker was told; the decisions stay pending./);
  assert.equal(launched, 0);
});

test('restart refuses another launch when the previous approved start has no recorded outcome', async t => {
  const { start: open, recorder, story } = approvedFixture(t);
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  recorder.recordEvent({ story: 'tl-1', type: 'activity', detail: 'Starting an independent Bruce Banner session after plan approval.' });
  for (let index = 0; index < 45; index += 1) recorder.recordEvent({ story: 'tl-1', type: 'activity', detail: 'Recorded progress ' + index });
  assert.equal(story().events.length, 40);
  let launched = 0;
  await open({ launch: async () => { launched += 1; return { session: 'duplicate' }; } });
  for (let attempt = 0; !story().blocked && attempt < 50; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(launched, 0);
  assert.match(story().blocked, /earlier start was interrupted.*Verify its worker process/s);
});

test('a blocked approved story is not automatically retried at startup', async t => {
  const { start: open, recorder, story } = approvedFixture(t);
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  recorder.recordEvent({ story: 'tl-1', type: 'blocked', detail: 'Worker capacity unavailable.' });
  let launched = 0;
  const center = await open({ launch: async () => { launched += 1; return { session: 'wrong' }; } });
  await requestDelivery('tl-1', Number(new URL(center.url).port));
  assert.equal(launched, 0);
  assert.equal(story().blocked, 'Worker capacity unavailable.');
});

test('test dispatch preserves a Claude Code story rather than choosing an installed alternative', async t => {
  const { start: open, recorder, story } = approvedFixture(t, 'Claude Code');
  const launched = [];
  const center = await open({ launch: async input => { launched.push(input); return { session: 'claude-tester' }; } });
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  await requestDelivery('tl-1', Number(new URL(center.url).port));
  assert.equal(launched[0].harness, 'Claude Code');
  assert.equal(story().harness, 'Claude Code');
});

test('an explicit resume after a diagnosed launch failure permits a verified retry', async t => {
  const { start: open, recorder, story } = approvedFixture(t);
  let launched = 0;
  const center = await open({ launch: async () => {
    launched += 1;
    if (launched === 1) throw new Error('Capacity unavailable.');
    return { session: 'tester-after-resume' };
  } });
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  const port = Number(new URL(center.url).port);
  await requestDelivery('tl-1', port);
  assert.match(story().blocked, /Capacity unavailable/);
  recorder.recordEvent({ story: 'tl-1', type: 'resume', detail: 'Capacity restored; prior process verified exited.' });
  assert.equal((await requestDelivery('tl-1', port)).told, 'worker');
  assert.equal(launched, 2);
  assert.equal(story().worker.session, 'tester-after-resume');
});

test('overlapping manual and approval starts launch only one worker in the story worktree', async t => {
  const { start: open, recorder, story } = approvedFixture(t);
  let unblock;
  const held = new Promise(resolve => { unblock = resolve; });
  let launched = 0;
  const center = await open({ launch: async () => { launched += 1; await held; return { session: 'only-tester' }; } });
  const port = Number(new URL(center.url).port);
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  const automatic = requestDelivery('tl-1', port);
  const manual = requestStart('tl-1', 'Use the approved plan.', port);
  const results = Promise.allSettled([automatic, manual]);
  await new Promise(resolve => setTimeout(resolve, 50));
  unblock();
  await results;
  assert.equal(launched, 1);
  assert.equal(story().worker.session, 'only-tester');
});

test('a manual-first overlap still carries the approved test contract and durable start intent', async t => {
  const { start: open, recorder } = approvedFixture(t);
  let unblock;
  let entered;
  const held = new Promise(resolve => { unblock = resolve; });
  const launching = new Promise(resolve => { entered = resolve; });
  const launched = [];
  const center = await open({ launch: async input => { launched.push(input); entered(); await held; return { session: 'only-tester' }; } });
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  const port = Number(new URL(center.url).port);
  const manual = requestStart('tl-1', 'Reconcile the failed turn before adding missing pagination tests.', port);
  await launching;
  const automatic = requestDelivery('tl-1', port);
  unblock();
  await Promise.all([manual, automatic]);
  assert.equal(launched.length, 1);
  assert.match(launched[0].prompt, /Export selected rows; keep unselected rows private/);
  assert.match(launched[0].prompt, /tests and necessary fixtures only/);
  assert.match(launched[0].prompt, /Additional coordinator handoff \(within the approved tests-only boundary/);
  assert.match(launched[0].prompt, /Reconcile the failed turn before adding missing pagination tests/);
  assert.ok(recorder.store.history('tl-1').some(event => event.detail.startsWith('Starting an independent Bruce Banner session')));
});

test('a manual handoff arriving after automatic startup begins is explicitly refused rather than silently lost', async t => {
  const { start: open, recorder } = approvedFixture(t);
  let unblock;
  let entered;
  const held = new Promise(resolve => { unblock = resolve; });
  const launching = new Promise(resolve => { entered = resolve; });
  const center = await open({ launch: async () => { entered(); await held; return { session: 'tester' }; } });
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  const port = Number(new URL(center.url).port);
  const automatic = requestDelivery('tl-1', port);
  await launching;
  await assert.rejects(requestStart('tl-1', 'Additional remediation details.', port), /already in progress.*deliver additional instructions/);
  unblock();
  assert.equal((await automatic).told, 'worker');
});

test('a worker receives the absolute database path even when the daemon was configured with a relative one', async t => {
  const { dbPath, start: open, recorder } = approvedFixture(t);
  const launched = [];
  const center = await open({ dbPath: relative(process.cwd(), dbPath), launch: async input => { launched.push(input); return { session: 'tester' }; } });
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  await requestDelivery('tl-1', Number(new URL(center.url).port));
  assert.ok(launched[0].prompt.includes('Console database: ' + dbPath));
});

test('an unacknowledged approval is not launched again after its test worker was assigned and released', async t => {
  const { dbPath, start: open, close, recorder, story } = approvedFixture(t);
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  const first = await open({ launch: async () => ({ session: 'first-tester' }) });
  for (let attempt = 0; !story().worker && attempt < 50; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
  recorder.recordEvent({ story: 'tl-1', type: 'release-worker', assignment: story().worker.id, detail: 'No longer writing; handoff requires reconciliation.' });
  await close();
  let launches = 0;
  const second = await start({ port: 0, dbPath, launch: async () => { launches += 1; return { session: 'duplicate' }; } });
  try {
    for (let attempt = 0; !story().blocked && attempt < 50; attempt += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(launches, 0);
    assert.match(story().blocked, /approval already started a test worker/);
  } finally {
    await second.close();
  }
});

test('a released planner wait uses the current approved plan and worktree when it finally launches', async t => {
  const { directory, start: open, recorder } = approvedFixture(t);
  const planner = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 500)'], { stdio: 'ignore' });
  t.after(() => planner.kill());
  recorder.recordEvent({ story: 'tl-1', type: 'replan', detail: 'Prepare the planner turn.' });
  recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'planner' });
  const assignment = recorder.snapshot()[0].worker.id;
  recorder.recordEvent({ story: 'tl-1', type: 'turn-started', assignment, pid: planner.pid, log: join(directory, 'planner.log') });
  recorder.recordEvent({ story: 'tl-1', type: 'release-worker', assignment, detail: 'Planner is finishing.' });
  recorder.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Superseded plan.' });
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  const launched = [];
  const center = await open({ launch: async input => { launched.push(input); return { session: 'current-tester' }; } });
  const currentWorktree = join(directory, 'current');
  mkdirSync(currentWorktree);
  recorder.recordEvent({ story: 'tl-1', type: 'assign-worktree', branch: 'updated-branch', worktree: currentWorktree });
  recorder.recordEvent({ story: 'tl-1', type: 'replan', detail: 'Correct the plan while the released process finishes.' });
  recorder.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Current approved behavior.' });
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  await requestDelivery('tl-1', Number(new URL(center.url).port));
  assert.equal(launched.length, 1);
  assert.equal(launched[0].worktree, currentWorktree);
  assert.match(launched[0].prompt, /Current approved behavior/);
  assert.ok(launched[0].prompt.includes(currentWorktree));
  assert.ok(!launched[0].prompt.includes('Superseded plan.'));
});

test('a start for a story whose worker is mid-turn is refused at once, without waiting for the turn', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-busy-'));
  const dbPath = join(directory, 'stories.sqlite');
  const recorder = createConsoleService({ dbPath });
  recorder.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export selected rows.', branch: 'tl-1', harness: 'Claude Code', worktree: directory });
  let endTurn;
  const ended = new Promise(resolve => { endTurn = resolve; });
  const center = await start({ port: 0, dbPath, launch: async (input, options) => {
    options.onTurn({ session: 'scout', pid: process.pid, log: join(directory, 'scout.log'), ended });
    return { session: 'scout' };
  } });
  t.after(async () => {
    endTurn(0);
    await center.close();
    recorder.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const port = Number(new URL(center.url).port);
  await requestStart('tl-1', 'Scout the repository.', port);
  assert.ok(recorder.snapshot()[0].worker.turn);
  const refusal = requestStart('tl-1', 'Scout again.', port).then(() => 'started', error => error.message);
  const waited = new Promise(resolve => setTimeout(() => resolve('still waiting'), 3000));
  assert.match(await Promise.race([refusal, waited]), /already has a worker/);
  await assert.rejects(requestStart('tl-1', 'Scout a third time.', port), /already has a worker/);
});

test('a manual test start that fails to launch shows the failure on the story, and a resume permits the retry', async t => {
  const { start: open, recorder, story } = approvedFixture(t, 'Claude Code');
  let launched = 0;
  const center = await open({ launch: async () => {
    launched += 1;
    if (launched === 1) throw new Error('Not signed in.');
    return { session: 'tester-after-sign-in' };
  } });
  const port = Number(new URL(center.url).port);
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  await assert.rejects(requestStart('tl-1', 'Write the tests.', port), /Not signed in/);
  assert.match(story().blocked, /Not signed in/);
  await assert.rejects(requestStart('tl-1', 'Write the tests.', port), /Resolve the story blocker/);
  recorder.recordEvent({ story: 'tl-1', type: 'resume', detail: 'Signed in; no worker process was left running.' });
  await requestStart('tl-1', 'Write the tests.', port);
  assert.equal(launched, 2);
  assert.equal(story().worker.session, 'tester-after-sign-in');
});

test('a manual start after the approved test worker was assigned carries only the coordinator prompt', async t => {
  const { start: open, recorder, story } = approvedFixture(t, 'Claude Code');
  const launched = [];
  const center = await open({ launch: async input => { launched.push(input); return { session: 'tester-' + launched.length }; } });
  const port = Number(new URL(center.url).port);
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  await requestDelivery('tl-1', port);
  assert.match(launched[0].prompt, /independent test author/);
  recorder.recordEvent({ story: 'tl-1', type: 'release-worker', assignment: story().worker.id, detail: 'Tests written.' });
  await requestStart('tl-1', 'Strengthen the export test to kill the surviving mutant.', port);
  assert.equal(launched[1].prompt, 'Strengthen the export test to kill the surviving mutant.');
  assert.equal(story().worker.session, 'tester-2');
  assert.equal(recorder.store.history('tl-1').filter(event => event.type === 'activity' && /Starting an independent/.test(event.detail)).length, 1);
});

test('a story in publishing gets a worker from a manual start, assigned as Hawkeye and launched in the publishing phase', async t => {
  const { start: open, recorder, story } = approvedFixture(t, 'Claude Code');
  recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  for (const [type, extra] of [['handoff', {}], ['handoff', { command: 'node --test' }], ['handoff', { command: 'node --test' }], ['handoff', { command: 'node --test' }],
    ['handoff', { command: 'none: no mutation gate' }], ['handoff', {}], ['comparison-choice', { run: false }]]) {
    recorder.recordEvent({ story: 'tl-1', type, detail: 'Phase work done.', ...extra });
  }
  for (const event of recorder.pending()) recorder.ack(event.seq);
  assert.equal(story().phase, 'publishing');
  const launched = [];
  const center = await open({ launch: async input => { launched.push(input); return { session: 'publisher-1' }; } });
  await requestStart('tl-1', 'Run Publishing in phase 8 of ai-sdlc.', Number(new URL(center.url).port));
  assert.deepEqual([launched.length, launched[0].phase, launched[0].worktree], [1, 'publishing', story().worktree]);
  assert.equal(story().worker.role, 'watcher');
  assert.equal(story().worker.session, 'publisher-1');
});
