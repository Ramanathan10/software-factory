// The one table of agent harnesses: how each is installed and how its story workers are driven.
//   node harnesses.mjs start <harness> <worktree>   kickoff prompt on stdin; prints how the worker was started
// install.mjs reads the table to install the skills, and the Command Center imports `messageWorker` to hand
// the owner's decisions to a worker.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import { phaseTiers } from '../mission-console/roles.mjs';
import { isMain } from '../mission-console/is-main.mjs';

// One row per harness, keyed by the name stories record.
// Installing: `id` is the name install.mjs takes, `marker` the folder in the home directory whose presence
// shows the harness is installed, and `skills` where it reads skills. `install` is 'link' when the harness
// reads the skills in place, or 'copy' when it needs its own copies; a 'copy' harness may name an
// `extension` folder that receives the Command Center.
// Workers: `workers` is 'command-line' when a worker is a session of the harness's own program, 'in-app'
// when only the agent inside the harness can start one with the tools named in `start` and `message`, and
// 'none' when the harness cannot run workers yet.
// A command-line row gives `command`, and `start` and `message` return its arguments; the prompt always
// goes in on stdin. `permissions` holds the arguments for each choice of the profile's `workerPermissions`;
// `tools` are the programs a restricted worker may run. A row whose program chooses the session id itself
// gives `sessionFrom`, which finds the id in the program's output. `model` returns the arguments that run
// a turn on a named model; the name comes from the profile's `models`, never from this table.
// The program keeps its own record of each session, one JSON object to a line. `record` returns that
// file's path, or undefined when there is none yet, and `ran` returns the `{ model, effort }` a line of it
// shows a turn ran on, or undefined for a line that does not say.
function list(folder, recursive = false) {
  try { return readdirSync(folder, { recursive }); } catch { return []; }
}

export const harnesses = {
  'GitHub Copilot app': {
    id: 'copilot', marker: '.copilot', skills: join('.copilot', 'skills'), install: 'copy',
    extension: join('.copilot', 'extensions', 'ai-sdlc-console'),
    workers: 'in-app', start: 'create_session', message: 'send_session_message',
  },
  Cursor: { id: 'cursor', marker: '.cursor', skills: join('.cursor', 'skills'), install: 'link', workers: 'none' },
  'Claude Code': {
    id: 'claude-code', marker: '.claude', skills: join('.claude', 'skills'), install: 'link',
    workers: 'command-line',
    command: 'claude',
    start: ({ session }) => ['-p', '--session-id', session],
    message: ({ session }) => ['-p', '--resume', session],
    model: name => ['--model', name],
    record: ({ session, env }) => {
      const projects = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
      return list(projects).map(project => join(projects, project, session + '.jsonl')).find(file => existsSync(file));
    },
    // A subagent's lines are marked as a side chain, and a line the program wrote itself names no real model.
    ran: line => (line.type === 'assistant' && !line.isSidechain && /^[^<]/.test(line.message?.model ?? '')
      ? { model: line.message.model, effort: line.effort } : undefined),
    permissions: {
      restricted: tools => ['--permission-mode', 'acceptEdits', '--allowedTools', ...tools.map(tool => `Bash(${tool} *)`)],
      unrestricted: () => ['--permission-mode', 'bypassPermissions'],
    },
  },
  Codex: {
    id: 'codex', marker: '.codex', skills: join('.agents', 'skills'), install: 'link',
    workers: 'command-line',
    command: 'codex',
    start: () => ['exec', '--json'],
    message: ({ session }) => ['exec', 'resume', session],
    model: name => ['--model', name],
    record: ({ session, env }) => {
      const sessions = join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
      const file = list(sessions, true).find(name => name.endsWith(session + '.jsonl'));
      return file && join(sessions, file);
    },
    ran: line => (line.type === 'turn_context' && line.payload?.model ? { model: line.payload.model, effort: line.payload.effort } : undefined),
    // The prompt is read from stdin when the prompt argument is "-".
    promptArgument: '-',
    sessionFrom: output => /"thread_id":\s*"([^"]+)"/.exec(output)?.[1],
    permissions: {
      restricted: () => ['-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true'],
      unrestricted: () => ['--dangerously-bypass-approvals-and-sandbox'],
    },
  },
};

const home = (env = process.env) => env.AI_SDLC_HOME || join(homedir(), '.ai-sdlc');

// What a worker may do comes from the owner's profile: the permission choice, and for a restricted
// worker git, gh, node, and the program each repository's gates run. So does the model of each turn:
// `models` names a model for each tier, by harness id, and `phaseTiers` is each phase's tier, the
// factory's own unless the profile changes it.
export function workerSettings(env = process.env) {
  let profile = {};
  try { profile = JSON.parse(readFileSync(join(home(env), 'profile.json'), 'utf8')); } catch { /* no profile yet: restricted */ }
  const gateTools = Object.values(profile.repos ?? {}).flatMap(repo => Object.values(repo.gates ?? {}))
    .filter(command => typeof command === 'string' && command.trim()).map(command => command.trim().split(/\s+/)[0]);
  return {
    permissions: profile.workerPermissions === 'unrestricted' ? 'unrestricted' : 'restricted',
    tools: [...new Set(['git', 'gh', 'node', ...gateTools])],
    models: profile.models ?? {},
    phaseTiers: { ...phaseTiers, ...profile.phaseTiers },
  };
}

