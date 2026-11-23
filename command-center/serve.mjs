// The factory daemon: the Command Center dashboard, the supervisor of every story worker's turns, and the
// PR watcher, in one process.
//   node serve.mjs [port]                   start the daemon
//   node serve.mjs start <story> [port]     start a story's worker; kickoff prompt on stdin
//   node serve.mjs deliver <story> [port]   hand a story's waiting decisions to its worker
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { harnesses, messageWorker, modelPlan, row, sessionRan, startWorker } from '../adapters/harnesses.mjs';
import { harnessKey } from '../mission-console/roles.mjs';
import { InputError, workerPhases } from '../mission-console/store.mjs';
import { watchOnce } from '../mission-console/watcher.mjs';
import { createConsoleService } from './console-service.mjs';
import { createSupervisor } from './supervisor.mjs';

export const DEFAULT_PORT = 4174;

// One adapter for each harness in adapters/harnesses.mjs whose workers are driven from the command line,
// keyed by the name stories record. An adapter has `messageWorker({ session, worktree, prompt })`, which
// sends a prompt to a worker session, and may have `wakeCoordinator({ prompt })`, which sends one to the
// Jarvis chat. A harness that messages workers from inside its own app delivers decisions there instead.
export function loadAdapters(table = harnesses, send = messageWorker) {
  return new Map(Object.keys(table).filter(harness => table[harness].workers === 'command-line')
    .map(harness => [harnessKey(harness), { messageWorker: (message, options) => send({ harness, ...message }, options) }]));
}

// Hands one batch of the owner's decisions to the story's worker, as the factory runbook's event chain
// describes. `adapter` is undefined when the story's harness has none. A decision that cannot reach its
// worker stays pending in the store and goes to Jarvis, who tells the owner what to do next.
// Resolves to who was told: 'worker', 'coordinator', or 'nobody' (the reason is logged instead).
// `onTurn` is told the turn the message started, so the daemon can watch it.
export async function deliver({ story, seqs, types, session, worktree, phase, onTurn }, adapter, log = console.log) {
  const event = '[Mission Console event] The owner recorded ' + types.join(', ') + ' on story ' + story + ' (event seq ' + seqs.join(', ') + '). ';
  let reason = !adapter ? 'its harness has no adapter' : !session ? 'no worker is assigned' : '';
  if (!reason) {
    try {
      await adapter.messageWorker({ session, worktree, phase, prompt: event + 'Read the console, act on these events, acknowledge them, and continue.' }, { onTurn });
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

// Starts the worker of one story and records it, so the daemon is the parent of the worker's program and
// hears the turn end. Resolves to what the harness table's start call resolves to: the session and log of
// a running worker, or what Jarvis does instead for a harness whose workers are not started from here.
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
    // Why the program could not be started is for the owner to read, not an internal fault.
    throw Object.assign(error, { status: 502, expose: true });
  }
  service.recordEvent({ story: id, type: 'assign-worker', key: randomUUID(), session: started.session });
  if (turn) supervisor.track({ story: id, ...turn });
  return started;
}

// `watchSeconds` is how often registered pull requests are observed; left out, the daemon does not watch.
// `ran` reads what a worker session last ran on from its harness's record; see `sessionRan`.
export async function start({ port = DEFAULT_PORT, dbPath, adapters = new Map(), watchSeconds, turnPollMs, launch, models = modelPlan, ran = sessionRan } = {}) {
  let supervisor;
  // session -> { at, value }: the record is read again at most every few seconds, and only while the
  // session's turn is running or nothing has been read from it yet.
  const lastRan = new Map();
  const workerRan = story => {
    const { session, turn } = story.worker;
    const known = lastRan.get(session);
    if (!known || ((turn || !known.value) && Date.now() - known.at > 5000)) {
      let value;
      try { value = ran(story.harness, session); } catch { /* a harness with no workers here has no record */ }
      lastRan.set(session, { at: Date.now(), value: value ?? known?.value });
    }
    return lastRan.get(session).value;
  };
  const service = createConsoleService({
    dbPath,
    onDecision: async decision => {
      const story = service.snapshot().find(story => story.id === decision.story);
      const onTurn = turn => supervisor.track({ story: decision.story, ...turn });
      return deliver({ ...decision, worktree: story?.worktree, phase: story?.phase, onTurn }, adapters.get(harnessKey(story?.harness)));
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

// Asks the running daemon to start a story's worker, so the daemon is the one that watches it.
export const requestStart = (story, prompt, port = DEFAULT_PORT) => post('/api/worker/start', { story, prompt }, port);

// Asks the running Command Center to hand a story's waiting decisions to its worker, so every decision
// reaches a worker through the one process that keeps a session to one turn at a time.
export const requestDelivery = (story, port = DEFAULT_PORT) => post('/api/deliver', { story }, port);

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

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
