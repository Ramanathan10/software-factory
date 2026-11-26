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
  let gate;
  const launch = async (input, options) => {
    if (gate && input.phase !== 'coordinator') await gate;
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
    holdWorkerStart: () => {
      let release;
      gate = new Promise(resolve => { release = resolve; });
      return release;
    },
    open: async (options = {}) => {
      center = await start({ port: 0, dbPath, launch, adapters, turnPollMs: POLL_MS, quietMs, ...options });
      return { center, port: Number(new URL(center.url).port) };
    },
    close: async () => { await center?.close(); center = undefined; },
  };
}

const staffed = rig => rig.recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'planner-1' });
const noNews = /No news: nobody is working on tl-1 in planning: no worker, nothing pending, no open question\. Staff it, or record blocked or a question\./;
const stuckPrompt = "Action for you: nobody is working on tl-1 in planning, and Jarvis's turn did not staff it. Start a worker or tell Jarvis what to do, then choose Done.";
const stuckNotice = story => story.questions.find(question => question.id.startsWith('action-jarvis-') && /nobody is working/.test(question.prompt));
const notices = rig => rig.story().questions.filter(question => question.id.startsWith('action-jarvis-'));

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
  staffed(rig);
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
  staffed(rig);
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
  rig.recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0, by: 'jarvis' });
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
  assert.deepEqual(await requestDelivery('tl-1', port), { story: 'tl-1', seqs: [answer.seq], told: 'nobody',
    reason: 'No worker is assigned to tl-1, so no worker was told; the decisions stay pending. Staff the phase, then deliver.' });
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

async function failedWorkerStory(rig) {
  rig.recorder.recordEvent({ story: 'tl-1', type: 'assign-worker', session: 'scout-1' });
  const assignment = rig.story().worker.id;
  rig.recorder.recordEvent({ story: 'tl-1', type: 'turn-started', assignment, pid: 999999, log: join(rig.directory, 'scout.log') });
  rig.ackAll();
  rig.recorder.recordEvent({ story: 'tl-1', type: 'turn-ended', assignment, outcome: 'failed', code: 1, wake: true, detail: 'Worker turn failed (exit code 1).' });
  const { center } = await rig.open();
  await until('a background Jarvis turn', () => rig.jarvis.length);
  rig.jarvis[0].end(1);
  const notice = await until('the action question', () => rig.story().questions.find(question => question.id.startsWith('action-jarvis-')));
  return { center, notice };
}

const answerThroughDashboard = (center, rig, question, answer) => fetch(center.url + 'api/decision', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: center.url.slice(0, -1) },
  body: JSON.stringify({ story: 'tl-1', type: 'answer', question, answer, revision: rig.story().revision }),
});

test('Done to a Jarvis failure on a story whose worker is idle after a failed turn gives Jarvis a new turn and tells the worker nothing', async t => {
  const rig = coordinated(t);
  const { center, notice } = await failedWorkerStory(rig);
  assert.equal((await answerThroughDashboard(center, rig, notice.id, 0)).status, 200);
  await pause(2500);
  await settle();
  assert.equal(rig.messages.filter(entry => entry.input.phase !== 'coordinator').length, 0, 'the answer is not delivered to the worker');
  assert.equal(rig.jarvisTurns(), 2, 'exactly one new Jarvis turn');
});

test('Done to a Jarvis failure gives Jarvis a new turn even when no worker turn-ended is pending', async t => {
  const rig = coordinated(t);
  const { center, notice } = await failedWorkerStory(rig);
  rig.ackAll();
  assert.equal((await answerThroughDashboard(center, rig, notice.id, 0)).status, 200);
  await pause(2500);
  await settle();
  assert.equal(rig.messages.filter(entry => entry.input.phase !== 'coordinator').length, 0, 'the answer is not delivered to the worker');
  assert.equal(rig.jarvisTurns(), 2, 'exactly one new Jarvis turn');
});