// Finds a row by the name stories record or by its install id, ignoring case.
export function row(harness) {
  const wanted = String(harness).trim().toLowerCase();
  const name = Object.keys(harnesses).find(key => key.toLowerCase() === wanted || harnesses[key].id === wanted);
  if (!name) throw new Error(`"${harness}" is not a known harness. Known: ${Object.keys(harnesses).join(', ')}.`);
  return { name, ...harnesses[name] };
}

// The model the profile names for a turn that starts in `phase`, or undefined to leave the choice to the
// harness: no phase given, a phase with no tier, or a tier the profile names no model for.
export function modelFor(harness, phase, { models = {}, phaseTiers: tierOf = phaseTiers } = workerSettings()) {
  return models[row(harness).id]?.[tierOf[phase]] || undefined;
}

// What the dashboard shows: each phase's tier, and the model named for each tier by harness, keyed by the
// lower-case name stories record.
export function modelPlan({ models = {}, phaseTiers: tierOf = phaseTiers } = workerSettings()) {
  return {
    phaseTiers: tierOf,
    models: Object.fromEntries(Object.entries(harnesses).map(([name, entry]) => [name.toLowerCase(), models[entry.id] ?? {}])),
  };
}

// session -> the path of the harness's record of it, once found.
const records = new Map();

// The model and effort a worker session last ran on, read from the end of the harness's own record of the
// session: `{ model, effort }`, with `effort` left out when the record does not give one. Undefined when
// the harness keeps no record this table can read, or the session has not run far enough to have one.
export function sessionRan(harness, session, env = process.env) {
  const entry = row(harness);
  if (!entry.record || !session) return undefined;
  try {
    if (!records.has(session)) {
      const found = entry.record({ session, env });
      if (!found) return undefined;
      records.set(session, found);
    }
    const file = openSync(records.get(session), 'r');
    try {
      // The newest lines usually say, and the record of a long session is large: read a longer end of it
      // only when a shorter one did not say.
      const size = fstatSync(file).size;
      for (let span = 1024 * 1024; ; span *= 8) {
        const tail = Buffer.alloc(Math.min(size, span));
        readSync(file, tail, 0, tail.length, size - tail.length);
        for (const text of tail.toString('utf8').split('\n').reverse()) {
          let line;
          try { line = JSON.parse(text); } catch { continue; }
          const ran = entry.ran(line);
          if (ran) return ran.effort ? { model: ran.model, effort: String(ran.effort) } : { model: ran.model };
        }
        if (span >= size) break;
      }
    } finally {
      closeSync(file);
    }
  } catch { /* the record cannot be read: say nothing */ }
  return undefined;
}

// The full command line for one worker turn. `phase` is the story's phase as the turn starts.
export function commandFor(harness, kind, { session, phase }, settings = workerSettings()) {
  const entry = row(harness);
  if (entry.workers !== 'command-line') throw new Error(`${entry.name} workers are not started from the command line.`);
  const { permissions, tools } = settings;
  const model = modelFor(harness, phase, settings);
  const args = [...entry[kind]({ session }), ...entry.permissions[permissions](tools), ...(model ? entry.model(model) : [])];
  return { command: entry.command, args: entry.promptArgument ? [...args, entry.promptArgument] : args };
}

// Why a command-line harness's program cannot be started, or null when it can. Windows starts only an
// .exe or .com directly; a .cmd or .bat that forwards to a script, as an npm install leaves, is refused
// here instead of being run through a shell that would reinterpret the arguments.
export function launchProblem(harness, env = process.env, platform = process.platform) {
  const { name, command } = row(harness);
  const has = extensions => (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
    .some(dir => extensions.some(extension => existsSync(join(dir, command + extension))));
  if (has(platform === 'win32' ? ['.exe', '.com'] : [''])) return null;
  return platform === 'win32' && has(['.cmd', '.bat'])
    ? `${name} is installed as a ${command}.cmd script, which cannot be started directly on Windows. Install ${name}'s native program, which provides ${command}.exe.`
    : `${name}'s program "${command}" was not found on PATH. Install ${name}, or choose another harness for the story.`;
}

// A failure to start the program, said in terms the owner can act on.
const explained = (harness, error, env) => (error.code === 'ENOENT' && launchProblem(harness, env) ? new Error(launchProblem(harness, env)) : error);

// Runs one turn in the worktree with the prompt on stdin. The turn outlives this process; its output goes to `log`.
function run({ command, args }, { worktree, prompt, log, spawnProcess = spawn }) {
  const output = openSync(log, 'a');
  const child = spawnProcess(command, args, { cwd: worktree, detached: true, windowsHide: true, stdio: ['pipe', output, output] });
  // The program has its own handle on the log now.
  closeSync(output);
  child.stdin?.on('error', () => {}).end(prompt);
  return child;
}

// Where a session's turns are logged, under `workers` in the AI SDLC home.
function logFor(name, env) {
  const folder = join(home(env), 'workers');
  mkdirSync(folder, { recursive: true });
  return join(folder, name + '.log');
}

// Resolves to the program's exit code once the turn ends, or null when it is not known.
const exit = child => new Promise(resolve => child.once('close', code => resolve(code ?? null)).once('error', () => resolve(null)));

const started = child => new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));

