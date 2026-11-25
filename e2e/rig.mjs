import { execFile, spawn } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { harnesses, launchProblem } from '../adapters/harnesses.mjs';
import { isAlive } from '../command-center/supervisor.mjs';
import { openStore } from '../mission-console/store.mjs';

const run = promisify(execFile);
const slashes = path => path.replaceAll('\\', '/');
const consoleCli = fileURLToPath(new URL('../mission-console/jarvis.mjs', import.meta.url));
const launcher = fileURLToPath(new URL('../command-center/serve.mjs', import.meta.url));
const daemonFile = fileURLToPath(new URL('./daemon.mjs', import.meta.url));
const standIn = fileURLToPath(new URL('./gh-stand-in.mjs', import.meta.url));

export function expect(condition, message) {
  if (!condition) throw new Error(message);
}

export const quietMs = 2000;

const modelPrograms = Object.values(harnesses).filter(entry => entry.workers === 'command-line').map(entry => entry.command);
const programFiles = ['', '.exe', '.com', '.cmd', '.bat', '.ps1'];
const holdsNode = dir => ['node', 'node.exe'].some(name => existsSync(join(dir, name)));
const holdsModelProgram = dir => modelPrograms.some(command => programFiles.some(extension => existsSync(join(dir, command + extension))));

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

export async function openRig({ entry, turnMs, tally, profile: overrides = {} }) {
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
  const profile = { workerPermissions: 'restricted', ...overrides };
  writeFileSync(join(home, 'profile.json'), JSON.stringify(profile));
  const pathKey = Object.keys(process.env).find(key => key.toUpperCase() === 'PATH') ?? 'PATH';
  const searched = (process.env[pathKey] ?? '').split(delimiter).filter(dir => dir && !holdsModelProgram(dir));
  if (!searched.some(holdsNode)) {
    const nodeOnly = join(root, 'node');
    const copy = join(nodeOnly, 'node' + extname(process.execPath));
    mkdirSync(nodeOnly);
    try {
      linkSync(process.execPath, copy);
    } catch {
      copyFileSync(process.execPath, copy);
    }
    searched.unshift(nodeOnly);
  }
  const env = { ...process.env, [pathKey]: [bin, ...searched].join(delimiter), GH_CONFIG_DIR: join(root, 'gh-config'), AI_SDLC_HOME: home, AI_SDLC_CONSOLE_DB: db };
  for (const key of Object.keys(env)) if (key !== pathKey && key.toUpperCase() === 'PATH') delete env[key];
  for (const name of Object.keys(harnesses).filter(name => harnesses[name].workers === 'command-line')) {
    if (!launchProblem(name, env)) {
      rmSync(root, { recursive: true, force: true });
      throw new Error(name + '\'s model program is still on the PATH the Command Center gets, so a worker could spend model usage.');
    }
  }
  const calls = join(home, 'scripted-calls.jsonl');
  const playbooks = join(home, 'playbooks');
  mkdirSync(playbooks);
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN']) delete env[key];
  const port = await freePort();
  const origin = 'http://127.0.0.1:' + port;
  const store = openStore(db);
  let daemonOutput = '';
  const daemon = spawn(process.execPath, [daemonFile, String(port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [daemon.stdout, daemon.stderr]) stream.on('data', chunk => { daemonOutput += chunk; });

  const everyEvent = () => store.snapshot().flatMap(story => store.history(story.id));
  const turnsFile = join(home, 'scripted-turns.jsonl');
  const scriptedTurns = () => {
    const latest = new Map();
    if (existsSync(turnsFile)) {
      for (const line of readFileSync(turnsFile, 'utf8').split(/\r?\n/).filter(Boolean)) {
        const { pid, event } = JSON.parse(line);
        latest.set(pid, event);
      }
    }
    return latest;
  };
  const running = () => [...scriptedTurns()].filter(([, event]) => event === 'spawned').map(([pid]) => pid);
  const ended = pid => {
    const last = scriptedTurns().get(pid);
    return last ? last === 'exited' : !isAlive(pid);
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
    quietMs,
    playbook(story, { next = 'You are the next scripted worker for story ' + story + '.', turns = [] } = {}) {
      writeFileSync(join(playbooks, story + '.json'), JSON.stringify({ story, db, console: consoleCli, serve: launcher, port, turnMs, next, turns }, null, 2));
    },
    gh: (...args) => ['node', standIn, github, ...args],
    calls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)) : []),
    snapshot: story => store.snapshot().find(item => item.id === story),
    history: story => (rig.snapshot(story) ? store.history(story).toReversed() : []),
    event: (story, type, match = () => true) => rig.history(story).find(item => item.type === type && match(item)),
    turnsEnded: (story, count) => rig.history(story).filter(item => item.type === 'turn-ended').length >= count && !rig.snapshot(story).worker?.turn,
    acknowledged: (story, seq) => !store.pendingFor(story).some(item => item.seq === seq),
    daemonSaid: pattern => pattern.test(daemonOutput),
    processEnded: ended,
    create(story, { scouted = true, ...fields } = {}) {
      const created = store.record({ story, key: story + '-create', type: 'create', title: 'End-to-end check ' + story, detail: 'Exercise the factory with scripted workers.', branch: 'e2e', worktree, harness: entry.name, ...fields });
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
        const turns = store.history(story.id).toReversed().filter(item => ['turn-started', 'turn-ended', 'release-worker'].includes(item.type));
        const doubled = turns.find((item, at) => item.type === 'turn-started' && turns[at + 1]?.type === 'turn-started');
        expect(!doubled, story.id + ' has two turns running at once (seq ' + doubled?.seq + ').');
        const bad = turns.find(item => item.type === 'turn-ended' && item.worker.lastTurn.outcome !== 'ended');
        expect(!bad, story.id + ' has a turn that ' + bad?.worker.lastTurn.outcome + ': ' + bad?.detail);
      }
      await rig.until('worker processes to end', () => !running().length, 30000);
    },
    checkCalls() {
      const ran = rig.calls();
      expect(ran.length, 'No turn ran the scripted program; the calls file ' + calls + ' is empty or missing.');
      const events = everyEvent();
      const workerTurns = events.filter(item => item.type === 'turn-started').length;
      const jarvisTurns = events.filter(item => item.type === 'jarvis-woken').length;
      expect(ran.length === workerTurns + jarvisTurns, 'The scripted program ran ' + ran.length + ' times, but the console shows ' + workerTurns + ' worker turns and ' + jarvisTurns + ' Jarvis wakes.');
      const jarvisCalls = ran.filter(call => call.actor === 'jarvis').length;
      expect(jarvisCalls === jarvisTurns, jarvisCalls + ' scripted calls ran as Jarvis, but Jarvis was woken ' + jarvisTurns + ' times.');
      for (const call of ran) {
        const [command, ...args] = call.argv ?? [];
        const shaped = [entry.start, entry.message].some(kind => {
          const expected = kind({ session: call.session });
          return expected.every((arg, at) => args[at] === arg);
        });
        expect(command === entry.command && shaped, 'A turn did not run with ' + entry.name + '\'s start or resume arguments: ' + JSON.stringify(call.argv));
      }
      return ran.length;
    },
    async close({ keep }) {
      for (const pid of running()) {
        try {
          process.kill(pid);
        } catch (error) {
          if (error.code !== 'ESRCH') console.log('# A worker process could not be stopped (' + error.message + ').');
        }
      }
      daemon.kill();
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
