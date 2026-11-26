import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { install } from './install.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'factory-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  const skillsDir = join(root, 'repo', 'skills');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(skillsDir, 'jarvis'), { recursive: true });
  mkdirSync(join(skillsDir, 'notes'));
  writeFileSync(join(skillsDir, 'jarvis', 'SKILL.md'), '# Jarvis');
  return { root, home, skillsDir };
}

const states = results => results.map(result => [result.harness, result.skill, result.state]);

const installScript = fileURLToPath(new URL('./install.mjs', import.meta.url));
function cli(home, ...args) {
  const env = { ...process.env, USERPROFILE: home, HOME: home };
  try {
    return { status: 0, output: execFileSync(process.execPath, [installScript, ...args], { encoding: 'utf8', env }) };
  } catch (error) {
    return { status: error.status, output: error.stdout };
  }
}

const backups = (home, folder, stamp, ...rest) => join(home, folder, 'ai-sdlc-backups', String(stamp), ...rest);
const everything = home => readdirSync(home, { recursive: true }).sort();
const leftovers = folder => readdirSync(folder).filter(name => name.includes('.bak-'));
const copilot = (home, skillsDir, options = {}) => install({ home, skillsDir, only: ['copilot'], ...options });
const row = (results, skill) => results.find(result => result.skill === skill);

function copilotFixture(t) {
  const made = fixture(t);
  mkdirSync(join(made.skillsDir, 'grill-me'));
  writeFileSync(join(made.skillsDir, 'grill-me', 'SKILL.md'), '# Grill');
  mkdirSync(join(made.home, '.copilot'));
  return made;
}

function mine(path, text = '# Mine') {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'SKILL.md'), text);
}

function printedPath(output, prefix) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const found = new RegExp(escaped + '\\S*').exec(output);
  return found?.[0].replace(/[.,;:]+$/, '');
}

test('skills are linked only into harnesses that are installed, and a second run changes nothing', t => {
  const { home, skillsDir } = fixture(t);
  assert.deepEqual(states(install({ home, skillsDir })), [['Claude Code', 'jarvis', 'created']]);
  const link = join(home, '.claude', 'skills', 'jarvis');
  assert.equal(realpathSync(link), realpathSync(join(skillsDir, 'jarvis')));
  assert.deepEqual(states(install({ home, skillsDir })), [['Claude Code', 'jarvis', 'linked']]);
});

test('a named harness is set up even when it is not installed', t => {
  const { home, skillsDir } = fixture(t);
  assert.deepEqual(states(install({ home, skillsDir, only: ['codex'] })), [['Codex', 'jarvis', 'created']]);
  assert.ok(existsSync(join(home, '.agents', 'skills', 'jarvis', 'SKILL.md')));
});

test('checking reports a missing link without creating it', t => {
  const { home, skillsDir } = fixture(t);
  assert.deepEqual(states(install({ home, skillsDir, write: false })), [['Claude Code', 'jarvis', 'missing']]);
  assert.equal(existsSync(join(home, '.claude', 'skills')), false);
});

test('a skill that is already there is left alone and reported as blocked, saying what it is', t => {
  const { root, home, skillsDir } = fixture(t);
  const existing = join(home, '.claude', 'skills', 'jarvis');
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, 'SKILL.md'), '# Mine');
  const [result] = install({ home, skillsDir });
  assert.deepEqual([result.state, result.existing], ['blocked', 'a folder of its own']);
  assert.equal(readFileSync(join(existing, 'SKILL.md'), 'utf8'), '# Mine');

  const other = join(root, 'other-repo', 'jarvis');
  mkdirSync(other, { recursive: true });
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
  symlinkSync(other, join(home, '.agents', 'skills', 'jarvis'), 'junction');
  const [codex] = install({ home, skillsDir, only: ['codex'] });
  assert.equal(codex.state, 'blocked');
  assert.equal(codex.existing, 'a link to ' + realpathSync(other));
});

