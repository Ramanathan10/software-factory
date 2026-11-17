import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { InputError, openStore } from './store.mjs';

const host = '127.0.0.1';
const browserEvents = new Set(['answer', 'approve', 'comparison-choice']);

function respond(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
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

function seed(store) {
  const add = (story, type, input) => store.record({ story, type, key: story + '-' + type, ...input });
  add('TL-142', 'create', {
    title: 'Stabilize orders pagination', detail: 'Keep cursor results stable when timestamps tie.',
    branch: 'tl-142-stable-pagination', worktree: '(sample) tmp/tl-142',
  });
  add('TL-142', 'plan', { revision: 1, detail: 'Keep the API shape and verify that orders with tied timestamps appear exactly once across pages.' });
  add('TL-142', 'approve', { revision: 2 });
  add('TL-142', 'activity', {
    revision: 3, detail: 'Strange saved a test for a cursor boundary with tied timestamps.',
    file: 'tests/orders-pagination.test.ts', change: 'Added test',
    diff: '+ expect(pageTwo.ids).toEqual([secondOrder.id]);',
  });
  add('TL-147', 'create', {
    title: 'Add CSV export to activity history', detail: 'Export activity data with existing access rules.',
    branch: 'tl-147-activity-export', worktree: '(sample) tmp/tl-147',
  });
  add('TL-147', 'question', {
    revision: 1, question: 'scope', prompt: 'Which rows should Cap include in the CSV plan?',
    options: ['All rows matching the current filters', 'Only rows on the current page', 'Only rows the user selects'], recommended: 0,
  });
}

function main() {
  const [command, file, argument, ...rest] = process.argv.slice(2);
  if (!['serve', 'demo', 'record', 'snapshot', 'pending', 'ack'].includes(command) ||
      (command !== 'demo' && !file) || rest.length ||
      (argument && !['serve', 'ack'].includes(command)) || (command === 'ack' && !argument)) {
    throw new InputError('Usage: node jarvis.mjs demo [port] | serve <db> [port] | record <db> | snapshot <db> | pending <db> | ack <db> <seq>');
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
    let result;
    if (command === 'record') result = store.record(JSON.parse(readFileSync(0, 'utf8').replace(/^\uFEFF/, '')));
    if (command === 'snapshot') result = store.snapshot();
    if (command === 'pending') result = store.pending();
    if (command === 'ack') result = store.ack(Number(argument));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
