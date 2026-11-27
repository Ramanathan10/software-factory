import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { openStore, workerPhases } from '../mission-console/store.mjs';

const decisions = new Set(['answer', 'approve', 'plan-feedback', 'comparison-choice', 'request-cleanup']);
const [command, ...args] = process.argv.slice(2);
const home = process.env.AI_SDLC_HOME;
process.on('exit', () => appendFileSync(join(home, 'scripted-turns.jsonl'), JSON.stringify({ pid: process.pid, event: 'exited' }) + '\n'));
const actor = process.env.AI_SDLC_ACTOR;
const after = flag => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const resumed = args.includes('--resume') || (args[0] === 'exec' && args[1] === 'resume');
const session = command === 'codex' ? (resumed ? args[2] : randomUUID()) : after(resumed ? '--resume' : '--session-id');

function fail(message) {
  console.error(message);
  process.exit(1);
}

if (command === 'codex' && !resumed) console.log(JSON.stringify({ type: 'thread.started', thread_id: session }));
appendFileSync(join(home, 'scripted-calls.jsonl'), JSON.stringify({ argv: [command, ...args], cwd: process.cwd(), session, actor }) + '\n');
if (after('--model') === 'no-such-model-e2e') fail('The model no-such-model-e2e does not exist or you do not have access to it.');

const prompt = readFileSync(0, 'utf8');
const id = /story ([A-Za-z0-9-]+)/.exec(prompt)?.[1];
if (!id) fail('The prompt names no story.');
let book;
try {
  book = JSON.parse(readFileSync(join(home, 'playbooks', id + '.json'), 'utf8'));
} catch (error) {
  fail('No playbook for story ' + id + ': ' + error.message);
}
const store = openStore(book.db);
const read = () => store.handover(id);
const sleep = ms => new Promise(done => setTimeout(done, ms));

function cli(file, cliArgs, input) {
  return spawnSync(process.execPath, [file, ...cliArgs], { input: input ?? '', encoding: 'utf8', timeout: 300000, windowsHide: true });
}

const why = result => '(' + (result.error?.message ?? result.signal ?? 'exit ' + result.status) + ') ' + (result.stderr + result.stdout).trim();

function record(fields) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const { story } = read();
    const event = { story: id, key: randomUUID(), revision: story.revision, ...(story.worker ? { assignment: story.worker.id } : {}), ...fields };
    const result = cli(book.console, ['record', book.db], JSON.stringify(event));
    if (result.status === 0) return;
    if (!/Story changed/.test(result.stderr)) fail('Recording ' + fields.type + ' was refused ' + why(result));
  }
  fail('Recording ' + fields.type + ' kept meeting a changed story.');
}

function ack(seq) {
  const result = cli(book.console, ['ack', book.db, String(seq)]);
  if (result.status !== 0) fail('Acknowledging event ' + seq + ' failed ' + why(result));
}

function serve(kind, input) {
  const result = cli(book.serve, [kind, id, String(book.port)], input);
  if (result.status !== 0 && !/already has a worker|already in progress|has no worker to start/.test(result.stderr)) {
    fail('serve.mjs ' + kind + ' ' + id + ' failed ' + why(result));
  }
}

function turnsRunning() {
  const turnsFile = join(home, 'scripted-turns.jsonl');
  const latest = new Map();
  if (existsSync(turnsFile)) {
    for (const line of readFileSync(turnsFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
      const { pid, event } = JSON.parse(line);
      latest.set(pid, event);
    }
  }
  const started = store.history(id).filter(event => event.type === 'turn-started').map(event => event.worker.turn.pid);
  return started.some(pid => pid !== process.pid && latest.get(pid) === 'spawned');
}

async function coordinate() {
  const deadline = Date.now() + book.turnMs;
  while (turnsRunning()) {
    if (Date.now() > deadline) fail('A worker turn on story ' + id + ' was still running after ' + book.turnMs / 1000 + ' s.');
    await sleep(250);
  }
  const wake = store.history(id).filter(event => event.type === 'jarvis-woken').length;
  const planned = book.jarvis?.find(entry => entry.wake === wake);
  if (planned) {
    for (const step of planned.steps) perform(step);
    return;
  }
  const { story, pending } = read();
  if (!story.worker && workerPhases.has(story.phase) && story.questions.every(question => question.answer)) {
    if (story.phase === 'publishing') for (const event of pending) if (event.type === 'comparison-choice') ack(event.seq);
    serve('start', book.next);
    if (story.pendingDecision) serve('deliver');
  }
  for (const event of pending) if (!decisions.has(event.type) && event.seq <= (story.jarvis?.handled ?? 0)) ack(event.seq);
}

const saved = {};

function fill(value) {
  if (typeof value === 'string') {
    const { story } = read();
    return value.replace(/\{\{answer:([^}]+)\}\}/g, (_, question) => story.questions.find(item => item.id === question)?.answer ?? '')
      .replace(/\{\{([^}:]+)\}\}/g, (_, name) => saved[name] ?? '');
  }
  if (Array.isArray(value)) return value.map(fill);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, fill(item)]));
  return value;
}

function perform(step) {
  if (step.record) return record(fill(step.record));
  if (step.ack) {
    for (const event of read().pending) if (step.ack.includes(event.type)) ack(event.seq);
    return;
  }
  if (step.write) {
    const file = resolve(step.write);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, fill(step.text));
    return;
  }
  if (step.run) {
    const [program, ...rest] = fill(step.run);
    const result = spawnSync(program === 'node' ? process.execPath : program, rest, { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) fail(step.run.join(' ') + ' failed ' + why(result));
    if (step.save) saved[step.save] = result.stdout.trim();
    return;
  }
  fail('Unknown playbook step: ' + JSON.stringify(step));
}

async function work() {
  const deadline = Date.now() + book.turnMs;
  let story;
  while ((story = read().story).worker?.session !== session) {
    if (Date.now() > deadline) fail('Session ' + session + ' was never assigned to story ' + id + '.');
    await sleep(250);
  }
  const assigned = store.history(id).filter(event => event.type === 'assign-worker').sort((a, b) => a.seq - b.seq);
  const keys = { role: story.worker.role, phase: story.phase, turn: resumed ? 'resumed' : 'first',
    worker: assigned.findIndex(event => event.worker?.id === story.worker.id) + 1 };
  const entry = book.turns.find(turn => turn.role === keys.role && turn.phase === keys.phase && turn.turn === keys.turn &&
    (turn.worker === undefined || turn.worker === keys.worker));
  if (!entry) fail('No playbook entry for ' + JSON.stringify(keys) + ' on story ' + id + '.');
  for (const step of entry.steps) perform(step);
}

try {
  if (actor === 'jarvis') await coordinate();
  else await work();
} finally {
  store.close();
}
