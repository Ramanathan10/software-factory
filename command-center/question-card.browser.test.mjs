import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, before, test } from 'node:test';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function findBrowser() {
  const named = process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH) ? [process.env.CHROME_PATH] : [];
  const installed = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  ].filter(existsSync);
  const names = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge', 'microsoft-edge-stable', 'chrome', 'msedge'];
  const onPath = (process.env.PATH ?? process.env.Path ?? '').split(delimiter).filter(Boolean)
    .flatMap(dir => names.flatMap(name => [join(dir, name), join(dir, name + '.exe')])).filter(existsSync);
  return [...named, ...installed, ...onPath][0] ?? null;
}

const browserPath = findBrowser();
const skip = browserPath ? false : 'No Chrome or Edge was found (set CHROME_PATH to one), so the question-card browser test did not run.';

const freePort = () => new Promise((resolve, reject) => {
  const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => resolve(port));
  });
});

const prompt = [
  'Which docs should change with the fix?',
  '',
  '1. First **bold** step',
  '2. Second step with `code`',
  '',
  '- bullet one',
  '- bullet two',
  '',
  '(a) lettered one',
  '(b) lettered two',
  '',
  '<img src=x onerror="window.__pwned=1"> and <script>window.__pwned=1</script>',
  '[bad](javascript:window.__pwned=1)',
].join('\n');

const readPrompt = `(() => {
  const group = document.querySelector('GROUP');
  const id = group?.getAttribute('aria-labelledby');
  const block = id ? document.getElementById(id) : null;
  if (!block) return { found: false, id };
  const tags = selector => block.querySelectorAll(selector).length;
  const lettered = [...block.querySelectorAll('p')].find(p => p.textContent.includes('(a) lettered one'));
  return {
    found: true,
    id,
    ordered: [...block.querySelectorAll('ol > li')].map(li => li.textContent),
    bullets: [...block.querySelectorAll('ul > li')].map(li => li.textContent),
    paragraphs: tags('p'),
    strong: [...block.querySelectorAll('strong')].map(node => node.textContent),
    code: [...block.querySelectorAll('code')].map(node => node.textContent),
    letteredBreaks: lettered ? lettered.querySelectorAll('br').length : -1,
    injected: document.querySelectorAll('GROUP img, GROUP script').length,
    jsLinks: [...block.querySelectorAll('a')].filter(a => /^javascript:/i.test(a.getAttribute('href') ?? '')).length,
    pwned: window.__pwned ?? null,
    text: block.textContent,
    legend: group.tagName === 'FIELDSET' ? group.querySelectorAll('legend').length : null,
    textareaLabel: group.querySelector('textarea')?.getAttribute('aria-label') ?? null,
  };
})()`;

let root;
let browser;
let socket;
let center;
let legacy;
let legacyStore;
let nextId = 0;
const waiting = new Map();

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId;
  waiting.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async expression => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};

async function until(expression, what) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const value = await evaluate(expression).catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  throw new Error('Timed out waiting for ' + what);
}

async function open(url) {
  await send('Page.navigate', { url });
}

before(async () => {
  if (skip) return;
  root = mkdtempSync(join(realpathSync.native(tmpdir()), 'qfmt-browser-'));
  const home = join(root, 'home');
  process.env.AI_SDLC_HOME = home;
  const dbPath = join(root, 'console.sqlite');
  const { openStore } = await import('../mission-console/store.mjs');
  const store = openStore(dbPath);
  store.record({ story: 'WEB-7', key: randomUUID(), type: 'create', title: 'Paginate the orders table', detail: 'Paginate the orders table', branch: 'story/web-7', worktree: join(root, 'work'), harness: 'Seed Harness', repo: 'example/web-app' });
  const { revision } = store.handover('WEB-7').story;
  store.record({ story: 'WEB-7', key: randomUUID(), revision, type: 'question', question: 'docs', prompt, options: ['Change all three', 'Change none'], recommended: 0 });
  store.close();

  const { start } = await import('./serve.mjs');
  center = await start({ port: await freePort(), dbPath, adapters: new Map(), quietMs: 3600000, launch: async () => { throw new Error('no worker may start in a browser test'); } });

  const { serve } = await import('../mission-console/jarvis.mjs');
  legacyStore = openStore(dbPath);
  legacy = serve(legacyStore, await freePort());
  await new Promise(resolve => legacy.once('listening', resolve));

  const profile = join(root, 'browser-profile');
  browser = spawn(browserPath, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--no-first-run', '--disable-gpu', '--window-size=1680,1050', 'about:blank'], { stdio: 'ignore' });
  let debugPort;
  for (let i = 0; i < 100 && !debugPort; i++) {
    try { debugPort = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { await sleep(100); }
  }
  assert.ok(debugPort, 'the browser never reported a DevTools port');
  let pages;
  for (let i = 0; i < 50 && !pages?.some(each => each.type === 'page'); i++) {
    pages = await fetch('http://127.0.0.1:' + debugPort + '/json/list').then(response => response.json(), () => null);
    if (!pages?.some(each => each.type === 'page')) await sleep(100);
  }
  const page = pages.find(each => each.type === 'page');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    const pending = message.id && waiting.get(message.id);
    if (!pending) return;
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message.result);
  });
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1680, height: 3200, deviceScaleFactor: 1, mobile: false });
});

