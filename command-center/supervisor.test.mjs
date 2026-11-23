import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createConsoleService } from './console-service.mjs';
import { requestStart, start } from './serve.mjs';
import { createSupervisor, isAlive, turnVerdict } from './supervisor.mjs';

// The tests choose the verdict themselves, so they hold whatever policy `turnVerdict` settles on.
const byCode = ({ code }) => (code === 0 ? { outcome: 'ended', wake: false } : { outcome: code === null ? 'lost' : 'failed', wake: true });

test('a finished turn wakes Jarvis only when it failed or the worker said nothing', () => {
  const verdict = (code, recorded) => turnVerdict({ code, recorded, adopted: code === null });
  assert.deepEqual(verdict(0, 2), { outcome: 'ended', wake: false }, 'the worker\'s own events already told Jarvis');
  assert.deepEqual(verdict(0, 0), { outcome: 'ended', wake: true }, 'a clean exit with nothing recorded needs a look');
  assert.deepEqual(verdict(1, 0), { outcome: 'failed', wake: true });
  assert.deepEqual(verdict(3, 4), { outcome: 'failed', wake: true }, 'a failure after progress is still a failure');
  assert.deepEqual(verdict(null, 1), { outcome: 'ended', wake: false }, 'it reported before its process went away');
  assert.deepEqual(verdict(null, 0), { outcome: 'lost', wake: true });
});

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'factory-supervisor-'));
  const service = createConsoleService({ dbPath: join(directory, 'stories.db') });
  t.after(() => {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  });
  service.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', worktree: directory, harness: 'Codex' });
  service.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'worker-1' });
  const logged = [];
  const supervisor = createSupervisor({ service, verdict: byCode, log: line => logged.push(line), ...options });
  const story = () => service.snapshot().find(item => item.id === 'tl-1');
  return { service, supervisor, story, logged, directory };
}

// A turn whose end the test decides.
function turn(pid = 4242) {
  let end;
  const ended = new Promise(resolve => { end = resolve; });
  return { story: 'tl-1', pid, log: '/logs/worker-1.log', ended, end: async code => { end(code); await ended; await null; } };
}

test('a turn the daemon starts is recorded with its process, and its failure wakes Jarvis', async t => {
  const { service, supervisor, story } = fixture(t);
  const running = turn();
  supervisor.track(running);
  assert.deepEqual([story().worker.turn.pid, story().worker.turn.log], [4242, '/logs/worker-1.log']);
  assert.ok(!service.pending().some(event => event.type === 'turn-started'), 'a turn starting is not news');

  await running.end(3);
  assert.equal(story().worker.turn, undefined);
  assert.deepEqual([story().worker.lastTurn.outcome, story().worker.lastTurn.code], ['failed', 3]);
  const wake = service.pending().find(event => event.type === 'turn-ended');
  assert.match(wake.detail, /Worker turn failed \(exit code 3\)[\s\S]*See \/logs\/worker-1\.log/);
});

test('a turn that ends cleanly is recorded without waking anyone, and the next turn can start', async t => {
  const { service, supervisor, story } = fixture(t);
  const first = turn(100);
  supervisor.track(first);
  await first.end(0);
  assert.equal(story().worker.lastTurn.outcome, 'ended');
  assert.ok(!service.pending().some(event => event.type === 'turn-ended'));

  supervisor.track(turn(101));
  assert.equal(story().worker.turn.pid, 101);
});

test('the verdict is told how much the worker recorded during the turn', async t => {
  const seen = [];
  const { service, supervisor, story } = fixture(t, { verdict: input => { seen.push(input); return { outcome: 'ended', wake: false }; } });
  const running = turn();
  supervisor.track(running);
  service.recordEvent({ story: 'tl-1', type: 'activity', assignment: story().worker.id, detail: 'Mapped the export query.' });
  service.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
  // The owner's answer is not the worker's doing.
  service.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 0 });
  await running.end(0);
  assert.deepEqual(seen, [{ code: 0, recorded: 2, adopted: false }]);
});

test('a turn left by an earlier daemon is checked by its process: running is left alone, gone is recorded', t => {
  const living = new Set([7001]);
  const seen = [];
  const { service, supervisor, story } = fixture(t, {
    alive: pid => living.has(pid), bootedAt: 0,
    verdict: input => { seen.push(input); return { outcome: 'lost', wake: true }; },
  });
  service.recordEvent({ story: 'tl-1', type: 'turn-started', assignment: story().worker.id, pid: 7001, log: '/logs/old.log' });

  supervisor.sweep();
  assert.equal(story().worker.turn.pid, 7001);

  living.clear();
  supervisor.sweep();
  assert.equal(story().worker.lastTurn.outcome, 'lost');
  assert.deepEqual(seen, [{ code: null, recorded: 0, adopted: true }]);
  assert.match(service.pending().find(event => event.type === 'turn-ended').detail, /how it ended is not known/);
  supervisor.sweep();
  assert.equal(seen.length, 1, 'a turn is finished once');
});

