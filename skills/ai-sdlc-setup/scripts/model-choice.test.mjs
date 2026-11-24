import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as preflight from './preflight.mjs';
import { commandFor, row, workerSettings } from '../../../adapters/harnesses.mjs';

const { check, findCommandCenter, phaseTiers, validate } = preflight;
const asset = name => JSON.parse(readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)), 'utf8'));
const script = fileURLToPath(new URL('./preflight.mjs', import.meta.url));
const checkout = findCommandCenter();

const completeMachine = () => ({
  schemaVersion: 1,
  ownerName: 'Sam',
  crossModelReviewAuthorized: false,
  sharedResources: [],
  defaultVerificationEnvironment: 'localhost',
  implementationLevel: 'full',
  reviewRoundLimit: 3,
  beforeAndAfter: 'ask',
  architectureDiagram: 'ask',
  workerPermissions: 'restricted',
  models: { 'claude-code': { deep: null, standard: null } },
  commandCenterPath: checkout,
});

const completeRepo = () => ({
  gates: { test: 'git --version', lint: null, typecheck: null, build: null, secrets: null, dependencies: null, staticAnalysis: null, mutation: null },
  branchPattern: 'story/{id}-{slug}',
  worktreeRoot: '/work/trees',
  teamRules: [],
  readiness: { tracker: 'none' },
  requiredPipelines: [],
  reviewBot: 'none',
  specDir: 'docs/specs',
});

const notAskedMachine = ['schemaVersion', 'commandCenterPath', 'phaseTiers', 'adapters', 'repos', 'declinedComponents'];
const notAskedRepo = ['schemaVersion', 'crossModelReviewAuthorized'];

function workspace(t, machineProfile, repoEntry) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-sdlc-models-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const home = join(dir, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://example.test/acme/widgets.git']);
  const repos = repoEntry ? { repos: { 'acme/widgets': repoEntry } } : {};
  writeFileSync(join(home, 'profile.json'), JSON.stringify({ ...machineProfile, ...repos }));
  return { repo, env: { ...process.env, AI_SDLC_HOME: home } };
}

const modelWarnings = result => result.warnings.filter(warning => /model choice/.test(warning));
const without = (object, key) => Object.fromEntries(Object.entries(object).filter(([name]) => name !== key));

test('a tier may be saved as null, meaning the owner kept the program default, but not as an empty or unknown tier', () => {
  const schema = asset('profile.schema.json');
  const base = { schemaVersion: 1, ownerName: 'Sam', crossModelReviewAuthorized: false };
  assert.deepEqual(validate({ ...base, models: { 'claude-code': { deep: null, standard: null } } }, schema), []);
  assert.deepEqual(validate({ ...base, models: { codex: { deep: 'model-alpha', standard: null, fast: null } } }, schema), []);
  assert.match(validate({ ...base, models: { codex: { deep: '' } } }, schema).join('\n'), /models\.codex\.deep must not be empty/);
  assert.match(validate({ ...base, models: { codex: { huge: null } } }, schema).join('\n'), /models\.codex\.huge is not a known field/);
});

test('the example profile shows a harness that keeps its default for a tier, and still validates', () => {
  const example = asset('profile.example.json');
  assert.deepEqual(validate(example, asset('profile.schema.json')), []);
  const tiers = Object.values(example.models ?? {}).flatMap(tiersOf => Object.values(tiersOf));
  assert.ok(tiers.includes(null), 'the example saves "keep the default" as null for at least one tier');
});

test('modelWarning names the harness, the tiers with no recorded choice, and the setup question', () => {
  assert.equal(typeof preflight.modelWarning, 'function', 'preflight exports modelWarning');
  const claude = row('Claude Code');
  const none = preflight.modelWarning({}, phaseTiers, claude);
  assert.match(none, /^Claude Code has no model choice recorded for deep and standard\./);
  assert.match(none, /Models question for Claude Code/);
  assert.match(none, /"keep the default" is saved as null/);

  const half = preflight.modelWarning({ 'claude-code': { deep: 'model-alpha' } }, phaseTiers, claude);
  assert.match(half, /recorded for standard\./);
  assert.doesNotMatch(half, /recorded for deep/);

  const otherHarness = preflight.modelWarning({ codex: { deep: 'model-alpha', standard: 'model-beta' } }, phaseTiers, claude);
  assert.match(otherHarness, /^Claude Code has no model choice recorded for deep and standard\./);
});

