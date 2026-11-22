// Runs the Command Center on its own, for harnesses that cannot host it themselves.
//   node serve.mjs [port]                   start the dashboard
//   node serve.mjs deliver <story> [port]   hand a story's waiting decisions to its worker
import { pathToFileURL } from 'node:url';
import { harnesses, messageWorker } from '../adapters/harnesses.mjs';
import { harnessKey } from '../mission-console/roles.mjs';
import { createConsoleService } from './console-service.mjs';

export const DEFAULT_PORT = 4174;

// One adapter for each harness in adapters/harnesses.mjs whose workers are driven from the command line,
// keyed by the name stories record. An adapter has `messageWorker({ session, worktree, prompt })`, which
// sends a prompt to a worker session, and may have `wakeCoordinator({ prompt })`, which sends one to the
// Jarvis chat. A harness that messages workers from inside its own app delivers decisions there instead.
export function loadAdapters(table = harnesses, send = messageWorker) {
  return new Map(Object.keys(table).filter(harness => table[harness].workers === 'command-line')
    .map(harness => [harnessKey(harness), { messageWorker: message => send({ harness, ...message }) }]));
}

// Hands one batch of the owner's decisions to the story's worker, as the factory runbook's event chain
// describes. `adapter` is undefined when the story's harness has none. A decision that cannot reach its
// worker stays pending in the store and goes to Jarvis, who tells the owner what to do next.
// Resolves to who was told: 'worker', 'coordinator', or 'nobody' (the reason is logged instead).
export async function deliver({ story, seqs, types, session, worktree }, adapter, log = console.log) {
  const event = '[Mission Console event] The owner recorded ' + types.join(', ') + ' on story ' + story + ' (event seq ' + seqs.join(', ') + '). ';
  let reason = !adapter ? 'its harness has no adapter' : !session ? 'no worker is assigned' : '';
  if (!reason) {
    try {
      await adapter.messageWorker({ session, worktree, prompt: event + 'Read the console, act on these events, acknowledge them, and continue.' });
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

export async function start({ port = DEFAULT_PORT, dbPath, adapters = new Map() } = {}) {
  const service = createConsoleService({
    dbPath,
    onDecision: async decision => {
      const story = service.snapshot().find(story => story.id === decision.story);
      return deliver({ ...decision, worktree: story?.worktree }, adapters.get(harnessKey(story?.harness)));
    },
  });
  try {
    const server = await service.startServer(port);
    return { url: server.url, close: async () => { await server.close(); service.close(); } };
  } catch (error) {
    service.close();
    throw error;
  }
}

// Asks the running Command Center to hand a story's waiting decisions to its worker, so every decision
// reaches a worker through the one process that keeps a session to one turn at a time.
export async function requestDelivery(story, port = DEFAULT_PORT) {
  const origin = 'http://127.0.0.1:' + port;
  const response = await fetch(origin + '/api/deliver', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ story }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

const direct = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

//   node serve.mjs deliver <story> [port]
if (direct && process.argv[2] === 'deliver') {
  try {
    console.log(JSON.stringify(await requestDelivery(process.argv[3], Number(process.argv[4] ?? DEFAULT_PORT))));
  } catch (error) {
    console.error(error.cause?.code === 'ECONNREFUSED' ? 'The Command Center is not running. Start it with: node ' + process.argv[1] : error.message);
    process.exitCode = 1;
  }
} else if (direct) {
  const port = Number(process.argv[2] ?? DEFAULT_PORT);
  try {
    const { url } = await start({ port, dbPath: process.env.AI_SDLC_CONSOLE_DB || undefined, adapters: loadAdapters() });
    console.log('Command Center: ' + url);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const address = 'http://127.0.0.1:' + port + '/';
    const ours = await fetch(address + 'api/meta').then(response => response.json()).then(meta => Boolean(meta.phases), () => false);
    console.log(ours ? 'Command Center is already running: ' + address : 'Port ' + port + ' is in use by another program. Pass a different port.');
    process.exitCode = ours ? 0 : 1;
  }
}
