import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { openStore } from './store.mjs';
import { watchOnce } from './watcher.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'pr-url-'));
  const file = join(directory, 'stories.db');
  const stores = [];
  t.after(() => {
    stores.forEach(store => store.close());
    rmSync(directory, { recursive: true, force: true });
  });
  const open = () => {
    const store = openStore(file);
    stores.push(store);
    return store;
  };
  return Object.assign(open, { file });
}

function begin(store, story) {
  const created = store.record({ story, key: story + '-start', type: 'create', title: 'Implement ' + story, detail: 'Use an isolated branch.',
    branch: story, worktree: '/worktrees/' + story, harness: 'Codex' });
  store.record({ story, key: story + '-scout', type: 'handoff', revision: created.revision, detail: 'Context pack ready.' });
}

function writer(store, story) {
  return (type, input = {}) => {
    const { revision } = store.snapshot().find(item => item.id === story);
    return store.record({ story, type, revision, key: story + '-' + revision, ...input });
  };
}

function toPublishing(record) {
  record('plan', { detail: 'Plan.' });
  record('approve');
  record('handoff', { detail: 'Tests ready.' });
  record('handoff', { detail: 'Valid red.', command: 'npm test' });
  record('handoff', { detail: 'Verified green.', command: 'npm test' });
  record('handoff', { detail: 'Gates passed.', command: 'node --test' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  record('handoff', { detail: 'Reviewed.' });
  record('comparison-choice', { run: false });
}

function publishing(t, story = 'story') {
  const open = fixture(t);
  const store = open();
  begin(store, story);
  const record = writer(store, story);
  toPublishing(record);
  const read = () => store.handover(story).story;
  return { store, file: open.file, record, read, again() { record('replan', { detail: 'Back to publishing.' }); toPublishing(record); } };
}

const refuses = (status, pattern) => error => error.status === status && pattern.test(error.message);
const lastEvent = (story, type) => story.events.findLast(event => event.type === type);

test('a pull request recorded with a path suffix is stored in canonical form and read by Hawkeye', async t => {
  const { store, record, read } = publishing(t);
  record('pr-opened', { url: 'https://github.com/o/r/pull/3/files' });
  assert.equal(read().pr, 'https://github.com/o/r/pull/3');
  assert.equal(read().phase, 'ci');
  assert.equal(lastEvent(read(), 'pr-opened').detail, 'https://github.com/o/r/pull/3', 'a recognised pull request needs no warning');
  const reads = [];
  const head = 'a'.repeat(40);
  const changes = await watchOnce(store, { readPr: async url => {
    reads.push(url);
    return { head, status: 'running', failedCount: 0, failures: [] };
  } });
  assert.deepEqual(reads, ['https://github.com/o/r/pull/3']);
  assert.equal(changes.length, 0, 'a running first observation wakes nobody');
  assert.equal(read().prObservation.head, head);
  assert.equal(read().prObservation.status, 'running');
});

test('each suffix, query, fragment and trailing slash is dropped from a stored GitHub pull request', t => {
  for (const url of ['https://github.com/o/r/pull/3/', 'https://github.com/o/r/pull/3/commits/abc', 'https://github.com/o/r/pull/3/checks?check_run_id=1', 'https://github.com/o/r/pull/3#discussion_r1']) {
    const { record, read } = publishing(t, 'drop');
    record('pr-opened', { url });
    assert.equal(read().pr, 'https://github.com/o/r/pull/3', url);
  }
});

test('a GitHub Enterprise pull request is stored in canonical form and read by Hawkeye', async t => {
  const { store, record, read } = publishing(t);
  record('pr-opened', { url: 'https://ghe.example.com/o/r/pull/3/files' });
  assert.equal(read().pr, 'https://ghe.example.com/o/r/pull/3');
  assert.equal(lastEvent(read(), 'pr-opened').detail, 'https://ghe.example.com/o/r/pull/3', 'Hawkeye watches this host, so no warning');
  const reads = [];
  await watchOnce(store, { readPr: async url => {
    reads.push(url);
    return { head: 'b'.repeat(40), status: 'running', failedCount: 0, failures: [] };
  } });
  assert.deepEqual(reads, ['https://ghe.example.com/o/r/pull/3']);
});

test('an Azure DevOps pull request is stored up to its id and read by Hawkeye', async t => {
  const { store, record, read } = publishing(t);
  record('pr-opened', { url: 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/12?_a=files' });
  assert.equal(read().pr, 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/12');
  const reads = [];
  await watchOnce(store, { readPr: async url => {
    reads.push(url);
    return { head: 'b'.repeat(40), status: 'running', failedCount: 0, failures: [] };
  } });
  assert.deepEqual(reads, ['https://dev.azure.com/org/Proj/_git/repo/pullrequest/12']);
});

test('the same pull request recorded again in another spelling is accepted and keeps the first spelling', t => {
  const { record, read, again } = publishing(t);
  record('pr-opened', { url: 'https://github.com/o/r/pull/3' });
  again();
  record('pr-opened', { url: 'https://github.com/o/r/pull/3/files' });
  assert.equal(read().pr, 'https://github.com/o/r/pull/3');
  assert.equal(read().phase, 'ci');
  again();
  record('pr-opened', { url: 'https://github.com/O/R/pull/3#x' });
  assert.equal(read().pr, 'https://github.com/o/r/pull/3', 'the first spelling stays');
  assert.equal(read().phase, 'ci');
});

test('a different pull request is refused with 409 and the story stays in publishing', t => {
  const { record, read, again } = publishing(t);
  record('pr-opened', { url: 'https://github.com/o/r/pull/3' });
  again();
  for (const url of ['https://github.com/o/r/pull/30', 'https://github.com/o/r/pull/4', 'https://github.com/o/other/pull/3', 'https://ghe.example.com/o/r/pull/3']) {
    assert.throws(() => record('pr-opened', { url }), refuses(409, /Continue on the existing pull request/), url);
    assert.equal(read().phase, 'publishing', url);
    assert.equal(read().pr, 'https://github.com/o/r/pull/3', url);
  }
});

test('an Azure DevOps pull request is the same one across both hosts and spellings, and only its own id', t => {
  const { record, read, again } = publishing(t);
  const legacy = 'https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12';
  record('pr-opened', { url: legacy });
  assert.equal(read().pr, legacy);
  again();
  record('pr-opened', { url: 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/12' });
  assert.equal(read().pr, legacy, 'the first spelling stays');
  again();
  record('pr-opened', { url: 'https://dev.azure.com/ORG/proj/_git/REPO/pullrequest/12/files?_a=files#x' });
  assert.equal(read().pr, legacy);
  again();
  for (const url of ['https://dev.azure.com/org/Proj/_git/repo/pullrequest/120', 'https://org.visualstudio.com/Proj/_git/repo/pullrequest/1', 'https://dev.azure.com/org/Proj/_git/other/pullrequest/12']) {
    assert.throws(() => record('pr-opened', { url }), refuses(409, /Continue on the existing pull request/), url);
  }
  assert.equal(read().phase, 'publishing');
});

test('an Azure DevOps pull request recorded first on dev.azure.com accepts the visualstudio.com address afterwards', t => {
  const { record, read, again } = publishing(t);
  const first = 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/12';
  record('pr-opened', { url: first });
  again();
  record('pr-opened', { url: 'https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12' });
  assert.equal(read().pr, first);
  assert.equal(read().phase, 'ci');
});

test('a URL that is not a pull request is refused with 400, and the story stays in publishing', t => {
  const { record, read } = publishing(t);
  for (const url of [
    'https://github.com/o/r/issues/3',
    'https://github.com/o/r',
    'https://github.com/o/r/pull/30x',
    'https://github.com/o/r/pull/0',
    'https://dev.azure.com/org/Proj/_git/repo',
  ]) {
    assert.throws(() => record('pr-opened', { url }), refuses(400, /Use the pull request's URL\./), url);
    assert.equal(read().phase, 'publishing', url);
    assert.equal(read().pr, undefined, url);
  }
});

test('the console CLI refuses a URL that is not a pull request with the same message and leaves the phase alone', t => {
  const { file: db, record, read } = publishing(t, 'cli');
  const cli = fileURLToPath(new URL('jarvis.mjs', import.meta.url));
  for (const url of ['https://github.com/o/r/issues/3', 'https://github.com/o/r', 'https://dev.azure.com/org/Proj/_git/repo']) {
    const { revision } = read();
    let failure;
    try {
      execFileSync(process.execPath, [cli, 'record', db], {
        input: JSON.stringify({ story: 'cli', key: 'cli-bad-' + revision + '-' + url.length, type: 'pr-opened', revision, url }),
        encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure, url + ' was accepted');
    assert.match(String(failure.stderr) + failure.message, /Use the pull request's URL\./, url);
    assert.equal(read().phase, 'publishing', url);
  }
  record('pr-opened', { url: 'https://github.com/o/r/pull/3/files' });
  assert.equal(read().pr, 'https://github.com/o/r/pull/3');
});

test('a pull request on a host Hawkeye does not watch is kept as given, says so, and is never read', async t => {
  const { store, record, read } = publishing(t);
  const url = 'https://gitlab.example.com/o/r/-/merge_requests/3';
  record('pr-opened', { url });
  assert.equal(read().pr, url);
  assert.equal(read().phase, 'ci');
  const detail = lastEvent(read(), 'pr-opened').detail;
  assert.match(detail, /Hawkeye does not watch gitlab\.example\.com/);
  assert.match(detail, /record pr-ready without a head once its checks pass/);
  let reads = 0;
  let warnings = 0;
  assert.deepEqual(await watchOnce(store, { readPr: async () => { reads += 1; return {}; }, warn: () => { warnings += 1; } }), []);
  assert.equal(reads, 0, 'Hawkeye makes no read for a host it does not watch');
  assert.equal(warnings, 0);
});

test('a host Hawkeye does not watch is still held to the byte-equal re-record', t => {
  const { record, read, again } = publishing(t);
  const url = 'https://gitlab.example.com/o/r/-/merge_requests/3';
  record('pr-opened', { url });
  again();
  assert.throws(() => record('pr-opened', { url: url + '/diffs' }), refuses(409, /Continue on the existing pull request/));
  record('pr-opened', { url });
  assert.equal(read().pr, url);
});

test('a watched pull request that cannot be read warns with the CLI to check for its host', async t => {
  const warnings = [];
  const failing = async () => { throw new Error('boom'); };
  for (const [url, expected] of [
    ['https://github.com/o/r/pull/3', 'Hawkeye could not observe gh. Check GitHub CLI access to github.com and the next poll.'],
    ['https://ghe.example.com/o/r/pull/3/files', 'Hawkeye could not observe ghe. Check GitHub CLI access to ghe.example.com and the next poll.'],
    ['https://dev.azure.com/org/Proj/_git/repo/pullrequest/12', 'Hawkeye could not observe ado. Check Azure CLI access (az extension add --name azure-devops, then az login) and the next poll.'],
    ['https://org.visualstudio.com/Proj/_git/repo/pullrequest/12', 'Hawkeye could not observe vs. Check Azure CLI access (az extension add --name azure-devops, then az login) and the next poll.'],
  ]) {
    const id = expected.split(' ')[4].replace('.', '');
    const store = fixture(t)();
    begin(store, id);
    const record = writer(store, id);
    toPublishing(record);
    record('pr-opened', { url });
    warnings.length = 0;
    assert.deepEqual(await watchOnce(store, { readPr: failing, warn: message => warnings.push(message) }), []);
    assert.deepEqual(warnings, [expected], url);
  }
});