test('a testing story with no worker and a pending approval wakes Jarvis once the story is blocked', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  rig.recorder.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Export selected rows.' });
  rig.ackAll();
  rig.recorder.recordEvent({ story: 'tl-1', type: 'approve' });
  rig.recorder.recordEvent({ story: 'tl-1', type: 'blocked', detail: 'Bruce Banner could not start after plan approval: boom' });
  assert.equal(rig.story().phase, 'testing');
  assert.ok(rig.story().blocked);
  await rig.open();
  await settle();
  assert.equal(rig.workers.length, 0);
  assert.equal(rig.jarvisTurns(), 1, 'the blocked story is handed to Jarvis');
});

test('a Jarvis turn an earlier daemon left, whose process is gone but which recorded its own work, is recorded as ended', async t => {
  const rig = coordinated(t);
  const handoff = scoutHandedOff(rig);
  const gone = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
  await new Promise(resolve => gone.once('close', resolve));
  rig.recorder.recordEvent({ story: 'tl-1', type: 'jarvis-woken', handled: handoff.seq });
  rig.recorder.recordEvent({ story: 'tl-1', type: 'jarvis-turn-started', session: 'jarvis-old', pid: gone.pid, log: join(rig.directory, 'old.log') });
  rig.recorder.recordEvent({ story: 'tl-1', type: 'activity', detail: 'Jarvis checked the story.', by: 'jarvis' });
  staffed(rig);
  await rig.open();
  await until('the finished turn', () => rig.story().jarvis?.lastTurn);
  assert.equal(rig.story().jarvis.lastTurn.outcome, 'ended');
  assert.ok(!rig.story().questions.some(question => question.id.startsWith('action-jarvis-')));
  await settle();
  assert.equal(rig.jarvisTurns(), 0);
});

test('the turn after a failed Jarvis turn starts a fresh session rather than resuming the failed one', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  assert.ok(rig.story().jarvis.session);
  rig.jarvis[0].end(1);
  const notice = await until('the action question', () => rig.story().questions.find(question => question.id.startsWith('action-jarvis-')));
  rig.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: notice.id, answer: 0 });
  await until('one new Jarvis turn', () => rig.jarvisTurns() === 2);
  await settle();
  assert.equal(rig.jarvis.length, 2, 'the new turn is launched');
  assert.equal(rig.jarvisMessages().length, 0, 'the failed session is not resumed');
});

test('a failed Jarvis turn is described by its last log line, not by an earlier usage limit line', async t => {
  const rig = coordinated(t);
  scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  writeFileSync(rig.jarvis[0].log, 'ERROR: You’ve hit your usage limit. Try again at 9:12 PM.\nretrying\nTypeError: boom\n');
  rig.jarvis[0].end(1);
  const notice = await until('the action question', () => rig.story().questions.find(question => question.id.startsWith('action-jarvis-')));
  assert.match(notice.prompt, /Jarvis stopped with an error: TypeError: boom/);
  assert.doesNotMatch(notice.prompt, /usage limit/i);
});

test('a Done a finished Jarvis turn was given does not open the gate for later ordinary worker news', async t => {
  const rig = coordinated(t);
  const { center, notice } = await failedWorkerStory(rig);
  assert.equal((await answerThroughDashboard(center, rig, notice.id, 0)).status, 200);
  await until('the Jarvis turn for Done', () => rig.jarvisTurns() === 2);
  const [turn] = [...rig.jarvis.slice(1), ...rig.jarvisMessages()];
  turn.end(0);
  await until('the Jarvis turn to end', () => !rig.story().jarvis?.turn);
  await pause(2000);
  for (const entry of rig.messages.filter(entry => entry.input.phase !== 'coordinator')) entry.end(0);
  await until('no worker turn running', () => rig.story().worker && !rig.story().worker.turn);
  await settle();
  const before = rig.jarvisTurns();
  rig.recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 });
  await settle();
  assert.equal(rig.jarvisTurns(), before, 'no further Jarvis turn');
});

