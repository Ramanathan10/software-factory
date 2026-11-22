import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { sendMedia } from '../mission-console/media.mjs';
import { phases, roles } from '../mission-console/roles.mjs';
import { InputError, openStore } from '../mission-console/store.mjs';

const legacyDb = join(homedir(), '.copilot', 'ai-sdlc-console', 'jarvis-missions.sqlite');
// Stories recorded while the console lived in the Copilot folder stay where they are.
export const DEFAULT_DB_PATH = existsSync(legacyDb)
  ? legacyDb
  : join(process.env.AI_SDLC_HOME || join(homedir(), '.ai-sdlc'), 'console', 'jarvis-missions.sqlite');

const host = '127.0.0.1';
const humanDecisions = new Set(['answer', 'approve', 'plan-feedback', 'comparison-choice', 'request-cleanup']);
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.css', ['app.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/markdown.js', ['markdown.js', 'text/javascript; charset=utf-8']],
].map(([route, [file, type]]) => [route, [readFileSync(new URL('./ui/' + file, import.meta.url)), type]]));
const security = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self'; base-uri 'none'; form-action 'none'",
};

function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, { 'Content-Type': type, ...security });
  response.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

async function readJson(request) {
  const body = await readBody(request, 32768, 'Decision exceeds 32 KiB.');
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new InputError('Expected valid JSON.');
  }
}