test('replacing moves what blocks a skill into the harness backup folder and links this repository\'s one', t => {
  const { home, skillsDir } = fixture(t);
  const existing = join(home, '.claude', 'skills', 'jarvis');
  mine(existing);
  assert.deepEqual(states(install({ home, skillsDir, replace: true, write: false })), [['Claude Code', 'jarvis', 'blocked']]);
  assert.equal(existsSync(join(home, '.claude', 'ai-sdlc-backups')), false);
  const results = install({ home, skillsDir, replace: true, stamp: 7 });
  assert.deepEqual(states(results), [['Claude Code', 'jarvis', 'replaced']]);
  const moved = backups(home, '.claude', 7, 'skills', 'jarvis');
  assert.equal(results[0].movedTo, moved);
  assert.equal(realpathSync(existing), realpathSync(join(skillsDir, 'jarvis')));
  assert.equal(readFileSync(join(moved, 'SKILL.md'), 'utf8'), '# Mine');
  assert.deepEqual(leftovers(join(home, '.claude', 'skills')), []);
  assert.deepEqual(states(install({ home, skillsDir, replace: true })), [['Claude Code', 'jarvis', 'linked']]);
});

test('replacing for Codex moves what blocks a skill under the .agents folder', t => {
  const { home, skillsDir } = fixture(t);
  mine(join(home, '.agents', 'skills', 'jarvis'));
  const [result] = install({ home, skillsDir, only: ['codex'], replace: true, stamp: 8 });
  assert.equal(result.state, 'replaced');
  assert.equal(result.movedTo, backups(home, '.agents', 8, 'skills', 'jarvis'));
  assert.equal(readFileSync(join(result.movedTo, 'SKILL.md'), 'utf8'), '# Mine');
  assert.equal(existsSync(join(home, '.codex')), false);
});

test('replacing from the command names the real folder the skill went to and prints no placeholder', t => {
  const { root } = fixture(t);
  const home = join(root, 'cli-home');
  mine(join(home, '.claude', 'skills', 'jarvis'));
  const { status, output } = cli(home, '--replace', 'claude-code');
  assert.equal(status, 0);
  assert.doesNotMatch(output, /bak-<time>/);
  const printed = printedPath(output, join(home, '.claude', 'ai-sdlc-backups'));
  assert.ok(printed, output);
  assert.match(printed, /skills[\\/]jarvis$/);
  assert.equal(readFileSync(join(printed, 'SKILL.md'), 'utf8'), '# Mine');
});

test('the command fails when a skill is blocked, and succeeds once it is replaced', t => {
  const { home, skillsDir } = fixture(t);
  const existing = join(home, '.claude', 'skills', 'jarvis');
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, 'SKILL.md'), '# Mine');
  const run = (...args) => cli(home, ...args, 'claude-code');
  const blocked = run('--check');
  assert.equal(blocked.status, 1);
  assert.match(blocked.output, /NOT INSTALLED: jarvis\..*is a folder of its own/);
  assert.match(blocked.output, /node install\.mjs --replace/);
  assert.match(blocked.output, /ai-sdlc-backups/);
  assert.doesNotMatch(blocked.output, /bak-<time>/);
  assert.equal(run().status, 1);
  assert.equal(run('--bogus').status, 1);
});

test('a skills folder that is itself a link is left alone', t => {
  const { root, home, skillsDir } = fixture(t);
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(home, '.claude', 'skills'), 'junction');
  assert.deepEqual(install({ home, skillsDir }).map(result => result.state), ['folder-is-link']);
  assert.equal(existsSync(join(elsewhere, 'jarvis')), false);
});

