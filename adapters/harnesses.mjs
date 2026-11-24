import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { phaseTiers } from '../mission-console/roles.mjs';
import { isMain } from '../mission-console/is-main.mjs';

const until = (text, pattern) => pattern.exec(text)?.[1]?.trim().replace(/\.$/, '');

function list(folder, recursive = false) {
  try { return readdirSync(folder, { recursive }); } catch { return []; }
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return undefined; }
}

const strings = values => [...new Set(values.filter(value => typeof value === 'string' && value))];

function firstDefault(sources, fallback) {
  for (const [from, read] of sources) {
    const model = read();
    if (typeof model === 'string' && model) return { default: model, defaultFrom: from };
  }
  return { default: null, defaultFrom: fallback };
}

function claudeModels({ env = process.env, repository } = {}) {
  const config = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  const catalogs = join(config, 'cache', 'model-catalog');
  const names = list(catalogs).filter(file => file.endsWith('-cc.json')).flatMap(file => {
    const catalog = readJson(join(catalogs, file))?.catalog?.config;
    return [...(Array.isArray(catalog?.models) ? catalog.models.map(model => model?.id) : []), ...Object.keys(catalog?.provider_alias_targets ?? {})];
  });
  const settings = [
    ...(repository ? [join(repository, '.claude', 'settings.local.json'), join(repository, '.claude', 'settings.json')] : []),
    join(config, 'settings.json'),
  ];
  return {
    names: strings(names),
    namesFrom: join(catalogs, '*-cc.json'),
    ...firstDefault([
      ['the ANTHROPIC_MODEL environment variable', () => env.ANTHROPIC_MODEL],
      ...settings.map(file => [file, () => readJson(file)?.model]),
    ], "the account's default"),
  };
}

