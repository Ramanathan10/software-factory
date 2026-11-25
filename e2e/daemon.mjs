import { spawn } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnesses, messageWorker, startWorker } from '../adapters/harnesses.mjs';
import { loadAdapters, start } from '../command-center/serve.mjs';

const scripted = fileURLToPath(new URL('./scripted.mjs', import.meta.url));
const turns = join(process.env.AI_SDLC_HOME, 'scripted-turns.jsonl');
const note = (pid, event) => appendFileSync(turns, JSON.stringify({ pid, event }) + '\n');
const spawnProcess = (command, args, options) => {
  const child = spawn(process.execPath, [scripted, command, ...args], options);
  if (child.pid) {
    note(child.pid, 'spawned');
    child.once('exit', () => note(child.pid, 'exited'));
  }
  return child;
};
const settleMs = 2000;

const { url } = await start({
  port: Number(process.argv[2]),
  dbPath: process.env.AI_SDLC_CONSOLE_DB,
  adapters: loadAdapters(harnesses, (message, options) => messageWorker(message, { ...options, spawnProcess, settleMs })),
  launch: (input, options) => startWorker(input, { ...options, spawnProcess, settleMs }),
  quietMs: 2000,
  turnPollMs: 250,
  watchSeconds: 30,
  ran: () => undefined,
});
console.log('Command Center: ' + url);