test('a harness that needs copies gets the skills and a Command Center extension that runs on its own', async t => {
  const { home, skillsDir } = fixture(t);
  mkdirSync(join(home, '.copilot'));
  const copilot = () => install({ home, skillsDir }).filter(result => result.harness === 'GitHub Copilot app');
  assert.deepEqual(states(copilot()), [['GitHub Copilot app', 'extension', 'copied'], ['GitHub Copilot app', 'jarvis', 'copied']]);
  assert.equal(readFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), 'utf8'), '# Jarvis');
  const extension = join(home, '.copilot', 'extensions', 'ai-sdlc-console');
  for (const file of ['extension.mjs', 'command-center/console-service.mjs', 'mission-console/jarvis.mjs', 'readiness-sync/check-story.mjs']) {
    assert.ok(existsSync(join(extension, file)), file);
  }
  const { loadAdapters } = await import(pathToFileURL(join(extension, 'command-center', 'serve.mjs')).href);
  assert.ok(loadAdapters().has('claude code'));
});

test('copying again with nothing changed leaves every copy current and writes nothing anywhere', t => {
  const { home, skillsDir } = copilotFixture(t);
  const first = copilot(home, skillsDir, { stamp: 1 });
  assert.deepEqual(first.map(result => result.state), ['copied', 'copied', 'copied']);
  assert.equal(first.some(result => 'movedTo' in result), false);
  const before = everything(home);
  const second = copilot(home, skillsDir, { stamp: 2 });
  assert.deepEqual(states(second), [['GitHub Copilot app', 'extension', 'current'], ['GitHub Copilot app', 'grill-me', 'current'], ['GitHub Copilot app', 'jarvis', 'current']]);
  assert.equal(second.some(result => 'movedTo' in result), false);
  assert.deepEqual(everything(home), before);
  assert.deepEqual(leftovers(join(home, '.copilot', 'skills')), []);
  assert.deepEqual(leftovers(join(home, '.copilot', 'extensions')), []);
  assert.equal(existsSync(join(home, '.copilot', 'ai-sdlc-backups')), false);
});

test('the command reports copies as current on the second run and changes nothing', t => {
  const { root } = fixture(t);
  const home = join(root, 'cli-home');
  mkdirSync(join(home, '.copilot'), { recursive: true });
  const first = cli(home, 'copilot');
  assert.equal(first.status, 0);
  assert.match(first.output, /GitHub Copilot app: \d+ copied/);
  const before = everything(home);
  const second = cli(home, 'copilot');
  assert.equal(second.status, 0);
  assert.match(second.output, /GitHub Copilot app: \d+ current/);
  assert.doesNotMatch(second.output, /copied|updated|moved/);
  assert.deepEqual(everything(home), before);
});

test('a copy that differs is moved to the harness backup folder, reported as updated, and named', t => {
  const { home, skillsDir } = copilotFixture(t);
  mine(join(home, '.copilot', 'skills', 'grill-me'), '# The owner\'s own');
  const results = copilot(home, skillsDir, { stamp: 5 });
  assert.deepEqual(states(results), [['GitHub Copilot app', 'extension', 'copied'], ['GitHub Copilot app', 'grill-me', 'updated'], ['GitHub Copilot app', 'jarvis', 'copied']]);
  const moved = backups(home, '.copilot', 5, 'skills', 'grill-me');
  assert.equal(row(results, 'grill-me').movedTo, moved);
  assert.equal(readFileSync(join(moved, 'SKILL.md'), 'utf8'), '# The owner\'s own');
  assert.equal(readFileSync(join(home, '.copilot', 'skills', 'grill-me', 'SKILL.md'), 'utf8'), '# Grill');
  assert.equal('movedTo' in row(results, 'jarvis'), false);
  assert.deepEqual(leftovers(join(home, '.copilot', 'skills')), []);
  assert.deepEqual(readdirSync(join(home, '.copilot', 'ai-sdlc-backups', '5')), ['skills']);
});

test('the command prints the real path of each folder it moved', t => {
  const { root } = fixture(t);
  const home = join(root, 'cli-home');
  mine(join(home, '.copilot', 'skills', 'grill-me'), '# The owner\'s own');
  const { status, output } = cli(home, 'copilot');
  assert.equal(status, 0);
  assert.match(output, /GitHub Copilot app: .*\b1 updated\b/);
  const printed = printedPath(output, join(home, '.copilot', 'ai-sdlc-backups'));
  assert.ok(printed, output);
  assert.match(printed, /skills[\\/]grill-me$/);
  assert.equal(readFileSync(join(printed, 'SKILL.md'), 'utf8'), '# The owner\'s own');
  assert.doesNotMatch(output, /bak-<time>/);
});

