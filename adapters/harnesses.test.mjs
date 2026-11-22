import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { commandFor, harnesses, launchProblem, messageWorker, row, startWorker, workerSettings } from './harnesses.mjs';

// Every turn is logged in the AI SDLC home; keep the tests out of the real one.
process.env.AI_SDLC_HOME = mkdtempSync(join(tmpdir(), 'factory-home-'));
after(() => rmSync(process.env.AI_SDLC_HOME, { recursive: true, force: true }));

const restricted = { permissions: 'restricted', tools: ['git', 'npm'] };
const unrestricted = { permissions: 'unrestricted', tools: [] };

// Stands in for the harness's program: records each call and lets the test end a turn.
function fakeProgram(output = '', exit) {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
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
  assert.deepEqual(workerSettings(home(t)), { permissions: 'restricted', tools: ['git', 'gh', 'node'] });
  const env = home(t, { workerPermissions: 'unrestricted', repos: { 'a/b': { gates: { test: 'npm test', lint: 'npx eslint .', build: null } }, 'c/d': { gates: { test: 'npm run t' } } } });
  assert.deepEqual(workerSettings(env), { permissions: 'unrestricted', tools: ['git', 'gh', 'node', 'npm', 'npx'] });
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
  assert.equal(claude.calls[0].prompt, 'kickoff');

  const codex = fakeProgram('{"type":"thread.started","thread_id":"0199-abc"}\n');
  const second = await startWorker({ harness: 'Codex', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: codex.spawnProcess, settings: restricted, settleMs: 0 });
  assert.equal(second.session, '0199-abc');

  const silent = fakeProgram();
  await assert.rejects(startWorker({ harness: 'Codex', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: silent.spawnProcess, settings: restricted, settleMs: 0, waitMs: 300 }),
    /did not report a session id/);
});
