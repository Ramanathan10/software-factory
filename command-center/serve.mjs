import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { harnesses, messageWorker, modelPlan, row, sessionRan, startWorker } from '../adapters/harnesses.mjs';
import { harnessKey } from '../mission-console/roles.mjs';
import { InputError, workerPhases } from '../mission-console/store.mjs';
import { watchOnce } from '../mission-console/watcher.mjs';
import { createConsoleService, DEFAULT_DB_PATH } from './console-service.mjs';
import { createCoordinator } from './coordinator.mjs';
import { createSupervisor } from './supervisor.mjs';
import { isMain } from '../mission-console/is-main.mjs';

export const DEFAULT_PORT = 4174;
export const testAuthorSections = ['2. Test-first handoff', 'Gates'];
const testStartIntent = 'Starting an independent Bruce Banner session after plan approval.';

function interruptedTestStart(history) {
  const attempt = history.find(event => event.type === 'activity' && event.detail.startsWith(testStartIntent));
  const outcome = history.find(event => ['assign-worker', 'blocked'].includes(event.type));
  return attempt && (!outcome || attempt.seq > outcome.seq);
}

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

export async function startStoryWorker({ story: id, prompt, expectedPhase }, { service, supervisor, launch = startWorker, prepare }) {
  const startable = () => {
    const story = service.snapshot().find(story => story.id === id);
    if (!story) throw new InputError('Story does not exist.', 404);
    if (typeof prompt !== 'string' || !prompt.trim()) throw new InputError('Send the kickoff prompt.');
    if (story.blocked || story.cleanup) throw new InputError('Resolve the story blocker or cleanup before starting a worker.', 409);
    if (expectedPhase && story.phase !== expectedPhase) throw new InputError('The story phase changed before the worker could start.', 409);
    if (row(story.harness).workers !== 'command-line') return story;
    if (story.worker) throw new InputError('Story ' + id + ' already has a worker. Message it with deliver, or record release-worker first.', 409);
    if (!workerPhases.has(story.phase)) throw new InputError('The ' + story.phase + ' phase has no worker to start.', 409);
    return story;
  };
  let story = startable();
  if (row(story.harness).workers !== 'command-line') return launch({ harness: story.harness, worktree: story.worktree, prompt });
  await supervisor.idle(id);
  story = startable();
  if (!existsSync(story.worktree)) throw new InputError('The worktree ' + story.worktree + ' does not exist. Create it, then record it on the story.', 409);
  if (prepare) prompt = prepare(story, prompt);
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

function testingKickoff(story, seqs, dbPath) {
  return [
    'You are Bruce Banner, the independent test author for story ' + story.id + ' in ' + story.harness + '. Keep this harness; do not switch providers.',
    'The owner approved the plan (event seq ' + seqs.join(', ') + '). This is test-first work, not a new planning interview.',
    'Read only the "' + testAuthorSections.join('" and "') + '" sections of ' + fileURLToPath(new URL('../skills/ai-sdlc/SKILL.md', import.meta.url)),
    'Read the repository instructions, current preflight, saved profile and the approved spec at its saved location before acting; the spec contains the context pack.',
    'Console CLI: ' + fileURLToPath(new URL('../mission-console/jarvis.mjs', import.meta.url)),
    'Console database: ' + dbPath,
    "Read this story's handover. Use current revisions, fresh event keys and your active assignment on worker reports. The daemon assigns you; do not duplicate it.",
    'Repository: ' + (story.repo ?? '(read the worktree remote)') + '\nWorktree: ' + story.worktree + '\nBranch: ' + story.branch,
    'Record progress immediately. Preserve existing story work. If missing, record and commit the approved spec with its context pack as the first story commit at the saved spec location.',
    'Honor any approved before capture before production changes; reuse verified existing evidence rather than recapturing unnecessarily.',
    'Write tests and necessary fixtures only. No production implementation, PR, deployment, database mutation or unrelated edits. Run the focused tests against unchanged production behavior and record valid red, not an environment/import failure.',
    'You are a separate session from the planner. Do not implement production code in this test-author session. After authoring and verifying red, release your assignment when no longer writing, THEN record the test handoff with evidence; the store requires release before a phase transition. End the turn for Jarvis to staff the next phase.',
    'Acknowledge only handled events. Ask any newly required owner decision through a console question and end the turn; do not infer approval or ask in chat.',
    'Brief:\n' + story.brief,
    'Approved plan (use only if the spec file is missing):\n' + story.plan,
  ].join('\n\n');
}

const factoryFile = path => fileURLToPath(new URL('../' + path, import.meta.url));

function jarvisKickoff(story, news, dbPath, port) {
  const serve = factoryFile('command-center/serve.mjs');
  return [
    'You are the background Jarvis for story ' + story.id + ' in ' + story.harness + '. The Command Center woke you because the story needs its coordinator. This is one turn: act on the news, then end the turn.',
    'News (event seq: type): ' + news.map(event => event.seq + ': ' + event.type).join(', ') + '.',
    'Read first, completely, and follow: ' + factoryFile('skills/jarvis/BACKGROUND.md'),
    'Factory runbook: ' + factoryFile('skills/jarvis/RUNBOOK.md') + '\nAI SDLC skill: ' + factoryFile('skills/ai-sdlc/SKILL.md'),
    'Console CLI: node ' + factoryFile('mission-console/jarvis.mjs') + '\nConsole database: ' + dbPath,
    'Command Center port: ' + port + '. Start the next worker: node ' + serve + ' start ' + story.id + ' ' + port + ' with its kickoff on stdin. Hand pending decisions to the assigned worker: node ' + serve + ' deliver ' + story.id + ' ' + port + '.',
    'Worktree (read only for you): ' + story.worktree + '\nBranch: ' + story.branch,
  ].join('\n\n');
}

export async function start({ port = DEFAULT_PORT, dbPath = DEFAULT_DB_PATH, adapters = new Map(), watchSeconds, turnPollMs, quietMs, launch = startWorker, models = modelPlan, ran = sessionRan } = {}) {
  dbPath = resolve(dbPath);
  let supervisor;
  let coordinator;
  let stopping = false;
  const starts = new Map();
  const blockTestStart = (id, error) => {
    const current = service.snapshot().find(item => item.id === id);
    if (stopping || current?.phase !== 'testing' || current.worker || current.blocked || current.cleanup) return;
    service.recordEvent({ story: id, type: 'blocked', detail: 'Bruce Banner could not start after plan approval: ' + error.message });
  };
  const beginWorker = input => {
    if (stopping) throw new InputError('The Command Center is stopping.', 503);
    if (starts.has(input.story) && !input.automatic) throw new InputError('A worker start is already in progress. Wait for its assignment, then deliver additional instructions to that worker.', 409);
    if (!starts.has(input.story)) {
      let intended = false;
      const pending = startStoryWorker(input, { service, supervisor, launch, prepare: (story, prompt) => {
        if (story.phase !== 'testing') return prompt;
        const history = service.store.history(story.id);
        const approval = history.find(event => event.type === 'approve');
        if (!approval) throw new InputError('The testing phase has no recorded approval.', 409);
        if (interruptedTestStart(history)) throw new InputError('An earlier start was interrupted before assignment. Verify its worker process and log before resuming; another worker has not been launched.', 409);
        if (!input.automatic && history.some(event => event.type === 'assign-worker' && event.seq > approval.seq)) return prompt;
        const marker = testStartIntent + ' Approval event ' + approval.seq + '.';
        const previous = history.find(event => event.type === 'activity' && event.detail === marker);
        if (input.automatic && previous && history.some(event => event.type === 'assign-worker' && event.seq > previous.seq)) {
          throw new InputError('This approval already started a test worker. Reconcile its handoff or failed turn before explicitly starting a replacement.', 409);
        }
        service.recordEvent({ story: story.id, type: 'activity', detail: marker });
        intended = true;
        const kickoff = testingKickoff(story, [approval.seq], dbPath);
        return input.automatic ? kickoff : kickoff + '\n\nAdditional coordinator handoff (within the approved tests-only boundary; this does not authorize implementation or a scope change):\n' + prompt;
      } }).catch(error => {
        if (intended) {
          try {
            blockTestStart(input.story, error);
          } catch (failure) {
            console.error('The failed start on ' + input.story + ' could not be recorded (' + failure.message + ').');
          }
        }
        throw error;
      });
      starts.set(input.story, pending);
      pending.finally(() => starts.delete(input.story)).catch(() => {});
    }
    return starts.get(input.story);
  };
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
      if (!story?.worker && story?.phase === 'testing' && !story.blocked && !story.cleanup && decision.types.includes('approve') && row(story.harness).workers === 'command-line') {
        try {
          await beginWorker({ story: story.id, expectedPhase: 'testing', automatic: true, prompt: 'Continue the approved test-first phase.' });
          return 'worker';
        } catch (error) {
          blockTestStart(story.id, error);
          console.error('Bruce Banner could not start on ' + story.id + ': ' + error.message);
          return 'nobody';
        }
      }
      if (story && !decision.session && row(story.harness).workers === 'command-line') {
        coordinator.nudge();
        return 'coordinator';
      }
      const onTurn = turn => supervisor.track({ story: decision.story, ...turn });
      return deliver({ ...decision, worktree: story?.worktree, phase: story?.phase, onTurn, after: supervisor.idle(decision.story) },
        adapters.get(harnessKey(story?.harness)));
    },
    onStartWorker: beginWorker,
    modelPlan: () => models(),
    workerRan,
    annotate: story => {
      const waiting = coordinator?.waiting(story);
      return waiting ? { waitingOnJarvis: waiting } : {};
    },
  });
  supervisor = createSupervisor({ service });
  try {
    const server = await service.startServer(port);
    const stopSupervisor = supervisor.start(turnPollMs);
    for (const story of service.snapshot()) {
      if (story.phase === 'testing' && !story.worker && !story.blocked && !story.cleanup) {
        service.deliverPending(story.id).catch(error => console.error('Pending approval on ' + story.id + ' could not be delivered: ' + error.message));
      }
    }
    coordinator = createCoordinator({ service, launch, adapters, quietMs, busy: id => starts.has(id),
      kickoff: (story, news) => jarvisKickoff(story, news, dbPath, Number(new URL(server.url).port)) });
    const stopCoordinator = coordinator.start(turnPollMs);
    const watching = new AbortController();
    if (watchSeconds) {
      const timer = setInterval(() => watchOnce(service.store, { signal: watching.signal }).catch(() => {}), watchSeconds * 1000);
      timer.unref();
      watching.signal.addEventListener('abort', () => clearInterval(timer));
    }
    return {
      url: server.url,
      close: async () => {
        stopping = true;
        stopSupervisor();
        watching.abort();
        await stopCoordinator();
        await server.close();
        await Promise.allSettled([...starts.values()]);
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