test('an installed copy with an extra file is updated, and the extra file stays in the backup only', t => {
  const { home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  const installed = join(home, '.copilot', 'skills', 'jarvis');
  writeFileSync(join(installed, 'extra.md'), 'only here');
  const results = copilot(home, skillsDir, { stamp: 2 });
  assert.equal(row(results, 'jarvis').state, 'updated');
  assert.equal(row(results, 'grill-me').state, 'current');
  assert.equal(readFileSync(join(backups(home, '.copilot', 2, 'skills', 'jarvis'), 'extra.md'), 'utf8'), 'only here');
  assert.equal(existsSync(join(installed, 'extra.md')), false);
  assert.equal(readFileSync(join(installed, 'SKILL.md'), 'utf8'), '# Jarvis');
});

test('a skill whose source changed is updated and the previous copy is kept', t => {
  const { home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  writeFileSync(join(skillsDir, 'jarvis', 'SKILL.md'), '# Jarvis v2');
  const results = copilot(home, skillsDir, { stamp: 2 });
  assert.deepEqual(results.map(result => result.state), ['current', 'current', 'updated']);
  assert.equal(readFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), 'utf8'), '# Jarvis v2');
  assert.equal(readFileSync(join(backups(home, '.copilot', 2, 'skills', 'jarvis'), 'SKILL.md'), 'utf8'), '# Jarvis');
  assert.deepEqual(leftovers(join(home, '.copilot', 'skills')), []);
});

for (const part of ['extension.mjs', join('command-center', 'console-service.mjs'), join('mission-console', 'jarvis.mjs'), join('readiness-sync', 'check-story.mjs'), join('adapters', 'harnesses.mjs')]) {
  test('an extension copy that differs in ' + part + ' is updated and backed up', t => {
    const { home, skillsDir } = copilotFixture(t);
    copilot(home, skillsDir, { stamp: 1 });
    const installed = join(home, '.copilot', 'extensions', 'ai-sdlc-console');
    const edited = join(installed, part);
    const original = readFileSync(edited, 'utf8');
    writeFileSync(edited, original + '\n// edited');
    const results = copilot(home, skillsDir, { stamp: 2 });
    assert.equal(row(results, 'extension').state, 'updated');
    assert.equal(row(results, 'extension').movedTo, backups(home, '.copilot', 2, 'extensions', 'ai-sdlc-console'));
    assert.equal(readFileSync(join(row(results, 'extension').movedTo, part), 'utf8'), original + '\n// edited');
    assert.equal(readFileSync(edited, 'utf8'), original);
    assert.deepEqual(leftovers(join(home, '.copilot', 'extensions')), []);
    assert.equal(copilot(home, skillsDir, { stamp: 3 }).every(result => result.state === 'current'), true);
  });
}

