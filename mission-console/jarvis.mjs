import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { InputError, openStore } from './store.mjs';
import { waitForAny, waitForWake, watch, watchOnce } from './watcher.mjs';
import { sendMedia } from './media.mjs';
import { isMain } from './is-main.mjs';

const host = '127.0.0.1';
const browserEvents = new Set(['answer', 'approve', 'comparison-choice', 'request-cleanup']);

function respond(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; media-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32768) throw new InputError('Event exceeds 32 KiB.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new InputError('Expected valid JSON.');
  }
}

export function serve(store, port) {
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/console.css', ['console.css', 'text/css; charset=utf-8']],
    ['/console.mjs', ['console.mjs', 'text/javascript; charset=utf-8']],
    ['/roles.mjs', ['roles.mjs', 'text/javascript; charset=utf-8']],
  ].map(([route, [file, type]]) => [route, [readFileSync(new URL(file, import.meta.url)), type]]));
  const server = createServer(async (request, response) => {
    const authority = host + ':' + server.address().port;
    const origin = 'http://' + authority;
    try {
      if (request.headers.host !== authority) throw new InputError('Use the local console URL.', 403);
      if (request.method === 'GET' && assets.has(request.url)) {
        const [file, type] = assets.get(request.url);
        respond(response, 200, file, type);
      } else if (request.method === 'GET' && request.url === '/api/stories') {
        respond(response, 200, store.snapshot());
      } else if (request.method === 'GET' && request.url.startsWith('/api/media?')) {
        const url = new URL(request.url, origin);
        await sendMedia(request, response, store.artifact(url.searchParams.get('story'), url.searchParams.get('id')));
      } else if (request.method === 'POST' && request.url === '/api/decision') {
        if (request.headers.origin !== origin) throw new InputError('The decision must come from the local console.', 403);
        if (request.headers['content-type'] !== 'application/json') throw new InputError('Send JSON.', 415);
        const event = await readJson(request);
        if (!browserEvents.has(event?.type)) throw new InputError('This endpoint accepts human decisions.', 403);
        respond(response, 200, store.record(event));
      } else {
        respond(response, 404, { error: 'Route not found.' });
      }
    } catch (error) {
      if (!(error instanceof InputError)) console.error(error);
      respond(response, error.status ?? 500, { error: error instanceof InputError ? error.message : 'The local store could not complete the request.' });
    }
  });
  server.listen(port, host);
  return server;
}

export function seed(store) {
  const add = (story, type, input) => store.record({ story, type, key: story + '-' + type, ...input });
  add('TL-142', 'create', {
    title: 'Stabilize orders pagination', detail: 'Keep cursor results stable when timestamps tie.',
    branch: 'tl-142-stable-pagination', worktree: '(sample) tmp/tl-142', harness: 'Codex',
  });
  add('TL-142', 'handoff', { revision: 1, detail: 'Scout mapped the orders query and its cursor tests.' });
  add('TL-142', 'plan', { revision: 2, detail: 'Keep the API shape and verify that orders with tied timestamps appear exactly once across pages.' });
  add('TL-142', 'approve', { revision: 3 });
  add('TL-142', 'activity', {
    revision: 4, detail: 'Test author saved a test for a cursor boundary with tied timestamps.',
    file: 'tests/orders-pagination.test.ts', change: 'Added test',
    diff: '+ expect(pageTwo.ids).toEqual([secondOrder.id]);',
  });
  add('TL-147', 'create', {
    title: 'Add CSV export to activity history', detail: 'Export activity data with existing access rules.',
    branch: 'tl-147-activity-export', worktree: '(sample) tmp/tl-147', harness: 'Cursor',
  });
  add('TL-147', 'handoff', { revision: 1, detail: 'Scout found the activity history view and its access rules.' });
  add('TL-147', 'question', {
    revision: 2, question: 'scope', prompt: 'Which rows should the CSV include?',
    options: ['All rows matching the current filters', 'Only rows on the current page', 'Only rows the user selects'], recommended: 0,
  });
}

async function main() {
  const [command, file, argument, secondsArg, ...rest] = process.argv.slice(2);
  if (!['serve', 'demo', 'record', 'snapshot', 'pending', 'handover', 'ack', 'watch', 'watch-once', 'wait', 'wait-any'].includes(command) ||
      (command !== 'demo' && !file) || rest.length || (secondsArg && !['wait', 'wait-any'].includes(command)) ||
      (argument && !['serve', 'snapshot', 'ack', 'handover', 'watch', 'wait', 'wait-any'].includes(command)) ||
      (['ack', 'handover', 'wait'].includes(command) && !argument)) {
    throw new InputError('Usage: node jarvis.mjs demo [port] | serve <db> [port] | record <db> | snapshot <db> [harness] | pending <db> | handover <db> <story> | ack <db> <seq> | watch <db> [interval-seconds] | watch-once <db> | wait <db> <story> [seconds] | wait-any <db> [after-seq] [seconds]');
  }
  const watchSeconds = Number(argument ?? 30);
  if (command === 'watch' && (!Number.isInteger(watchSeconds) || watchSeconds < 15 || watchSeconds > 3600)) {
    throw new InputError('Watch interval must be between 15 and 3600 seconds.');
  }
  const waitSeconds = Number(secondsArg ?? 30);
  if (command === 'wait' && (!Number.isInteger(waitSeconds) || waitSeconds < 0 || waitSeconds > 60)) {
    throw new InputError('Wait must be between 0 and 60 seconds.');
  }
  const after = argument === undefined ? undefined : Number(argument);
  const anySeconds = Number(secondsArg ?? 43200);
  if (command === 'wait-any' && ((after !== undefined && (!Number.isSafeInteger(after) || after < 0)) || !Number.isInteger(anySeconds) || anySeconds < 0 || anySeconds > 86400)) {
    throw new InputError('wait-any takes an event seq to start after, and up to 86400 seconds.');
  }
  const store = openStore(command === 'demo' ? ':memory:' : file);
  if (command === 'serve' || command === 'demo') {
    const port = Number((command === 'demo' ? file : argument) ?? 4173);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new InputError('Invalid port.');
    if (command === 'demo') seed(store);
    const server = serve(store, port);
    server.on('listening', () => console.log('Mission Console: http://' + host + ':' + server.address().port));
    server.on('close', () => store.close());
    return;
  }
  try {
    if (command === 'watch') {
      const controller = new AbortController();
      const stop = () => controller.abort();
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
      try {
        await watch(store, watchSeconds, controller.signal);
      } catch (error) {
        if (!controller.signal.aborted || error.name !== 'AbortError') throw error;
      } finally {
        for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, stop);
      }
      return;
    }
    let result;
    if (command === 'record') {
      const event = JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, ''));
      result = store.record(process.env.AI_SDLC_ACTOR === 'jarvis' ? { ...event, by: 'jarvis' } : event);
    }
    if (command === 'snapshot') result = store.snapshot(argument);
    if (command === 'pending') result = store.pending();
    if (command === 'handover') result = store.handover(argument);
    if (command === 'ack') result = store.ack(Number(argument));
    if (command === 'watch-once') result = await watchOnce(store);
    if (command === 'wait') result = await waitForWake(store, argument, waitSeconds);
    if (command === 'wait-any') result = await waitForAny(store, { after, seconds: anySeconds });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}

if (isMain(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
