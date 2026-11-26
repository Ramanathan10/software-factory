import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('.', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);

const generic = /^(github|dependabot|claude|actions|bot|noreply|web-flow|users)$/i;

function privateWords({ owner, names = [], extra = '' }) {
  if (!owner) throw new Error('No owner to check for: add an origin remote or set GITHUB_REPOSITORY_OWNER.');
  const words = new Set(extra.split(',').map(word => word.trim()).filter(Boolean));
  const ascii = new Set();
  for (const word of owner.split(/[^A-Za-z]+/).filter(word => word.length >= 3 && !generic.test(word)))
    for (let end = 3; end <= word.length; end += 1) ascii.add(word.slice(0, end));
  for (const word of ascii) words.add(word);
  for (const name of names.filter(name => !/\[bot\]/.test(name) && name.toLowerCase() !== owner.toLowerCase()).map(name => name.split(/[^\p{L}\p{N}]+/u).filter(Boolean)))
    if (name.join('').length >= 3 && !name.every(word => generic.test(word))) words.add(name.join(' '));
  return Object.assign([...words], { ascii });
}

const alnum = '[\\p{L}\\p{N}]';

function lineMatcher(words) {
  const escape = word => word.split(' ').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+');
  const bounded = word => {
    const edge = words.ascii?.has(word) ? '[A-Za-z0-9]' : alnum;
    return (new RegExp('^' + alnum, 'u').test(word) ? '(?<!' + edge + ')' : '') + escape(word) + (new RegExp(alnum + '$', 'u').test(word) ? '(?!' + edge + ')' : '');
  };
  return new RegExp('(' + words.map(bounded).join('|') + ')', 'iu');
}

function ownerFrom(env, readOrigin) {
  if (env) return env;
  let origin = '';
  try { origin = readOrigin(); } catch {}
  return /[:/]([^/]+)\/[^/]+?(?:\.git)?$/.exec(origin.replace(/^.*\/git\/(?=[^/]+\/[^/]+$)/, '/'))?.[1];
}

const exempt = /^(LICENSE|CODE_OF_CONDUCT\.md|SECURITY\.md|skills\/[^/]+\/LICENSE)$/;
const text = file => !/\.(png|jpe?g|gif|webp|mp4|webm|ico|pdf|zip)$/i.test(file);

test('no tracked file names the owner or other private details', () => {
  const owner = ownerFrom(process.env.GITHUB_REPOSITORY_OWNER, () => git('remote', 'get-url', 'origin'));
  const names = git('log', '--format=%an%n%cn').split('\n');
  try { names.push(git('config', 'user.name')); } catch {}
  const words = privateWords({ owner, names, extra: process.env.PRIVATE_WORDS });
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

test('owner login prefixes keep ASCII word edges, so accented text around them is still caught', () => {
  for (const [owner, line] of [['renee', 'Renée wrote'], ['jose', 'José wrote'], ['quillfern', 'équill']]) assert.ok(hits({ owner, names: [] }, line), line);
});

test('each word of a hyphenated owner login gets prefixes', () => {
  const sources = { owner: 'oak-harbour', names: [] };
  assert.ok(hits(sources, 'the oak tree'));
  assert.ok(hits(sources, 'at harb'));
});

test('a contributor name matches only as the whole full name, words in order', () => {
  const sources = { owner: 'quillfern', names: ['Andrex Markwell'] };
  assert.ok(hits(sources, 'written by Andrex Markwell'));
  assert.ok(hits(sources, 'ANDREX MARKWELL'));
  for (const line of ['this and that', 'Markwell alone', 'a mark of respect', 'Andrex alone', 'Markwell Andrex']) assert.ok(!hits(sources, line), line);
});

test('a contributor name is not turned into prefixes', () => {
  const words = privateWords({ owner: 'quillfern', names: ['Andrex Markwell', 'Thelwin', 'Fordane', 'Willowby', 'Markel Smythe'] });
  for (const word of ['and', 'and ', 'the', 'for', 'wil', 'will', 'mark', 'marks', 'Mar', 'The']) assert.ok(!words.includes(word), word);
  const line = 'and the for will mark marks smith';
  assert.ok(!lineMatcher(words).test(line), line);
});

test('common-word contributor names do not flag ordinary text', () => {
  for (const name of ['Andrex Markwell', 'Thelwin', 'Fordane', 'Willowby', 'Markel Smythe']) {
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

test('hyphenated, apostrophe and oddly spaced contributor names match as written', () => {
  const sources = { owner: 'quillfern', names: ['Zyra-Venn', "Orla O'Venn"] };
  for (const line of ['by Zyra-Venn', 'by Zyra Venn', 'by Zyra  Venn', 'by zyra_venn', "by Orla O'Venn", 'by Orla O Venn']) assert.ok(hits(sources, line), line);
  for (const line of ['Zyra alone', 'Venn alone', 'Zyravenn']) assert.ok(!hits(sources, line), line);
});

test('non-ASCII contributor names keep their letters', () => {
  const sources = { owner: 'quillfern', names: ['Ísolde Vexmoor'] };
  for (const line of ['by Ísolde Vexmoor', 'by ÍSOLDE VEXMOOR', 'by Ísolde-Vexmoor']) assert.ok(hits(sources, line), line);
  for (const line of ['Isolde Vexmoor', 'by Ísoldes Vexmoor', 'by Ísolde Vexmoors']) assert.ok(!hits(sources, line), line);
});

test('digits in a contributor name are kept', () => {
  const sources = { owner: 'quillfern', names: ['quill99', 'Jo3n Vexmoor'] };
  for (const line of ['by quill99', 'by Jo3n Vexmoor', 'by jo3n-vexmoor']) assert.ok(hits(sources, line), line);
  for (const line of ['by quill', 'quill 99x', 'by Jon Vexmoor', 'Vexmoor alone']) assert.ok(!hits({ ...sources, owner: 'zzzzzz' }, line), line);
});

test('a git name equal to the owner login adds no whole-name entry', () => {
  const sources = { owner: 'quill99', names: ['Quill99', 'Orla Venn'] };
  assert.ok(!hits(sources, 'github.com/quill99/factory'));
  assert.ok(hits(sources, 'by Orla Venn'));
});

test('a name with one generic word is still protected; a name of only generic words is skipped', () => {
  const sources = { owner: 'quillfern', names: ['Zyra GitHub', 'Claude Orvane', 'GitHub Actions', 'Claude'] };
  assert.ok(hits(sources, 'by Zyra GitHub'));
  assert.ok(hits(sources, 'by Claude Orvane'));
  assert.ok(!hits(sources, 'GitHub Actions and Claude alone'));
});

test('the owner comes from the environment, else from the origin url, else is missing', () => {
  const boom = () => { throw new Error('Command failed: git remote get-url origin'); };
  assert.equal(ownerFrom('acme', boom), 'acme');
  assert.equal(ownerFrom(undefined, () => 'git@github.com:quillfern/factory.git'), 'quillfern');
  assert.equal(ownerFrom('', () => 'https://github.com/quillfern/factory'), 'quillfern');
  assert.equal(ownerFrom(undefined, boom), undefined);
  assert.equal(ownerFrom(undefined, () => ''), undefined);
});
