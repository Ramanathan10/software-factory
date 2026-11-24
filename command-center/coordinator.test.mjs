import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createConsoleService } from './console-service.mjs';
import { requestDelivery, requestStart, start } from './serve.mjs';

const QUIET_MS = 300;
const POLL_MS = 50;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const settle = () => pause(QUIET_MS * 4 + POLL_MS * 4);

async function until(what, check, ms = 8000) {
  const deadline = Date.now() + ms;
  for (;;) {
    const found = check();
    if (found) return found;
    if (Date.now() > deadline) throw new Error('Timed out waiting for ' + what + '.');
    await pause(20);
  }
}

function turnControl() {
  let end;
  const ended = new Promise(resolve => { end = resolve; });
  return { ended, end };
}

function coordinated(t, { harness = 'Codex', quietMs = QUIET_MS } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'factory-coordinator-'));
  const dbPath = join(directory, 'stories.sqlite');
  const recorder = createConsoleService({ dbPath });
  const jarvis = [];
  const workers = [];
  const messages = [];
  let failNext;
  let session = 0;
  const turn = (input, options, kind) => {
    const control = turnControl();
    const log = join(directory, 'turn-' + (jarvis.length + workers.length + messages.length) + '.log');
    writeFileSync(log, '');
    const entry = { input, log, ...control };
    kind.push(entry);
    options?.onTurn?.({ session: input.session, pid: process.pid, log, ended: control.ended });
    return entry;
  };
  const launch = async (input, options) => {
    if (failNext && input.phase === 'coordinator') {
      const error = failNext;
      failNext = undefined;
      jarvis.push({ input, failed: error });
      throw error;
    }
    session += 1;
    const name = (input.phase === 'coordinator' ? 'jarvis-' : 'worker-') + session;
    const entry = { session: name };
    const control = turnControl();
    const log = join(directory, name + '.log');
    writeFileSync(log, '');
    Object.assign(entry, { input, log, ...control });
    (input.phase === 'coordinator' ? jarvis : workers).push(entry);
    options?.onTurn?.({ session: name, pid: process.pid, log, ended: control.ended });
    return { session: name, log };
  };
  const adapter = { messageWorker: async (message, options) => turn(message, options, messages) };
  const adapters = new Map([[harness.toLowerCase(), adapter]]);
  let center;
  t.after(async () => {
    for (const entry of [...jarvis, ...workers, ...messages]) entry.end?.(0);
    await center?.close();
    recorder.close();
    rmSync(directory, { recursive: true, force: true });
  });
  recorder.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export selected rows.', branch: 'tl-1', harness, worktree: directory });
  const story = () => recorder.snapshot().find(item => item.id === 'tl-1');
  const history = () => recorder.store.history('tl-1');
  const ackAll = () => { for (const event of recorder.pending()) recorder.ack(event.seq); };
  return {
    directory, dbPath, recorder, story, history, ackAll, jarvis, workers, messages,
    jarvisMessages: () => messages.filter(entry => entry.input.phase === 'coordinator'),
    jarvisTurns: () => jarvis.length + messages.filter(entry => entry.input.phase === 'coordinator').length,
    failNextLaunch: error => { failNext = error; },
    open: async (options = {}) => {
      center = await start({ port: 0, dbPath, launch, adapters, turnPollMs: POLL_MS, quietMs, ...options });
      return { center, port: Number(new URL(center.url).port) };
    },
    close: async () => { await center?.close(); center = undefined; },
  };
}

function scoutHandedOff(rig) {
  rig.recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'scout-1' });
  rig.recorder.recordEvent({ story: 'tl-1', type: 'release-worker', assignment: rig.story().worker.id, detail: 'Scout finished.' });
  return rig.recorder.recordEvent({ story: 'tl-1', type: 'handoff', detail: 'Context pack ready.' });
}