test('an extension copy that has lost a part, or gained a file, is updated', t => {
  const { home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  const installed = join(home, '.copilot', 'extensions', 'ai-sdlc-console');
  rmSync(join(installed, 'readiness-sync'), { recursive: true });
  assert.equal(row(copilot(home, skillsDir, { stamp: 2 }), 'extension').state, 'updated');
  writeFileSync(join(installed, 'mission-console', 'stray.txt'), 'x');
  assert.equal(row(copilot(home, skillsDir, { stamp: 3 }), 'extension').state, 'updated');
  assert.equal(existsSync(join(installed, 'mission-console', 'stray.txt')), false);
});

test('a change to a part of the extension in this repository updates the installed one', t => {
  const { root, home, skillsDir } = copilotFixture(t);
  const repoDir = join(root, 'repo');
  const here = fileURLToPath(new URL('.', import.meta.url));
  for (const part of ['command-center', 'mission-console', 'readiness-sync', 'adapters']) cpSync(join(here, part), join(repoDir, part), { recursive: true });
  copilot(home, skillsDir, { repoDir, stamp: 1 });
  assert.equal(copilot(home, skillsDir, { repoDir, stamp: 2 }).every(result => result.state === 'current'), true);
  writeFileSync(join(repoDir, 'readiness-sync', 'check-story.mjs'), '\n// changed upstream', { flag: 'a' });
  const results = copilot(home, skillsDir, { repoDir, stamp: 3 });
  assert.equal(row(results, 'extension').state, 'updated');
  assert.equal(row(results, 'extension').movedTo, backups(home, '.copilot', 3, 'extensions', 'ai-sdlc-console'));
});

test('a write run moves earlier .bak- folders of shipped skills out of the scanned folders and names each', t => {
  const { home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  const skills = join(home, '.copilot', 'skills');
  const extensions = join(home, '.copilot', 'extensions');
  mine(join(skills, 'jarvis.bak-123'), '# old jarvis');
  mine(join(skills, 'grill-me.bak-99'), '# old grill');
  mkdirSync(join(extensions, 'ai-sdlc-console.bak-123'));
  writeFileSync(join(extensions, 'ai-sdlc-console.bak-123', 'extension.mjs'), '// old');
  for (const name of ['my-skill.bak-1', 'jarvis.bak-old', 'jarvis.bak-', 'notes.bak-1']) mine(join(skills, name));
  mkdirSync(join(extensions, 'other.bak-1'));

  const results = copilot(home, skillsDir, { stamp: 9 });
  const movedRows = results.filter(result => result.state === 'moved');
  assert.deepEqual(movedRows.map(result => result.skill).sort(), ['ai-sdlc-console.bak-123', 'grill-me.bak-99', 'jarvis.bak-123']);
  assert.deepEqual(movedRows.map(result => result.harness), ['GitHub Copilot app', 'GitHub Copilot app', 'GitHub Copilot app']);
  const at = name => movedRows.find(result => result.skill === name);
  assert.equal(at('jarvis.bak-123').path, join(skills, 'jarvis.bak-123'));
  assert.equal(at('jarvis.bak-123').movedTo, backups(home, '.copilot', 9, 'skills', 'jarvis.bak-123'));
  assert.equal(at('ai-sdlc-console.bak-123').path, join(extensions, 'ai-sdlc-console.bak-123'));
  assert.equal(at('ai-sdlc-console.bak-123').movedTo, backups(home, '.copilot', 9, 'extensions', 'ai-sdlc-console.bak-123'));
  assert.equal(readFileSync(join(at('jarvis.bak-123').movedTo, 'SKILL.md'), 'utf8'), '# old jarvis');
  assert.equal(readFileSync(join(at('ai-sdlc-console.bak-123').movedTo, 'extension.mjs'), 'utf8'), '// old');
  assert.deepEqual(leftovers(skills).sort(), ['jarvis.bak-', 'jarvis.bak-old', 'my-skill.bak-1', 'notes.bak-1']);
  assert.deepEqual(leftovers(extensions), ['other.bak-1']);
  assert.equal(results.filter(result => result.state !== 'moved').every(result => result.state === 'current'), true);
});

test('a link harness run moves earlier .bak- folders of shipped skills too', t => {
  const { home, skillsDir } = fixture(t);
  install({ home, skillsDir });
  const skills = join(home, '.claude', 'skills');
  mine(join(skills, 'jarvis.bak-123'), '# old jarvis');
  mine(join(skills, 'jarvis.bak-old'));
  const results = install({ home, skillsDir, stamp: 4 });
  const moved = results.filter(result => result.state === 'moved');
  assert.deepEqual(moved.map(result => [result.skill, result.path, result.movedTo]), [['jarvis.bak-123', join(skills, 'jarvis.bak-123'), backups(home, '.claude', 4, 'skills', 'jarvis.bak-123')]]);
  assert.deepEqual(leftovers(skills), ['jarvis.bak-old']);
  assert.equal(readFileSync(join(moved[0].movedTo, 'SKILL.md'), 'utf8'), '# old jarvis');
});

test('the command says how many earlier backups it moved and where', t => {
  const { root } = fixture(t);
  const home = join(root, 'cli-home');
  mine(join(home, '.claude', 'skills', 'jarvis.bak-1'));
  mine(join(home, '.claude', 'skills', 'jarvis.bak-2'));
  const { status, output } = cli(home, 'claude-code');
  assert.equal(status, 0);
  assert.match(output, /\b2 moved\b/);
  assert.match(output, /jarvis\.bak-1/);
  assert.ok(printedPath(output, join(home, '.claude', 'ai-sdlc-backups')), output);
  assert.deepEqual(leftovers(join(home, '.claude', 'skills')), []);
});

test('checking changes nothing: equal copies are current, differing ones outdated, earlier backups are counted', t => {
  const { home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  const skills = join(home, '.copilot', 'skills');
  writeFileSync(join(skills, 'jarvis', 'SKILL.md'), '# Changed');
  mine(join(skills, 'grill-me.bak-5'));
  mkdirSync(join(home, '.copilot', 'extensions', 'ai-sdlc-console.bak-5'));
  const before = everything(home);
  const results = copilot(home, skillsDir, { write: false, stamp: 2 });
  assert.deepEqual(results.filter(result => result.state !== 'old-backup').map(result => [result.skill, result.state]), [['extension', 'current'], ['grill-me', 'current'], ['jarvis', 'outdated']]);
  assert.deepEqual(results.filter(result => result.state === 'old-backup').map(result => result.skill).sort(), ['ai-sdlc-console.bak-5', 'grill-me.bak-5']);
  assert.equal(results.some(result => 'movedTo' in result), false);
  assert.deepEqual(everything(home), before);
});

test('the command exits cleanly when checking finds an outdated copy, and counts earlier backups without moving them', t => {
  const { root } = fixture(t);
  const home = join(root, 'cli-home');
  assert.equal(cli(home, 'copilot').status, 0);
  const skills = join(home, '.copilot', 'skills');
  writeFileSync(join(skills, 'jarvis', 'SKILL.md'), '# Changed');
  mine(join(skills, 'grill-me.bak-5'));
  mine(join(skills, 'jarvis.bak-6'));
  const before = everything(home);
  const { status, output } = cli(home, '--check', 'copilot');
  assert.equal(status, 0);
  assert.match(output, /GitHub Copilot app: .*\b\d+ current\b/);
  assert.match(output, /\b1 outdated\b/);
  assert.match(output, /\b2 old backups\b/);
  assert.deepEqual(everything(home), before);
});

test('a copy kept for the owner stays kept', t => {
  const { home, skillsDir } = copilotFixture(t);
  mkdirSync(join(skillsDir, 'diagram-design'));
  writeFileSync(join(skillsDir, 'diagram-design', 'SKILL.md'), '# Shipped');
  mine(join(home, '.copilot', 'skills', 'diagram-design'));
  const results = copilot(home, skillsDir, { stamp: 3 });
  assert.equal(row(results, 'diagram-design').state, 'kept');
  assert.equal('movedTo' in row(results, 'diagram-design'), false);
  assert.equal(readFileSync(join(home, '.copilot', 'skills', 'diagram-design', 'SKILL.md'), 'utf8'), '# Mine');
  assert.equal(existsSync(join(home, '.copilot', 'ai-sdlc-backups')), false);
  assert.equal(row(copilot(home, skillsDir, { write: false }), 'diagram-design').state, 'kept');
});

test('a backup folder that is a link stops every move for that harness and writes nothing through it', t => {
  const { root, home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  const installed = join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md');
  writeFileSync(installed, '# The owner\'s edit');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  const link = join(home, '.copilot', 'ai-sdlc-backups');
  symlinkSync(outside, link, 'junction');
  mine(join(home, '.copilot', 'skills', 'grill-me.bak-5'));
  const results = copilot(home, skillsDir, { stamp: 2 });
  assert.deepEqual(results.filter(result => result.state === 'backup-is-link').map(result => result.path), [link]);
  assert.equal(readFileSync(installed, 'utf8'), '# The owner\'s edit');
  assert.equal(row(results, 'grill-me').state, 'current');
  assert.equal(row(results, 'extension').state, 'current');
  assert.equal(results.some(result => ['moved', 'updated'].includes(result.state)), false);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(existsSync(join(home, '.copilot', 'skills', 'grill-me.bak-5')), true);
});

test('the command fails and names a backup folder that is a link', t => {
  const { root } = fixture(t);
  const home = join(root, 'cli-home');
  assert.equal(cli(home, 'copilot').status, 0);
  writeFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), '# The owner\'s edit');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  const link = join(home, '.copilot', 'ai-sdlc-backups');
  symlinkSync(outside, link, 'junction');
  const { status, output } = cli(home, 'copilot');
  assert.equal(status, 1);
  assert.ok(output.includes(link), output);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(readFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), 'utf8'), '# The owner\'s edit');
});