// How long a new turn is watched before it is called running. A sign-in, model, or argument problem ends
// the program with an error within seconds; a real Codex turn refused for its model took a little over five.
const SETTLE_MS = 10000;

// Resolves once the turn has run for `ms` or ended cleanly. Rejects when it ended with an error in that
// time, with the last lines it wrote, so a turn that never began is not reported as a running worker.
function settled(child, { harness, log, ms = SETTLE_MS }) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    child.once('close', code => {
      clearTimeout(timer);
      if (!code) return resolve();
      let tail = '';
      try { tail = readFileSync(log, 'utf8').trim().split(/\r?\n/).slice(-3).join('\n'); } catch { /* nothing was written */ }
      reject(new Error(`${harness} ended its turn at once with an error (exit code ${code}).${tail ? '\n' + tail : ''}\nSee ${log}.`));
    });
  });
}

// session -> a promise that settles when the turn this process started for it ends.
const turns = new Map();

// Sends a prompt to an existing worker session. Waits for a turn this process already started for that
// session, and for `options.after`, so one session never runs two turns at once, and resolves once the new
// turn is running. `options.onTurn` is told the turn's `pid`, `log`, and `ended`, a promise of its exit code,
// as soon as its process exists.
export async function messageWorker({ harness, session, worktree, prompt, phase }, options = {}) {
  const invocation = commandFor(harness, 'message', { session, phase }, options.settings);
  const previous = Promise.all([turns.get(session), options.after]);
  let finish;
  turns.set(session, new Promise(resolve => { finish = resolve; }));
  try {
    await previous;
    const log = logFor(session, options.env);
    const child = run(invocation, { worktree, prompt, log, spawnProcess: options.spawnProcess });
    child.once('close', finish).once('error', finish);
    const ended = exit(child);
    // Reported as soon as the process exists, so a daemon that restarts while the turn settles finds it in the store.
    if (child.pid) options.onTurn?.({ session, pid: child.pid, log, ended });
    await started(child);
    await settled(child, { harness, log, ms: options.settleMs });
    child.unref?.();
  } catch (error) {
    finish();
    throw explained(harness, error, options.launchEnv);
  }
}

// Starts a new worker session and resolves to its session id once the harness has reported it.
// For a harness whose workers are not started from the command line it starts nothing, and resolves to
// what Jarvis does instead, so the same call is the first step in every harness.
export async function startWorker({ harness, worktree, prompt, phase }, options = {}) {
  const entry = row(harness);
  if (entry.workers === 'in-app') {
    return { inApp: true, start: entry.start, message: entry.message, next: `Start the worker with ${entry.start}, as the "${entry.name}" section of the factory runbook describes.` };
  }
  if (entry.workers === 'none') {
    return { noWorkers: true, next: `${entry.name} cannot run workers yet. Tell the owner before doing the story's work in the Jarvis chat.` };
  }
  const session = randomUUID();
  const log = logFor(session, options.env);
  const child = run(commandFor(harness, 'start', { session, phase }, options.settings), { worktree, prompt, log, spawnProcess: options.spawnProcess });
  const ended = exit(child);
  // Told once the session id is known; kept off the result, which the command line prints as JSON. A message
  // to the session waits for this first turn as it does for any other (delivery-model.mjs).
  const running = found => {
    turns.set(found, ended.then(() => {}));
    options.onTurn?.({ session: found, pid: child.pid, log, ended });
    return { session: found, log };
  };
  await started(child).catch(error => { throw explained(harness, error, options.launchEnv); });
  await settled(child, { harness, log, ms: options.settleMs });
  child.unref?.();
  if (!entry.sessionFrom) return running(session);
  for (let waited = 0; waited < (options.waitMs ?? 60000); waited += 250) {
    const found = entry.sessionFrom(readFileSync(log, 'utf8'));
    if (found) return running(found);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${harness} did not report a session id. See ${log}.`);
}

if (isMain(import.meta.url)) {
  const [mode, harness, worktree] = process.argv.slice(2);
  if (mode !== 'start' || !harness || !worktree) {
    console.error('Usage: node harnesses.mjs start <harness> <worktree>   (kickoff prompt on stdin)\nHarnesses: ' + Object.keys(harnesses).join(', '));
    process.exit(2);
  }
  try {
    const result = await startWorker({ harness, worktree, prompt: readFileSync(0, 'utf8') });
    console.log(JSON.stringify(result));
    // A started worker keeps running on its own; do not wait for its turn to end.
    process.exit(result.noWorkers ? 1 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