test('new review feedback wakes the background Jarvis even while the ci worker is assigned and between turns', async t => {
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
  const url = 'https://github.com/acme/widgets/pull/1';
  write('pr-opened', { url });
  write('assign-worker', { session: 'hawkeye-1' });
  const assignment = rig.story().worker.id;
  write('turn-started', { assignment, pid: 999999, log: join(rig.directory, 'hawkeye.log') });
  write('turn-ended', { assignment, outcome: 'ended', code: 0, detail: 'Watching checks.' });
  rig.ackAll();
  await rig.open();
  await settle();
  assert.equal(rig.jarvisTurns(), 0, 'nothing is news before the review arrives');
  const observation = (keys, status = 'running') => ({ head: 'a'.repeat(40), status, failedCount: 0, failures: [], review: {
    approvals: [], changesRequested: [], unresolved: keys.length, earlier: 0,
    items: keys.map(key => ({ key, kind: 'thread', author: 'reviewer-a', bot: false, path: 'src/export.mjs', line: 4, excerpt: 'Rename this.', url: url + '#' + key })),
    keys, more: false, lastActivityAt: new Date().toISOString() } });
  const seen = write('pr-observed', { url, observation: observation(['PRRT_1:PRRC_1']) });
  assert.equal(seen.wake, true, 'the store queues the review wake');
  await until('a background Jarvis turn for the review', () => rig.jarvis.length);
  assert.ok(rig.jarvis[0].input.prompt.includes(String(seen.seq)), 'the kickoff carries the review wake');
  assert.ok(rig.story().worker, 'the ci worker stays assigned until Jarvis releases it');
});

for (const status of ['merged', 'closed']) {
  test('a ' + status + ' PR observed during PR review wakes the background Jarvis while the Hawkeye worker waits on the owner', async t => {
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
    const url = 'https://github.com/acme/widgets/pull/1';
    write('pr-opened', { url });
    write('pr-review-start', { detail: 'One new thread from reviewer-a.' });
    write('assign-worker', { session: 'hawkeye-1' });
    const assignment = rig.story().worker.id;
    write('question', { question: 'pr-1-1', prompt: 'Rename the helper?', options: ['Rename it', 'Reply without a change'], recommended: 0 });
    write('turn-started', { assignment, pid: 999999, log: join(rig.directory, 'hawkeye.log') });
    write('turn-ended', { assignment, outcome: 'ended', code: 0, detail: 'Asked the owner.' });
    rig.ackAll();
    await rig.open();
    await settle();
    assert.equal(rig.jarvisTurns(), 0, 'nothing is news while the worker waits on the owner');
    const seen = write('pr-observed', { url, observation: { head: 'a'.repeat(40), status, failedCount: 0, failures: [] } });
    assert.equal(seen.wake, true, 'the store queues the ' + status + ' observation');
    await until('a background Jarvis turn for the ' + status + ' PR', () => rig.jarvis.length);
    assert.ok(rig.jarvis[0].input.prompt.includes(String(seen.seq)), 'the kickoff carries the ' + status + ' observation');
  });
}

function stuck(rig) {
  scoutHandedOff(rig);
  rig.ackAll();
}

const rest = rig => until('the Jarvis turn to end', () => rig.story().jarvis?.lastTurn && !rig.story().jarvis.turn);

