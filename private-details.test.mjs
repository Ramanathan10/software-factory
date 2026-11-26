import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('.', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);

function privateWords(env = process.env) {
  const owner = env.GITHUB_REPOSITORY_OWNER || /[:/]([^/]+)\/[^/]+?(?:\.git)?$/.exec(git('remote', 'get-url', 'origin').replace(/^.*\/git\/(?=[^/]+\/[^/]+$)/, '/'))?.[1];
  let identities = git('log', '--format=%an%n%cn');
  try { identities += '\n' + git('config', 'user.name'); } catch {}
  const generic = /^(github|dependabot|claude|actions|bot|noreply|web-flow|users)$/i;
  const names = [owner, ...identities.split('\n')].flatMap(name => String(name ?? '').split(/[^A-Za-z]+/))
    .filter(word => word.length >= 3 && !generic.test(word) && !/\[bot\]/.test(word));
  const words = new Set((env.PRIVATE_WORDS ?? '').split(',').map(word => word.trim()).filter(Boolean));
  for (const name of names) for (let end = 3; end <= name.length; end += 1) words.add(name.slice(0, end));
  return [...words];
}

function lineMatcher(words) {
  const bounded = word => (/^\w/.test(word) ? '(?<![A-Za-z0-9])' : '') + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (/\w$/.test(word) ? '(?![A-Za-z0-9])' : '');
  return new RegExp('(' + words.map(bounded).join('|') + ')', 'i');
}

const exempt =/^(LICENSE|CODE_OF_CONDUCT\.md|SECURITY\.md|skills\/[^/]+\/LICENSE)$/;
const text = file => !/\.(png|jpe?g|gif|webp|mp4|webm|ico|pdf|zip)$/i.test(file);

test('no tracked file names the owner or other private details', () => {
  const words = privateWords();
  assert.ok(words.length, 'no names to look for');
  const pattern = lineMatcher(words);
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

const hits = (sources, line) => lineMatcher(privateWords(sources)).test(line);

test('an owner login counts as a whole word and so does each prefix of 3+ letters', () => {
  const sources = { owner: 'quillfern', names: [] };
  for (const line of ['by quillfern', 'by quill', 'by QUI today', 'x/quil/y']) assert.ok(hits(sources, line), line);
  for (const line of ['a quiet room', 'qu alone', 'quillferns']) assert.ok(!hits(sources, line), line);
});

test('each word of a hyphenated owner login gets prefixes', () => {
  const sources = { owner: 'oak-harbour', names: [] };
  assert.ok(hits(sources, 'the oak tree'));
  assert.ok(hits(sources, 'at harb'));
});

test('a contributor name matches only as the whole full name, words in order', () => {
  const sources = { owner: 'quillfern', names: ['Andrew Marks'] };
  assert.ok(hits(sources, 'written by Andrew Marks'));
  assert.ok(hits(sources, 'ANDREW MARKS'));
  for (const line of ['this and that', 'Marks alone', 'a mark of respect', 'Andrew alone', 'Marks Andrew']) assert.ok(!hits(sources, line), line);
});

test('a contributor name is not turned into prefixes', () => {
  const words = privateWords({ owner: 'quillfern', names: ['Andrew Marks', 'Theodore', 'Ford', 'Willa', 'Mark Smith'] });
  for (const word of ['and', 'and ', 'the', 'for', 'wil', 'will', 'mark', 'marks', 'Mar', 'The']) assert.ok(!words.includes(word), word);
  const line = 'and the for will mark marks smith';
  assert.ok(!lineMatcher(words).test(line), line);
});

test('common-word contributor names do not flag ordinary text', () => {
  for (const name of ['Andrew Marks', 'Theodore', 'Ford', 'Willa', 'Mark Smith']) {
    const sources = { owner: 'quillfern', names: [name] };
    assert.ok(hits(sources, 'by ' + name), name);
    assert.ok(!hits(sources, 'and the for will wil mark marks theo'), name);
  }
});

test('bots and generic names are skipped', () => {
  const sources = { owner: 'quillfern', names: ['GitHub', 'dependabot[bot]', 'github-actions[bot]', 'Claude', 'noreply'] };
  assert.ok(!hits(sources, 'GitHub dependabot Claude noreply actions'));
});

test('blank and repeated names add nothing', () => {
  const sources = { owner: 'quillfern', names: ['', ' ', 'Orla Venn', 'Orla Venn'] };
  assert.ok(hits(sources, 'Orla Venn'));
  assert.ok(!hits(sources, 'a blank line'));
});

test('PRIVATE_WORDS entries are matched, including ones ending in a non-letter', () => {
  const sources = { owner: 'quillfern', names: [], extra: 'ZZQ-, Hollowmere ,' };
  assert.ok(hits(sources, 'story ZZQ-12 here'));
  assert.ok(hits(sources, 'the hollowmere site'));
  assert.ok(!hits(sources, 'xZZQ-12'));
  assert.ok(!hits(sources, 'hollowmeres'));
});

test('a missing owner fails with a message that names origin and GITHUB_REPOSITORY_OWNER', () => {
  for (const owner of [undefined, '', null]) {
    assert.throws(() => privateWords({ owner, names: ['Orla Venn'], extra: 'ZZQ-' }), error => {
      assert.match(error.message, /origin/);
      assert.match(error.message, /GITHUB_REPOSITORY_OWNER/);
      assert.doesNotMatch(error.message, /Command failed/);
      return true;
    });
  }
});
