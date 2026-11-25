import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { harnesses, messageWorker, startWorker } from '../adapters/harnesses.mjs';
import { loadAdapters, start } from '../command-center/serve.mjs';

const scripted = fileURLToPath(new URL('./scripted.mjs', import.meta.url));
const spawnProcess = (command, args, options) => spawn(process.execPath, [scripted, command, ...args], options);
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
