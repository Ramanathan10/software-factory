import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('.', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);

// Names this repository must not carry, found without writing them into it: the GitHub owner, the git
// identities of this checkout, and PRIVATE_WORDS (comma-separated; a repository variable in CI) for anything
// else, such as a work story prefix. A nickname is usually the start of a name, so each name's first three or
// more letters count as a whole word too. Bots and generic words are skipped.
function privateWords(env = process.env) {
  const owner = env.GITHUB_REPOSITORY_OWNER || /[:/]([^/]+)\/[^/]+?(?:\.git)?$/.exec(git('remote', 'get-url', 'origin').replace(/^.*\/git\/(?=[^/]+\/[^/]+$)/, '/'))?.[1];
  let identities = git('log', '--format=%an%n%cn');
  try { identities += '\n' + git('config', 'user.name'); } catch { /* no identity configured */ }
  const generic = /^(github|dependabot|claude|actions|bot|noreply|web-flow|users)$/i;
  const names = [owner, ...identities.split('\n')].flatMap(name => String(name ?? '').split(/[^A-Za-z]+/))
    .filter(word => word.length >= 3 && !generic.test(word) && !/\[bot\]/.test(word));
  const words = new Set((env.PRIVATE_WORDS ?? '').split(',').map(word => word.trim()).filter(Boolean));
  for (const name of names) for (let end = 3; end <= name.length; end += 1) words.add(name.slice(0, end));
  return [...words];
}

// The license and the community files name the copyright holder and where to report a problem.
const exempt = /^(LICENSE|CODE_OF_CONDUCT\.md|SECURITY\.md|skills\/[^/]+\/LICENSE)$/;
const text = file => !/\.(png|jpe?g|gif|webp|mp4|webm|ico|pdf|zip)$/i.test(file);

test('no tracked file names the owner or other private details', () => {
  const words = privateWords();
  assert.ok(words.length, 'no names to look for');
  // A word edge only where the entry itself starts or ends with a letter or digit, so "PCS-" still matches "PCS-12".
  const bounded = word => (/^\w/.test(word) ? '(?<![A-Za-z0-9])' : '') + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/\w$/.test(word) ? '(?![A-Za-z0-9])' : '');
  const pattern = new RegExp('(' + words.map(bounded).join('|') + ')', 'i');
  const found = [];
  for (const file of tracked.filter(file => text(file) && !exempt.test(file))) {
    readFileSync(join(repo, file), 'utf8').split('\n').forEach((line, index) => {
      const match = pattern.exec(line);
      if (match) found.push(file + ':' + (index + 1) + ' names "' + match[1] + '"');
    });
  }
  assert.deepEqual(found, [], 'This repository is shared: write "the owner" for the person running the session, and leave out real organizations, people, repositories, and story prefixes.');
});

test('no profile or story database is tracked', () => {
  const kept = tracked.filter(file => /\.(sqlite|sqlite-wal|sqlite-shm|db)$/i.test(file) || (/(^|\/)profile\.json$/i.test(file)));
  assert.deepEqual(kept, [], 'Profiles and story databases hold one person\'s names and settings. Remove them with git rm --cached; an example profile is named profile.example.json.');
});