// delivery-model.mjs: after a restart, a message started a second turn beside the one the earlier daemon left.
test('a message waits until the turn left by an earlier daemon has ended', async t => {
  const living = new Set([7003]);
  const { service, supervisor, story } = fixture(t, { alive: pid => living.has(pid), bootedAt: 0 });
  service.recordEvent({ story: 'tl-1', type: 'turn-started', assignment: story().worker.id, pid: 7003, log: '/logs/old.log' });
  let idle = false;
  const waiting = supervisor.idle('tl-1', 5).then(() => { idle = true; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(idle, false);
  living.clear();
  await waiting;
  assert.equal(idle, true);
});

test('stopping the daemon ends a wait for an earlier daemon\'s turn', async t => {
  const { service, supervisor, story } = fixture(t, { alive: () => true, bootedAt: 0 });
  service.recordEvent({ story: 'tl-1', type: 'turn-started', assignment: story().worker.id, pid: 7004, log: '/logs/old.log' });
  const stop = supervisor.start(60000);
  const waiting = supervisor.idle('tl-1', 5);
  await new Promise(resolve => setTimeout(resolve, 20));
  stop();
  await assert.rejects(waiting, /stopped before the earlier turn ended/);
});

test('a story with no turn left by an earlier daemon is idle at once', async t => {
  const { supervisor } = fixture(t, { alive: () => true, bootedAt: 0 });
  await supervisor.idle('tl-1');
  await supervisor.idle('no-such-story');
});

test('a turn recorded before the machine last started is gone, whatever process has its ID now', t => {
  const { service, supervisor, story } = fixture(t, { alive: () => true, bootedAt: Date.now() + 60000 });
  service.recordEvent({ story: 'tl-1', type: 'turn-started', assignment: story().worker.id, pid: 7002, log: '/logs/old.log' });
  supervisor.sweep();
  assert.equal(story().worker.lastTurn.outcome, 'lost');
});

test('a turn the daemon is still waiting on is not swept, and one whose worker was released is dropped', async t => {
  const { service, supervisor, story, logged } = fixture(t, { alive: () => false, bootedAt: 0 });
  const running = turn();
  supervisor.track(running);
  supervisor.sweep();
  assert.equal(story().worker.turn.pid, 4242, 'the daemon hears this one end itself');

  service.recordEvent({ story: 'tl-1', type: 'release-worker', assignment: story().worker.id, detail: 'Stopped by the owner.' });
  await running.end(1);
  assert.equal(story().worker, undefined);
  assert.deepEqual(logged, []);
});

test('a turn that cannot be recorded is reported and not watched', t => {
  const { service, supervisor, story, logged } = fixture(t);
  service.recordEvent({ story: 'tl-1', type: 'release-worker', assignment: story().worker.id, detail: 'Released.' });
  supervisor.track(turn());
  assert.match(logged[0], /tl-1 is running but could not be recorded \(no worker is assigned\)/);
});

test('this process is alive, and a process that has exited is not', async () => {
  assert.equal(isAlive(process.pid), true);
  const child = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(resolve => child.once('close', resolve));
  assert.equal(isAlive(child.pid), false);
});

// Stands in for the harness table's start call with a real program, so a real exit code comes back.
const launchReal = script => async ({ worktree }, { onTurn }) => {
  const child = spawn(process.execPath, ['-e', script], { cwd: worktree, stdio: 'ignore' });
  const ended = new Promise(resolve => child.once('close', code => resolve(code)));
  onTurn({ session: 'session-9', pid: child.pid, log: join(worktree, 'turn.log'), ended });
  return { session: 'session-9', log: join(worktree, 'turn.log') };
};

test('the daemon starts a story worker, assigns it, and records the turn its program ends', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-daemon-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'stories.sqlite');
  const center = await start({ port: 0, dbPath, launch: launchReal('setTimeout(() => process.exit(0), 150)') });
  const recorder = createConsoleService({ dbPath });
  const port = Number(new URL(center.url).port);
  const story = () => recorder.snapshot().find(item => item.id === 'tl-1');
  try {
    await assert.rejects(requestStart('tl-1', 'kickoff', port), /Story does not exist/);
    recorder.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', worktree: join(directory, 'missing'), harness: 'Codex' });
    await assert.rejects(requestStart('tl-1', 'kickoff', port), /worktree .*missing does not exist/);
    recorder.recordEvent({ story: 'tl-1', type: 'assign-worktree', branch: 'tl-1', worktree: directory });
    await assert.rejects(requestStart('tl-1', ' ', port), /Send the kickoff prompt/);

    assert.deepEqual(await requestStart('tl-1', 'kickoff', port), { session: 'session-9', log: join(directory, 'turn.log') });
    assert.equal(story().worker.session, 'session-9');
    assert.ok(story().worker.turn.pid > 0);
    await assert.rejects(requestStart('tl-1', 'kickoff', port), /already has a worker/);

    for (let waited = 0; story().worker.turn && waited < 5000; waited += 50) await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(story().worker.lastTurn.code, 0);
    assert.ok(story().events.some(event => event.type === 'turn-ended'));
  } finally {
    recorder.close();
    await center.close();
  }
});

test('a worker whose program cannot be started is refused with the reason, and nothing is assigned', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-daemon-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'stories.sqlite');
  const center = await start({ port: 0, dbPath, launch: async () => { throw new Error('Codex ended its turn at once with an error (exit code 1).'); } });
  const recorder = createConsoleService({ dbPath });
  try {
    recorder.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', worktree: directory, harness: 'Codex' });
    const port = Number(new URL(center.url).port);
    await assert.rejects(requestStart('tl-1', 'kickoff', port), /ended its turn at once with an error/);
    assert.equal(recorder.snapshot().find(item => item.id === 'tl-1').worker, undefined);
  } finally {
    recorder.close();
    await center.close();
  }
});

test('a harness whose workers are not started from the command line gets the table\'s answer, and no worker', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-daemon-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'stories.sqlite');
  const center = await start({ port: 0, dbPath });
  const recorder = createConsoleService({ dbPath });
  try {
    recorder.createStory({ story: 'tl-2', title: 'Add import', detail: 'Import rows.', branch: 'tl-2', worktree: directory, harness: 'Cursor' });
    const answer = await requestStart('tl-2', 'kickoff', Number(new URL(center.url).port));
    assert.equal(answer.noWorkers, true);
    assert.equal(recorder.snapshot()[0].worker, undefined);
  } finally {
    recorder.close();
    await center.close();
  }
});