test('news on a story with no worker wakes a background Jarvis once the story has been quiet, in its harness and worktree', async t => {
  const rig = coordinated(t);
  const handoff = scoutHandedOff(rig);
  const { port } = await rig.open();
  await pause(QUIET_MS / 3);
  assert.equal(rig.jarvisTurns(), 0, 'Jarvis waits for the story to be quiet');
  await until('a background Jarvis turn', () => rig.jarvis.length);
  const [{ input }] = rig.jarvis;
  assert.deepEqual([input.harness, input.worktree, input.phase], ['Codex', rig.directory, 'coordinator']);
  assert.match(input.prompt, /tl-1/);
  assert.ok(input.prompt.includes(String(handoff.seq)), 'the kickoff names the news it carries');
  assert.ok(input.prompt.includes('Console database: ' + rig.dbPath) || input.prompt.includes(rig.dbPath));
  assert.ok(input.prompt.includes(String(port)), 'the kickoff names the daemon it can start workers through');
  const background = input.prompt.match(/\S*BACKGROUND\.md/)?.[0];
  assert.ok(background && existsSync(background), 'the kickoff points at the background Jarvis instructions, which exist: ' + background);
  assert.ok(!rig.workers.length, 'the daemon does not staff the role itself');
  const woken = rig.history().find(event => event.type === 'jarvis-woken');
  assert.ok(woken, 'the wake is recorded before the launch');
  assert.equal(rig.story().jarvis.handled, handoff.seq);
  await until('the Jarvis turn to be recorded', () => rig.story().jarvis?.turn);
  assert.equal(rig.story().jarvis.session, rig.jarvis[0].session);
});

test('news already given to a finished Jarvis turn does not wake it again', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.jarvis[0].end(0);
  await until('the Jarvis turn to end', () => rig.story().jarvis?.lastTurn);
  assert.equal(rig.story().jarvis.lastTurn.outcome, 'ended');
  await settle();
  assert.equal(rig.jarvisTurns(), 1, 'the unacknowledged handoff was already seen');
});

test('news recorded during a Jarvis turn gets exactly one follow-up turn on the same session, after the first ends', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  const question = rig.recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
  const answer = rig.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 1 });
  await settle();
  assert.equal(rig.jarvisTurns(), 1, 'a story never has two Jarvis turns running');
  rig.jarvis[0].end(0);
  await until('the follow-up turn', () => rig.jarvisMessages().length);
  const [followUp] = rig.jarvisMessages();
  assert.deepEqual([followUp.input.session, followUp.input.phase, followUp.input.worktree], [rig.jarvis[0].session, 'coordinator', rig.directory]);
  assert.ok(followUp.input.prompt.includes(String(question.seq)) && followUp.input.prompt.includes(String(answer.seq)), 'one turn carries every pending news seq');
  assert.equal(rig.story().jarvis.handled, answer.seq);
  followUp.end(0);
  await until('the follow-up to end', () => !rig.story().jarvis?.turn && rig.history()[0].type === 'jarvis-turn-ended');
  await settle();
  assert.equal(rig.jarvisTurns(), 2);
});

test('what Jarvis records itself never wakes it', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0, by: 'jarvis' });
  rig.recorder.recordEvent({ story: 'tl-1', type: 'blocked', detail: 'Needs the owner.', by: 'jarvis' });
  rig.jarvis[0].end(0);
  await until('the Jarvis turn to end', () => rig.story().jarvis?.lastTurn);
  await settle();
  assert.equal(rig.jarvisTurns(), 1);
});

test('a story whose only news came from the owner\'s Jarvis chat is not woken', async t => {
  const rig = coordinated(t);
  rig.ackAll();
  rig.recorder.recordEvent({ story: 'tl-1', type: 'handoff', detail: 'Context pack ready.', by: 'jarvis' });
  await rig.open();
  await settle();
  assert.equal(rig.jarvisTurns(), 0);
});

test('a decision for a story with no worker is handed to the background Jarvis, and stays pending until it is handled', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  rig.ackAll();
  rig.recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0, by: 'jarvis' });
  const { port } = await rig.open();
  await settle();
  assert.equal(rig.jarvisTurns(), 0);
  const answer = rig.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 1 });
  assert.deepEqual(await requestDelivery('tl-1', port), { story: 'tl-1', seqs: [answer.seq], told: 'coordinator' });
  await until('a background Jarvis turn', () => rig.jarvis.length);
  assert.ok(rig.jarvis[0].input.prompt.includes(String(answer.seq)));
  assert.ok(rig.recorder.pending().some(event => event.seq === answer.seq));
});

test('a story whose worker is between clean turns is left to that worker', async t => {
  const rig = coordinated(t);
  rig.recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'scout-1' });
  rig.recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
  rig.ackAll();
  const { port } = await rig.open();
  rig.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: 'scope', answer: 0 });
  assert.equal((await requestDelivery('tl-1', port)).told, 'worker');
  await settle();
  assert.equal(rig.jarvisTurns(), 0);
  assert.equal(rig.messages.length, 1);
});

