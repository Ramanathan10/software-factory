import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { linkSkills } from './install.mjs';

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
  assert.deepEqual(states(linkSkills({ home, skillsDir })), [['Claude Code', 'jarvis', 'created']]);
  const link = join(home, '.claude', 'skills', 'jarvis');
  assert.equal(realpathSync(link), realpathSync(join(skillsDir, 'jarvis')));
  assert.deepEqual(states(linkSkills({ home, skillsDir })), [['Claude Code', 'jarvis', 'linked']]);
});

test('a named harness is set up even when it is not installed', t => {
  const { home, skillsDir } = fixture(t);
  assert.deepEqual(states(linkSkills({ home, skillsDir, only: ['codex'] })), [['Codex', 'jarvis', 'created']]);
  assert.ok(existsSync(join(home, '.agents', 'skills', 'jarvis', 'SKILL.md')));
});

test('checking reports a missing link without creating it', t => {
  const { home, skillsDir } = fixture(t);
  assert.deepEqual(states(linkSkills({ home, skillsDir, write: false })), [['Claude Code', 'jarvis', 'missing']]);
  assert.equal(existsSync(join(home, '.claude', 'skills')), false);
});

test('a skill that is already there is kept, not replaced', t => {
  const { home, skillsDir } = fixture(t);
  const existing = join(home, '.claude', 'skills', 'jarvis');
  mkdirSync(existing, { recursive: true });
  writeFileSync(join(existing, 'SKILL.md'), '# Mine');
  assert.deepEqual(states(linkSkills({ home, skillsDir })), [['Claude Code', 'jarvis', 'kept']]);
  assert.equal(realpathSync(existing).startsWith(realpathSync(home)), true);
});

test('a skills folder that is itself a link is left alone', t => {
  const { root, home, skillsDir } = fixture(t);
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(home, '.claude', 'skills'), 'junction');
  assert.deepEqual(linkSkills({ home, skillsDir }).map(result => result.state), ['folder-is-link']);
  assert.equal(existsSync(join(elsewhere, 'jarvis')), false);
});
