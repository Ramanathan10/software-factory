import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { harnesses } from './adapters/harnesses.mjs';
import { install } from './install.mjs';

const repo = fileURLToPath(new URL('.', import.meta.url));
const names = ['delete-comment', 'verify-decision-delivery', 'verify-story-lifecycle'];
const tracked = execFileSync('git', ['ls-files'], { cwd: repo, encoding: 'utf8' }).split('\n').filter(Boolean);
const frontmatterName = file => /^name:\s*(\S+)\s*$/m.exec(readFileSync(join(repo, file), 'utf8').split(/^---\s*$/m)[1] ?? '')?.[1];

for (const name of names) {
  test(`${name} exists once, under .agents/skills`, () => {
    const copies = tracked.filter(file => existsSync(join(repo, file)) && /(^|\/)SKILL\.md$/.test(file) && frontmatterName(file) === name);
    assert.deepEqual(copies, [`.agents/skills/${name}/SKILL.md`]);
  });
}

test('install never installs a maintainer skill', t => {
  const home = mkdtempSync(join(tmpdir(), 'maintainer-skills-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const harness of Object.values(harnesses)) mkdirSync(join(home, harness.marker), { recursive: true });
  const results = install({ home, write: false });
  assert.ok(results.length > 0);
  assert.deepEqual(results.filter(result => names.includes(result.skill)), []);
});

test('no tracked file outside docs/specs names a maintainer skill under .claude/skills', () => {
  const old = new RegExp(`\.claude/skills/(${names.join('|')})`);
  const offenders = tracked.filter(file => !file.startsWith('docs/specs/') && existsSync(join(repo, file)) && old.test(readFileSync(join(repo, file), 'utf8')));
  assert.deepEqual(offenders, []);
});
