import { execFile, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { isAlive } from '../command-center/supervisor.mjs';
import { openStore } from '../mission-console/store.mjs';

const run = promisify(execFile);
const slashes = path => path.replaceAll('\\', '/');
const consoleCli = fileURLToPath(new URL('../mission-console/jarvis.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('../command-center/serve.mjs', import.meta.url));
const standIn = fileURLToPath(new URL('./gh-stand-in.mjs', import.meta.url));

export function expect(condition, message) {
  if (!condition) throw new Error(message);
}

function brief(story, db) {
  return [
    'You are a test worker in an automated end-to-end check of a story console. Your story is ' + story + '.',
    'Do only the numbered steps below. Run no other commands, read no skills or repository instructions, and change no files except scratch JSON files in the current directory.',
    'How the console works:',
    '- Read the story: node "' + slashes(consoleCli) + '" handover "' + slashes(db) + '" ' + story + '\n  It prints JSON with story.revision, story.worker.id (your assignment), story.questions, and pending (events not yet acknowledged, each with seq and type).',
    '- Record an event: send one JSON object on standard input to: node "' + slashes(consoleCli) + '" record "' + slashes(db) + '"\n  Pipe it however your shell allows; writing it to a file first is fine. Every event needs "story", "type", "key" (any new unique string) and "revision" (the story\'s current revision). It prints the new revision.',
    '- Acknowledge an event: node "' + slashes(consoleCli) + '" ack "' + slashes(db) + '" <seq>',
    '- If story.worker is missing when you read the story, wait two seconds and read it again until it appears.',
  ].join('\n');
}

export const onAnswer = (story, question) => [
  'You will be messaged again when the owner answers. In that later turn:',
  '1. Read the story. Find the answer to question "' + question + '" in story.questions, and the event of type "answer" in pending.',
  '2. Record {"story":"' + story + '","type":"activity","assignment":"<story.worker.id>","detail":"E2E answer received: <the answer text>"} with key and revision filled in.',
  '3. Acknowledge the seq of that answer event.',
  '4. End your turn.',
].join('\n');

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function openRig({ entry, model, unrestricted, turnMs, tally, profile: overrides = {} }) {
  const root = mkdtempSync(join(realpathSync.native(tmpdir()), 'factory-e2e-'));
  const worktree = join(root, 'work');
  const home = join(worktree, '.factory-e2e');
  const db = join(home, 'console.sqlite');
  mkdirSync(home, { recursive: true });
  const bin = join(root, 'bin');
  const github = join(root, 'github');
  mkdirSync(bin);
  mkdirSync(join(root, 'gh-config'));
  writeFileSync(join(bin, 'gh'), '#!/bin/sh\nexec "' + slashes(process.execPath) + '" "' + slashes(standIn) + '" "' + slashes(github) + '" "$@"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'gh.cmd'), '@"' + process.execPath + '" "' + standIn + '" "' + github + '" %*\r\n');
  await run('git', ['init', '-q'], { cwd: worktree });
  const models = model ? { [entry.id]: { deep: model, standard: model, fast: model } } : {};
  const profile = {
    workerPermissions: unrestricted ? 'unrestricted' : 'restricted',
    ...overrides,
    models: { ...models, ...overrides.models, [entry.id]: { ...models[entry.id], ...overrides.models?.[entry.id] } },
  };
  writeFileSync(join(home, 'profile.json'), JSON.stringify(profile));
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: bin + delimiter + process.env[pathKey], GH_CONFIG_DIR: join(root, 'gh-config'), AI_SDLC_HOME: home, AI_SDLC_CONSOLE_DB: db };
  if (model) env.CLAUDE_CODE_SUBAGENT_MODEL = model;
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[key];
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const store = openStore(db);
  let daemonOutput = '';
  const daemon = spawn(process.execPath, [launcher, String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [daemon.stdout, daemon.stderr]) stream.on('data', chunk => { daemonOutput += chunk; });

  const everyEvent = () => store.snapshot().flatMap(story => story.events);
  const jarvisPids = new Set();
  const turnPids = () => {
    for (const story of store.snapshot()) if (story.jarvis?.turn?.pid) jarvisPids.add(story.jarvis.turn.pid);
    return [...everyEvent().filter(event => event.type === 'turn-started').map(event => event.worker.turn.pid), ...jarvisPids];
  };
  const lastLog = () => {
    const turn = everyEvent().filter(event => event.type === 'turn-started').sort((a, b) => b.seq - a.seq)[0];
    try { return readFileSync(turn.worker.turn.log, 'utf8').trim().slice(-800); } catch { return '(no log)'; }
  };
  const launch = (command, story, input) => {
    const child = execFile(process.execPath, [launcher, command, story, String(port)], { env, timeout: turnMs + 60000 });
    child.stdin.end(input ?? '');
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    return new Promise((resolve, reject) => child.on('close', code => (code
      ? reject(new Error('serve.mjs ' + command + ' ' + story + ' failed: ' + (err || out).trim()))
      : resolve(JSON.parse(out)))));
  };

  const rig = {
    harness: entry.name,
    root, home, db, env, profile, github, turnMs,
    console: consoleCli,
    lastLog,
    worktree,
    port,
    launcher,
    jarvisWakes: story => rig.history(story).filter(item => item.type === 'jarvis-woken'),
    script({ next, deliver }) {
      const kickoff = join(worktree, 'next-kickoff.txt');
      writeFileSync(kickoff, next);
      const text = [
        '# End-to-end check',
        'This folder is a throwaway workspace for an automated end-to-end check of the story console. Nothing here is real work.',
        'If you are the background Jarvis for a story here, do not plan, write code or read other repositories. Do exactly this, then end your turn:',
        '1. Start the next worker for the story with: node "' + slashes(launcher) + '" start <story> ' + port + ' < next-kickoff.txt',
        ...(deliver ? ['2. Then hand it the pending decisions with: node "' + slashes(launcher) + '" deliver <story> ' + port] : []),
        'Acknowledge the news you were given, record nothing else, and never ask anything in chat.',
      ].join('\n\n');
      for (const name of ['AGENTS.md', 'CLAUDE.md']) writeFileSync(join(worktree, name), text + '\n');
    },
    brief: story => brief(story, db),
    snapshot: story => store.snapshot().find(item => item.id === story),
    history: story => (rig.snapshot(story) ? store.history(story).toReversed() : []),
    event: (story, type, match = () => true) => rig.history(story).find(item => item.type === type && match(item)),
    turnsEnded: (story, count) => rig.history(story).filter(item => item.type === 'turn-ended').length >= count && !rig.snapshot(story).worker?.turn,
    acknowledged: (story, seq) => !store.pendingFor(story).some(item => item.seq === seq),
    daemonSaid: pattern => pattern.test(daemonOutput),
    processEnded: pid => !isAlive(pid),
    create(story, { scouted = true, ...fields } = {}) {
      const created = store.record({ story, key: story + '-create', type: 'create', title: 'End-to-end check ' + story, detail: 'Exercise the factory with real workers.', branch: 'e2e', worktree, harness: entry.name, ...fields });
      if (scouted) store.record({ story, key: story + '-scout', type: 'handoff', revision: created.revision, detail: 'Context pack ready.' });
    },
    start: (story, kickoff) => launch('start', story, kickoff),
    deliver: story => launch('deliver', story),
    async decide(body) {
      const response = await fetch(origin + '/api/decision', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error('The decision was refused: ' + result.error);
      return result;
    },
    waitAny(after, seconds) {
      const child = execFile(process.execPath, [consoleCli, 'wait-any', db, String(after), String(seconds)], { env });
      let out = '';
      child.stdout.on('data', chunk => { out += chunk; });
      return new Promise((resolve, reject) => child.on('close', code => (code ? reject(new Error('wait-any failed.')) : resolve(JSON.parse(out)))));
    },
    async until(what, check, ms = turnMs, gaveUp = () => false) {
      const deadline = Date.now() + ms;
      for (;;) {
        const found = check();
        if (found) return found;
        if (gaveUp() && !check()) throw new Error('The worker ended its turn without ' + what + '. Its log ends:\n' + lastLog());
        if (Date.now() > deadline) throw new Error('Timed out after ' + ms / 1000 + 's waiting for ' + what + '.');
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    },
    worker: (story, turns, what, check) => rig.until(what, check, turnMs, () => rig.turnsEnded(story, turns)),
    async step(label, body) {
      tally.steps += 1;
      const number = tally.steps;
      const began = Date.now();
      try {
        const result = await body();
        console.log('ok ' + number + ' - ' + label + ' (' + ((Date.now() - began) / 1000).toFixed(1) + 's)');
        return result;
      } catch (error) {
        tally.failed += 1;
        console.log('not ok ' + number + ' - ' + label + '\n  ' + error.message.replaceAll('\n', '\n  '));
        throw error;
      }
    },
    async checkTurns() {
      for (const story of store.snapshot()) {
        const turns = story.events.toReversed().filter(item => ['turn-started', 'turn-ended', 'release-worker'].includes(item.type));
        const doubled = turns.find((item, at) => item.type === 'turn-started' && turns[at + 1]?.type === 'turn-started');
        expect(!doubled, story.id + ' has two turns running at once (seq ' + doubled?.seq + ').');
        const bad = turns.find(item => item.type === 'turn-ended' && item.worker.lastTurn.outcome !== 'ended');
        expect(!bad, story.id + ' has a turn that ' + bad?.worker.lastTurn.outcome + ': ' + bad?.detail);
      }
      await rig.until('worker processes to end', () => turnPids().every(pid => !isAlive(pid)), 30000);
    },
    async close({ keep }) {
      daemon.kill();
      try {
        for (const pid of turnPids().filter(isAlive)) process.kill(pid);
      } catch (error) {
        console.log('# A worker process could not be stopped (' + error.message + ').');
      }
      store.close();
      await new Promise(resolve => (daemon.exitCode === null ? daemon.once('close', resolve) : resolve()));
      if (keep) {
        console.log('# Kept for inspection: ' + root + '\n# Worker logs: ' + join(home, 'workers') + '\n# Command Center output:\n' + daemonOutput.trim().split('\n').map(line => '#   ' + line).join('\n'));
      } else {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
      }
    },
  };
  try {
    await rig.until('the Command Center to start', () => daemonOutput.includes('Command Center: '), 15000);
  } catch (error) {
    await rig.close({ keep: true });
    throw error;
  }
  return rig;
}
