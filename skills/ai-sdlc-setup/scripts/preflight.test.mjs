import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { branchPatternProblem, check, componentSeverity, components, detect, findCommandCenter, nextSteps, onPath, phaseTiers, validate } from './preflight.mjs';

const asset = name => JSON.parse(readFileSync(fileURLToPath(new URL(`../assets/${name}`, import.meta.url)), 'utf8'));
const checkout = findCommandCenter();
const machine = { schemaVersion: 1, ownerName: 'Sam', crossModelReviewAuthorized: true, commandCenterPath: checkout };
const repoProfile = gates => ({ gates });

function workspace(t, { machineProfile, repoEntry } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-sdlc-preflight-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, 'repo');
  const home = join(dir, 'home');
  mkdirSync(repo);
  mkdirSync(home);
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', 'https://example.test/acme/widgets.git']);
  const repos = repoEntry ? { repos: { 'acme/widgets': repoEntry } } : {};
  if (machineProfile) writeFileSync(join(home, 'profile.json'), JSON.stringify({ ...machineProfile, ...repos }));
  return { repo, env: { ...process.env, AI_SDLC_HOME: home } };
}

test('a repository with no origin remote is refused, with what to do', t => {
  const { repo, env } = workspace(t);
  assert.equal(detect(repo, env).repo.remote, 'https://example.test/acme/widgets.git');
  assert.doesNotMatch(check(repo, env).problems.join('\n'), /origin/);
  execFileSync('git', ['-C', repo, 'remote', 'remove', 'origin']);
  assert.equal(detect(repo, env).repo.remote, null);
  const result = check(repo, env);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /has no "origin" remote\. Push the repository.*git remote add origin <url>/);
});

test('the example profile satisfies the schema', () => {
  assert.deepEqual(validate(asset('profile.example.json'), asset('profile.schema.json')), []);
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
  assert.match(result.problems.join('\n'), /No profile at/);
  assert.match(result.problems.join('\n'), /No repository section for acme\/widgets/);
});

test('check passes with a repository profile in the machine profile and reports skipped gates', t => {
  const { repo, env } = workspace(t, { machineProfile: machine, repoEntry: repoProfile({ test: 'git --version', mutation: null }) });
  const result = check(repo, env);
  assert.deepEqual(result.problems, []);
  assert.equal(result.owner, 'Sam');
  assert.deepEqual(result.repo.gates, { test: 'git --version' });
  assert.deepEqual(result.repo.skippedGates, ['mutation']);
});

test('check reports the way-of-working settings, with defaults for the ones not saved', t => {
  const defaults = workspace(t, { machineProfile: machine, repoEntry: repoProfile({}) });
  const byDefault = check(defaults.repo, defaults.env);
  assert.deepEqual(
    [byDefault.implementationLevel, byDefault.reviewRoundLimit, byDefault.beforeAndAfter, byDefault.architectureDiagram, byDefault.workerPermissions, byDefault.repo.branchPattern],
    ['full', 3, 'ask', 'ask', 'restricted', 'story/{id}-{slug}']);
  assert.deepEqual(byDefault.adapters, {});

  const saved = workspace(t, {
    machineProfile: { ...machine, implementationLevel: 'lite', reviewRoundLimit: 2, beforeAndAfter: 'never', architectureDiagram: 'always', workerPermissions: 'unrestricted', adapters: { copilot: { repoAliases: {} } } },
    repoEntry: { ...repoProfile({}), branchPattern: 'feature/{id}-{slug}', worktreeRoot: '/work/trees' },
  });
  const result = check(saved.repo, saved.env);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(
    [result.implementationLevel, result.reviewRoundLimit, result.beforeAndAfter, result.architectureDiagram, result.workerPermissions, result.repo.branchPattern],
    ['lite', 2, 'never', 'always', 'unrestricted', 'feature/{id}-{slug}']);
  assert.deepEqual(result.adapters, { copilot: { repoAliases: {} } });
  assert.equal(result.repo.worktreeRoot, '/work/trees');
  assert.equal(byDefault.repo.worktreeRoot, join(byDefault.repo.root, '..', 'repo-worktrees'));
});

