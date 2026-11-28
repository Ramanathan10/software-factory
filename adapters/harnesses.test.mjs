import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { commandFor, harnesses, launchProblem, messageWorker, modelFor, modelPlan, row, sessionRan, startWorker, workerSettings } from './harnesses.mjs';
import { phaseTiers, phases, tiers } from '../mission-console/roles.mjs';

process.env.AI_SDLC_HOME = mkdtempSync(join(tmpdir(), 'factory-home-'));
after(() => rmSync(process.env.AI_SDLC_HOME, { recursive: true, force: true }));

const claudeNotes = '\n\nNotes for Claude Code:\n- When you start a subagent with the Agent tool, pass run_in_background: false, so the call returns only with the subagent\'s result. This turn runs headless, and Claude Code stops a background subagent when the turn ends.';
const restricted = { permissions: 'restricted', tools: ['git', 'npm'] };
const unrestricted = { permissions: 'unrestricted', tools: [] };

function fakeProgram(output = '', exit) {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 5000 + calls.length;
    child.stdin = { on: () => child.stdin, end: prompt => { call.prompt = prompt; } };
    const call = { command, args, cwd: options.cwd, child };
    calls.push(call);
    if (output && typeof options.stdio[1] === 'number') writeSync(options.stdio[1], output);
    setImmediate(() => child.emit('spawn'));
    if (exit !== undefined) setTimeout(() => child.emit('close', exit), 20);
    return child;
  };
  return { calls, spawnProcess };
}