test('a worker turn that failed wakes the background Jarvis even though the worker is still assigned', async t => {
  const rig = coordinated(t);
  rig.recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'scout-1' });
  const assignment = rig.story().worker.id;
  rig.recorder.recordEvent({ story: 'tl-1', type: 'turn-started', assignment, pid: 999999, log: join(rig.directory, 'scout.log') });
  rig.ackAll();
  const failed = rig.recorder.recordEvent({ story: 'tl-1', type: 'turn-ended', assignment, outcome: 'failed', code: 1, wake: true, detail: 'Worker turn failed (exit code 1).' });
  await rig.open();
  await until('a background Jarvis turn', () => rig.jarvis.length);
  assert.ok(rig.jarvis[0].input.prompt.includes(String(failed.seq)));
});

test('a failed Jarvis turn asks the owner in plain words, and no Jarvis turn starts until they answer Done', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  writeFileSync(rig.jarvis[0].log, 'starting\nERROR: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 9:12 PM.\n');
  rig.jarvis[0].end(1);
  const notice = await until('the action question', () => rig.story().questions.find(question => question.id.startsWith('action-jarvis-')));
  assert.match(notice.id, /^action-jarvis-\d+$/);
  assert.match(notice.prompt, /^Action for you: Jarvis could not run for tl-1: /);
  assert.match(notice.prompt, /usage limit/i);
  assert.match(notice.prompt, /9:12 PM/);
  assert.match(notice.prompt, /Then choose Done\.$/);
  assert.match(notice.options[0], /^Done/);
  assert.match(notice.options[1], /^Hold/);
  assert.equal(notice.recommended, 0);
  assert.deepEqual([rig.story().jarvis.lastTurn.outcome, rig.story().jarvis.lastTurn.code], ['failed', 1]);

  rig.recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
  await settle();
  assert.equal(rig.jarvisTurns(), 1, 'no retry while the owner has not answered');

  rig.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: notice.id, answer: 0 });
  await until('one new Jarvis turn', () => rig.jarvisTurns() === 2);
  await settle();
  assert.equal(rig.jarvisTurns(), 2);
});

test('answering Hold to the Jarvis failure gives no new turn, and the daemon acknowledges the answer itself', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.jarvis[0].end(1);
  const notice = await until('the action question', () => rig.story().questions.find(question => question.id.startsWith('action-jarvis-')));
  const hold = rig.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: notice.id, answer: 1 });
  await until('the Hold to be acknowledged', () => !rig.recorder.pending().some(event => event.seq === hold.seq));
  await settle();
  assert.equal(rig.jarvisTurns(), 1);
});

test('a failure no harness recognises is described with the last log line and the log path', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  writeFileSync(rig.jarvis[0].log, 'reading the handover\nTypeError: something odd happened\n');
  rig.jarvis[0].end(7);
  const notice = await until('the action question', () => rig.story().questions.find(question => question.id.startsWith('action-jarvis-')));
  assert.match(notice.prompt, /Jarvis stopped with an error/);
  assert.ok(notice.prompt.includes('TypeError: something odd happened'));
  assert.ok(notice.prompt.includes(rig.jarvis[0].log));
});

test('a Jarvis launch that fails at once is recorded as a failed turn with its error, and is not retried', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  rig.failNextLaunch(new Error('Codex ended its turn at once with an error (exit code 1).\nFailed to authenticate: model "no-such-model" does not exist'));
  await rig.open();
  const notice = await until('the action question', () => rig.story().questions.find(question => question.id.startsWith('action-jarvis-')));
  assert.ok(notice.prompt.includes('no-such-model'));
  assert.equal(rig.story().jarvis.lastTurn.outcome, 'failed');
  assert.equal(rig.story().jarvis.turn, undefined);
  await settle();
  assert.equal(rig.jarvis.length, 1);
});

test('a wake that a restart interrupted before its turn was recorded is reported as lost, not launched again', async t => {
  const rig = coordinated(t);
  const handoff = scoutHandedOff(rig);
  rig.recorder.recordEvent({ story: 'tl-1', type: 'jarvis-woken', handled: handoff.seq });
  await rig.open();
  const notice = await until('the action question', () => rig.story().questions.find(question => question.id.startsWith('action-jarvis-')));
  assert.ok(notice);
  assert.equal(rig.story().jarvis.lastTurn.outcome, 'lost');
  await settle();
  assert.equal(rig.jarvisTurns(), 0);
});

test('a Jarvis turn left running by an earlier daemon is adopted, and one whose process is gone is recorded as lost', async t => {
  const rig = coordinated(t);
  const handoff = scoutHandedOff(rig);
  const gone = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(resolve => gone.once('close', resolve));
  rig.recorder.recordEvent({ story: 'tl-1', type: 'jarvis-woken', handled: handoff.seq });
  rig.recorder.recordEvent({ story: 'tl-1', type: 'jarvis-turn-started', session: 'jarvis-old', pid: gone.pid, log: join(rig.directory, 'old.log') });
  await rig.open();
  await until('the lost turn', () => rig.story().jarvis?.lastTurn?.outcome === 'lost');
  assert.ok(rig.story().questions.some(question => question.id.startsWith('action-jarvis-')));
  await settle();
  assert.equal(rig.jarvisTurns(), 0);
});