test('a link backup folder does not stop a harness that needs no move', t => {
  const { root, home, skillsDir } = copilotFixture(t);
  const outside = join(root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(home, '.copilot', 'ai-sdlc-backups'), 'junction');
  const results = copilot(home, skillsDir, { stamp: 1 });
  assert.deepEqual(results.map(result => result.state), ['copied', 'copied', 'copied']);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(lstatSync(join(home, '.copilot', 'ai-sdlc-backups')).isSymbolicLink(), true);
});

test('a backup folder for the same stamp that already exists is left alone and a fresh one is used', t => {
  const { home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  writeFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), '# The owner\'s edit');
  const taken = backups(home, '.copilot', 7, 'skills', 'jarvis');
  mine(taken, '# From an earlier run');
  const results = copilot(home, skillsDir, { stamp: 7 });
  const moved = backups(home, '.copilot', '7-2', 'skills', 'jarvis');
  assert.equal(row(results, 'jarvis').state, 'updated');
  assert.equal(row(results, 'jarvis').movedTo, moved);
  assert.equal(readFileSync(join(moved, 'SKILL.md'), 'utf8'), '# The owner\'s edit');
  assert.equal(readFileSync(join(taken, 'SKILL.md'), 'utf8'), '# From an earlier run');
});

test('every move in one run shares one backup folder, the first free one', t => {
  const { home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  writeFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), '# Edit');
  writeFileSync(join(home, '.copilot', 'extensions', 'ai-sdlc-console', 'extension.mjs'), '// Edit');
  mine(join(home, '.copilot', 'skills', 'grill-me.bak-3'));
  mkdirSync(backups(home, '.copilot', 7), { recursive: true });
  mkdirSync(backups(home, '.copilot', '7-2'), { recursive: true });
  const results = copilot(home, skillsDir, { stamp: 7 });
  const used = results.filter(result => result.movedTo).map(result => result.movedTo);
  assert.equal(used.length, 3);
  for (const path of used) assert.equal(path.startsWith(join(home, '.copilot', 'ai-sdlc-backups', '7-3')), true, path);
  assert.deepEqual(readdirSync(backups(home, '.copilot', 7)), []);
  assert.deepEqual(readdirSync(backups(home, '.copilot', '7-2')), []);
});

