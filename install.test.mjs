import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { install } from './install.mjs';

// A home with Claude Code installed, and a repository with one skill and one folder that is not a skill.
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

  // A link to some other repository's skill of the same name says where it points.
  const other = join(root, 'other-repo', 'jarvis');
  mkdirSync(other, { recursive: true });
  mkdirSync(join(home, '.agents', 'skills'), { recursive: true });
  symlinkSync(other, join(home, '.agents', 'skills', 'jarvis'), 'junction');
  const [codex] = install({ home, skillsDir, only: ['codex'] });
  assert.equal(codex.state, 'blocked');
  assert.equal(codex.existing, 'a link to ' + realpathSync(other));
});

test('replacing moves what blocks a skill aside and links this repository\'s one', t => {
  const { home, skillsDir } = fixture(t);
  const existing = join(home, '.claude', 'skills', 'jarvis');
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, 'SKILL.md'), '# Mine');
  assert.deepEqual(states(install({ home, skillsDir, replace: true, write: false })), [['Claude Code', 'jarvis', 'blocked']]);
  assert.deepEqual(states(install({ home, skillsDir, replace: true, stamp: 7 })), [['Claude Code', 'jarvis', 'replaced']]);
  assert.equal(realpathSync(existing), realpathSync(join(skillsDir, 'jarvis')));
  assert.equal(readFileSync(existing + '.bak-7/SKILL.md', 'utf8'), '# Mine');
  assert.deepEqual(states(install({ home, skillsDir, replace: true })), [['Claude Code', 'jarvis', 'linked']]);
});

test('the command fails when a skill is blocked, and succeeds once it is replaced', t => {
  const { home, skillsDir } = fixture(t);
  const existing = join(home, '.claude', 'skills', 'jarvis');
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, 'SKILL.md'), '# Mine');
  // The command reads the real home folder, so point it at the fixture.
  const run = (...args) => {
    try {
      return { status: 0, output: execFileSync(process.execPath, [fileURLToPath(new URL('./install.mjs', import.meta.url)), ...args, 'claude-code'], { encoding: 'utf8', env: { ...process.env, USERPROFILE: home, HOME: home } }) };
    } catch (error) {
      return { status: error.status, output: error.stdout };
    }
  };
  const blocked = run('--check');
  assert.equal(blocked.status, 1);
  assert.match(blocked.output, /NOT INSTALLED: jarvis\..*is a folder of its own/);
  assert.match(blocked.output, /node install\.mjs --replace/);
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
  // The copied launcher loads from the extension folder alone, without this checkout.
  const { loadAdapters } = await import(pathToFileURL(join(extension, 'command-center', 'serve.mjs')).href);
  assert.ok(loadAdapters().has('claude code'));
});

test('copying again replaces the copies and keeps the previous ones beside them', t => {
  const { home, skillsDir } = fixture(t);
  install({ home, skillsDir, only: ['copilot'], stamp: 1 });
  writeFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), '# Edited by hand');
  install({ home, skillsDir, only: ['copilot'], stamp: 2 });
  assert.equal(readFileSync(join(home, '.copilot', 'skills', 'jarvis', 'SKILL.md'), 'utf8'), '# Jarvis');
  assert.equal(readFileSync(join(home, '.copilot', 'skills', 'jarvis.bak-2', 'SKILL.md'), 'utf8'), '# Edited by hand');
  assert.deepEqual(readdirSync(join(home, '.copilot', 'extensions')).sort(), ['ai-sdlc-console', 'ai-sdlc-console.bak-2']);
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
  // The real skills, so the copied preflight script is the one that runs.
  install({ home, only: ['copilot'] });
  const copied = join(home, '.copilot', 'skills', 'ai-sdlc-setup', 'scripts', 'preflight.mjs');
  const facts = JSON.parse(execFileSync(process.execPath, [copied, 'detect', home], { encoding: 'utf8' }));
  assert.equal(realpathSync(facts.commandCenterPath), realpathSync(join(home, '.copilot', 'extensions', 'ai-sdlc-console')));
});