test('modelWarning is silent once both tiers are recorded, by name or as null, and for harnesses with no model option', () => {
  assert.equal(typeof preflight.modelWarning, 'function', 'preflight exports modelWarning');
  const claude = row('Claude Code');
  assert.equal(preflight.modelWarning({ 'claude-code': { deep: null, standard: null } }, phaseTiers, claude), null);
  assert.equal(preflight.modelWarning({ 'claude-code': { deep: 'model-alpha', standard: 'model-beta' } }, phaseTiers, claude), null);
  assert.equal(preflight.modelWarning({ codex: { deep: null, standard: 'model-beta' } }, phaseTiers, row('codex')), null);
  assert.equal(preflight.modelWarning({}, phaseTiers, row('Cursor')), null);
  assert.equal(preflight.modelWarning({}, phaseTiers, row('GitHub Copilot app')), null);
});

test('fast is never required, even when the owner moves a phase to it', () => {
  assert.equal(typeof preflight.modelWarning, 'function', 'preflight exports modelWarning');
  const moved = { ...phaseTiers, ci: 'fast', publishing: 'fast' };
  assert.equal(preflight.modelWarning({ 'claude-code': { deep: null, standard: 'model-beta' } }, moved, row('Claude Code')), null);
  assert.doesNotMatch(preflight.modelWarning({}, moved, row('Claude Code')), /fast/);
});

test('check warns about the harness of the story being started, and only that one', t => {
  const profile = { ...completeMachine(), models: { codex: { deep: 'model-alpha', standard: 'model-beta' } } };
  const { repo, env } = workspace(t, profile, completeRepo());

  const claude = check(repo, env, checkout, row('Claude Code'));
  assert.deepEqual(claude.problems, []);
  assert.equal(claude.ok, true, 'a missing model choice is a warning, not a problem');
  assert.equal(modelWarnings(claude).length, 1);
  assert.match(modelWarnings(claude)[0], /^Claude Code has no model choice recorded for deep and standard\./);
  assert.match(claude.nextSteps.join('\n'), /Models question/);
  if (!claude.warnings.some(warning => /is not installed/.test(warning))) {
    assert.doesNotMatch(claude.nextSteps.join('\n'), /declinedComponents/, 'install advice only for component warnings');
  }

  assert.deepEqual(modelWarnings(check(repo, env, checkout, row('Codex'))), []);
  assert.deepEqual(modelWarnings(check(repo, env, checkout)), [], 'no harness named: no model warning');
  assert.deepEqual(modelWarnings(check(repo, env, checkout, row('Cursor'))), []);
  assert.deepEqual(modelWarnings(check(repo, env, checkout, row('GitHub Copilot app'))), []);
});

test('check is silent about models once the owner chose to keep the default', t => {
  const { repo, env } = workspace(t, completeMachine(), completeRepo());
  const result = check(repo, env, checkout, row('Claude Code'));
  assert.deepEqual(result.problems, []);
  assert.deepEqual(modelWarnings(result), []);
});

test('a complete profile has no unanswered questions', t => {
  const { repo, env } = workspace(t, completeMachine(), completeRepo());
  const result = check(repo, env, checkout);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.unanswered, []);
  assert.deepEqual(result.warnings.filter(warning => /no answer for/.test(warning)), []);
});

test('each missing interview answer gets its own warning naming the question to ask', t => {
  const machine = without(completeMachine(), 'workerPermissions');
  const repoEntry = without(completeRepo(), 'reviewBot');
  const { repo, env } = workspace(t, machine, repoEntry);
  const result = check(repo, env, checkout);
  assert.equal(result.ok, true, 'an unanswered question is a warning, not a problem');
  assert.ok(Array.isArray(result.unanswered), 'check returns unanswered');
  assert.equal(result.unanswered.length, 2);
  assert.match(JSON.stringify(result.unanswered ?? null), /workerPermissions/);
  assert.match(JSON.stringify(result.unanswered ?? null), /reviewBot/);
  const answers = result.warnings.filter(warning => /no answer for/.test(warning));
  assert.equal(answers.length, 2);
  assert.match(answers.join('\n'), /The profile has no answer for the .+ question \(workerPermissions\)\. Ask ai-sdlc-setup machine question 9\./);
  assert.match(answers.join('\n'), /The profile has no answer for the .+ question \([^)]*reviewBot\)\. Ask ai-sdlc-setup repository question 5\./);
});

test('a profile saved before the Models question existed is asked it', t => {
  const { repo, env } = workspace(t, without(completeMachine(), 'models'), completeRepo());
  const result = check(repo, env, checkout);
  assert.match(JSON.stringify(result.unanswered ?? null), /models/);
  assert.match(result.warnings.join('\n'), /no answer for the Models question \([^)]*models[^)]*\)\. Ask ai-sdlc-setup machine question 10\./);
});