test('nothing in the repository tells the owner to look for a .bak-<time> folder beside the skills', () => {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const read = (...path) => readFileSync(join(here, ...path), 'utf8');
  const adr = readdirSync(join(here, 'docs', 'adr')).find(name => name.startsWith('0008-'));
  for (const text of [read('install.mjs'), read('AGENTS.md'), read('README.md'), read('docs', 'adr', adr)]) assert.doesNotMatch(text, /bak-<time>/);
  for (const text of [read('README.md'), read('docs', 'adr', adr)]) assert.match(text, /ai-sdlc-backups/);
  assert.ok(read('README.md').includes('`~/.copilot/ai-sdlc-backups/<time>/<skills\\|extensions>/<name>`'));
  for (const file of ['README.md', 'AGENTS.md']) {
    const cells = line => line.replaceAll('\\|', '').split('|').length;
    let width = 0;
    for (const line of read(file).split('\n')) {
      if (!line.startsWith('|')) width = 0;
      else {
        width ||= cells(line);
        assert.equal(cells(line), width, line.slice(0, 80));
      }
    }
  }
});

test('a copied skill the owner customizes is kept, and checking changes nothing', t => {
  const { home, skillsDir } = fixture(t);
  mkdirSync(join(skillsDir, 'diagram-design'));
  writeFileSync(join(skillsDir, 'diagram-design', 'SKILL.md'), '# Shipped');
  const mine = join(home, '.copilot', 'skills', 'diagram-design');
  mkdirSync(mine, { recursive: true });
  writeFileSync(join(mine, 'SKILL.md'), '# Mine');
  assert.deepEqual(states(install({ home, skillsDir, only: ['copilot'], write: false })),
    [['GitHub Copilot app', 'extension', 'missing'], ['GitHub Copilot app', 'diagram-design', 'kept'], ['GitHub Copilot app', 'jarvis', 'missing']]);
  assert.equal(existsSync(join(home, '.copilot', 'extensions')), false);
  install({ home, skillsDir, only: ['copilot'] });
  assert.equal(readFileSync(join(mine, 'SKILL.md'), 'utf8'), '# Mine');
});