async function readBody(request, limit, message) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new InputError(message, 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const images = {
  png: { type: 'image/png', magic: [0x89, 0x50, 0x4e, 0x47] },
  jpg: { type: 'image/jpeg', magic: [0xff, 0xd8, 0xff] },
  webp: { type: 'image/webp', magic: [0x52, 0x49, 0x46, 0x46] },
};
const folderFor = story => String(story).replace(/[^\w-]/g, '_');
const imageOf = bytes => Object.entries(images).find(([, { magic }]) => magic.every((byte, index) => bytes[index] === byte))?.[0];

export function createConsoleService({ dbPath = DEFAULT_DB_PATH, onDecision, decisionDelayMs = 1500 } = {}) {
  mkdirSync(dirname(dbPath), { recursive: true });
  const store = openStore(dbPath);
  const currentRevision = story => store.snapshot().find(item => item.id === story)?.revision;
  const attachmentRoot = join(dirname(dbPath), 'attachments');
  // Batch a burst of decisions (e.g. "Send answers" posts one per question) into one wake-up per story.
  const batches = new Map();
  const notify = (story, recorded, type) => {
    if (!onDecision) return;
    const batch = batches.get(story) ?? { seqs: [], types: new Set() };
    clearTimeout(batch.timer);
    batch.seqs.push(recorded.seq);
    batch.types.add(type);
    batch.timer = setTimeout(() => {
      batches.delete(story);
      const record = store.snapshot().find(item => item.id === story);
      Promise.resolve(onDecision({ story, seqs: batch.seqs, types: [...batch.types], session: record?.worker?.session })).catch(() => {});
    }, decisionDelayMs);
    batches.set(story, batch);
  };

  const service = {
    snapshot: harness => store.snapshot(harness),
    pending: () => store.pending(),
    ack: seq => store.ack(seq),
    handover: story => store.handover(story),
    listAttachments(story) {
      const folder = join(attachmentRoot, folderFor(story));
      if (!existsSync(folder)) return [];
      return readdirSync(folder).filter(name => /^[\w.-]+$/.test(name)).sort().map(name => {
        const path = join(folder, name);
        return { name, path, url: '/attachments/' + folderFor(story) + '/' + name, size: statSync(path).size };
      });
    },
    saveAttachment(story, bytes) {
      if (currentRevision(story) === undefined) throw new InputError('Story not found.', 404);
      const ext = imageOf(bytes);
      if (!ext || bytes.length < 16) throw new InputError('Attach a PNG, JPEG, or WebP screenshot.');
      const folder = join(attachmentRoot, folderFor(story));
      mkdirSync(folder, { recursive: true });
      const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8) + '.' + ext;
      const path = join(folder, name);
      writeFileSync(path, bytes);
      return { name, path, url: '/attachments/' + folderFor(story) + '/' + name, size: bytes.length };
    },
    createStory({ story, title, detail, branch, worktree, harness } = {}) {
      for (const [name, value] of Object.entries({ story, title, harness })) {
        if (typeof value !== 'string' || !value.trim()) throw new InputError(name + ' is required.');
      }
      return store.record({ story, type: 'create', key: randomUUID(), title, detail, branch, worktree, harness });
    },
    recordEvent(event) {
      const next = { ...event, key: event.key ?? randomUUID() };
      if (next.type !== 'create' && next.revision === undefined) next.revision = currentRevision(next.story);
      return store.record(next);
    },
    startServer(port = 0) {
      const clients = new Set();
      let last = '';
      const frame = () => JSON.stringify({ at: new Date().toISOString(), stories: store.snapshot() });
      // Poll the store so events recorded by the CLI or other processes stream too.
      const tick = setInterval(() => {
        if (!clients.size) return;
        const next = frame();
        const changed = next.slice(next.indexOf(',"stories"')) !== last;
        if (changed) last = next.slice(next.indexOf(',"stories"'));
        for (const client of clients) client.write(changed ? 'event: stories\ndata: ' + next + '\n\n' : 'event: beat\ndata: {}\n\n');
      }, 1000);

      const server = createServer(async (request, response) => {
        const origin = 'http://' + host + ':' + server.address().port;
        try {
          const path = new URL(request.url, origin).pathname;
          if (request.method === 'GET' && assets.has(path)) {
            const [body, type] = assets.get(path);
            send(response, 200, body, type);
          } else if (request.method === 'GET' && path === '/api/stories') {
            send(response, 200, store.snapshot());
          } else if (request.method === 'GET' && path === '/api/media') {
            const query = new URL(request.url, origin).searchParams;
            await sendMedia(request, response, store.artifact(query.get('story'), query.get('id')));
          } else if (request.method === 'GET' && path === '/api/meta') {
            send(response, 200, { roles, phases });
          } else if (request.method === 'GET' && path === '/events') {
            response.writeHead(200, { 'Content-Type': 'text/event-stream', ...security, Connection: 'keep-alive' });
            response.write('retry: 2000\nevent: stories\ndata: ' + frame() + '\n\n');
            clients.add(response);
            request.on('close', () => clients.delete(response));
          } else if (request.method === 'POST' && path === '/api/decision') {
            if (request.headers.origin !== origin) throw new InputError('Decisions must come from the console.', 403);
            const event = await readJson(request);
            if (!humanDecisions.has(event?.type)) throw new InputError('Only human decisions are accepted here.', 403);
            const recorded = service.recordEvent(event);
            notify(event.story, recorded, event.type);
            send(response, 200, recorded);
          } else if (request.method === 'POST' && path === '/api/attachment') {
            if (request.headers.origin !== origin) throw new InputError('Attachments must come from the console.', 403);
            const story = new URL(request.url, origin).searchParams.get('story') ?? '';
            const bytes = await readBody(request, 10 * 1024 * 1024, 'Screenshot exceeds 10 MiB.');
            send(response, 200, service.saveAttachment(story, bytes));
          } else if (request.method === 'GET' && /^\/attachments\/[\w-]+\/[\w-]+\.(png|jpg|webp)$/.test(path)) {
            const [, , folder, name] = path.split('/');
            const file = join(attachmentRoot, folder, name);
            if (!existsSync(file)) throw new InputError('Route not found.', 404);
            send(response, 200, readFileSync(file), images[name.split('.').pop()].type);
          } else {
            send(response, 404, { error: 'Route not found.' });
          }
        } catch (error) {
          send(response, error.status ?? 500, { error: error instanceof InputError ? error.message : 'The store could not complete the request.' });
        }
      });

      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve({
          url: 'http://' + host + ':' + server.address().port + '/',
          close: () => new Promise(done => {
            clearInterval(tick);
            for (const client of clients) client.end();
            server.close(done);
          }),
        }));
      });
    },
    close: () => store.close(),
  };
  return service;
}