test('a story in a worker phase with no worker and nothing pending wakes Jarvis once it has been quiet, with a kickoff that says nobody is working on it', async t => {
  const rig = coordinated(t);
  stuck(rig);
  await rig.open();
  await pause(QUIET_MS / 3);
  assert.equal(rig.jarvisTurns(), 0, 'Jarvis waits for the story to be quiet');
  await until('a background Jarvis turn', () => rig.jarvis.length);
  const [{ input }] = rig.jarvis;
  assert.deepEqual([input.harness, input.worktree, input.phase], ['Codex', rig.directory, 'coordinator']);
  assert.match(input.prompt, noNews);
  assert.doesNotMatch(input.prompt, /News \(event seq/);
  assert.ok(input.prompt.includes('BACKGROUND.md'));
  assert.ok(rig.history().some(event => event.type === 'jarvis-woken'), 'the wake is recorded');
  assert.equal(rig.story().jarvis.handled ?? 0, 0, 'a wake with no news leaves the handled mark alone');
  assert.ok(!rig.workers.length, 'the daemon does not staff the role itself');
});

test('news the story already carries wakes Jarvis with the news, not the no-news line', async t => {
  const rig = coordinated(t);
  const handoff = scoutHandedOff(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.jarvis.length);
  assert.ok(rig.jarvis[0].input.prompt.includes(String(handoff.seq)));
  assert.doesNotMatch(rig.jarvis[0].input.prompt, /No news:/);
  rig.jarvis[0].end(0);
  await rest(rig);
  const ended = rig.history().find(event => event.type === 'jarvis-turn-ended');
  assert.doesNotMatch(ended.detail, /^No-news turn/, 'a turn that carried news is not the no-news turn');
});

test('the turn that ends a no-news wake is marked, and a story it left unstaffed is put to the owner instead of woken again', async t => {
  const rig = coordinated(t);
  stuck(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.jarvis[0].end(0);
  const ended = await until('the turn to end', () => rig.history().find(event => event.type === 'jarvis-turn-ended'));
  assert.match(ended.detail, /^No-news turn/);
  const notice = await until('the action question', () => stuckNotice(rig.story()));
  assert.match(notice.id, /^action-jarvis-\d+$/);
  assert.equal(notice.prompt, stuckPrompt);
  assert.match(notice.options[0], /^Done/);
  assert.match(notice.options[1], /^Hold/);
  assert.equal(notice.recommended, 0);
  await settle();
  assert.equal(rig.jarvisTurns(), 1, 'one wake per idle spell');
  assert.equal(notices(rig).length, 1, 'one question while the owner has not answered');
});

test('a no-news turn that fails posts the failure question as before, and no stuck question beside it', async t => {
  const rig = coordinated(t);
  stuck(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.jarvis[0].end(1);
  const notice = await until('the action question', () => notices(rig)[0]);
  assert.match(notice.prompt, /^Action for you: Jarvis could not run for tl-1: /);
  await settle();
  assert.equal(notices(rig).length, 1);
  assert.equal(rig.jarvisTurns(), 1);
  assert.match(rig.history().find(event => event.type === 'jarvis-turn-ended').detail, /^No-news turn/);
});

test('a no-news wake that staffs the story is not followed by a question', async t => {
  const rig = coordinated(t);
  stuck(rig);
  const { port } = await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  await requestStart('tl-1', 'You are the planner for tl-1.', port);
  rig.jarvis[0].end(0);
  await rest(rig);
  await settle();
  assert.equal(notices(rig).length, 0);
  assert.equal(rig.jarvisTurns(), 1);
});

test('a story created and never worked on is woken once and then put to the owner, not woken twice', async t => {
  const rig = coordinated(t);
  assert.equal(rig.story().phase, 'scout');
  assert.equal(rig.history().length, 1, 'the story has only its create event');
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.jarvis[0].end(0);
  await until('the action question', () => stuckNotice(rig.story()));
  await settle();
  assert.equal(rig.jarvisTurns(), 1);
});

test('Hold on the stuck question stops every wake and question until something new happens on the story', async t => {
  const rig = coordinated(t);
  stuck(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.jarvis[0].end(0);
  const notice = await until('the action question', () => stuckNotice(rig.story()));
  const hold = rig.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: notice.id, answer: 1 });
  await until('the Hold to be acknowledged', () => !rig.recorder.pending().some(event => event.seq === hold.seq));
  await settle();
  assert.equal(rig.jarvisTurns(), 1, 'no wake after Hold');
  assert.equal(notices(rig).length, 1, 'no new question after Hold');

  rig.recorder.recordEvent({ story: 'tl-1', type: 'activity', detail: 'The owner looked at the story.' });
  await until('a second background Jarvis turn', () => rig.jarvisTurns() === 2);
  const [turn] = rig.jarvisMessages().length ? rig.jarvisMessages() : rig.jarvis.slice(1);
  assert.match(turn.input.prompt, noNews, 'a new event starts a new idle spell with its own wake');
});

test('Done on the stuck question gives Jarvis one more turn, and the question comes back if the story is still unstaffed', async t => {
  const rig = coordinated(t);
  stuck(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.jarvis[0].end(0);
  const first = await until('the action question', () => stuckNotice(rig.story()));
  rig.recorder.recordEvent({ story: 'tl-1', type: 'answer', question: first.id, answer: 0 });
  await until('one more Jarvis turn', () => rig.jarvisTurns() === 2);
  rig.ackAll();
  [...rig.jarvisMessages(), ...rig.jarvis.slice(1)][0].end(0);
  const second = await until('the question again', () => notices(rig).find(question => question.id !== first.id && !question.answer));
  assert.equal(second.prompt, stuckPrompt);
  await settle();
  assert.equal(rig.jarvisTurns(), 2, 'one turn for Done, no more until the owner answers again');
});

test('a restart between a no-news wake and the question does not wake Jarvis again', async t => {
  const rig = coordinated(t);
  stuck(rig);
  await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  rig.jarvis[0].end(0);
  await until('the turn to end', () => rig.history().some(event => event.type === 'jarvis-turn-ended'));
  await rig.close();
  await rig.open();
  await settle();
  assert.equal(rig.jarvisTurns(), 1, 'the mark is a stored event, so the restart does not repeat the wake');
  assert.equal(notices(rig).filter(question => !question.answer).length, 1, 'the owner is asked once');
});

for (const [name, arrange] of Object.entries({
  'a story in ci': rig => {
    scoutHandedOff(rig);
    const write = (type, extra = {}) => rig.recorder.recordEvent({ story: 'tl-1', type, ...extra });
    write('plan', { detail: 'Export selected rows.' });
    write('approve');
    for (const detail of ['Red verified.', 'Green.', 'Gates pass.', 'Gates pass.']) write('handoff', { detail, command: 'node --test' });
    write('handoff', { detail: 'Mutation pass.', command: 'npx stryker run' });
    write('handoff', { detail: 'Review clean.' });
    write('comparison-choice', { run: false });
    write('pr-opened', { url: 'https://github.com/acme/widgets/pull/1' });
    assert.equal(rig.story().phase, 'ci');
  },
  'a story in a phase with no worker': rig => {
    scoutHandedOff(rig);
    rig.recorder.recordEvent({ story: 'tl-1', type: 'plan', detail: 'Export selected rows.' });
    assert.equal(rig.story().phase, 'approval');
  },
  'a story with a worker': rig => staffed(rig),
  'a blocked story': rig => {
    scoutHandedOff(rig);
    rig.recorder.recordEvent({ story: 'tl-1', type: 'blocked', detail: 'Needs the owner.' });
  },
  'a story with an open question': rig => {
    scoutHandedOff(rig);
    rig.recorder.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0, by: 'jarvis' });
  },
  'a story awaiting cleanup': rig => {
    scoutHandedOff(rig);
    rig.recorder.recordEvent({ story: 'tl-1', type: 'request-cleanup' });
  },
})) {
  test(name + ' is not woken with no news', async t => {
    const rig = coordinated(t);
    arrange(rig);
    rig.ackAll();
    await rig.open();
    await settle();
    assert.equal(rig.jarvisTurns(), 0);
    assert.equal(notices(rig).length, 0);
  });
}

test('a story whose worker start is in flight is not woken with no news', async t => {
  const rig = coordinated(t);
  stuck(rig);
  const release = rig.holdWorkerStart();
  const { port } = await rig.open();
  const started = requestStart('tl-1', 'You are the planner for tl-1.', port).catch(() => {});
  await settle();
  assert.equal(rig.jarvisTurns(), 0, 'nobody is idle while a worker is being started');
  release();
  await started;
  await settle();
  assert.equal(rig.jarvisTurns(), 0);
  assert.ok(rig.story().worker);
});

test('what Jarvis records while it staffs a story does not make the staffed story look idle', async t => {
  const rig = coordinated(t);
  stuck(rig);
  const { port } = await rig.open();
  await until('a background Jarvis turn', () => rig.story().jarvis?.turn);
  await requestStart('tl-1', 'You are the planner for tl-1.', port);
  rig.recorder.recordEvent({ story: 'tl-1', type: 'activity', detail: 'Jarvis started the planner.', by: 'jarvis' });
  rig.jarvis[0].end(0);
  await rest(rig);
  await settle();
  assert.equal(rig.jarvisTurns(), 1);
});
