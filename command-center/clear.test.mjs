import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { startWorker } from '../adapters/harnesses.mjs';
import { createClearer } from './clear.mjs';
import { createConsoleService } from './console-service.mjs';

const slash = path => path.replace(/\\/g, '/');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hasBranch = (repo, branch) => git(repo, 'branch', '--list', branch) !== '';
const listed = (repo, path) => git(repo, 'worktree', 'list', '--porcelain').split(/\r?\n/).some(line => line.startsWith('worktree ') && same(line.slice(9), path));
const real = path => slash(existsSync(path) ? realpathSync.native(path) : resolve(path)).toLowerCase();
const same = (a, b) => real(a) === real(b);

async function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ai-sdlc-clear-'));
  const home = join(root, 'home');
  const dbPath = join(root, 'db', 'stories.db');
  const origin = join(root, 'origin.git');
  const main = join(root, 'main');
  mkdirSync(join(home, 'workers'), { recursive: true });
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', main);
  git(main, 'config', 'user.name', 'Factory Test');
  git(main, 'config', 'user.email', 'factory-test@example.invalid');
  git(main, 'config', 'core.autocrlf', 'false');
  writeFileSync(join(main, 'README.md'), 'app\n');
  git(main, 'add', '.');
  git(main, 'commit', '-q', '-m', 'Start');
  git(main, 'remote', 'add', 'origin', origin);
  git(main, 'push', '-q', '-u', 'origin', 'main');
  const service = createConsoleService({ dbPath, home });
  const server = await service.startServer(0);
  t.after(async () => {
    await server.close();
    service.close();
    rmSync(root, { recursive: true, force: true });
  });
  const url = server.url;
  const origin_ = url.slice(0, -1);
  const find = id => service.snapshot().find(story => story.id === id);
  const record = (id, type, input = {}) => service.recordEvent({ story: id, type, ...input });

  function worktree(id, { branch = 'story/' + id.toLowerCase(), push = true } = {}) {
    const path = slash(join(root, 'wt', id));
    git(main, 'worktree', 'add', '-q', '-b', branch, path);
    writeFileSync(join(path, id + '.txt'), id + '\n');
    git(path, 'add', '.');
    git(path, 'commit', '-q', '-m', 'Work on ' + id);
    if (push) git(path, 'push', '-q', '-u', 'origin', branch);
    return { path, branch, head: git(path, 'rev-parse', 'HEAD') };
  }

  function files(id) {
    const made = {
      stories: join(home, 'stories', id),
      notes: join(home, 'notes', id),
      attachments: join(root, 'db', 'attachments', id),
    };
    for (const folder of Object.values(made)) mkdirSync(folder, { recursive: true });
    writeFileSync(join(made.stories, 'context-pack.md'), '# pack\n');
    writeFileSync(join(made.notes, 'notes.md'), '# notes\n');
    writeFileSync(join(made.attachments, 'shot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return made;
  }

  function story(id, { branch, path, mode = 'pushed', repo = 'acme/app', phase = 'closed' } = {}) {
    service.createStory({ story: id, title: 'Ship ' + id, detail: 'Brief for ' + id, branch, worktree: path, harness: 'Codex', repo });
    const logs = { tester: slash(join(home, 'workers', id + '-tester.log')), jarvis: slash(join(home, 'workers', id + '-jarvis.log')), outside: slash(join(root, id + '-outside.log')) };
    for (const log of Object.values(logs)) writeFileSync(log, 'turn output\n');
    const turn = (session, log) => {
      record(id, 'assign-worker', { session });
      const assignment = find(id).worker.id;
      record(id, 'turn-started', { assignment, pid: 4242, log });
      record(id, 'turn-ended', { assignment, outcome: 'ended', code: 0, detail: 'Turn ended.' });
      record(id, 'release-worker', { assignment, detail: 'Finished.' });
    };
    const steps = [
      () => record(id, 'handoff', { detail: 'Context pack ready.' }),
      () => record(id, 'plan', { detail: 'Plan for ' + id }),
      () => record(id, 'approve'),
      () => { turn(id + '-tester', logs.tester); record(id, 'handoff', { detail: 'Tests ready.' }); },
      () => record(id, 'handoff', { detail: 'Red observed.', command: 'node --test' }),
      () => { turn(id + '-builder', logs.outside); record(id, 'handoff', { detail: 'Green.', command: 'node --test' }); },
      () => record(id, 'handoff', { detail: 'Gates passed.', command: 'node --test' }),
      () => record(id, 'handoff', { detail: 'No surviving mutants.', command: 'stryker' }),
      () => record(id, 'handoff', { detail: 'Review complete.' }),
      () => record(id, 'comparison-choice', { run: false }),
      () => record(id, 'pr-opened', { url: 'https://github.com/' + repo + '/pull/' + id.length }),
    ];
    const stopAt = { closed: steps.length, building: 5 }[phase];
    for (const step of steps.slice(0, stopAt)) step();
    if (phase !== 'closed') return { logs };
    const pr = find(id).pr;
    const head = git(path, 'rev-parse', 'HEAD');
    if (mode === 'observed') {
      record(id, 'pr-observed', { url: pr, observation: { head, status: 'passed', failedCount: 0, failures: [] } });
      record(id, 'pr-ready', { head, detail: 'Checks passed for the head.' });
      record(id, 'pr-observed', { url: pr, observation: { head, status: 'merged', failedCount: 0, failures: [] } });
    } else if (mode === 'ready') {
      record(id, 'pr-ready', { head, detail: 'Checks passed for the head.' });
    } else {
      record(id, 'pr-ready', { detail: 'Checks passed.' });
    }
    record(id, 'merged', { detail: 'GitHub reports the PR merged.' });
    record(id, 'jarvis-turn-started', { session: id + '-jarvis', pid: 4343, log: logs.jarvis });
    record(id, 'jarvis-turn-ended', { outcome: 'ended', code: 0, detail: 'Jarvis ended its turn.' });
    assert.equal(find(id).phase, 'closed');
    return { logs };
  }

  async function clear(stories) {
    const response = await fetch(url + 'api/clear', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin_ }, body: JSON.stringify({ stories }),
    });
    const body = await response.json();
    assert.ok(Array.isArray(body.results), 'POST /api/clear answered ' + response.status + ' ' + JSON.stringify(body) + ' with no results list');
    return { status: response.status, results: body.results, of: id => body.results.find(result => result.story === id) };
  }

  async function preview(id) {
    const response = await fetch(url + 'api/clear/preview?story=' + encodeURIComponent(id));
    return { status: response.status, body: await response.json() };
  }

  return { root, home, dbPath, main, url, origin: origin_, service, find, record, worktree, files, story, clear, preview };
}