test('each gate is its own question, and a gate declined as null counts as answered', t => {
  const repoEntry = completeRepo();
  delete repoEntry.gates.lint;
  const { repo, env } = workspace(t, completeMachine(), repoEntry);
  const result = check(repo, env, checkout);
  assert.equal(result.unanswered?.length, 1);
  assert.match(JSON.stringify(result.unanswered ?? null), /gates\.lint/);
  assert.match(result.warnings.join('\n'), /no answer for the .+ question \([^)]*gates\.lint\)/);
});

test('every profile field is either asked by setup or marked as not asked', t => {
  const schema = asset('profile.schema.json');
  const repoSchema = schema.properties.repos.additionalProperties;
  const asked = [];
  for (const field of Object.keys(schema.properties).filter(field => !notAskedMachine.includes(field))) {
    asked.push(['machine', field, without(completeMachine(), field), completeRepo()]);
  }
  for (const field of Object.keys(repoSchema.properties).filter(field => !notAskedRepo.includes(field) && field !== 'gates')) {
    asked.push(['repository', field, completeMachine(), without(completeRepo(), field)]);
  }
  for (const gate of Object.keys(repoSchema.properties.gates.properties)) {
    const repoEntry = completeRepo();
    delete repoEntry.gates[gate];
    asked.push(['repository', 'gates.' + gate, completeMachine(), repoEntry]);
  }
  for (const [scope, field, machine, repoEntry] of asked) {
    const { repo, env } = workspace(t, machine, repoEntry);
    const result = check(repo, env, checkout);
    assert.ok(JSON.stringify(result.unanswered ?? []).includes(field),
      `${scope} field ${field} is in the schema but is neither an interview question nor marked as not asked`);
  }
});

test('the CLI judges the named harness, by name or install id, and refuses an unknown one', t => {
  const profile = { ...completeMachine(), models: { codex: { deep: 'model-alpha', standard: 'model-beta' } } };
  const { repo, env } = workspace(t, profile, completeRepo());
  const run = (...args) => {
    try {
      return { code: 0, out: JSON.parse(execFileSync(process.execPath, [script, 'check', repo, ...args], { env, encoding: 'utf8' })) };
    } catch (error) {
      return { code: error.status, out: JSON.parse(error.stdout) };
    }
  };
  for (const harness of ['Claude Code', 'claude-code']) {
    const { code, out } = run(harness);
    assert.equal(code, 0, harness);
    assert.match(out.warnings.join('\n'), /Claude Code has no model choice recorded for deep and standard/, harness);
  }
  assert.doesNotMatch(run().out.warnings.join('\n'), /model choice/, 'no harness named: output as today');

  const bogus = run('Bogus');
  assert.equal(bogus.code, 1);
  assert.equal(bogus.out.ok, false);
  const problems = bogus.out.problems.join('\n');
  assert.match(problems, /Bogus/);
  for (const name of ['Claude Code', 'Codex', 'Cursor', 'GitHub Copilot app']) assert.ok(problems.includes(name), `names ${name}`);
});

test('a worker turn passes --model where a model is named and none where the owner kept the default', t => {
  const home = mkdtempSync(join(tmpdir(), 'ai-sdlc-models-home-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  writeFileSync(join(home, 'profile.json'), JSON.stringify({ models: { 'claude-code': { deep: 'model-alpha', standard: null } } }));
  const settings = workerSettings({ AI_SDLC_HOME: home });
  assert.deepEqual(commandFor('Claude Code', 'start', { session: 'S-1', phase: 'planning' }, settings).args.slice(-2), ['--model', 'model-alpha']);
  assert.ok(!commandFor('Claude Code', 'message', { session: 'S-1', phase: 'building' }, settings).args.includes('--model'));
});

test('setup asks deep and standard for each harness, saves "keep the default" as null, and never asks fast', () => {
  const skill = readFileSync(fileURLToPath(new URL('../SKILL.md', import.meta.url)), 'utf8');
  const step = skill.split('\n').find(line => /^10\. \*\*Models\.\*\*/.test(line));
  assert.ok(step, 'machine step 10 is the Models question');
  assert.doesNotMatch(step, /`fast`/);
  assert.match(step, /`deep`/);
  assert.match(step, /`standard`/);
  assert.match(step, /null/);
  assert.doesNotMatch(step, /Recommend leaving a tier out/);
  assert.doesNotMatch(skill, /Skip the machine interview when a valid profile exists/);
});
