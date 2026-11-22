// Runs the Command Center on its own, for harnesses that cannot host it themselves.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { harnessKey } from '../mission-console/roles.mjs';
import { createConsoleService } from './console-service.mjs';

export const DEFAULT_PORT = 4174;

// An adapter is adapters/<name>/adapter.mjs. It exports `harness`, the name stories record;
// `messageWorker({ session, prompt })`, which sends a prompt to a worker session; and, when the harness
// allows it, `wakeCoordinator({ prompt })`, which sends one to the Jarvis chat.
export async function loadAdapters(directory = fileURLToPath(new URL('../adapters/', import.meta.url))) {
  const adapters = new Map();
  for (const name of readdirSync(directory)) {
    const file = join(directory, name, 'adapter.mjs');
    if (!existsSync(file)) continue;
    const adapter = await import(pathToFileURL(file).href);
    adapters.set(harnessKey(adapter.harness), adapter);
  }
  return adapters;
}

// Hands one batch of the owner's decisions to the story's worker, as the factory runbook's event chain
// describes. `adapter` is undefined when the story's harness has none. A decision that cannot reach its
// worker stays pending in the store and goes to Jarvis, who tells the owner what to do next.
// Resolves to who was told: 'worker', 'coordinator', or 'nobody' (the reason is logged instead).
export async function deliver({ story, seqs, types, session }, adapter, log = console.log) {
  const event = '[Mission Console event] The owner recorded ' + types.join(', ') + ' on story ' + story + ' (event seq ' + seqs.join(', ') + '). ';
  let reason = !adapter ? 'its harness has no adapter' : !session ? 'no worker is assigned' : '';
  if (!reason) {
    try {
      await adapter.messageWorker({ session, prompt: event + 'Read the console, act on these events, acknowledge them, and continue.' });
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
      const harness = service.snapshot().find(story => story.id === decision.story)?.harness;
      return deliver(decision, adapters.get(harnessKey(harness)));
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.argv[2] ?? DEFAULT_PORT);
  try {
    const { url } = await start({ port, dbPath: process.env.AI_SDLC_CONSOLE_DB || undefined, adapters: await loadAdapters() });
    console.log('Command Center: ' + url);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    const address = 'http://127.0.0.1:' + port + '/';
    const ours = await fetch(address + 'api/meta').then(response => response.json()).then(meta => Boolean(meta.phases), () => false);
    console.log(ours ? 'Command Center is already running: ' + address : 'Port ' + port + ' is in use by another program. Pass a different port.');
    process.exitCode = ours ? 0 : 1;
  }
}