function assertKept(f, id, { path, branch, made, logs }) {
  const story = f.find(id);
  assert.ok(story, id + ' left the story database');
  assert.equal(story.phase, 'closed');
  if (path) assert.ok(existsSync(path), id + ' worktree was deleted');
  if (branch) assert.ok(hasBranch(f.main, branch), id + ' branch was deleted');
  for (const folder of Object.values(made ?? {})) assert.ok(existsSync(folder), folder + ' was deleted');
  for (const log of Object.values(logs ?? {})) assert.ok(existsSync(log), log + ' was deleted');
}

test('the fixture builds a closed story on a pushed story branch in its own worktree', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  assert.ok(listed(f.main, path));
  assert.equal(git(path, 'branch', '--show-current'), branch);
  assert.ok(git(f.main, 'ls-remote', 'origin', branch).length > 0);
});

const noPendingFor = (f, id) => assert.deepEqual(f.service.pending().filter(record => record.story === id && ['request-cleanup', 'cleanup-blocked', 'complete-cleanup'].includes(record.type)).map(record => record.type), [], id + ' has pending cleanup events after a clear');

test('a clean story whose branch is pushed is cleared: worktree, branch, folders, attachments and its logs go', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  const made = f.files('S-1');
  const { logs } = f.story('S-1', { branch, path });
  const { status, of } = await f.clear(['S-1']);
  assert.equal(status, 200);
  const result = of('S-1');
  assert.equal(result.result, 'cleared', JSON.stringify(result));
  assert.ok(!existsSync(path), 'the worktree folder is still there');
  assert.ok(!listed(f.main, path), 'git still lists the worktree');
  assert.ok(!hasBranch(f.main, branch), 'the local branch is still there');
  assert.ok(git(f.main, 'ls-remote', 'origin', branch).length > 0, 'the remote branch was deleted');
  for (const folder of Object.values(made)) assert.ok(!existsSync(folder), folder + ' is still there');
  assert.ok(!existsSync(logs.tester), 'the worker turn log is still there');
  assert.ok(!existsSync(logs.jarvis), 'the Jarvis turn log is still there');
  assert.ok(existsSync(logs.outside), 'a log outside the workers folder was deleted');
  assert.ok(existsSync(join(f.home, 'workers')), 'the workers folder itself was deleted');
  assert.ok(Array.isArray(result.deleted) && result.deleted.some(item => String(item).includes('S-1')), 'the result does not list what was deleted: ' + JSON.stringify(result));
  assert.equal(f.find('S-1'), undefined, 'snapshot still lists the cleared story');
  noPendingFor(f, 'S-1');
});

