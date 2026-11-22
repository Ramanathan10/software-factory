import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { commandFor, harnesses, messageWorker, row, startWorker, workerSettings } from './harnesses.mjs';

const restricted = { permissions: 'restricted', tools: ['git', 'npm'] };
const unrestricted = { permissions: 'unrestricted', tools: [] };

// Stands in for the harness's program: records each call and lets the test end a turn.
function fakeProgram(output = '') {
  const calls = [];
  const spawnProcess = (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = { on: () => child.stdin, end: prompt => { call.prompt = prompt; } };
    const call = { command, args, cwd: options.cwd, child };
    calls.push(call);
    if (output && typeof options.stdio[1] === 'number') writeSync(options.stdio[1], output);
    setImmediate(() => child.emit('spawn'));
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
  await messageWorker({ harness: 'Claude Code', session: 'one', worktree: '/work/tl-1', prompt: 'The owner answered.' }, { spawnProcess, settings: restricted });
  assert.equal(calls[0].cwd, '/work/tl-1');
  assert.equal(calls[0].prompt, 'The owner answered.');
  calls[0].child.emit('close');
});

test('a second message to the same session waits for the first turn to end', async () => {
  const { calls, spawnProcess } = fakeProgram();
  const send = prompt => messageWorker({ harness: 'Codex', session: 'two', worktree: '.', prompt }, { spawnProcess, settings: restricted });
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
  await assert.rejects(messageWorker(message, { spawnProcess: failing, settings: restricted }), /ENOENT/);
  const { calls, spawnProcess } = fakeProgram();
  await messageWorker(message, { spawnProcess, settings: restricted });
  assert.equal(calls.length, 1);
  calls[0].child.emit('close');
});

test('starting a worker returns the id it chose, or the id the program reports', async t => {
  const env = home(t);
  const claude = fakeProgram();
  const first = await startWorker({ harness: 'Claude Code', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: claude.spawnProcess, settings: restricted });
  assert.equal(claude.calls[0].args[2], first.session);
  assert.equal(claude.calls[0].prompt, 'kickoff');

  const codex = fakeProgram('{"type":"thread.started","thread_id":"0199-abc"}\n');
  const second = await startWorker({ harness: 'Codex', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: codex.spawnProcess, settings: restricted });
  assert.equal(second.session, '0199-abc');

  const silent = fakeProgram();
  await assert.rejects(startWorker({ harness: 'Codex', worktree: '.', prompt: 'kickoff' }, { env, spawnProcess: silent.spawnProcess, settings: restricted, waitMs: 300 }),
    /did not report a session id/);
});