test('skills copied for a harness find the Command Center in the extension folder beside them', t => {
  const { home } = fixture(t);
  install({ home, only: ['copilot'] });
  const copied = join(home, '.copilot', 'skills', 'ai-sdlc-setup', 'scripts', 'preflight.mjs');
  const facts = JSON.parse(execFileSync(process.execPath, [copied, 'detect', home], { encoding: 'utf8' }));
  assert.equal(realpathSync(facts.commandCenterPath), realpathSync(join(home, '.copilot', 'extensions', 'ai-sdlc-console')));
});

test('the --replace hint is not printed after --replace already ran and failed on a linked backup folder', t => {
  const { root } = fixture(t);
  const home = join(root, 'cli-home');
  mkdirSync(join(home, '.claude', 'skills', 'jarvis'), { recursive: true });
  const outside = join(root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(home, '.claude', 'ai-sdlc-backups'), 'junction');
  const plain = cli(home, 'claude-code');
  assert.equal(plain.status, 1);
  assert.match(plain.output, /node install\.mjs --replace/);
  const replaced = cli(home, '--replace', 'claude-code');
  assert.equal(replaced.status, 1);
  assert.doesNotMatch(replaced.output, /Run "node install\.mjs --replace"/);
  assert.deepEqual(readdirSync(outside), []);
});

test('a backup folder that is a regular file is reported, not a crash', t => {
  const { home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  writeFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), '# The owner\'s edit');
  const file = join(home, '.copilot', 'ai-sdlc-backups');
  writeFileSync(file, 'not a folder');
  const results = copilot(home, skillsDir, { stamp: 2 });
  assert.deepEqual(results.filter(result => result.state === 'backup-is-file').map(result => result.path), [file]);
  assert.equal(readFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), 'utf8'), '# The owner\'s edit');
  assert.equal(readFileSync(file, 'utf8'), 'not a folder');
});

test('an item that needs a move and meets a linked backup folder still shows in the results', t => {
  const { root, home, skillsDir } = copilotFixture(t);
  copilot(home, skillsDir, { stamp: 1 });
  writeFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), '# The owner\'s edit');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  symlinkSync(outside, join(home, '.copilot', 'ai-sdlc-backups'), 'junction');
  const results = copilot(home, skillsDir, { stamp: 2 });
  assert.equal(row(results, 'jarvis').state, 'not-moved');
  assert.equal(row(results, 'grill-me').state, 'current');
});