test('check reports the model of each tier and the tier of each phase, as the owner changed them', async t => {
  const roles = await import('../../../mission-console/roles.mjs');
  assert.deepEqual(phaseTiers, roles.phaseTiers, 'the skill and the Command Center agree on the tier of each phase');
  const defaults = workspace(t, { machineProfile: machine, repoEntry: repoProfile({}) });
  assert.deepEqual([check(defaults.repo, defaults.env).models, check(defaults.repo, defaults.env).phaseTiers], [{}, phaseTiers]);

  const models = { 'claude-code': { deep: 'big', standard: 'middle', fast: 'small' } };
  const saved = workspace(t, { machineProfile: { ...machine, models, phaseTiers: { ci: 'fast' } }, repoEntry: repoProfile({}) });
  const result = check(saved.repo, saved.env);
  assert.deepEqual(result.problems, []);
  assert.deepEqual([result.models, result.phaseTiers], [models, { ...phaseTiers, ci: 'fast' }]);

  const wrong = workspace(t, { machineProfile: { ...machine, models: { codex: { huge: 'x' } }, phaseTiers: { ci: 'cheap', lunch: 'fast' } }, repoEntry: repoProfile({}) });
  const problems = check(wrong.repo, wrong.env).problems.join(' ');
  assert.match(problems, /models\.codex\.huge is not a known field/);
  assert.match(problems, /phaseTiers\.ci must be one of/);
  assert.match(problems, /phaseTiers\.lunch is not a known field/);
});

test('check rejects a setting outside its fixed choices', t => {
  const { repo, env } = workspace(t, { machineProfile: { ...machine, implementationLevel: 'careful', reviewRoundLimit: 9 }, repoEntry: repoProfile({}) });
  const problems = check(repo, env).problems.join('\n');
  assert.match(problems, /implementationLevel must be one of/);
  assert.match(problems, /reviewRoundLimit must be one of/);
});

test('a branch pattern needs both placeholders, no others, and a name git accepts', t => {
  for (const pattern of ['story/{id}-{slug}', 'pbi/{id}-{slug}', '{slug}_{id}', 'team/feature/{id}/{slug}']) {
    assert.equal(branchPatternProblem(pattern), null, pattern);
  }
  assert.match(branchPatternProblem('story/{slug}'), /must contain \{id\}/);
  assert.match(branchPatternProblem('story/{id}'), /must contain \{slug\}/);
  assert.match(branchPatternProblem('{user}/{id}-{slug}'), /only the \{id\} and \{slug\}/);
  for (const pattern of ['my story/{id}-{slug}', '/{id}-{slug}', '{id}-{slug}/', 'a..b/{id}-{slug}', 'a//{id}-{slug}', 'a:{id}-{slug}', '-{id}-{slug}', '{id}-{slug}.']) {
    assert.match(branchPatternProblem(pattern), /not a valid git branch name/, pattern);
  }
  const { repo, env } = workspace(t, { machineProfile: machine, repoEntry: { ...repoProfile({}), branchPattern: 'story/{slug}' } });
  const result = check(repo, env);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /repos\.acme\/widgets\.branchPattern must contain \{id\}/);
});

test('a profile file inside the repository is not read', t => {
  const { repo, env } = workspace(t, { machineProfile: machine });
  writeFileSync(join(repo, '.ai-sdlc.json'), JSON.stringify(repoProfile({ test: 'git --version' })));
  const result = check(repo, env);
  assert.deepEqual(result.repo.gates, {});
  assert.match(result.problems.join('\n'), /No repository section for acme\/widgets/);
});

test('check reports an invalid repository profile', t => {
  const { repo, env } = workspace(t, { machineProfile: machine, repoEntry: { schemaVersion: 1 } });
  assert.match(check(repo, env).problems.join('\n'), /repos\.acme\/widgets\.gates is missing/);
});

test('check reports a gate whose tool is not installed', t => {
  const { repo, env } = workspace(t, { machineProfile: machine, repoEntry: repoProfile({ secrets: 'no-such-scanner-xyz detect' }) });
  const result = check(repo, env);
  assert.equal(result.ok, false);
  assert.match(result.problems[0], /gate secrets needs "no-such-scanner-xyz"/);
});

