import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { harnesses, messageWorker, modelPlan, row, sessionRan, startWorker } from '../adapters/harnesses.mjs';
import { harnessKey } from '../mission-console/roles.mjs';
import { InputError, workerPhases } from '../mission-console/store.mjs';
import { watchOnce } from '../mission-console/watcher.mjs';
import { createConsoleService } from './console-service.mjs';
import { createSupervisor } from './supervisor.mjs';
import { isMain } from '../mission-console/is-main.mjs';

export const DEFAULT_PORT = 4174;

export function loadAdapters(table = harnesses, send = messageWorker) {
  return new Map(Object.keys(table).filter(harness => table[harness].workers === 'command-line')
    .map(harness => [harnessKey(harness), { messageWorker: (message, options) => send({ harness, ...message }, options) }]));
}

export async function deliver({ story, seqs, types, session, worktree, phase, onTurn, after }, adapter, log = console.log) {
  const event = '[Mission Console event] The owner recorded ' + types.join(', ') + ' on story ' + story + ' (event seq ' + seqs.join(', ') + '). ';
  let reason = !adapter ? 'its harness has no adapter' : !session ? 'no worker is assigned' : '';
  if (!reason) {
    try {
      await adapter.messageWorker({ session, worktree, phase, prompt: event + 'Read the console, act on these events, acknowledge them, and continue.' }, { onTurn, after });
      return 'worker';
    } catch (error) {
      reason = 'the worker could not be messaged (' + error.message + ')';
    }
  }
  const prompt = event + 'It was not delivered: ' + reason + '. It stays pending. ' +
    'Follow "Undelivered decisions" in the factory runbook and tell the owner what to do next.';
  try {
    if (adapter?.wakeCoordinator) {
      await adapter.wakeCoordinator({ prompt });
      return 'coordinator';
    }
  } catch (error) {
    log('Jarvis could not be woken (' + error.message + ').');
  }
  log(prompt);
  return 'nobody';
}

export async function startStoryWorker({ story: id, prompt }, { service, supervisor, launch = startWorker }) {
  const story = service.snapshot().find(story => story.id === id);
  if (!story) throw new InputError('Story does not exist.', 404);
  if (typeof prompt !== 'string' || !prompt.trim()) throw new InputError('Send the kickoff prompt.');
  if (row(story.harness).workers !== 'command-line') return launch({ harness: story.harness, worktree: story.worktree, prompt });
  if (story.worker) throw new InputError('Story ' + id + ' already has a worker. Message it with deliver, or record release-worker first.', 409);
  if (!workerPhases.has(story.phase)) throw new InputError('The ' + story.phase + ' phase has no worker to start.', 409);
  if (!existsSync(story.worktree)) throw new InputError('The worktree ' + story.worktree + ' does not exist. Create it, then record it on the story.', 409);
  let turn;
  let started;
  try {
    started = await launch({ harness: story.harness, worktree: story.worktree, prompt, phase: story.phase }, { onTurn: running => { turn = running; } });
  } catch (error) {
    throw Object.assign(error, { status: 502, expose: true });
  }
  service.recordEvent({ story: id, type: 'assign-worker', key: randomUUID(), session: started.session });
  if (turn) supervisor.track({ story: id, ...turn });
  return started;
}

export async function start({ port = DEFAULT_PORT, dbPath, adapters = new Map(), watchSeconds, turnPollMs, launch, models = modelPlan, ran = sessionRan } = {}) {
  let supervisor;
  const lastRan = new Map();
  const workerRan = story => {
    const { session, turn } = story.worker;
    const known = lastRan.get(session);
    if (!known || ((turn || !known.value) && Date.now() - known.at > 5000)) {
      let value;
      try { value = ran(story.harness, session); } catch {}
      lastRan.set(session, { at: Date.now(), value: value ?? known?.value });
    }
    return lastRan.get(session).value;
  };
  const service = createConsoleService({
    dbPath,
    onDecision: async decision => {
      const story = service.snapshot().find(story => story.id === decision.story);
      const onTurn = turn => supervisor.track({ story: decision.story, ...turn });
      return deliver({ ...decision, worktree: story?.worktree, phase: story?.phase, onTurn, after: supervisor.idle(decision.story) },
        adapters.get(harnessKey(story?.harness)));
    },
    onStartWorker: input => startStoryWorker(input, { service, supervisor, launch }),
    modelPlan: () => models(),
    workerRan,
  });
  supervisor = createSupervisor({ service });
  try {
    const server = await service.startServer(port);
    const stopSupervisor = supervisor.start(turnPollMs);
    const watching = new AbortController();
    if (watchSeconds) {
      const timer = setInterval(() => watchOnce(service.store, { signal: watching.signal }).catch(() => {}), watchSeconds * 1000);
      timer.unref();
      watching.signal.addEventListener('abort', () => clearInterval(timer));
    }
    return {
      url: server.url,
      close: async () => {
        stopSupervisor();
        watching.abort();
        await server.close();
        service.close();
      },
    };
  } catch (error) {
    service.close();
    throw error;
  }
}

async function post(path, body, port) {
  const origin = 'http://127.0.0.1:' + port;
  const response = await fetch(origin + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}

export const requestStart = (story, prompt, port = DEFAULT_PORT) => post('/api/worker/start', { story, prompt }, port);

export const requestDelivery = (story, port = DEFAULT_PORT) => post('/api/deliver', { story }, port);

const direct = isMain(import.meta.url);

if (direct && ['deliver', 'start'].includes(process.argv[2])) {
  const port = Number(process.argv[4] ?? DEFAULT_PORT);
  try {
    console.log(JSON.stringify(process.argv[2] === 'start'
      ? await requestStart(process.argv[3], readFileSync(0, 'utf8').replace(/^\uFEFF/, ''), port)
      : await requestDelivery(process.argv[3], port)));
  } catch (error) {
    console.error(error.cause?.code === 'ECONNREFUSED' ? 'The Command Center is not running. Start it with: node ' + process.argv[1] : error.message);
    process.exitCode = 1;
  }
} else if (direct && !Number.isInteger(Number(process.argv[2] ?? DEFAULT_PORT))) {
  console.error('Usage: node serve.mjs [port] | start <story> [port] | deliver <story> [port]');
  process.exitCode = 2;
} else if (direct) {
  const port = Number(process.argv[2] ?? DEFAULT_PORT);
  try {
    const { url } = await start({ port, dbPath: process.env.AI_SDLC_CONSOLE_DB || undefined, adapters: loadAdapters(), watchSeconds: 30 });
    console.log('Command Center: ' + url);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const address = 'http://127.0.0.1:' + port + '/';
    const ours = await fetch(address + 'api/meta').then(response => response.json()).then(meta => Boolean(meta.phases), () => false);
    console.log(ours ? 'Command Center is already running: ' + address : 'Port ' + port + ' is in use by another program. Pass a different port.');
    process.exitCode = ours ? 0 : 1;
  }
}