function home(t, profile) {
  const directory = mkdtempSync(join(tmpdir(), 'factory-workers-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  if (profile) writeFileSync(join(directory, 'profile.json'), JSON.stringify(profile));
  return { AI_SDLC_HOME: directory };
}

test('every harness says how it is installed and how its workers are driven', () => {
  for (const [name, entry] of Object.entries(harnesses)) {
    assert.ok(entry.id && entry.marker && entry.skills, name);
    assert.ok(['link', 'copy'].includes(entry.install), name);
    assert.ok(['command-line', 'in-app', 'none'].includes(entry.workers), name);
    if (entry.workers === 'in-app') assert.ok(entry.start && entry.message, name);
  }
  assert.equal(new Set(Object.values(harnesses).map(entry => entry.id)).size, Object.keys(harnesses).length);
});

test('every command-line harness has commands for starting, messaging, and both permission choices', () => {
  for (const name of Object.keys(harnesses).filter(name => harnesses[name].workers === 'command-line')) {
    for (const kind of ['start', 'message']) {
      for (const settings of [restricted, unrestricted]) {
        const { command, args } = commandFor(name, kind, { session: 'S-1' }, settings);
        assert.ok(command && args.length, `${name} ${kind} ${settings.permissions}`);
      }
    }
  }
});

test('Claude Code starts with a chosen session id and resumes it, allowing only the listed programs', () => {
  assert.deepEqual(commandFor('Claude Code', 'start', { session: 'S-1' }, restricted), {
    command: 'claude',
    args: ['-p', '--session-id', 'S-1', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(git *)', 'Bash(npm *)'],
  });
  assert.deepEqual(commandFor('claude code', 'message', { session: 'S-1' }, unrestricted).args,
    ['-p', '--resume', 'S-1', '--permission-mode', 'bypassPermissions']);
});

test('a restricted Claude Code worker may read the factory folder, which holds the skills, the phase table and the console reference', () => {
  const settings = { ...restricted, readable: [process.platform === 'win32' ? 'C:\\Tools\\factory\\' : '/tools/factory/'] };
  const rule = process.platform === 'win32' ? 'Read(//c/Tools/factory/**)' : 'Read(//tools/factory/**)';
  assert.deepEqual(commandFor('Claude Code', 'message', { session: 'S-1' }, settings).args,
    ['-p', '--resume', 'S-1', '--permission-mode', 'acceptEdits', '--allowedTools', 'Bash(git *)', 'Bash(npm *)', rule]);
  assert.ok(!commandFor('Claude Code', 'message', { session: 'S-1' }, { ...settings, permissions: 'unrestricted' }).args.includes(rule));
  assert.ok(!commandFor('Codex', 'start', {}, settings).args.includes(rule));
});

test('Codex reads the prompt from stdin and resumes by session id', () => {
  assert.deepEqual(commandFor('Codex', 'start', {}, restricted).args,
    ['exec', '--json', '-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true', '-']);
  assert.deepEqual(commandFor('Codex', 'message', { session: 'S-2' }, unrestricted).args,
    ['exec', 'resume', 'S-2', '--dangerously-bypass-approvals-and-sandbox', '-']);
});

test('a harness is found by its story name or its install id, and an unknown one is refused', () => {
  assert.equal(row('claude-code').name, 'Claude Code');
  assert.equal(row(' github copilot app ').id, 'copilot');
  assert.throws(() => row('Emacs'), /"Emacs" is not a known harness/);
  assert.throws(() => commandFor('GitHub Copilot app', 'start', {}, restricted), /not started from the command line/);
});

test('the start call answers for every harness, starting a program only for a command-line one', async () => {
  const { calls, spawnProcess } = fakeProgram();
  const inApp = await startWorker({ harness: 'GitHub Copilot app', worktree: '.', prompt: 'kickoff' }, { spawnProcess });
  assert.deepEqual([inApp.inApp, inApp.start, inApp.message], [true, 'create_session', 'send_session_message']);
  const none = await startWorker({ harness: 'Cursor', worktree: '.', prompt: 'kickoff' }, { spawnProcess });
  assert.equal(none.noWorkers, true);
  assert.match(none.next, /Tell the owner/);
  assert.equal(calls.length, 0);
});

test('worker settings come from the profile, and are restricted without one', t => {
  assert.deepEqual(workerSettings(home(t)), { permissions: 'restricted', tools: ['git', 'gh', 'node'], readable: [], models: {}, phaseTiers });
  const models = { codex: { deep: 'big' } };
  const env = home(t, { workerPermissions: 'unrestricted', commandCenterPath: '/opt/factory', models, phaseTiers: { ci: 'fast' }, repos: { 'a/b': { gates: { test: 'npm test', lint: 'npx eslint .', build: null } }, 'c/d': { gates: { test: 'npm run t' } } } });
  assert.deepEqual(workerSettings(env), { permissions: 'unrestricted', tools: ['git', 'gh', 'node', 'npm', 'npx'], readable: ['/opt/factory'], models, phaseTiers: { ...phaseTiers, ci: 'fast' } });
});

test('every phase with a tier is a real phase, and every tier is a known one', () => {
  for (const [phase, tier] of Object.entries(phaseTiers)) {
    assert.ok(phases[phase] || phase === 'coordinator', phase);
    assert.ok(tiers.includes(tier), `${phase} -> ${tier}`);
  }
});

test('a turn runs on the model the profile names for its phase, and on the harness default otherwise', t => {
  const settings = workerSettings(home(t, { models: { 'claude-code': { deep: 'big', standard: 'middle' }, codex: { deep: 'other-big', fast: 'small' } }, phaseTiers: { ci: 'fast' } }));
  assert.deepEqual(commandFor('Claude Code', 'start', { session: 'S-1', phase: 'scout' }, settings).args.slice(-2), ['--model', 'big']);
  assert.deepEqual(commandFor('Claude Code', 'message', { session: 'S-1', phase: 'testing' }, settings).args.slice(-2), ['--model', 'middle']);
  assert.deepEqual(commandFor('Codex', 'message', { session: 'S-2', phase: 'review' }, settings).args.slice(-3), ['--model', 'other-big', '-']);
  assert.equal(modelFor('codex', 'ci', settings), 'small', 'the profile moved ci to the fast tier');
  const plan = modelPlan(settings);
  assert.deepEqual([plan.phaseTiers.ci, plan.models.codex, plan.models['claude code'].deep, plan.models.cursor], ['fast', { deep: 'other-big', fast: 'small' }, 'big', {}]);
  assert.equal(modelFor('Claude Code', 'ci', settings), undefined);
  assert.equal(modelFor('Codex', 'building', settings), undefined);
  assert.equal(modelFor('Claude Code', 'merge', settings), undefined);
  assert.ok(!commandFor('Claude Code', 'message', { session: 'S-1' }, settings).args.includes('--model'));
  assert.ok(!commandFor('Claude Code', 'start', { session: 'S-1', phase: 'scout' }, restricted).args.includes('--model'), 'settings with no models');
});

test('a message runs in the story worktree with the prompt on stdin', async () => {
  const { calls, spawnProcess } = fakeProgram();
  await messageWorker({ harness: 'Claude Code', session: 'one', worktree: '/work/tl-1', prompt: 'The owner answered.' }, { spawnProcess, settings: restricted, settleMs: 0 });
  assert.equal(calls[0].cwd, '/work/tl-1');
  assert.equal(calls[0].prompt, 'The owner answered.');
  calls[0].child.emit('close');
});

test('a second message to the same session waits for the first turn to end', async () => {
  const { calls, spawnProcess } = fakeProgram();
  const send = prompt => messageWorker({ harness: 'Codex', session: 'two', worktree: '.', prompt }, { spawnProcess, settings: restricted, settleMs: 0 });
  await send('first');
  const second = send('second');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.length, 1);
  calls[0].child.emit('close');
  await second;
  assert.deepEqual(calls.map(call => call.prompt), ['first', 'second']);
  calls[1].child.emit('close');
});

test('a message to a new session waits for the kickoff turn startWorker began', async () => {
  const { calls, spawnProcess } = fakeProgram();
  const { session } = await startWorker({ harness: 'Claude Code', worktree: '.', prompt: 'kickoff' }, { spawnProcess, settings: restricted, settleMs: 0 });
  const message = messageWorker({ harness: 'Claude Code', session, worktree: '.', prompt: 'The owner answered.' }, { spawnProcess, settings: restricted, settleMs: 0 });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.length, 1, 'the message started a turn while the kickoff turn was running');
  calls[0].child.emit('close', 0);
  await message;
  assert.deepEqual(calls.map(call => call.prompt), ['kickoff' + claudeNotes, 'The owner answered.']);
  calls[1].child.emit('close', 0);
});

test('a message reports its turn as soon as the process exists, before the turn settles', async () => {
  const { calls, spawnProcess } = fakeProgram();
  const told = [];
  const message = messageWorker({ harness: 'Codex', session: 'early', worktree: '.', prompt: 'next' }, { spawnProcess, settings: restricted, settleMs: 200, onTurn: turn => told.push(turn.pid) });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(told, [calls[0].child.pid]);
  await message;
  calls[0].child.emit('close', 0);
});

test('a message waits for what the caller says is still running', async () => {
  const { calls, spawnProcess } = fakeProgram();
  let release;
  const after = new Promise(resolve => { release = resolve; });
  const message = messageWorker({ harness: 'Codex', session: 'adopted', worktree: '.', prompt: 'next' }, { spawnProcess, settings: restricted, settleMs: 0, after });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls.length, 0);
  release();
  await message;
  assert.equal(calls.length, 1);
  calls[0].child.emit('close', 0);
});