test('a cleared story keeps only its deletion marker and the completion event in the database', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  assert.equal((await f.clear(['S-1'])).of('S-1').result, 'cleared');
  f.service.close();
  const db = new DatabaseSync(f.dbPath);
  try {
    const rows = db.prepare('SELECT state FROM stories WHERE id = ?').all('S-1');
    assert.deepEqual(rows.map(row => JSON.parse(row.state)), [{ id: 'S-1', deleted: true }]);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events WHERE story = ?').get('S-1').n, 1);
  } finally {
    db.close();
  }
});

test('commits in the recorded merged PR head count as pushed after the remote branch is pruned', async t => {
  for (const mode of ['observed', 'ready']) {
    await t.test(mode, async t => {
      const f = await fixture(t);
      const { path, branch } = f.worktree('S-1');
      f.story('S-1', { branch, path, mode });
      git(f.main, 'push', '-q', 'origin', '--delete', branch);
      git(f.main, 'fetch', '-q', '--prune', 'origin');
      const result = (await f.clear(['S-1'])).of('S-1');
      assert.equal(result.result, 'cleared', JSON.stringify(result));
      assert.ok(!existsSync(path));
      assert.ok(!hasBranch(f.main, branch));
    });
  }
});

test('a story with no recorded merged head and a pruned remote branch is blocked and keeps everything', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  const made = f.files('S-1');
  const { logs } = f.story('S-1', { branch, path, mode: 'none' });
  git(f.main, 'push', '-q', 'origin', '--delete', branch);
  git(f.main, 'fetch', '-q', '--prune', 'origin');
  const result = (await f.clear(['S-1'])).of('S-1');
  assert.equal(result.result, 'blocked', JSON.stringify(result));
  assert.match(result.reason, /remote/i);
  assertKept(f, 'S-1', { path, branch, made, logs });
  assert.equal(f.find('S-1').cleanup?.blocked, result.reason, 'the story does not carry the blocked reason');
  noPendingFor(f, 'S-1');
});

test('a commit on the branch that is not pushed blocks the clear, even with a merged head recorded', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  const made = f.files('S-1');
  const { logs } = f.story('S-1', { branch, path, mode: 'observed' });
  writeFileSync(join(path, 'later.txt'), 'later\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'Later work');
  const result = (await f.clear(['S-1'])).of('S-1');
  assert.equal(result.result, 'blocked', JSON.stringify(result));
  assert.match(result.reason, /push|remote/i);
  assertKept(f, 'S-1', { path, branch, made, logs });
});

