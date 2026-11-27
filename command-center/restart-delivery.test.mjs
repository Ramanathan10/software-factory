import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { harnesses, messageWorker } from '../adapters/harnesses.mjs';
import { createConsoleService } from './console-service.mjs';
import { loadAdapters, start } from './serve.mjs';

process.env.AI_SDLC_HOME = mkdtempSync(join(tmpdir(), 'factory-restart-home-'));
after(() => rmSync(process.env.AI_SDLC_HOME, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));

const story = 'tl-1';
const settings = { permissions: 'restricted', tools: ['git'] };
const turnProgram = 'const fs = require("fs"); const file = process.argv[1]; setInterval(() => { try { process.exit(Number(fs.readFileSync(file, "utf8"))); } catch {} }, 25);';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(what, check, ms = 15000) {
  for (let waited = 0; !check(); waited += 20) {
    if (waited > ms) throw new Error('Timed out waiting for ' + what + '.');
    await sleep(20);
  }
}

function setup(t, { turnPollMs = 250 } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'factory-restart-'));
  const dbPath = join(directory, 'stories.sqlite');
  const children = [];
  const resumes = [];
  const launched = [];
  const turnTypes = () => recorder.store.history(story).filter(event => ['turn-started', 'turn-ended'].includes(event.type)).map(event => event.type);
  const liveTurn = name => {
    const marker = join(directory, name + '.exit');
    const child = spawn(process.execPath, ['-e', turnProgram, marker], { stdio: ['pipe', 'ignore', 'ignore'] });
    children.push(child);
    const exited = new Promise(resolve => child.once('close', resolve));
    return { child, pid: child.pid, exited, end: (code = 0) => { writeFileSync(marker, String(code)); return exited; } };
  };
  const spawnProcess = (command, args) => {
    const live = liveTurn('resume-' + resumes.length);
    const resume = { args, live, typesAtSpawn: turnTypes(), prompt: '' };
    const end = live.child.stdin.end.bind(live.child.stdin);
    live.child.stdin.end = prompt => { resume.prompt = String(prompt); return end(); };
    resumes.push(resume);
    return live.child;
  };
  const adapters = loadAdapters(harnesses, (message, options) => messageWorker(message, { ...options, spawnProcess, settleMs: 0, settings }));
  const recorder = createConsoleService({ dbPath });
  const daemons = [];
  const rig = {
    directory, resumes, launched, recorder, turnTypes, liveTurn,
    async open() {
      const center = await start({ port: 0, dbPath, adapters, launch: async input => { launched.push(input); return { session: 'jarvis-1' }; }, quietMs: 60000, turnPollMs });
      const daemon = { center, closed: false, origin: 'http://127.0.0.1:' + new URL(center.url).port };
      daemons.push(daemon);
      return daemon;
    },
    async stop(daemon) {
      if (daemon.closed) return;
      daemon.closed = true;
      await daemon.center.close().catch(() => {});
    },
    async answer(daemon, question = 'scope', option = 1) {
      const revision = recorder.snapshot().find(item => item.id === story).revision;
      const response = await fetch(daemon.origin + '/api/decision', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: daemon.origin },
        body: JSON.stringify({ story, type: 'answer', question, answer: option, revision, key: randomUUID() }) });
      assert.equal(response.status, 200);
      return response.json();
    },
    seed({ harness = 'Claude Code', session = 'worker-1', turn = false, questions = ['scope'] } = {}) {
      recorder.createStory({ story, title: 'Add export', detail: 'Export rows.', branch: story, harness, worktree: directory });
      recorder.recordEvent({ story, type: 'assign-worker', session });
      const assignment = recorder.snapshot()[0].worker.id;
      const running = turn ? liveTurn('adopted') : undefined;
      if (running) recorder.recordEvent({ story, type: 'turn-started', assignment, pid: running.pid, log: join(directory, 'adopted.log') });
      for (const question of questions) recorder.recordEvent({ story, type: 'question', question, prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
      return { assignment, running };
    },
    workerActs(assignment) {
      recorder.recordEvent({ story, type: 'activity', assignment, detail: 'Read the console.' });
    },
    ended: count => turnTypes().filter(type => type === 'turn-ended').length >= count,
  };
  t.after(async () => {
    for (const child of children) child.kill();
    await Promise.all(children.map(child => (child.exitCode === null && child.signalCode === null ? new Promise(resolve => child.once('close', resolve)) : undefined)));
    await sleep(200);
    for (const daemon of daemons) await rig.stop(daemon);
    recorder.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
  return rig;
}

const quiet = t => t.mock.method(console, 'log', () => {});
const turnsOf = rig => rig.turnTypes().toReversed();
const mentions = (resume, seq) => new RegExp('answer on story ' + story + ' \\(event seq ' + seq + '\\)').test(resume.prompt);

for (const [where, waitMs] of [['queued behind the running turn', 2000], ['still inside the batch window', 200]]) {
  test('an answer ' + where + ' when the daemon restarts is handed to the same worker once, after the adopted turn has ended', async t => {
    quiet(t);
    const rig = setup(t);
    const { running } = rig.seed({ turn: true });
    const first = await rig.open();
    const answer = await rig.answer(first);
    await sleep(waitMs);
    await rig.stop(first);
    await rig.open();
    await sleep(500);
    assert.equal(rig.resumes.length, 0, 'the worker was resumed while its adopted turn still ran');
    await running.end(0);
    await until('the worker to be resumed with the answer', () => rig.resumes.length > 0);
    const [resume] = rig.resumes;
    await until('the prompt', () => resume.prompt);
    assert.ok(resume.args.includes('worker-1'), 'the resume names ' + JSON.stringify(resume.args));
    assert.ok(mentions(resume, answer.seq), resume.prompt);
    assert.equal(resume.typesAtSpawn[0], 'turn-ended', 'the resumed turn started before the adopted turn\'s end was recorded: ' + resume.typesAtSpawn);
    rig.recorder.ack(answer.seq);
    await resume.live.end(0);
    await until('the end of the resumed turn', () => rig.ended(2));
    await sleep(1500);
    assert.equal(rig.resumes.length, 1, 'the worker was resumed more than once');
    assert.deepEqual(turnsOf(rig), ['turn-started', 'turn-ended', 'turn-started', 'turn-ended']);
    assert.deepEqual(rig.launched, [], 'Jarvis was woken for a decision the worker owns');
  });
}

test('with a slow sweep, the resumed turn still starts only after the adopted turn\'s end is recorded', async t => {
  quiet(t);
  const rig = setup(t, { turnPollMs: 4000 });
  const { running } = rig.seed({ turn: true });
  const first = await rig.open();
  await rig.answer(first);
  await sleep(2000);
  await rig.stop(first);
  await rig.open();
  await sleep(300);
  await running.end(0);
  await until('the worker to be resumed', () => rig.resumes.length > 0, 20000);
  assert.deepEqual(rig.resumes[0].typesAtSpawn.slice(0, 2), ['turn-ended', 'turn-started'], 'at the spawn the history is ' + rig.resumes[0].typesAtSpawn);
  await rig.resumes[0].live.end(0);
  await until('the end of the resumed turn', () => rig.ended(2), 20000);
  assert.deepEqual(turnsOf(rig), ['turn-started', 'turn-ended', 'turn-started', 'turn-ended']);
});

test('an answer inside the batch window to an idle worker is handed to it soon after the daemon restarts, without waiting for any turn', async t => {
  quiet(t);
  const rig = setup(t);
  rig.seed();
  const first = await rig.open();
  const answer = await rig.answer(first);
  await rig.stop(first);
  await sleep(200);
  assert.equal(rig.resumes.length, 0);
  await rig.open();
  await until('the worker to be resumed with the answer', () => rig.resumes.length > 0, 8000);
  const [resume] = rig.resumes;
  await until('the prompt', () => resume.prompt);
  assert.ok(resume.args.includes('worker-1'), JSON.stringify(resume.args));
  assert.ok(mentions(resume, answer.seq), resume.prompt);
  rig.recorder.ack(answer.seq);
  await resume.live.end(0);
  await until('the end of the resumed turn', () => rig.ended(1));
  await sleep(1500);
  assert.equal(rig.resumes.length, 1, 'the worker was resumed more than once');
  assert.deepEqual(rig.launched, []);
});

test('an answer waiting behind an adopted turn goes to the worker assigned when the wait ends, never to the released session', async t => {
  quiet(t);
  const rig = setup(t);
  const { assignment, running } = rig.seed({ turn: true });
  const first = await rig.open();
  const answer = await rig.answer(first);
  await sleep(2000);
  await rig.stop(first);
  await rig.open();
  await sleep(500);
  rig.recorder.recordEvent({ story, type: 'release-worker', assignment, detail: 'Stopped.' });
  rig.recorder.recordEvent({ story, type: 'assign-worker', session: 'worker-2' });
  await running.end(0);
  await until('the replacement to be resumed with the answer', () => rig.resumes.length > 0);
  await sleep(1500);
  assert.deepEqual(rig.resumes.map(resume => resume.args.includes('worker-2')), [true]);
  assert.ok(!rig.resumes.some(resume => resume.args.includes('worker-1')), 'the released session was resumed');
  assert.ok(mentions(rig.resumes[0], answer.seq), rig.resumes[0].prompt);
});

test('an answer the worker acknowledged during the adopted turn does not resume the worker when the turn ends', async t => {
  quiet(t);
  const rig = setup(t);
  const { assignment, running } = rig.seed({ turn: true });
  const first = await rig.open();
  const answer = await rig.answer(first);
  await sleep(2000);
  await rig.stop(first);
  await rig.open();
  await sleep(500);
  rig.workerActs(assignment);
  rig.recorder.ack(answer.seq);
  await running.end(0);
  await until('the end of the adopted turn', () => rig.ended(1));
  await sleep(2500);
  assert.equal(rig.resumes.length, 0, 'the worker was resumed with an answer it had acknowledged');
  assert.deepEqual(rig.launched, [], 'Jarvis was woken for an answer the worker had handled');
  assert.deepEqual(turnsOf(rig), ['turn-started', 'turn-ended']);
});

test('a dashboard batch queued behind a running turn does not resume the worker or wake Jarvis when the worker acknowledged every decision during the turn', async t => {
  quiet(t);
  const rig = setup(t);
  const { assignment, running } = rig.seed({ turn: true });
  const daemon = await rig.open();
  const answer = await rig.answer(daemon);
  await sleep(2000);
  rig.workerActs(assignment);
  rig.recorder.ack(answer.seq);
  await running.end(0);
  await until('the end of the turn', () => rig.ended(1));
  await sleep(2500);
  assert.equal(rig.resumes.length, 0, 'the worker was resumed with an answer it had acknowledged');
  assert.deepEqual(rig.launched, [], 'Jarvis was woken');
  assert.deepEqual(turnsOf(rig), ['turn-started', 'turn-ended']);
});

test('a dashboard batch still resumes the worker once when only some of its decisions were acknowledged during the turn', async t => {
  quiet(t);
  const rig = setup(t);
  const { assignment, running } = rig.seed({ turn: true, questions: ['scope', 'order'] });
  const daemon = await rig.open();
  const first = await rig.answer(daemon, 'scope');
  const second = await rig.answer(daemon, 'order');
  await sleep(2000);
  rig.workerActs(assignment);
  rig.recorder.ack(first.seq);
  await running.end(0);
  await until('the worker to be resumed', () => rig.resumes.length > 0);
  await until('the prompt', () => rig.resumes[0].prompt);
  assert.ok(rig.resumes[0].prompt.includes(String(second.seq)), rig.resumes[0].prompt);
  await sleep(1000);
  assert.equal(rig.resumes.length, 1);
});

test('at start-up an answer pending on a blocked story with an assigned worker is handed to that worker, as on the live path', async t => {
  quiet(t);
  const rig = setup(t);
  rig.seed();
  const answer = rig.recorder.recordEvent({ story, type: 'answer', question: 'scope', answer: 1 });
  rig.recorder.recordEvent({ story, type: 'blocked', detail: 'Waiting for the owner to fix the sign-in.' });
  await rig.open();
  await until('the worker to be resumed with the answer', () => rig.resumes.length > 0, 8000);
  await until('the prompt', () => rig.resumes[0].prompt);
  assert.ok(rig.resumes[0].args.includes('worker-1'), JSON.stringify(rig.resumes[0].args));
  assert.ok(mentions(rig.resumes[0], answer.seq), rig.resumes[0].prompt);
});

test('at start-up a cleanup request on a story in cleanup is handed to its assigned worker, as on the live path', async t => {
  quiet(t);
  const rig = setup(t);
  rig.seed();
  const request = rig.recorder.recordEvent({ story, type: 'request-cleanup' });
  assert.ok(rig.recorder.snapshot()[0].cleanup);
  await rig.open();
  await until('the worker to be resumed with the cleanup request', () => rig.resumes.length > 0, 8000);
  await until('the prompt', () => rig.resumes[0].prompt);
  assert.ok(rig.resumes[0].args.includes('worker-1'), JSON.stringify(rig.resumes[0].args));
  assert.match(rig.resumes[0].prompt, new RegExp('request-cleanup on story ' + story + ' \\(event seq ' + request.seq + '\\)'));
});

test('start-up delivery leaves a story of an in-app harness alone', async t => {
  const logged = quiet(t);
  const rig = setup(t);
  rig.seed({ harness: 'GitHub Copilot app' });
  const answer = rig.recorder.recordEvent({ story, type: 'answer', question: 'scope', answer: 1 });
  await rig.open();
  await sleep(2000);
  assert.equal(rig.resumes.length, 0);
  assert.deepEqual(rig.launched, []);
  assert.ok(!logged.mock.calls.some(call => /not delivered/.test(String(call.arguments[0]))), 'start-up tried to deliver to an in-app story');
  assert.ok(rig.recorder.store.pendingFor(story).some(event => event.seq === answer.seq), 'the answer is still pending for its own harness to take');
});

test('start-up delivery does not try to hand a decision to a story with no worker assigned', async t => {
  const logged = quiet(t);
  const rig = setup(t);
  rig.recorder.createStory({ story, title: 'Add export', detail: 'Export rows.', branch: story, harness: 'Claude Code', worktree: rig.directory });
  rig.recorder.recordEvent({ story, type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
  rig.recorder.recordEvent({ story, type: 'answer', question: 'scope', answer: 1 });
  await rig.open();
  await sleep(2000);
  assert.equal(rig.resumes.length, 0);
  assert.ok(!logged.mock.calls.some(call => /not delivered/.test(String(call.arguments[0]))), 'start-up tried to deliver to an unstaffed story');
});

test('start-up succeeds and delivers nothing for a staffed story whose harness is unknown', async t => {
  quiet(t);
  const rig = setup(t);
  rig.seed({ harness: 'Retired Harness' });
  rig.recorder.recordEvent({ story, type: 'answer', question: 'scope', answer: 1 });
  const daemon = await rig.open();
  await sleep(1500);
  assert.equal((await fetch(daemon.origin + '/')).status, 200);
  assert.equal(rig.resumes.length, 0);
  assert.deepEqual(rig.launched, []);
});

test('a delivery queued behind a running turn is told "acknowledged" when the worker acknowledged its decisions during the turn', async t => {
  quiet(t);
  const rig = setup(t);
  const { assignment, running } = rig.seed({ turn: true });
  const daemon = await rig.open();
  const revision = rig.recorder.snapshot().find(item => item.id === story).revision;
  const answer = rig.recorder.recordEvent({ story, type: 'answer', question: 'scope', answer: 1, revision, key: randomUUID() });
  const delivery = fetch(daemon.origin + '/api/deliver', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: daemon.origin }, body: JSON.stringify({ story }) });
  await sleep(500);
  rig.workerActs(assignment);
  rig.recorder.ack(answer.seq);
  await running.end(0);
  const told = await (await delivery).json();
  assert.equal(told.told, 'acknowledged');
  assert.deepEqual(told.seqs, [answer.seq]);
  assert.equal(rig.resumes.length, 0, 'the worker was resumed with an answer it had acknowledged');
});