test('a Jarvis turn can start the next worker without waiting for itself to end', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  const { port } = await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  const started = requestStart('tl-1', 'You are the planner for tl-1.', port).then(() => 'started', error => error.message);
  assert.equal(await Promise.race([started, pause(3000).then(() => 'still waiting')]), 'started');
  assert.equal(rig.story().worker.role, 'planner');
  assert.equal(rig.workers.length, 1);
});

test('the owner\'s chat and the background Jarvis starting a worker at once produce one worker', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  const { port } = await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  const results = await Promise.allSettled([
    requestStart('tl-1', 'Planner kickoff from the background Jarvis.', port),
    requestStart('tl-1', 'Planner kickoff from the owner\'s chat.', port),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), ['fulfilled', 'rejected']);
  assert.equal(rig.workers.length, 1);
});

test('a plan approval with no worker starts the test author once and wakes no Jarvis', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  rig.recorder.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Export selected rows.' });
  rig.ackAll();
  const { center, port } = await rig.open();
  const response = await fetch(center.url + 'api/decision', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: center.url.slice(0, -1) },
    body: JSON.stringify({ story: 'tl-1', type: 'approve', revision: rig.story().revision }),
  });
  assert.equal(response.status, 200);
  await pause(QUIET_MS * 2);
  await requestDelivery('tl-1', port);
  await settle();
  assert.equal(rig.workers.length, 1);
  assert.equal(rig.workers[0].input.phase, 'testing');
  assert.equal(rig.jarvisTurns(), 0);
});

test('an approval waiting when the daemon starts starts the test author and wakes no Jarvis', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  rig.recorder.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Export selected rows.' });
  rig.ackAll();
  rig.recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  await rig.open();
  await until('the test author', () => rig.workers.length);
  await settle();
  assert.equal(rig.workers.length, 1);
  assert.equal(rig.jarvisTurns(), 0);
});

test('stories in harnesses that do not start workers from the command line are never woken', async t => {
  for (const harness of ['GitHub Copilot app', 'Cursor']) {
    await t.test(harness, async t => {
      const rig = coordinated(t, { harness });
      rig.recorder.recordEvent({ story: 'tl-1', type: 'handoff', detail: 'Context pack ready.' });
      await rig.open();
      await settle();
      assert.equal(rig.jarvisTurns(), 0);
    });
  }
});

test('a closed story is never woken', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  const write = (type, extra = {}) => rig.recorder.recordEvent({ story: 'tl-1', type, ...extra });
  write('plan', { detail: 'Export selected rows.' });
  write('approve');
  write('handoff', { detail: 'Red verified.', command: 'node --test' });
  write('handoff', { detail: 'Green.', command: 'node --test' });
  write('handoff', { detail: 'Gates pass.', command: 'node --test' });
  write('handoff', { detail: 'Gates pass.', command: 'node --test' });
  write('handoff', { detail: 'Mutation pass.', command: 'npx stryker run' });
  write('handoff', { detail: 'Review clean.' });
  write('comparison-choice', { run: false });
  write('pr-opened', { url: 'https://github.com/acme/widgets/pull/1' });
  write('merged', { detail: 'Merged.' });
  assert.equal(rig.story().phase, 'closed');
  await rig.open();
  await settle();
  assert.equal(rig.jarvisTurns(), 0);
});

test('the board is told a story is waiting on Jarvis, since when and why, and then that Jarvis is checking it', async t => {
  const rig = coordinated(t, { quietMs: 2000 });
  scoutHandedOff(rig);
  const { center } = await rig.open();
  const shown = async () => (await fetch(center.url + 'api/stories').then(response => response.json())).find(item => item.id === 'tl-1');
  let waiting;
  for (let attempt = 0; !waiting && attempt < 30; attempt += 1) {
    waiting = (await shown()).waitingOnJarvis;
    if (!waiting) await pause(50);
  }
  assert.ok(waiting, 'the story frame says it is waiting on Jarvis');
  assert.ok(Date.parse(waiting.since) <= Date.now());
  assert.match(waiting.why, /handed off/i);
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn, 8000);
  const checking = await shown();
  assert.ok(checking.jarvis?.turn, 'the story frame carries the running Jarvis turn');
  assert.equal(checking.waitingOnJarvis, undefined);
});