test('uncommitted or untracked files block the clear and delete nothing', async t => {
  for (const kind of ['untracked', 'uncommitted']) {
    await t.test(kind, async t => {
      const f = await fixture(t);
      const { path, branch } = f.worktree('S-1');
      const made = f.files('S-1');
      const { logs } = f.story('S-1', { branch, path });
      if (kind === 'untracked') writeFileSync(join(path, 'scratch.txt'), 'scratch\n');
      else writeFileSync(join(path, 'S-1.txt'), 'changed\n');
      const result = (await f.clear(['S-1'])).of('S-1');
      assert.equal(result.result, 'blocked', JSON.stringify(result));
      assert.match(result.reason, /uncommitted|untracked/i);
      assertKept(f, 'S-1', { path, branch, made, logs });
      assert.equal(f.find('S-1').cleanup?.blocked, result.reason);
    });
  }
});

test('the cleanup events of a clear are recorded by jarvis, so none is pending', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  writeFileSync(join(path, 'scratch.txt'), 'scratch\n');
  assert.equal((await f.clear(['S-1'])).of('S-1').result, 'blocked');
  const cleanup = f.service.store.history('S-1').filter(event => ['request-cleanup', 'cleanup-blocked'].includes(event.type));
  assert.deepEqual(cleanup.map(event => event.type).sort(), ['cleanup-blocked', 'request-cleanup']);
  for (const event of cleanup) assert.equal(event.by, 'jarvis', event.type + ' is not recorded by jarvis');
  noPendingFor(f, 'S-1');
});

test('a blocked story can be cleared again once the cause is fixed', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  writeFileSync(join(path, 'scratch.txt'), 'scratch\n');
  assert.equal((await f.clear(['S-1'])).of('S-1').result, 'blocked');
  rmSync(join(path, 'scratch.txt'));
  const result = (await f.clear(['S-1'])).of('S-1');
  assert.equal(result.result, 'cleared', JSON.stringify(result));
  assert.ok(!existsSync(path));
  assert.equal(f.find('S-1'), undefined);
});

test('a worktree already removed by hand does not block; the branch is left and named in the result', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  const made = f.files('S-1');
  const { logs } = f.story('S-1', { branch, path });
  git(f.main, 'worktree', 'remove', path);
  const result = (await f.clear(['S-1'])).of('S-1');
  assert.equal(result.result, 'cleared', JSON.stringify(result));
  for (const folder of Object.values(made)) assert.ok(!existsSync(folder), folder + ' is still there');
  assert.ok(!existsSync(logs.tester));
  assert.ok(hasBranch(f.main, branch), 'the branch was deleted although the repository could not be found');
  const left = JSON.stringify(result.left ?? []);
  assert.ok(left.includes(branch) && left.includes('acme/app'), 'the result does not name the branch and repository left behind: ' + JSON.stringify(result));
  assert.equal(f.find('S-1'), undefined);
});

test('a folder at the worktree path that git no longer lists blocks and is never deleted', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  git(f.main, 'worktree', 'remove', path);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'left.txt'), 'left\n');
  const result = (await f.clear(['S-1'])).of('S-1');
  assert.equal(result.result, 'blocked', JSON.stringify(result));
  assert.match(result.reason, /by hand/i);
  const said = slash(result.reason).toLowerCase();
  assert.ok(said.includes(real(path)) || said.includes(slash(path).toLowerCase()), 'the reason does not name the folder: ' + result.reason);
  assert.ok(existsSync(join(path, 'left.txt')), 'the unlisted folder was deleted');
  assertKept(f, 'S-1', { branch });
});

test('a worktree on another branch or on a detached HEAD blocks and deletes nothing', async t => {
  for (const kind of ['other-branch', 'detached']) {
    await t.test(kind, async t => {
      const f = await fixture(t);
      const { path, branch } = f.worktree('S-1');
      const made = f.files('S-1');
      const { logs } = f.story('S-1', { branch, path });
      if (kind === 'detached') git(path, 'switch', '-q', '--detach');
      else {
        git(path, 'switch', '-q', '-c', 'story/other');
        git(path, 'push', '-q', '-u', 'origin', 'story/other');
      }
      const result = (await f.clear(['S-1'])).of('S-1');
      assert.equal(result.result, 'blocked', JSON.stringify(result));
      assertKept(f, 'S-1', { path, branch, made, logs });
      if (kind === 'other-branch') assert.ok(hasBranch(f.main, 'story/other'));
    });
  }
});