function codexModels({ env = process.env } = {}) {
  const folder = env.CODEX_HOME || join(homedir(), '.codex');
  const cache = join(folder, 'models_cache.json');
  const config = join(folder, 'config.toml');
  const models = readJson(cache)?.models;
  const configured = () => {
    let text = '';
    try { text = readFileSync(config, 'utf8'); } catch {}
    return /^\s*model\s*=\s*(["'])([^"'\n]+)\1/m.exec(text.split(/^\s*\[/m)[0])?.[2];
  };
  return {
    names: strings(Array.isArray(models) ? models.filter(model => model?.visibility !== 'hide').map(model => model?.slug) : []),
    namesFrom: cache,
    ...firstDefault([[config, configured]], "the program's built-in default"),
  };
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
    models: claudeModels,
    record: ({ session, env }) => {
      const projects = join(env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects');
      return list(projects).map(project => join(projects, project, session + '.jsonl')).find(file => existsSync(file));
    },
    ran: line => (line.type === 'assistant' && !line.isSidechain && /^[^<]/.test(line.message?.model ?? '')
      ? { model: line.message.model, effort: line.effort } : undefined),
    explain: log => {
      if (/usage limit reached|hit your limit/i.test(log)) {
        const epoch = /usage limit reached\|(\d{9,})/i.exec(log)?.[1];
        const resets = epoch ? new Date(Number(epoch) * 1000).toLocaleString() : until(log, /resets ([^\n]+)/i);
        return { reason: 'Claude Code reached its usage limit' + (resets ? ' (it resets ' + resets + ')' : ''),
          next: 'Wait for the limit to reset, or raise the limit on your Claude plan' };
      }
      if (/failed to authenticate|oauth session expired|invalid api key|please run \/login|not logged in/i.test(log)) {
        return { reason: 'Claude Code is not signed in, or its sign-in has expired', next: 'Run claude in a terminal and sign in again with /login' };
      }
      return undefined;
    },
    permissions: {
      restricted: (tools, readable) => ['--permission-mode', 'acceptEdits', '--allowedTools', ...tools.map(tool => `Bash(${tool} *)`), ...readable.map(readRule)],
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
    models: codexModels,
    record: ({ session, env }) => {
      const sessions = join(env.CODEX_HOME || join(homedir(), '.codex'), 'sessions');
      const file = list(sessions, true).find(name => name.endsWith(session + '.jsonl'));
      return file && join(sessions, file);
    },
    ran: line => (line.type === 'turn_context' && line.payload?.model ? { model: line.payload.model, effort: line.payload.effort } : undefined),
    explain: log => {
      if (/usage limit/i.test(log)) {
        const lifts = until(log, /try again at ([^\n]+)/i);
        return { reason: 'Codex reached its usage limit' + (lifts ? ' until ' + lifts : ''),
          next: lifts ? 'Wait until ' + lifts + ', or add Codex credits' : 'Wait for the limit to lift, or add Codex credits' };
      }
      if (/refresh token|sign in again|not logged in|codex login/i.test(log)) {
        return { reason: 'Codex is not signed in, or its sign-in has expired', next: 'Run codex login in a terminal to sign in again' };
      }
      return undefined;
    },
    promptArgument: '-',
    sessionFrom: output => /"thread_id":\s*"([^"]+)"/.exec(output)?.[1],
    permissions: {
      restricted: () => ['-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true'],
      unrestricted: () => ['--dangerously-bypass-approvals-and-sandbox'],
    },
  },
};

export const readRule = folder => 'Read(//' + resolve(folder).replaceAll('\\', '/').replace(/^\/+/, '').replace(/^([A-Za-z]):/, (_, drive) => drive.toLowerCase()) + '/**)';

const home = (env = process.env) => env.AI_SDLC_HOME || join(homedir(), '.ai-sdlc');

export function workerSettings(env = process.env) {
  let profile = {};
  try { profile = JSON.parse(readFileSync(join(home(env), 'profile.json'), 'utf8')); } catch {}
  const gateTools = Object.values(profile.repos ?? {}).flatMap(repo => Object.values(repo.gates ?? {}))
    .filter(command => typeof command === 'string' && command.trim()).map(command => command.trim().split(/\s+/)[0]);
  return {
    permissions: profile.workerPermissions === 'unrestricted' ? 'unrestricted' : 'restricted',
    tools: [...new Set(['git', 'gh', 'node', ...gateTools])],
    readable: typeof profile.commandCenterPath === 'string' && profile.commandCenterPath.trim() ? [profile.commandCenterPath] : [],
    models: profile.models ?? {},
    phaseTiers: { ...phaseTiers, ...profile.phaseTiers },
  };
}

export function row(harness) {
  const wanted = String(harness).trim().toLowerCase();
  const name = Object.keys(harnesses).find(key => key.toLowerCase() === wanted || harnesses[key].id === wanted);
  if (!name) throw new Error(`"${harness}" is not a known harness. Known: ${Object.keys(harnesses).join(', ')}.`);
  return { name, ...harnesses[name] };
}

export function modelFor(harness, phase, { models = {}, phaseTiers: tierOf = phaseTiers } = workerSettings()) {
  return models[row(harness).id]?.[tierOf[phase]] || undefined;
}

export function modelPlan({ models = {}, phaseTiers: tierOf = phaseTiers } = workerSettings()) {
  return {
    phaseTiers: tierOf,
    models: Object.fromEntries(Object.entries(harnesses).map(([name, entry]) => [name.toLowerCase(), models[entry.id] ?? {}])),
  };
}

const records = new Map();

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
  } catch {}
  return undefined;
}

export function commandFor(harness, kind, { session, phase }, settings = workerSettings()) {
  const entry = row(harness);
  if (entry.workers !== 'command-line') throw new Error(`${entry.name} workers are not started from the command line.`);
  const { permissions, tools, readable = [] } = settings;
  const model = modelFor(harness, phase, settings);
  const args = [...entry[kind]({ session }), ...entry.permissions[permissions](tools, readable), ...(model ? entry.model(model) : [])];
  return { command: entry.command, args: entry.promptArgument ? [...args, entry.promptArgument] : args };
}