test('a message the caller no longer wants is not started, and the session accepts the next message', async () => {
  const { calls, spawnProcess } = fakeProgram();
  let release;
  const after = new Promise(resolve => { release = resolve; });
  let wanted = true;
  const stale = messageWorker({ harness: 'Codex', session: 'released', worktree: '.', prompt: 'old' }, { spawnProcess, settings: restricted, settleMs: 0, after, current: () => wanted });
  const outcome = stale.then(() => 'sent', error => error);
  wanted = false;
  release();
  const error = await outcome;
  assert.equal(error.code, 'STALE_ASSIGNMENT');
  assert.equal(calls.length, 0, 'a turn was started for a session its caller no longer wants');
  await messageWorker({ harness: 'Codex', session: 'released', worktree: '.', prompt: 'next' }, { spawnProcess, settings: restricted, settleMs: 0 });
  assert.deepEqual(calls.map(call => call.prompt), ['next']);
  calls[0].child.emit('close', 0);
});

test('the caller is asked whether a message is still wanted after the earlier turn ends, not before', async () => {
  const { calls, spawnProcess } = fakeProgram();
  const asked = [];
  const send = prompt => messageWorker({ harness: 'Claude Code', session: 'asked-late', worktree: '.', prompt }, {
    spawnProcess, settings: restricted, settleMs: 0, current: () => { asked.push(prompt + ' after ' + calls.length + ' turns'); return true; },
  });
  await send('first');
  const second = send('second');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(asked, ['first after 0 turns'], 'the second message asked while the first turn was still running');
  calls[0].child.emit('close', 0);
  await second;
  assert.deepEqual(asked, ['first after 0 turns', 'second after 1 turns']);
  calls[1].child.emit('close', 0);
});