test('a worktree or branch shared with another live story is not cleared', async t => {
  for (const shared of ['worktree', 'branch']) {
    await t.test(shared, async t => {
      const f = await fixture(t);
      const { path, branch } = f.worktree('S-1');
      const made = f.files('S-1');
      const { logs } = f.story('S-1', { branch, path });
      const other = shared === 'worktree'
        ? { branch: 'story/s-2', worktree: process.platform === 'win32' ? path.toUpperCase() : path + '/' }
        : { branch, worktree: slash(join(f.root, 'wt', 'S-2')) };
      f.service.createStory({ story: 'S-2', title: 'Live work', detail: 'Still open.', harness: 'Codex', repo: 'acme/app', ...other });
      const result = (await f.clear(['S-1'])).of('S-1');
      assert.notEqual(result.result, 'cleared', JSON.stringify(result));
      assertKept(f, 'S-1', { path, branch, made, logs });
      assert.ok(f.find('S-2'));
    });
  }
});

test('a story whose ID aliases another story folder on Windows is not cleared', async t => {
  for (const [id, alias] of [['S-1', 's-1'], ['S-3.', 'S-3']]) {
    await t.test(id + ' beside ' + alias, async t => {
      const f = await fixture(t);
      const { path, branch } = f.worktree(id.replace(/\.$/, '-dot'));
      f.story(id, { branch, path });
      f.service.createStory({ story: alias, title: 'Live work', detail: 'Still open.', branch: 'story/live', worktree: slash(join(f.root, 'wt', 'live')), harness: 'Codex', repo: 'acme/app' });
      const kept = join(f.home, 'stories', alias);
      mkdirSync(kept, { recursive: true });
      writeFileSync(join(kept, 'pack.md'), 'live\n');
      const result = (await f.clear([id])).of(id);
      assert.notEqual(result?.result, 'cleared', JSON.stringify(result));
      assert.ok(existsSync(join(kept, 'pack.md')), 'the live story folder was deleted');
      assert.ok(existsSync(path), 'the worktree was deleted');
      assert.ok(f.find(alias));
    });
  }
});

test('a story that is not closed, is missing, or has a Jarvis turn running is refused and nothing is recorded', async t => {
  const f = await fixture(t);
  const open = f.worktree('S-1');
  f.story('S-1', { ...open, phase: 'building' });
  const busy = f.worktree('S-2');
  f.story('S-2', busy);
  f.record('S-2', 'jarvis-turn-started', { session: 'S-2-jarvis', pid: 5151, log: slash(join(f.home, 'workers', 'S-2-jarvis.log')) });
  const before = ['S-1', 'S-2'].map(id => [f.find(id).revision, f.service.store.history(id).length]);
  const { results, of } = await f.clear(['S-1', 'S-2', 'NOPE-1']);
  assert.equal(results.length, 3);
  for (const id of ['S-1', 'S-2', 'NOPE-1']) assert.equal(of(id)?.result, 'refused', JSON.stringify(results));
  assert.deepEqual(['S-1', 'S-2'].map(id => [f.find(id).revision, f.service.store.history(id).length]), before);
  assert.ok(existsSync(open.path) && existsSync(busy.path));
  assert.equal(f.find('S-1').cleanup, undefined);
  assert.equal(f.find('S-2').cleanup, undefined);
});