export function launchProblem(harness, env = process.env, platform = process.platform) {
  const { name, command } = row(harness);
  const has = extensions => (env.PATH || env.Path || '').split(delimiter).filter(Boolean)
    .some(dir => extensions.some(extension => existsSync(join(dir, command + extension))));
  if (has(platform === 'win32' ? ['.exe', '.com'] : [''])) return null;
  return platform === 'win32' && has(['.cmd', '.bat'])
    ? `${name} is installed as a ${command}.cmd script, which cannot be started directly on Windows. Install ${name}'s native program, which provides ${command}.exe.`
    : `${name}'s program "${command}" was not found on PATH. Install ${name}, or choose another harness for the story.`;
}

const explained = (harness, error, env) => (error.code === 'ENOENT' && launchProblem(harness, env) ? new Error(launchProblem(harness, env)) : error);

function environment(phase) {
  const { AI_SDLC_ACTOR, ...env } = process.env;
  return phase === 'coordinator' ? { ...env, AI_SDLC_ACTOR: 'jarvis' } : env;
}

function run({ command, args }, { worktree, prompt, log, phase, spawnProcess = spawn }) {
  const output = openSync(log, 'a');
  const child = spawnProcess(command, args, { cwd: worktree, env: environment(phase), detached: true, windowsHide: true, stdio: ['pipe', output, output] });
  closeSync(output);
  child.stdin?.on('error', () => {}).end(prompt);
  return child;
}

function logFor(name, env) {
  const folder = join(home(env), 'workers');
  mkdirSync(folder, { recursive: true });
  return join(folder, name + '.log');
}

const exit = child => new Promise(resolve => child.once('close', code => resolve(code ?? null)).once('error', () => resolve(null)));

const started = child => new Promise((resolve, reject) => child.once('spawn', resolve).once('error', reject));

const SETTLE_MS = 10000;

function settled(child, { harness, log, ms = SETTLE_MS }) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    child.once('close', code => {
      clearTimeout(timer);
      if (!code) return resolve();
      let tail = '';
      try { tail = readFileSync(log, 'utf8').trim().split(/\r?\n/).slice(-3).join('\n'); } catch {}
      reject(new Error(`${harness} ended its turn at once with an error (exit code ${code}).${tail ? '\n' + tail : ''}\nSee ${log}.`));
    });
  });
}

const turns = new Map();

export async function messageWorker({ harness, session, worktree, prompt, phase }, options = {}) {
  const invocation = commandFor(harness, 'message', { session, phase }, options.settings);
  const previous = Promise.all([turns.get(session), options.after]);
  let finish;
  turns.set(session, new Promise(resolve => { finish = resolve; }));
  try {
    await previous;
    const log = logFor(session, options.env);
    const child = run(invocation, { worktree, prompt, log, phase, spawnProcess: options.spawnProcess });
    child.once('close', finish).once('error', finish);
    const ended = exit(child);
    if (child.pid) options.onTurn?.({ session, pid: child.pid, log, ended });
    await started(child);
    await settled(child, { harness, log, ms: options.settleMs });
    child.unref?.();
  } catch (error) {
    finish();
    throw explained(harness, error, options.launchEnv);
  }
}

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
  const child = run(commandFor(harness, 'start', { session, phase }, options.settings), { worktree, prompt, log, phase, spawnProcess: options.spawnProcess });
  const ended = exit(child);
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
  if (!((mode === 'start' && harness && worktree) || (mode === 'models' && harness))) {
    console.error('Usage: node harnesses.mjs start <harness> <worktree>   (kickoff prompt on stdin)\n       node harnesses.mjs models <harness> [repository]   (model names and default the harness offers)\nHarnesses: ' + Object.keys(harnesses).join(', '));
    process.exit(2);
  }
  if (mode === 'models') {
    try {
      const entry = row(harness);
      if (!entry.models) throw new Error(`${entry.name} takes no model option.`);
      console.log(JSON.stringify(entry.models({ env: process.env, repository: worktree && resolve(worktree) }), null, 2));
      process.exit(0);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  }
  try {
    const result = await startWorker({ harness, worktree, prompt: readFileSync(0, 'utf8') });
    console.log(JSON.stringify(result));
    process.exit(result.noWorkers ? 1 : 0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