test('cross-model sharing needs the machine to allow it and the repository not to forbid it', t => {
  const allowed = workspace(t, { machineProfile: machine, repoEntry: repoProfile({}) });
  assert.equal(check(allowed.repo, allowed.env).crossModelReviewAuthorized, true);
  const forbidden = workspace(t, { machineProfile: machine, repoEntry: { ...repoProfile({}), crossModelReviewAuthorized: false } });
  assert.equal(check(forbidden.repo, forbidden.env).crossModelReviewAuthorized, false);
  const machineNo = workspace(t, { machineProfile: { ...machine, crossModelReviewAuthorized: false }, repoEntry: repoProfile({}) });
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

const part = (list, name) => list.find(item => item.name === name);

test('components finds Stryker installed in the repository and suggests an install when it is not', t => {
  const { repo, env } = workspace(t);
  const bare = { ...env, PATH: '', Path: '' };
  assert.equal(part(components(repo, bare), 'stryker').found, false);
  assert.match(part(components(repo, bare), 'stryker').install, /@stryker-mutator\/core/);
  mkdirSync(join(repo, 'node_modules', '.bin'), { recursive: true });
  writeFileSync(join(repo, 'node_modules', '.bin', 'stryker'), '');
  assert.equal(part(components(repo, bare), 'stryker').found, true);
});

test('components looks for the .NET Stryker tool in a .NET repository', t => {
  const { repo, env } = workspace(t);
  const bare = { ...env, PATH: '', Path: '' };
  writeFileSync(join(repo, 'app.sln'), '');
  assert.match(part(components(repo, bare), 'stryker').install, /dotnet-stryker/);
  mkdirSync(join(repo, '.config'));
  writeFileSync(join(repo, '.config', 'dotnet-tools.json'), JSON.stringify({ tools: { 'dotnet-stryker': {} } }));
  assert.equal(part(components(repo, bare), 'stryker').found, true);
});

test('check links components to the gates that use them and remembers declined ones', t => {
  const { repo, env } = workspace(t, {
    machineProfile: { ...machine, declinedComponents: ['hyperframes'] },
    repoEntry: repoProfile({ test: 'git --version', mutation: 'git stryker run --mutate {files}' }),
  });
  const pathWithoutStryker = (env.PATH || env.Path || '').split(delimiter).filter(dir => !onPath('stryker', { ...env, PATH: dir })).join(delimiter);
  const result = check(repo, { ...env, PATH: pathWithoutStryker, Path: pathWithoutStryker });
  assert.deepEqual(part(result.components, 'stryker').usedBy, ['mutation']);
  assert.equal(part(result.components, 'hyperframes').declined, true);
  assert.doesNotMatch(result.warnings.join('\n'), /hyperframes/);
  assert.equal(result.ok, false);
  assert.match(result.problems.join('\n'), /stryker is not installed \(mutation testing\)/);
  assert.match(result.nextSteps.join('\n'), /ai-sdlc-setup/);
});

test('a missing component blocks only when the profile depends on it', () => {
  const severity = part => componentSeverity({ usedBy: [], declined: false, ...part });
  assert.equal(severity({ name: 'stryker', kind: 'gate', usedBy: ['mutation'] }), 'problem');
  assert.equal(severity({ name: 'gitleaks', kind: 'gate' }), null);
  assert.equal(severity({ name: 'git', kind: 'core' }), 'problem');
  assert.equal(severity({ name: 'gh', kind: 'core' }), 'warning');
  assert.equal(severity({ name: 'gh', kind: 'core', declined: true }), 'warning');
  assert.equal(severity({ name: 'hyperframes', kind: 'optional' }), 'warning');
  assert.equal(severity({ name: 'hyperframes', kind: 'optional', declined: true }), null);
});

test('next steps send a failing check back to setup', () => {
  assert.deepEqual(nextSteps({ problems: ['x'], warnings: [] }).length, 1);
  assert.match(nextSteps({ problems: ['x'], warnings: [] })[0], /ai-sdlc-setup/);
  assert.match(nextSteps({ problems: [], warnings: ['y'] })[0], /declinedComponents/);
});

test('the CLI runs when the skill folder is reached through a link', t => {
  const { repo, env } = workspace(t);
  const link = join(repo, '..', 'linked-skill');
  symlinkSync(fileURLToPath(new URL('..', import.meta.url)), link, 'junction');
  let output;
  try {
    output = execFileSync(process.execPath, [join(link, 'scripts', 'preflight.mjs'), 'detect', repo], { env, encoding: 'utf8' });
  } finally {
    // Remove only the link, before the workspace is deleted, so cleanup never reaches the real skill folder.
    if (process.platform === 'win32') rmdirSync(link); else unlinkSync(link);
  }
  assert.equal(JSON.parse(output).repo.slug, 'acme/widgets');
  assert.equal(JSON.parse(output).commandCenterPath, checkout);
});

test('check gives the full path of each Command Center file from the saved folder', t => {
  const { repo, env } = workspace(t, { machineProfile: machine, repoEntry: repoProfile({}) });
  const { commandCenter, problems } = check(repo, env);
  assert.deepEqual(problems, []);
  assert.equal(commandCenter.path, checkout);
  assert.deepEqual(Object.keys(commandCenter), ['path', 'console', 'harnesses', 'launcher', 'reference', 'readiness']);
  for (const name of ['console', 'harnesses', 'launcher', 'reference', 'readiness']) assert.ok(existsSync(commandCenter[name]), name);
  assert.equal(realpathSync(commandCenter.console), realpathSync(join(checkout, 'mission-console', 'jarvis.mjs')));
});

test('check refuses a saved folder that no longer holds the Command Center, and names where it is now', t => {
  const moved = workspace(t, { machineProfile: { ...machine, commandCenterPath: join(tmpdir(), 'old-checkout-that-moved') }, repoEntry: repoProfile({}) });
  const result = check(moved.repo, moved.env);
  assert.equal(result.ok, false);
  assert.equal(result.commandCenter, null);
  assert.match(result.problems.join('\n'), /old-checkout-that-moved" does not hold the Command Center\. Set it to ".+", where the Command Center is now\./);

  const { commandCenterPath, ...unset } = machine;
  const never = workspace(t, { machineProfile: unset, repoEntry: repoProfile({}) });
  assert.match(check(never.repo, never.env).problems.join('\n'), /profile\.commandCenterPath is not set\. Set it to "/);

  assert.match(check(never.repo, never.env, null).problems.join('\n'), /commandCenterPath is not set\. Run "node install\.mjs"/);
});

test('check passes on the team rules and the tracker a repository saved, and on none by default', t => {
  const plain = workspace(t, { machineProfile: machine, repoEntry: repoProfile({}) });
  assert.deepEqual([check(plain.repo, plain.env).repo.teamRules, check(plain.repo, plain.env).repo.readiness], [[], { tracker: 'none' }]);

  const teamRules = ['https://example.test/handbook', 'Reply to every pull request comment before resolving it.'];
  const readiness = { tracker: 'azure-devops', organization: 'your-org', project: 'Your Project', checklist: ['tasksClosed', 'effortSet'], unestimatedValue: -1 };
  const saved = workspace(t, { machineProfile: machine, repoEntry: { ...repoProfile({}), teamRules, readiness } });
  const result = check(saved.repo, saved.env);
  assert.deepEqual(result.problems, []);
  assert.deepEqual([result.repo.teamRules, result.repo.readiness], [teamRules, readiness]);
});

test('check rejects a tracker or a readiness check that does not exist', t => {
  const { repo, env } = workspace(t, { machineProfile: machine, repoEntry: { ...repoProfile({}), teamRules: [''], readiness: { tracker: 'jira', checklist: ['coffeeDrunk'] } } });
  const problems = check(repo, env).problems.join('\n');
  assert.match(problems, /readiness\.tracker must be one of/);
  assert.match(problems, /readiness\.checklist\[0\] must be one of/);
  assert.match(problems, /teamRules\[0\] must not be empty/);
});

test('the background Jarvis has a tier of its own, standard by default, which the owner can move', t => {
  assert.equal(phaseTiers.coordinator, 'standard');
  const moved = workspace(t, { machineProfile: { ...machine, phaseTiers: { coordinator: 'fast' } }, repoEntry: repoProfile({}) });
  const result = check(moved.repo, moved.env);
  assert.deepEqual(result.problems, []);
  assert.equal(result.phaseTiers.coordinator, 'fast');
});