test('clear all reports each story and one blocked or refused story does not stop the others', async t => {
  const f = await fixture(t);
  const dirty = f.worktree('S-1');
  f.story('S-1', dirty);
  writeFileSync(join(dirty.path, 'scratch.txt'), 'scratch\n');
  const clean = f.worktree('S-2');
  const made = f.files('S-2');
  f.story('S-2', clean);
  const open = f.worktree('S-3');
  f.story('S-3', { ...open, phase: 'building' });
  const clean2 = f.worktree('S-4');
  f.story('S-4', clean2);
  const { status, results, of } = await f.clear(['S-1', 'NOPE-1', 'S-2', 'S-3', 'S-4']);
  assert.equal(status, 200);
  assert.equal(results.length, 5, JSON.stringify(results));
  assert.equal(of('S-1').result, 'blocked');
  assert.match(of('S-1').reason, /untracked|uncommitted/i);
  assert.equal(of('NOPE-1').result, 'refused');
  assert.equal(of('S-3').result, 'refused');
  assert.equal(of('S-2').result, 'cleared');
  assert.equal(of('S-4').result, 'cleared');
  assert.ok(!existsSync(clean.path) && !existsSync(clean2.path));
  for (const folder of Object.values(made)) assert.ok(!existsSync(folder));
  assert.ok(existsSync(dirty.path) && existsSync(open.path));
  assert.deepEqual(f.service.snapshot().map(story => story.id).sort(), ['S-1', 'S-3']);
});

test('two clears of the same story at once clear it once and refuse the other', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  const [first, second] = await Promise.all([f.clear(['S-1']), f.clear(['S-1'])]);
  const outcomes = [first.of('S-1').result, second.of('S-1').result].sort();
  assert.deepEqual(outcomes, ['cleared', 'refused']);
  assert.ok(!existsSync(path));
});

test('/api/clear rejects other origins and malformed requests without touching any story', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  const revision = f.find('S-1').revision;
  const post = (body, origin = f.origin) => fetch(f.url + 'api/clear', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body });
  assert.equal((await post(JSON.stringify({ stories: ['S-1'] }), 'http://evil.example')).status, 403);
  assert.equal((await post('not json')).status, 400);
  assert.equal((await post(JSON.stringify({ stories: 'S-1' }))).status, 400);
  assert.equal((await post(JSON.stringify({}))).status, 400);
  assert.equal((await post(JSON.stringify({ stories: [42] }))).status, 400);
  assert.equal(f.find('S-1').revision, revision);
  assert.ok(existsSync(path));
});

test('the clear preview names the worktree, branch, folders and logs that exist and records nothing', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  const made = f.files('S-1');
  f.story('S-1', { branch, path });
  const revision = f.find('S-1').revision;
  const { status, body } = await f.preview('S-1');
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.story, 'S-1');
  assert.ok(same(body.worktree.path, path) && body.worktree.exists === true, JSON.stringify(body.worktree));
  assert.equal(body.branch.name, branch);
  assert.equal(body.branch.remove, true);
  for (const folder of Object.values(made)) assert.ok(body.folders.some(item => same(item, folder)), folder + ' missing from ' + JSON.stringify(body.folders));
  assert.equal(body.logs, 2);
  assert.equal(body.record, true);
  assert.equal(f.find('S-1').revision, revision);
  assert.ok(existsSync(path));
});

test('the clear preview names the ignored files the worktree removal deletes, and the clear deletes them', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  writeFileSync(join(path, '.gitignore'), '.env\nbuild/\n');
  git(path, 'add', '.gitignore');
  git(path, 'commit', '-q', '-m', 'Ignore local files');
  git(path, 'push', '-q', 'origin', branch);
  f.story('S-1', { branch, path });
  writeFileSync(join(path, '.env'), 'TOKEN=local\n');
  mkdirSync(join(path, 'build'));
  for (const name of ['1', '2', '3', '4', '5', '6']) writeFileSync(join(path, 'build', name + '.js'), name + '\n');
  const { status, body } = await f.preview('S-1');
  assert.equal(status, 200, JSON.stringify(body));
  assert.deepEqual(body.ignored, { count: 7, paths: ['.env', 'build/1.js', 'build/2.js', 'build/3.js', 'build/4.js'] });
  const result = (await f.clear(['S-1'])).of('S-1');
  assert.equal(result.result, 'cleared', JSON.stringify(result));
  assert.ok(!existsSync(join(path, '.env')), 'the ignored .env file is still there');
  assert.ok(!existsSync(path), 'the worktree is still there');
});

test('the clear preview lists no ignored files for a worktree without them', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  const { body } = await f.preview('S-1');
  assert.deepEqual(body.ignored, { count: 0, paths: [] });
});