after(async () => {
  try { socket?.close(); } catch {}
  if (browser?.pid) {
    if (process.platform === 'win32') await new Promise(resolve => execFile('taskkill', ['/pid', String(browser.pid), '/T', '/F'], () => resolve()));
    else browser.kill('SIGKILL');
  }
  await center?.close();
  await new Promise(resolve => legacy ? legacy.close(() => resolve()) : resolve());
  legacy?.closeAllConnections?.();
  try { legacyStore?.close(); } catch {}
  await sleep(500);
  try { if (root) rmSync(root, { recursive: true, force: true, maxRetries: 25, retryDelay: 200 }); } catch {}
});

const centerQuestion = async () => {
  await open(center.url);
  await until(`document.querySelector('#decisions h2 button.link')`, 'the Open inbox button');
  await evaluate(`document.querySelector('#decisions h2 button.link').click()`);
  await until(`document.querySelector('.decision.grooming .question')`, 'the question card');
  return evaluate(readPrompt.replaceAll('GROUP', '.decision.grooming .question'));
};

const shows = (result, where) => {
  assert.ok(result.found, where + ': no element holds the prompt, aria-labelledby is ' + result.id);
  assert.deepEqual(result.ordered, ['First bold step', 'Second step with code'], where + ': numbered lines are not an ol');
  assert.deepEqual(result.bullets, ['bullet one', 'bullet two'], where + ': dash lines are not a ul');
  assert.ok(result.paragraphs >= 3, where + ': blank lines do not make separate paragraphs (' + result.paragraphs + ' p)');
  assert.deepEqual(result.strong, ['bold'], where + ': ** is not bold');
  assert.deepEqual(result.code, ['code'], where + ': backticks are not code');
  assert.ok(result.letteredBreaks >= 1, where + ': (a) and (b) lines run together, no br between them');
};

const safe = (result, where) => {
  assert.equal(result.injected, 0, where + ': an img or script node was created from the prompt');
  assert.equal(result.pwned, null, where + ': injected script ran');
  assert.equal(result.jsLinks, 0, where + ': a javascript: link was rendered');
  assert.ok(result.text.includes('<img src=x onerror="window.__pwned=1">'), where + ': the img text is not shown literally');
  assert.ok(result.text.includes('<script>window.__pwned=1</script>'), where + ': the script text is not shown literally');
  assert.ok(result.text.includes('[bad](javascript:window.__pwned=1)'), where + ': the javascript: link is not shown as text');
};

test('the Command Center inbox card formats the prompt as lists, paragraphs and line breaks', { skip }, async () => {
  const result = await centerQuestion();
  shows(result, 'inbox card');
});

test('the Command Center inbox card shows injected HTML and a javascript: link as text, and the group is labelled by the prompt', { skip }, async () => {
  const result = await centerQuestion();
  assert.ok(result.found, 'no element holds the prompt, aria-labelledby is ' + result.id);
  assert.match(result.id, /^q-WEB-7-docs$/);
  safe(result, 'inbox card');
});

test('the legacy Mission Console question form formats the prompt, has no legend and is labelled by the prompt block', { skip }, async () => {
  await open('http://127.0.0.1:' + legacy.address().port + '/');
  await until(`document.querySelector('#questions fieldset')`, 'the legacy question form');
  const result = await evaluate(readPrompt.replaceAll('GROUP', '#questions fieldset'));
  shows(result, 'legacy form');
  safe(result, 'legacy form');
  assert.equal(result.legend, 0, 'the fieldset still has a legend');
  assert.ok(result.textareaLabel?.includes('Which docs should change with the fix?'), 'the textarea lost its aria-label: ' + result.textareaLabel);
});
