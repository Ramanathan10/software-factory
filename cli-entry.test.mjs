import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('.', import.meta.url));

function sources(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') return [];
    const path = join(folder, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.m?js$/.test(entry.name) && !/\.test\.m?js$/.test(entry.name) ? [path] : [];
  });
}

// Every module that runs as a CLI, found by its entry-point check so a new one is covered without listing it.
const clis = sources(repo).filter(file => !file.endsWith('is-main.mjs') && /process\.argv\[1\]|isMain\(import\.meta\.url\)/.test(readFileSync(file, 'utf8')));

test('the CLIs are found', () => {
  assert.ok(clis.length >= 6, 'found ' + clis.map(file => relative(repo, file)).join(', '));
});

// 95db86b: preflight.mjs compared process.argv[1] with import.meta.url, so through the installed link it
// printed nothing and exited 0. Each CLI is run through a linked checkout with an argument it rejects.
for (const file of clis) {
  test(relative(repo, file) + ' runs when reached through a link', t => {
    const scratch = mkdtempSync(join(tmpdir(), 'cli-entry-'));
    const link = join(scratch, 'checkout');
    symlinkSync(repo, link, 'junction');
    t.after(() => {
      if (process.platform === 'win32') rmdirSync(link); else unlinkSync(link);
      rmSync(scratch, { recursive: true, force: true });
    });
    const run = spawnSync(process.execPath, [join(link, relative(repo, file)), '--not-an-option'], {
      cwd: scratch, input: '', encoding: 'utf8', timeout: 20000,
      env: { ...process.env, HOME: scratch, USERPROFILE: scratch, AI_SDLC_HOME: scratch },
    });
    assert.equal(run.error, undefined, 'the CLI could not be run: ' + run.error?.message);
    assert.equal(run.signal, null, 'the CLI was stopped by ' + run.signal);
    assert.ok(run.status !== 0 && /Usage: node /.test(run.stderr),
      relative(repo, file) + ' did not print its usage and fail on an argument it should reject, so its entry-point check did not match through the link. ' +
      'Use isMain(import.meta.url) from mission-console/is-main.mjs; a skill script, which is copied on its own, compares realpathSync of both sides.\n' +
      'exit ' + run.status + '\n' + run.stdout + run.stderr);
  });
}