test('the clear preview says the branch stays when the worktree is already gone', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  git(f.main, 'worktree', 'remove', path);
  const { status, body } = await f.preview('S-1');
  assert.equal(status, 200, JSON.stringify(body));
  assert.equal(body.worktree.exists, false);
  assert.equal(body.branch.name, branch);
  assert.equal(body.branch.remove, false);
  assert.ok(typeof body.branch.reason === 'string' && body.branch.reason.length > 0);
  assert.deepEqual(body.folders, []);
});

test('the clear preview refuses a story that is not closed or does not exist', async t => {
  const f = await fixture(t);
  const open = f.worktree('S-1');
  f.story('S-1', { ...open, phase: 'building' });
  assert.equal((await f.preview('S-1')).status, 409);
  assert.equal((await f.preview('NOPE-1')).status, 404);
});

test('a branch named like a folder in its worktree is cleared, in either order of clear all', async t => {
  for (const order of [['A-1', 'B-1'], ['B-1', 'A-1']]) {
    await t.test(order.join(' then '), async t => {
      const f = await fixture(t);
      const plain = f.worktree('A-1');
      f.story('A-1', plain);
      const docs = f.worktree('B-1', { branch: 'docs', push: false });
      mkdirSync(join(docs.path, 'docs'));
      writeFileSync(join(docs.path, 'docs', 'guide.md'), '# guide\n');
      git(docs.path, 'add', '.');
      git(docs.path, 'commit', '-q', '-m', 'Docs folder');
      git(docs.path, 'push', '-q', '-u', 'origin', 'docs');
      f.story('B-1', { branch: 'docs', path: docs.path });
      const { status, results, of } = await f.clear(order);
      assert.equal(status, 200);
      assert.equal(results.length, 2);
      assert.equal(of('A-1').result, 'cleared', JSON.stringify(results));
      assert.equal(of('B-1').result, 'cleared', JSON.stringify(results));
      assert.ok(!existsSync(docs.path) && !hasBranch(f.main, 'docs'));
    });
  }
});

test('a story that throws during a clear is blocked and does not stop the batch or lose another story report', async t => {
  for (const order of [['A-1', 'B-1', 'C-1'], ['B-1', 'A-1', 'C-1']]) {
    await t.test(order.join(' then '), async t => {
      const f = await fixture(t);
      const trees = Object.fromEntries(['A-1', 'B-1', 'C-1'].map(id => [id, f.worktree(id)]));
      for (const [id, tree] of Object.entries(trees)) f.story(id, tree);
      const made = f.files('A-1');
      const real = f.service.store;
      const store = {
        snapshot: () => real.snapshot(),
        record: input => real.record(input),
        history: id => {
          if (id === 'B-1') throw new Error('history unreadable');
          return real.history(id);
        },
      };
      const clearer = createClearer({ store, home: f.home, attachmentRoot: join(f.root, 'db', 'attachments'), folderFor: id => String(id).replace(/[^\w-]/g, '_') });
      const results = await clearer.clear(order);
      const of = id => results.find(result => result.story === id);
      assert.equal(results.length, 3, JSON.stringify(results));
      assert.equal(of('A-1').result, 'cleared', JSON.stringify(results));
      assert.ok(of('A-1').deleted.some(item => String(item).includes('A-1')), JSON.stringify(of('A-1')));
      for (const folder of Object.values(made)) assert.ok(!existsSync(folder), folder + ' is still there');
      assert.equal(of('C-1').result, 'cleared', JSON.stringify(results));
      assert.equal(of('B-1').result, 'blocked', JSON.stringify(results));
      assert.match(of('B-1').reason, /history unreadable/);
      assert.ok(of('B-1').deleted.some(item => same(item, trees['B-1'].path)), 'the partial report of B-1 was lost: ' + JSON.stringify(of('B-1')));
      assert.ok(f.service.store.history('B-1').some(event => event.type === 'cleanup-blocked'), 'cleanup-blocked was not recorded for B-1');
      noPendingFor(f, 'B-1');
    });
  }
});

