import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { check, detect, validate } from './preflight.mjs';

const asset = name => JSON.parse(readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)), 'utf8'));
const machine = { schemaVersion: 1, ownerName: 'Sam', crossModelReviewAuthorized: true };
const repoProfile = gates => ({ schemaVersion: 1, gates });

function workspace(t, { machineProfile, repoFile } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-sdlc-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const home = join(dir, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://example.test/acme/widgets.git']);
  if (machineProfile) writeFileSync(join(home, 'profile.json'), JSON.stringify(machineProfile));
  if (repoFile) writeFileSync(join(repo, '.ai-sdlc.json'), JSON.stringify(repoFile));
  return { repo, env: { ...process.env, AI_SDLC_HOME: home } };
}

test('example profiles satisfy their schemas', () => {
  assert.deepEqual(validate(asset('profile.example.json'), asset('profile.schema.json')), []);
  assert.deepEqual(validate(asset('repo-profile.example.json'), asset('repo-profile.schema.json')), []);
});

test('validate reports missing, mistyped, and unknown fields', () => {
  const problems = validate({ schemaVersion: 2, crossModelReviewAuthorized: 'yes', password: 'x' }, asset('profile.schema.json'));
  assert.equal(problems.length, 4);
  assert.match(problems.join('\n'), /ownerName is missing/);
  assert.match(problems.join('\n'), /schemaVersion must be one of/);
  assert.match(problems.join('\n'), /crossModelReviewAuthorized must be boolean/);
  assert.match(problems.join('\n'), /password is not a known field/);
});

test('check sends a machine without profiles to setup', t => {
  const { repo, env } = workspace(t);
  const result = check(repo, env);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /No machine profile/);
  assert.match(result.problems.join('\n'), /No repository profile for acme\/widgets/);
});

test('check passes with a repository file and reports skipped gates', t => {
  const { repo, env } = workspace(t, { machineProfile: machine, repoFile: repoProfile({ test: 'git --version', mutation: null }) });
  const result = check(repo, env);
  assert.deepEqual(result.problems, []);
  assert.equal(result.owner, 'Sam');
  assert.deepEqual(result.repo.gates, { test: 'git --version' });
  assert.deepEqual(result.repo.skippedGates, ['mutation']);
});

test('the repository file wins over the machine profile entry, which is the fallback', t => {
  const withEntry = { ...machine, repos: { 'acme/widgets': repoProfile({ test: 'git status' }) } };
  const both = workspace(t, { machineProfile: withEntry, repoFile: repoProfile({ test: 'git --version' }) });
  assert.equal(check(both.repo, both.env).repo.gates.test, 'git --version');
  const fallback = workspace(t, { machineProfile: withEntry });
  const result = check(fallback.repo, fallback.env);
  assert.equal(result.ok, true);
  assert.equal(result.repo.gates.test, 'git status');
});

test('check reports a gate whose tool is not installed', t => {
  const { repo, env } = workspace(t, { machineProfile: machine, repoFile: repoProfile({ secrets: 'no-such-scanner-xyz detect' }) });
  const result = check(repo, env);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /gate secrets needs "no-such-scanner-xyz"/);
});

test('cross-model sharing needs the machine to allow it and the repository not to forbid it', t => {
  const allowed = workspace(t, { machineProfile: machine, repoFile: repoProfile({}) });
  assert.equal(check(allowed.repo, allowed.env).crossModelReviewAuthorized, true);
  const forbidden = workspace(t, { machineProfile: machine, repoFile: { ...repoProfile({}), crossModelReviewAuthorized: false } });
  assert.equal(check(forbidden.repo, forbidden.env).crossModelReviewAuthorized, false);
  const machineNo = workspace(t, { machineProfile: { ...machine, crossModelReviewAuthorized: false }, repoFile: repoProfile({}) });
  assert.equal(check(machineNo.repo, machineNo.env).crossModelReviewAuthorized, false);
});

test('detect reports repository facts for the interview', t => {
  const { repo, env } = workspace(t);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
  const facts = detect(repo, env);
  assert.equal(facts.repo.slug, 'acme/widgets');
  assert.deepEqual(facts.repo.packageScripts, { test: 'node --test' });
  assert.deepEqual(facts.repo.manifests, ['package.json']);
  assert.equal(facts.tools.git, true);
  assert.equal(facts.profiles.machineProfileExists, false);
});
