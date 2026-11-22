// The one table of agent harnesses: how each is installed and how its story workers are driven.
//   node harnesses.mjs start <harness> <worktree>   kickoff prompt on stdin; prints how the worker was started
// install.mjs reads the table to install the skills, and the Command Center imports `messageWorker` to hand
// the owner's decisions to a worker.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

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
// gives `sessionFrom`, which finds the id in the program's output.
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
// worker git, gh, node, and the program each repository's gates run.
export function workerSettings(env = process.env) {
  let profile = {};
  try { profile = JSON.parse(readFileSync(join(home(env), 'profile.json'), 'utf8')); } catch { /* no profile yet: restricted */ }
  const gateTools = Object.values(profile.repos ?? {}).flatMap(repo => Object.values(repo.gates ?? {}))
    .filter(command => typeof command === 'string' && command.trim()).map(command => command.trim().split(/\s+/)[0]);
  return {
    permissions: profile.workerPermissions === 'unrestricted' ? 'unrestricted' : 'restricted',
    tools: [...new Set(['git', 'gh', 'node', ...gateTools])],
  };
}

// Finds a row by the name stories record or by its install id, ignoring case.
export function row(harness) {
  const wanted = String(harness).trim().toLowerCase();
  const name = Object.keys(harnesses).find(key => key.toLowerCase() === wanted || harnesses[key].id === wanted);
  if (!name) throw new Error(`"${harness}" is not a known harness. Known: ${Object.keys(harnesses).join(', ')}.`);
  return { name, ...harnesses[name] };
}

// The full command line for one worker turn.
export function commandFor(harness, kind, { session }, { permissions, tools } = workerSettings()) {
  const entry = row(harness);
  if (entry.workers !== 'command-line') throw new Error(`${entry.name} workers are not started from the command line.`);
  const args = [...entry[kind]({ session }), ...entry.permissions[permissions](tools)];
  return { command: entry.command, args: entry.promptArgument ? [...args, entry.promptArgument] : args };
}

// Runs one turn in the worktree with the prompt on stdin. The turn outlives this process; its output goes to `log`.
function run({ command, args }, { worktree, prompt, log, spawnProcess = spawn }) {
  const output = log ? openSync(log, 'a') : 'ignore';
  const child = spawnProcess(command, args, { cwd: worktree, detached: true, windowsHide: true, stdio: ['pipe', output, output] });
  child.stdin?.on('error', () => {}).end(prompt);
  return child;
}

const started = child => new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));

// session -> a promise that settles when the turn this process started for it ends.
const turns = new Map();

// Sends a prompt to an existing worker session. Waits for a turn this process already started for that
// session, so one session never runs two turns at once, and resolves once the new turn is running.
export async function messageWorker({ harness, session, worktree, prompt }, options = {}) {
  const invocation = commandFor(harness, 'message', { session }, options.settings);
  const previous = turns.get(session) ?? Promise.resolve();
  let finish;
  turns.set(session, new Promise(resolve => { finish = resolve; }));
  await previous;
  try {
    const child = run(invocation, { worktree, prompt, spawnProcess: options.spawnProcess });
    child.once('close', finish).once('error', finish);
    await started(child);
    child.unref?.();
  } catch (error) {
    finish();
    throw error;
  }
}

// Starts a new worker session and resolves to its session id once the harness has reported it.
// For a harness whose workers are not started from the command line it starts nothing, and resolves to
// what Jarvis does instead, so the same call is the first step in every harness.
export async function startWorker({ harness, worktree, prompt }, options = {}) {
  const entry = row(harness);
  if (entry.workers === 'in-app') {
    return { inApp: true, start: entry.start, message: entry.message, next: `Start the worker with ${entry.start}, as the "${entry.name}" section of the factory runbook describes.` };
  }
  if (entry.workers === 'none') {
    return { noWorkers: true, next: `${entry.name} cannot run workers yet. Tell the owner before doing the story's work in the Jarvis chat.` };
  }
  const session = randomUUID();
  const folder = join(home(options.env), 'workers');
  mkdirSync(folder, { recursive: true });
  const log = join(folder, session + '.log');
  const child = run(commandFor(harness, 'start', { session }, options.settings), { worktree, prompt, log, spawnProcess: options.spawnProcess });
  await started(child);
  child.unref?.();
  if (!entry.sessionFrom) return { session, log };
  for (let waited = 0; waited < (options.waitMs ?? 60000); waited += 250) {
    const found = entry.sessionFrom(readFileSync(log, 'utf8'));
    if (found) return { session: found, log };
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${harness} did not report a session id. See ${log}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