test('a story whose attachments folder is shared with another story through folderFor is not cleared', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1-dot');
  f.story('S.1', { branch, path });
  f.service.createStory({ story: 'S_1', title: 'Live work', detail: 'Still open.', branch: 'story/live', worktree: slash(join(f.root, 'wt', 'live')), harness: 'Codex', repo: 'acme/app' });
  const shared = join(f.root, 'db', 'attachments', 'S_1');
  mkdirSync(shared, { recursive: true });
  writeFileSync(join(shared, 'keep.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const result = (await f.clear(['S.1'])).of('S.1');
  assert.notEqual(result?.result, 'cleared', JSON.stringify(result));
  assert.ok(existsSync(join(shared, 'keep.png')), 'the live story attachments were deleted');
  assert.ok(existsSync(path), 'the worktree was deleted');
  assert.ok(f.find('S_1'));
});

test('every Jarvis turn log of a story is cleared, even when the log is not named after the session', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  const launch = join(f.home, 'workers', 'launch-7f3a.log');
  writeFileSync(launch, 'turn output\n');
  f.record('S-1', 'jarvis-turn-started', { session: 'S-1-thread', pid: 4545, log: launch });
  f.record('S-1', 'jarvis-turn-ended', { outcome: 'ended', code: 0, detail: 'Jarvis ended its turn.\nSee ' + launch + '.' });
  const result = (await f.clear(['S-1'])).of('S-1');
  assert.equal(result.result, 'cleared', JSON.stringify(result));
  assert.ok(!existsSync(launch), 'a Jarvis turn log named after its launch is still there');
});

test('the turn log of a Jarvis launch that never reported a session is cleared', async t => {
  const f = await fixture(t);
  const { path, branch } = f.worktree('S-1');
  f.story('S-1', { branch, path });
  const spawnProcess = () => {
    const child = new EventEmitter();
    child.pid = 4646;
    child.stdin = { on: () => child.stdin, end: () => {} };
    setImmediate(() => child.emit('spawn'));
    return child;
  };
  const failure = await startWorker({ harness: 'Codex', worktree: path, prompt: 'wake', phase: 'coordinator' },
    { spawnProcess, env: { AI_SDLC_HOME: f.home }, settings: { permissions: 'unrestricted', tools: [] }, settleMs: 0, waitMs: 0 }).then(() => null, error => error);
  assert.ok(failure, 'the launch did not fail');
  const launch = /See (.+)\.$/.exec(failure.message)?.[1];
  assert.ok(launch && existsSync(launch), failure.message);
  f.record('S-1', 'jarvis-woken', { handled: 0 });
  f.record('S-1', 'jarvis-turn-ended', { outcome: 'failed', detail: 'Jarvis could not start.\n' + failure.message });
  const result = (await f.clear(['S-1'])).of('S-1');
  assert.equal(result.result, 'cleared', JSON.stringify(result));
  assert.ok(!existsSync(launch), 'the log of a launch that never reported a session is still there');
});

test('a story whose cleanup events cannot be recorded is reported blocked and the batch goes on', async t => {
  const f = await fixture(t);
  const trees = Object.fromEntries(['A-1', 'B-1'].map(id => [id, f.worktree(id)]));
  for (const [id, tree] of Object.entries(trees)) f.story(id, tree);
  const real = f.service.store;
  const store = {
    snapshot: () => real.snapshot(),
    history: id => real.history(id),
    record: input => {
      if (input.story === 'B-1') throw new Error('store unavailable');
      return real.record(input);
    },
  };
  const clearer = createClearer({ store, home: f.home, attachmentRoot: join(f.root, 'db', 'attachments'), folderFor: id => String(id).replace(/[^\w-]/g, '_') });
  const results = await clearer.clear(['B-1', 'A-1']);
  const of = id => results.find(result => result.story === id);
  assert.equal(of('B-1')?.result, 'blocked', JSON.stringify(results));
  assert.match(of('B-1').reason, /store unavailable/);
  assert.ok(existsSync(trees['B-1'].path), 'B-1 worktree was deleted');
  assert.equal(of('A-1')?.result, 'cleared', JSON.stringify(results));
});
