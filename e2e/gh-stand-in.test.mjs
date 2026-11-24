import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gh, parse } from './gh-stand-in.mjs';

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'gh-stand-in-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'remote', 'acme', 'tools.git');
  const work = join(root, 'work');
  mkdirSync(origin, { recursive: true });
  mkdirSync(work);
  git(origin, 'init', '-q', '--bare', '--initial-branch=main');
  git(work, 'init', '-q', '--initial-branch=main');
  git(work, 'config', 'user.name', 'Test');
  git(work, 'config', 'user.email', 'test@example.invalid');
  writeFileSync(join(work, 'a.txt'), 'a\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'Start');
  git(work, 'remote', 'add', 'origin', origin.replaceAll('\\', '/'));
  git(work, 'push', '-q', 'origin', 'main');
  git(work, 'switch', '-q', '-c', 'story/one');
  return { state: join(root, 'github'), work };
}

test('parse reads long, joined, short, and boolean flags', () => {
  assert.deepEqual(parse(['create', '--title=Add it', '-b', 'Body', '--draft', '--base', 'main']),
    { values: { title: 'Add it', body: 'Body', draft: true, base: 'main' }, positionals: ['create'] });
});

test('a pull request opens only for a pushed branch, once, and reads back with its live head', t => {
  const { state, work } = repository(t);
  const create = ['pr', 'create', '--title', 'Add it', '--body', 'Runs node --test.'];
  assert.throws(() => gh(state, create, { cwd: work }), /must first push the current branch/);
  git(work, 'push', '-q', 'origin', 'story/one');
  assert.equal(gh(state, create, { cwd: work }), 'https://github.com/acme/tools/pull/1');
  assert.throws(() => gh(state, create, { cwd: work }), /already exists:\nhttps:\/\/github.com\/acme\/tools\/pull\/1/);
  writeFileSync(join(work, 'b.txt'), 'b\n');
  git(work, 'add', '.');
  git(work, 'commit', '-q', '-m', 'More');
  git(work, 'push', '-q', 'origin', 'story/one');
  const viewed = JSON.parse(gh(state, ['pr', 'view', 'https://github.com/acme/tools/pull/1', '--json', 'url,state,headRefName,baseRefName,headRefOid,statusCheckRollup'], { cwd: work }));
  assert.deepEqual(viewed, {
    url: 'https://github.com/acme/tools/pull/1', state: 'OPEN', headRefName: 'story/one', baseRefName: 'main',
    headRefOid: git(work, 'rev-parse', 'HEAD'), statusCheckRollup: [],
  });
});

test('the body can come from a file, and an edit replaces it', t => {
  const { state, work } = repository(t);
  git(work, 'push', '-q', 'origin', 'story/one');
  writeFileSync(join(work, 'body.md'), 'From a file.');
  gh(state, ['pr', 'create', '-t', 'Add it', '-F', 'body.md'], { cwd: work });
  assert.equal(JSON.parse(gh(state, ['pr', 'view', '--json', 'body'], { cwd: work })).body, 'From a file.');
  gh(state, ['pr', 'edit', '1', '--body', 'Edited.'], { cwd: work });
  assert.equal(JSON.parse(gh(state, ['pr', 'view', '1', '--json', 'body'], { cwd: work })).body, 'Edited.');
});

test('a body file given by absolute path is read from that path', t => {
  const { state, work } = repository(t);
  git(work, 'push', '-q', 'origin', 'story/one');
  const outside = join(state, '..', 'pr-body.md');
  writeFileSync(outside, 'From an absolute path.');
  gh(state, ['pr', 'create', '--title', 'Add it', '--body-file', outside], { cwd: work });
  assert.equal(JSON.parse(gh(state, ['pr', 'view', '--json', 'body'], { cwd: work })).body, 'From an absolute path.');
});

test('only a local origin is accepted, so the stand-in never contacts a remote host', t => {
  const { state, work } = repository(t);
  git(work, 'push', '-q', 'origin', 'story/one');
  for (const remote of ['https://github.com/acme/tools.git', 'git@github.com:acme/tools.git', '//host/share/acme/tools.git']) {
    git(work, 'remote', 'set-url', 'origin', remote);
    assert.throws(() => gh(state, ['pr', 'create', '--title', 'Add it', '--body', 'Body'], { cwd: work }), /works only with a local origin/, remote);
  }
  assert.ok(!existsSync(join(state, 'pulls.json')), 'No pull request was recorded.');
});

test('anything it cannot stand in for is refused rather than sent to GitHub', t => {
  const { state, work } = repository(t);
  assert.throws(() => gh(state, ['api', 'user'], { cwd: work }), /does not support "gh api user"/);
  assert.throws(() => gh(state, ['pr', 'view'], { cwd: work }), /no pull requests found for branch "story\/one"/);
});