test('a message that is still wanted starts its turn in the same step that asks, with nothing awaited between', async () => {
  const order = [];
  let yielded = false;
  const spawnProcess = () => {
    order.push('spawned after a yield: ' + yielded);
    const child = new EventEmitter();
    child.pid = 7000;
    child.stdin = { on: () => child.stdin, end: () => {} };
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  const current = () => {
    order.push('asked');
    queueMicrotask(() => { yielded = true; });
    return true;
  };
  const sent = messageWorker({ harness: 'Codex', session: 'same-step', worktree: '.', prompt: 'x' }, { spawnProcess, settings: restricted, settleMs: 0, current });
  await sent;
  assert.deepEqual(order, ['asked', 'spawned after a yield: false']);
});

test('a message with no say over whether it is wanted always starts its turn', async () => {
  const { calls, spawnProcess } = fakeProgram();
  await messageWorker({ harness: 'Codex', session: 'jarvis-resume', worktree: '.', prompt: 'wake', phase: 'coordinator' }, { spawnProcess, settings: restricted, settleMs: 0 });
  assert.equal(calls.length, 1);
  calls[0].child.emit('close', 0);
});

test('a program that cannot be started is reported, and the session accepts the next message', async () => {
  const failing = () => {
    const child = new EventEmitter();
    child.stdin = { on: () => child.stdin, end: () => {} };
    setImmediate(() => child.emit('error', new Error('spawn claude ENOENT')));
    return child;
  };
  const message = { harness: 'Claude Code', session: 'three', worktree: '.', prompt: 'x' };
  await assert.rejects(messageWorker(message, { spawnProcess: failing, settings: restricted, settleMs: 0 }), /ENOENT/);
  const { calls, spawnProcess } = fakeProgram();
  await messageWorker(message, { spawnProcess, settings: restricted, settleMs: 0 });
  assert.equal(calls.length, 1);
  calls[0].child.emit('close');
});

test('a program that Windows cannot start directly, or that is missing, is refused with what to install', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-path-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { PATH: directory };
  assert.match(launchProblem('Claude Code', env, 'win32'), /"claude" was not found on PATH/);
  writeFileSync(join(directory, 'claude.cmd'), '');
  assert.match(launchProblem('claude-code', env, 'win32'), /claude\.cmd script.*Install Claude Code's native program.*claude\.exe/);
  writeFileSync(join(directory, 'claude.exe'), '');
  assert.equal(launchProblem('Claude Code', env, 'win32'), null);
  assert.match(launchProblem('Codex', env, 'linux'), /"codex" was not found on PATH/);
  writeFileSync(join(directory, 'codex'), '');
  assert.equal(launchProblem('Codex', env, 'linux'), null);

  const failing = () => {
    const child = new EventEmitter();
    child.stdin = { on: () => child.stdin, end: () => {} };
    setImmediate(() => child.emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' })));
    return child;
  };
  const options = { spawnProcess: failing, settings: restricted, settleMs: 0, launchEnv: { PATH: '' }, env: home(t) };
  await assert.rejects(messageWorker({ harness: 'Codex', session: 'four', worktree: '.', prompt: 'x' }, options), /"codex" was not found on PATH/);
  await assert.rejects(startWorker({ harness: 'Codex', worktree: '.', prompt: 'x' }, options), /"codex" was not found on PATH/);
});

test('a turn that ends at once with an error is reported with what it wrote, not as a running worker', async t => {
  const env = home(t);
  const refused = fakeProgram('{"type":"turn.failed","error":"The model is not supported."}\n', 1);
  await assert.rejects(startWorker({ harness: 'Claude Code', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: refused.spawnProcess, settings: restricted, settleMs: 2000 }),
    /Claude Code ended its turn at once with an error \(exit code 1\)[\s\S]*The model is not supported[\s\S]*See .*\.log/);
  await assert.rejects(messageWorker({ harness: 'Codex', session: 'five', worktree: '.', prompt: 'x' }, { env, spawnProcess: refused.spawnProcess, settings: restricted, settleMs: 2000 }),
    /Codex ended its turn at once with an error/);
  assert.ok(existsSync(join(env.AI_SDLC_HOME, 'workers', 'five.log')), 'a resumed turn is logged under its session');

  const short = fakeProgram('', 0);
  assert.ok((await startWorker({ harness: 'Claude Code', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: short.spawnProcess, settings: restricted, settleMs: 2000 })).session);
  const working = fakeProgram();
  assert.ok((await startWorker({ harness: 'Claude Code', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: working.spawnProcess, settings: restricted, settleMs: 30 })).session);
});

test('the caller is told each running turn, with its process and the code it ends with', async t => {
  const env = home(t);
  const turns = [];
  const onTurn = turn => turns.push(turn);
  const codex = fakeProgram('{"type":"thread.started","thread_id":"0199-abc"}\n');
  const result = await startWorker({ harness: 'Codex', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: codex.spawnProcess, settings: restricted, settleMs: 0, onTurn });
  assert.deepEqual(Object.keys(result), ['session', 'log'], 'the printed result stays plain');
  assert.deepEqual([turns[0].session, turns[0].log], ['0199-abc', result.log]);
  codex.calls[0].child.emit('close', 3);
  assert.equal(await turns[0].ended, 3);

  const resumed = fakeProgram();
  await messageWorker({ harness: 'Codex', session: '0199-abc', worktree: '.', prompt: 'next' }, { env, spawnProcess: resumed.spawnProcess, settings: restricted, settleMs: 0, onTurn });
  assert.equal(turns[1].session, '0199-abc');
  resumed.calls[0].child.emit('error', new Error('lost'));
  assert.equal(await turns[1].ended, null, 'an exit code that is not known is null');

  const refused = fakeProgram('', 1);
  await assert.rejects(startWorker({ harness: 'Claude Code', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: refused.spawnProcess, settings: restricted, settleMs: 2000, onTurn }));
  assert.equal(turns.length, 2, 'a turn that never began is reported as a failure to start, not as a turn');
});

test('starting a worker returns the id it chose, or the id the program reports', async t => {
  const env = home(t);
  const claude = fakeProgram();
  const first = await startWorker({ harness: 'Claude Code', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: claude.spawnProcess, settings: restricted, settleMs: 0 });
  assert.equal(claude.calls[0].args[2], first.session);
  assert.equal(claude.calls[0].prompt, 'kickoff' + claudeNotes);

  const codex = fakeProgram('{"type":"thread.started","thread_id":"0199-abc"}\n');
  const second = await startWorker({ harness: 'Codex', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: codex.spawnProcess, settings: restricted, settleMs: 0 });
  assert.equal(second.session, '0199-abc');
  assert.equal(codex.calls[0].prompt, 'kickoff');

  const silent = fakeProgram();
  await assert.rejects(startWorker({ harness: 'Codex', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: silent.spawnProcess, settings: restricted, settleMs: 0, waitMs: 300 }),
    /did not report a session id/);
});

test('a Claude Code start ends its prompt with the notes paragraph, and a Codex start adds nothing', async t => {
  const env = home(t);
  const claude = fakeProgram();
  await startWorker({ harness: 'Claude Code', worktree: '.', prompt: 'kickoff for story T-1' }, { env, spawnProcess: claude.spawnProcess, settings: restricted, settleMs: 0 });
  assert.equal(claude.calls[0].prompt, 'kickoff for story T-1\n\nNotes for Claude Code:\n- When you start a subagent with the Agent tool, pass run_in_background: false, so the call returns only with the subagent\'s result. This turn runs headless, and Claude Code stops a background subagent when the turn ends.');
  const codex = fakeProgram('{"type":"thread.started","thread_id":"0199-def"}\n');
  await startWorker({ harness: 'Codex', worktree: '.', prompt: 'kickoff for story T-1' }, { env, spawnProcess: codex.spawnProcess, settings: restricted, settleMs: 0 });
  assert.equal(codex.calls[0].prompt, 'kickoff for story T-1');
});

test('the model and effort a session last ran on are read from the harness\'s own record of it', t => {
  const directory = mkdtempSync(join(tmpdir(), 'factory-records-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { CLAUDE_CONFIG_DIR: join(directory, 'claude'), CODEX_HOME: join(directory, 'codex') };
  const lines = (...items) => items.map(item => JSON.stringify(item)).join('\n') + '\n';

  assert.equal(sessionRan('Claude Code', 'c-1', env), undefined, 'no record yet');
  const claude = join(env.CLAUDE_CONFIG_DIR, 'projects', 'C--work-tl-1');
  mkdirSync(claude, { recursive: true });
  writeFileSync(join(claude, 'c-1.jsonl'), lines(
    { type: 'assistant', isSidechain: false, effort: 'low', message: { model: 'first-model' } },
    { type: 'assistant', isSidechain: false, effort: 'high', message: { model: 'main-model' } },
    { type: 'assistant', isSidechain: true, effort: 'low', message: { model: 'subagent-model' } },
    { type: 'assistant', isSidechain: false, message: { model: '<synthetic>' } },
    { type: 'user', message: { content: 'x'.repeat(2 * 1024 * 1024) } }) + 'a line still being written');
  assert.deepEqual(sessionRan('Claude Code', 'c-1', env), { model: 'main-model', effort: 'high' }, 'found behind a long newer line');
  appendFileSync(join(claude, 'c-1.jsonl'), '\n' + lines({ type: 'assistant', isSidechain: false, message: { model: 'next-model' } }));
  assert.deepEqual(sessionRan('claude-code', 'c-1', env), { model: 'next-model' }, 'the newest turn, with no effort recorded');

  const codex = join(env.CODEX_HOME, 'sessions', '2030', '01', '02');
  mkdirSync(codex, { recursive: true });
  writeFileSync(join(codex, 'rollout-2030-01-02T03-04-05-x-9.jsonl'), lines(
    { type: 'session_meta', payload: {} },
    { type: 'turn_context', payload: { model: 'codex-model', effort: 'medium' } },
    { type: 'response_item', payload: { model: 'not-this' } }));
  assert.deepEqual(sessionRan('Codex', 'x-9', env), { model: 'codex-model', effort: 'medium' });

  assert.equal(sessionRan('Codex', 'never', env), undefined);
  assert.equal(sessionRan('Cursor', 'c-1', env), undefined);
  assert.equal(sessionRan('GitHub Copilot app', undefined, env), undefined);
});

test('the background Jarvis has its own tier, standard unless the profile moves it', t => {
  assert.equal(phaseTiers.coordinator, 'standard');
  const models = { codex: { deep: 'big', standard: 'middle', fast: 'small' } };
  assert.equal(modelFor('Codex', 'coordinator', workerSettings(home(t, { models }))), 'middle');
  const moved = workerSettings(home(t, { models, phaseTiers: { coordinator: 'fast' } }));
  assert.equal(modelFor('Codex', 'coordinator', moved), 'small');
  assert.deepEqual(commandFor('Codex', 'start', { phase: 'coordinator' }, moved).args.slice(-3), ['--model', 'small', '-']);
});

function programWithEnvironment() {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    child.pid = 6000 + calls.length;
    child.stdin = { on: () => child.stdin, end: () => {} };
    calls.push({ command, env: options.env ?? process.env });
    setImmediate(() => child.emit('spawn'));
    setTimeout(() => child.emit('close', 0), 10);
    return child;
  };
  return { calls, spawnProcess };
}

test('a background Jarvis program is marked as Jarvis in its environment, and a worker program is not', async () => {
  const { calls, spawnProcess } = programWithEnvironment();
  const options = { spawnProcess, settings: restricted, settleMs: 0 };
  const jarvis = await startWorker({ harness: 'Claude Code', worktree: '/work/tl-1', prompt: 'Check tl-1.', phase: 'coordinator' }, options);
  await startWorker({ harness: 'Claude Code', worktree: '/work/tl-1', prompt: 'Write the tests.', phase: 'testing' }, options);
  await messageWorker({ harness: 'Claude Code', session: jarvis.session, worktree: '/work/tl-1', prompt: 'More news on tl-1.', phase: 'coordinator' }, options);
  assert.deepEqual(calls.map(call => call.env.AI_SDLC_ACTOR), ['jarvis', undefined, 'jarvis']);
  assert.ok(calls[0].env.PATH || calls[0].env.Path, 'the marked program still sees the rest of the environment');
});

const failures = {
  'Claude Code': {
    usage: 'Claude AI usage limit reached|1795543200',
    usageNow: 'You’ve hit your limit · resets 3am (Europe/Dublin)',
    signIn: 'Failed to authenticate: OAuth session expired and could not be refreshed',
    signInMissing: 'Invalid API key · Please run /login',
  },
  Codex: {
    usage: 'ERROR: You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Nov 24th, 2026 2:12 AM.',
    signIn: 'Your access token could not be refreshed because your refresh token has expired. Please log out and sign in again.',
  },
};

test('each command-line harness explains a usage limit and a lapsed sign-in in plain words, with what to do', () => {
  for (const [harness, samples] of Object.entries(failures)) {
    const { explain } = row(harness);
    assert.equal(typeof explain, 'function', harness + ' explains its failures');
    for (const [kind, sample] of Object.entries(samples)) {
      const told = explain('2026-11-24T03:38:25Z starting\n' + sample + '\ntokens used\n12');
      assert.ok(told?.reason && told?.next, `${harness} ${kind}: ${JSON.stringify(told)}`);
      assert.match(told.reason, kind.startsWith('usage') ? /usage limit/i : /sign(ed)?[ -]?in/i, `${harness} ${kind}`);
    }
  }
  assert.match(row('Claude Code').explain(failures['Claude Code'].signIn).next, /\/login/);
  assert.match(row('Codex').explain(failures.Codex.signIn).next, /codex login/);
  assert.match(JSON.stringify(row('Codex').explain(failures.Codex.usage)), /2:12 AM/, 'the owner is told when the limit lifts');
});

test('a failure a harness does not recognise is left for the daemon to describe', () => {
  for (const harness of Object.keys(failures)) {
    assert.equal(row(harness).explain('TypeError: something odd happened\n    at main (index.js:1:1)'), undefined, harness);
    assert.equal(row(harness).explain(''), undefined, harness);
  }
});
