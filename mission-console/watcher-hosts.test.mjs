import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { openStore } from './store.mjs';
import * as watcher from './watcher.mjs';

const HEAD = 'c'.repeat(40);
const at = minutes => new Date(Date.UTC(2026, 0, 1, 12, minutes)).toISOString();
const PROJECT_ID = '0a1b2c3d-1111-2222-3333-444455556666';
const REPO_ID = 'aabbccdd-7777-8888-9999-000011112222';

function reader(name) {
  assert.equal(typeof watcher[name], 'function', 'watcher.mjs does not export ' + name);
  return watcher[name];
}

function pullRequest() {
  return {
    createdAt: at(0),
    latestOpinionatedReviews: { nodes: [] },
    reviews: { pageInfo: { hasNextPage: false }, nodes: [] },
    reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [] },
    comments: { pageInfo: { hasNextPage: false }, nodes: [] },
  };
}

function ghStub({ url, state = 'OPEN' }) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, args]);
    if (args[0] === 'pr') return { stdout: JSON.stringify({ url, state, headRefOid: HEAD, statusCheckRollup: [] }) };
    return { stdout: JSON.stringify({ data: { repository: { pullRequest: pullRequest() } } }) };
  };
  return { run, calls };
}

const consecutive = (args, ...sequence) => args.some((_, index) => sequence.every((value, offset) => args[index + offset] === value));

test('a GitHub Enterprise read asks gh for the pull request and runs GraphQL on that host', async () => {
  const read = reader('readGitHubPr');
  const url = 'https://ghe.example.com/o/r/pull/3';
  const { run, calls } = ghStub({ url });
  const observation = await read(url, undefined, [], { run });
  assert.equal(observation.head, HEAD);
  assert.equal(observation.status, 'no-checks');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], ['gh', ['pr', 'view', url, '--json', 'url,state,headRefOid,statusCheckRollup']]);
  const [file, graphql] = calls[1];
  assert.equal(file, 'gh');
  assert.ok(consecutive(graphql, 'api', 'graphql'));
  assert.ok(consecutive(graphql, '--hostname', 'ghe.example.com'), 'GraphQL names the host: ' + graphql.join(' '));
  assert.ok(consecutive(graphql, '-f', 'owner=o'));
  assert.ok(consecutive(graphql, '-f', 'name=r'));
  assert.ok(consecutive(graphql, '-F', 'number=3'));
  assert.ok(graphql.some(argument => argument.startsWith('query=')));
});

test('a github.com read keeps its call arguments and names github.com for GraphQL', async () => {
  const read = reader('readGitHubPr');
  const url = 'https://github.com/o/r/pull/3';
  const { run, calls } = ghStub({ url });
  await read(url, undefined, [], { run });
  assert.deepEqual(calls[0], ['gh', ['pr', 'view', url, '--json', 'url,state,headRefOid,statusCheckRollup']]);
  assert.ok(consecutive(calls[1][1], '--hostname', 'github.com'));
  assert.ok(consecutive(calls[1][1], '-f', 'owner=o') && consecutive(calls[1][1], '-F', 'number=3'));
});

test('a GitHub read answered with another pull request throws, ignoring case', async () => {
  const read = reader('readGitHubPr');
  const url = 'https://ghe.example.com/o/r/pull/3';
  await assert.rejects(read(url, undefined, [], { run: ghStub({ url: 'https://ghe.example.com/o/r/pull/4' }).run }), /GitHub returned a different PR/);
  await assert.rejects(read(url, undefined, [], { run: ghStub({ url: 'https://other.example.com/o/r/pull/3' }).run }), /GitHub returned a different PR/);
  const { run } = ghStub({ url: 'https://ghe.example.com/O/R/pull/3' });
  assert.equal((await read(url, undefined, [], { run })).head, HEAD);
});

const ORG_URL = 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/12';

function shown(extra = {}) {
  return {
    pullRequestId: 12, status: 'active', creationDate: at(0),
    lastMergeSourceCommit: { commitId: HEAD },
    reviewers: [],
    repository: { id: REPO_ID, name: 'repo', webUrl: 'https://dev.azure.com/org/Proj/_git/repo', project: { id: PROJECT_ID, name: 'Proj' } },
    ...extra,
  };
}

const policy = (type, status, name) => ({ status, configuration: { type: { displayName: type }, ...(name ? { settings: { displayName: name } } : {}) } });
const author = (uniqueName, displayName = 'Someone') => ({ uniqueName, displayName });
const note = (id, who, content, extra = {}) => ({ id, author: who, content, commentType: 'text', publishedDate: at(10), lastUpdatedDate: at(10), ...extra });
const discussion = (id, status, comments, context = null) => ({ id, status, comments, threadContext: context });
const onFile = (filePath, line) => ({ filePath, rightFileStart: { line, offset: 1 }, rightFileEnd: { line, offset: 9 } });

function azStub({ pr = shown(), policies = [], threads = [] } = {}) {
  const calls = [];
  const run = async (file, args) => {
    calls.push([file, args]);
    assert.equal(file, 'az');
    if (consecutive(args, 'repos', 'pr', 'show')) return { stdout: JSON.stringify(pr) };
    if (consecutive(args, 'repos', 'pr', 'policy', 'list')) return { stdout: JSON.stringify(policies) };
    if (consecutive(args, 'devops', 'invoke')) return { stdout: JSON.stringify({ count: threads.length, value: threads }) };
    throw new Error('unexpected az call: ' + args.join(' '));
  };
  return { run, calls };
}

const readAzure = (stub, { url = ORG_URL, posted = [] } = {}) => reader('readAzurePr')(url, undefined, posted, { run: stub.run });
const statusOf = async (options, url) => (await readAzure(azStub(options), { url })).status;

test('an Azure DevOps read runs show, policy list and one thread read, each with its organization and JSON output', async () => {
  const stub = azStub({ pr: shown({ reviewers: [] }) });
  const observation = await readAzure(stub);
  assert.equal(observation.head, HEAD);
  const [show, list, invoke] = stub.calls.map(([, args]) => args);
  assert.equal(stub.calls.length, 3);
  assert.ok(consecutive(show, 'repos', 'pr', 'show') && consecutive(show, '--id', '12'));
  assert.ok(consecutive(list, 'repos', 'pr', 'policy', 'list') && consecutive(list, '--id', '12'));
  for (const args of [show, list, invoke]) {
    assert.ok(consecutive(args, '--org', 'https://dev.azure.com/org'), args.join(' '));
    assert.ok(consecutive(args, '-o', 'json'), args.join(' '));
  }
  assert.ok(consecutive(invoke, '--area', 'git'));
  assert.ok(consecutive(invoke, '--resource', 'pullRequestThreads'));
  assert.ok(consecutive(invoke, '--route-parameters', 'project=' + PROJECT_ID, 'repositoryId=' + REPO_ID, 'pullRequestId=12'), invoke.join(' '));
  assert.ok(consecutive(invoke, '--api-version', '7.1'));
});

test('a visualstudio.com pull request is read with its own organization address', async () => {
  const stub = azStub();
  await readAzure(stub, { url: 'https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12' });
  for (const [, args] of stub.calls) assert.ok(consecutive(args, '--org', 'https://org.visualstudio.com'), args.join(' '));
});

test('a completed pull request is merged and an abandoned one is closed, whatever its policies say', async () => {
  const failing = [policy('Build', 'rejected')];
  assert.equal(await statusOf({ pr: shown({ status: 'completed' }), policies: failing }), 'merged');
  assert.equal(await statusOf({ pr: shown({ status: 'abandoned' }), policies: failing }), 'closed');
});

test('only Build and Status policies count as checks', async () => {
  assert.equal(await statusOf({ policies: [] }), 'no-checks');
  assert.equal(await statusOf({ policies: [policy('Minimum number of reviewers', 'rejected')] }), 'no-checks');
  assert.equal(await statusOf({ policies: [policy('Comment requirements', 'queued'), policy('Work item linking', 'broken')] }), 'no-checks');
  assert.equal(await statusOf({ policies: [policy('Build', 'approved'), policy('Minimum number of reviewers', 'rejected')] }), 'passed');
  assert.equal(await statusOf({ policies: [policy('Build', 'approved'), policy('Status', 'notApplicable')] }), 'passed');
  assert.equal(await statusOf({ policies: [policy('Status', 'running')] }), 'running');
  assert.equal(await statusOf({ policies: [policy('Build', 'queued')] }), 'running');
  assert.equal(await statusOf({ policies: [policy('Build', 'approved'), policy('Status', 'running')] }), 'running');
});

test('a rejected or broken Build or Status policy fails the checks and its name is listed', async () => {
  const rejected = await readAzure(azStub({ policies: [policy('Build', 'rejected'), policy('Status', 'running')] }));
  assert.equal(rejected.status, 'failed');
  assert.equal(rejected.failedCount, 1);
  assert.deepEqual(rejected.failures, ['Build']);
  const broken = await readAzure(azStub({ policies: [policy('Status', 'broken'), policy('Build', 'approved')] }));
  assert.equal(broken.status, 'failed');
  assert.deepEqual(broken.failures, ['Status']);
  const both = await readAzure(azStub({ policies: [policy('Build', 'rejected'), policy('Status', 'broken')] }));
  assert.equal(both.failedCount, 2);
  assert.deepEqual([...both.failures].sort(), ['Build', 'Status']);
});

test('the head is the merge source commit, lowercased, and a missing one throws', async () => {
  const upper = await readAzure(azStub({ pr: shown({ lastMergeSourceCommit: { commitId: 'ABCDEF0123'.repeat(4) } }) }));
  assert.equal(upper.head, 'abcdef0123'.repeat(4));
  await assert.rejects(readAzure(azStub({ pr: shown({ lastMergeSourceCommit: null }) })), /Azure DevOps returned an incomplete PR observation/);
  await assert.rejects(readAzure(azStub({ pr: shown({ lastMergeSourceCommit: undefined }) })), /incomplete/);
});

test('a null head warns, and records nothing', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'ado-null-'));
  const store = openStore(join(directory, 'stories.db'));
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  toCi(store, 'nullhead', ORG_URL);
  const before = store.handover('nullhead').story.revision;
  const warnings = [];
  const stub = azStub({ pr: shown({ lastMergeSourceCommit: null }) });
  assert.deepEqual(await watcher.watchOnce(store, { readPr: (url, signal, posted) => reader('readAzurePr')(url, signal, posted, { run: stub.run }), warn: message => warnings.push(message) }), []);
  assert.equal(warnings.length, 1);
  assert.equal(store.handover('nullhead').story.revision, before);
});

test('reviewer votes of 10 and 5 approve and of -10 and -5 request changes, named by unique name or display name', async () => {
  const pr = shown({ reviewers: [
    { vote: 10, uniqueName: 'a@example.test', displayName: 'A' },
    { vote: 5, displayName: 'Bee' },
    { vote: -10, uniqueName: 'c@example.test', displayName: 'C' },
    { vote: -5, uniqueName: 'd@example.test', displayName: 'D' },
    { vote: 0, uniqueName: 'e@example.test', displayName: 'E' },
    { vote: -5, displayName: 'Fee' },
  ] });
  const { review } = await readAzure(azStub({ pr }));
  assert.deepEqual([...review.approvals].sort(), ['Bee', 'a@example.test']);
  assert.deepEqual([...review.changesRequested].sort(), ['Fee', 'c@example.test', 'd@example.test']);
  assert.equal(review.earlier, 0);
  assert.equal(review.more, false);
});

const BUILD_SERVICE = 'Build\\Project Collection Build Service';

function threads() {
  return [
    discussion(5, 'active', [note(1, author('dev@example.test', 'Dev'), 'Rename this helper.'), note(2, author('lead@example.test', 'Lead'), 'Agreed.', { publishedDate: at(11), lastUpdatedDate: at(11) })],
      onFile('/src/widget.mjs', 12)),
    discussion(6, 'pending', [note(1, author(BUILD_SERVICE, 'Project Collection Build Service'), 'Coverage dropped by 0.2%.', { publishedDate: at(20), lastUpdatedDate: at(25) })]),
    discussion(7, 'active', [note(1, author(BUILD_SERVICE), 'Policy status has been updated', { commentType: 'system', publishedDate: at(30), lastUpdatedDate: at(30) })]),
    discussion(8, 'fixed', [note(1, author('dev@example.test'), 'Already handled.')], onFile('/src/old.mjs', 3)),
    discussion(9, 'closed', [note(1, author('dev@example.test'), 'Not needed.')]),
  ];
}

const plain = items => JSON.parse(JSON.stringify(items));

test('active and pending threads with a person or bot comment are unresolved items, newest last comment first', async () => {
  const { review } = await readAzure(azStub({ threads: threads() }));
  assert.equal(review.unresolved, 2);
  assert.deepEqual(review.keys, ['6/1', '5/2']);
  assert.deepEqual(plain(review.items), [
    { key: '6/1', kind: 'comment', author: BUILD_SERVICE, bot: true, excerpt: 'Coverage dropped by 0.2%.', url: ORG_URL + '?discussionId=6' },
    { key: '5/2', kind: 'thread', author: 'dev@example.test', bot: false, path: '/src/widget.mjs', line: 12, excerpt: 'Rename this helper.', url: ORG_URL + '?discussionId=5' },
  ]);
  assert.equal(review.lastActivityAt, at(25));
});

test('a thread holding only system comments is not counted', async () => {
  const { review } = await readAzure(azStub({ threads: [threads()[2]] }));
  assert.equal(review.unresolved, 0);
  assert.deepEqual(review.items, []);
  assert.deepEqual(review.keys, []);
});

test('a thread whose last comment the worker posted is skipped as an item', async () => {
  const { review } = await readAzure(azStub({ threads: threads() }), { posted: ['5/2'] });
  assert.deepEqual(review.keys, ['6/1']);
  assert.deepEqual(review.items.map(item => item.key), ['6/1']);
  const earlier = await readAzure(azStub({ threads: threads() }), { posted: ['5/1'] });
  assert.deepEqual(earlier.review.keys, ['6/1', '5/2'], 'only the last comment id counts');
});

test('an author becomes its unique name or display name string, and only a non-email unique name is a bot', async () => {
  const many = [
    discussion(1, 'active', [note(1, author('person@example.test', 'Person'), 'Human.')]),
    discussion(2, 'active', [note(1, author('svc-bot', 'Service'), 'Automated.', { publishedDate: at(15), lastUpdatedDate: at(15) })]),
  ];
  const { review } = await readAzure(azStub({ threads: many }));
  const byKey = Object.fromEntries(review.items.map(item => [item.key, item]));
  assert.equal(typeof byKey['1/1'].author, 'string');
  assert.equal(byKey['1/1'].author, 'person@example.test');
  assert.equal(byKey['1/1'].bot, false);
  assert.equal(byKey['2/1'].author, 'svc-bot');
  assert.equal(byKey['2/1'].bot, true);
});

test('no more than ten items are listed, and every key is kept', async () => {
  const eleven = Array.from({ length: 11 }, (_, n) => discussion(n + 1, 'active', [note(1, author('p@example.test'), 'Item ' + n, { publishedDate: at(n), lastUpdatedDate: at(n) })]));
  const { review } = await readAzure(azStub({ threads: eleven }));
  assert.equal(review.unresolved, 11);
  assert.equal(review.items.length, 10);
  assert.equal(review.keys.length, 11);
});

test('uppercase project and repository GUIDs are accepted and reach the thread read', async () => {
  const pr = shown({ repository: { id: REPO_ID.toUpperCase(), name: 'repo', webUrl: 'https://dev.azure.com/org/Proj/_git/repo', project: { id: PROJECT_ID.toUpperCase(), name: 'Proj' } } });
  const stub = azStub({ pr });
  await readAzure(stub);
  const invoke = stub.calls.map(([, args]) => args).find(args => consecutive(args, 'devops', 'invoke'));
  assert.ok(invoke.some(argument => argument.toLowerCase() === 'project=' + PROJECT_ID), invoke.join(' '));
  assert.ok(invoke.some(argument => argument.toLowerCase() === 'repositoryid=' + REPO_ID));
});

test('an id that is not a GUID throws before the thread read starts', async () => {
  for (const [label, repository] of [
    ['project', { id: REPO_ID, webUrl: 'https://dev.azure.com/org/Proj/_git/repo', project: { id: 'Proj & more' } }],
    ['repository', { id: 'repo id', webUrl: 'https://dev.azure.com/org/Proj/_git/repo', project: { id: PROJECT_ID } }],
    ['missing', { id: undefined, webUrl: 'https://dev.azure.com/org/Proj/_git/repo', project: { id: PROJECT_ID } }],
  ]) {
    const stub = azStub({ pr: shown({ repository }) });
    await assert.rejects(readAzure(stub), undefined, label);
    assert.ok(stub.calls.every(([, args]) => !consecutive(args, 'devops', 'invoke')), label + ': az devops invoke ran');
  }
});

test('an Azure DevOps answer for another repository or id throws', async () => {
  const other = webUrl => azStub({ pr: shown({ repository: { id: REPO_ID, webUrl, project: { id: PROJECT_ID } } }) });
  await assert.rejects(readAzure(other('https://dev.azure.com/org/Proj/_git/other')), /Azure DevOps returned a different PR/);
  await assert.rejects(readAzure(other('https://dev.azure.com/org/Elsewhere/_git/repo')), /different PR/);
  await assert.rejects(readAzure(azStub({ pr: shown({ pullRequestId: 13 }) })), /different PR/);
});

test('a visualstudio.com pull request whose webUrl is on dev.azure.com is the same pull request', async () => {
  const url = 'https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12';
  const observation = await readAzure(azStub(), { url });
  assert.equal(observation.head, HEAD);
  assert.equal(observation.review.items.length, 0);
});

test('an organization that breaks the naming rule throws before any az call', async () => {
  for (const url of [
    'https://dev.azure.com/bad_org/Proj/_git/repo/pullrequest/12',
    'https://dev.azure.com/-org/Proj/_git/repo/pullrequest/12',
    'https://dev.azure.com/org-/Proj/_git/repo/pullrequest/12',
    'https://dev.azure.com/org%20x/Proj/_git/repo/pullrequest/12',
  ]) {
    const stub = azStub();
    await assert.rejects(readAzure(stub, { url }), undefined, url);
    assert.deepEqual(stub.calls, [], url + ': az started');
  }
});

test('a GitHub address is not an Azure DevOps read', async () => {
  const stub = azStub();
  await assert.rejects(readAzure(stub, { url: 'https://github.com/o/r/pull/3' }));
  assert.deepEqual(stub.calls, []);
});

const GUID_ARGS = ['devops', 'invoke', '--area', 'git', '--resource', 'pullRequestThreads', '--route-parameters',
  'project=' + PROJECT_ID, 'repositoryId=' + REPO_ID, 'pullRequestId=12', '--api-version', '7.1', '--org', 'https://dev.azure.com/org', '-o', 'json'];

function execStub(calls, stdout = '{"ok":true}') {
  return async (...args) => {
    calls.push(args);
    return { stdout, stderr: '' };
  };
}

test('on Windows the az runner refuses an argument a shell could reinterpret before anything starts', async () => {
  const runAz = reader('runAz');
  for (const bad of ['project=a b', 'x"y', 'a&b', 'a|b', 'a%PATH%', 'a^b', 'a>b', 'a;b', 'a(b', '', 'a\nb']) {
    const calls = [];
    await assert.rejects(runAz('az', ['devops', 'invoke', '--route-parameters', bad], { platform: 'win32', exec: execStub(calls) }),
      error => /Refused an az argument/.test(error.message), JSON.stringify(bad));
    assert.deepEqual(calls, [], JSON.stringify(bad) + ' reached exec');
  }
});

test('on Windows the az runner passes one command string to a shell and lets = through', async () => {
  const runAz = reader('runAz');
  const calls = [];
  const answer = await runAz('az', GUID_ARGS, { platform: 'win32', exec: execStub(calls, '{"count":0,"value":[]}') });
  assert.equal(answer.stdout, '{"count":0,"value":[]}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'az ' + GUID_ARGS.join(' '));
  assert.ok(calls[0][0].includes('project=' + PROJECT_ID));
  const options = calls[0].at(-1);
  assert.equal(options.shell, true);
  assert.equal(options.windowsHide, true);
});

test('off Windows the az runner starts az without a shell and passes arguments as they are', async () => {
  const runAz = reader('runAz');
  const calls = [];
  const args = [...GUID_ARGS, 'a&b'];
  await runAz('az', args, { platform: 'linux', exec: execStub(calls) });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'az');
  assert.deepEqual(calls[0][1], args);
  assert.notEqual(calls[0].at(-1).shell, true);
});

test('the az runner keeps the timeout, buffer and abort signal of the GitHub reader', async () => {
  const runAz = reader('runAz');
  const calls = [];
  const controller = new AbortController();
  await runAz('az', GUID_ARGS, { platform: 'linux', exec: execStub(calls), signal: controller.signal });
  const options = calls[0].at(-1);
  assert.equal(options.signal, controller.signal);
  assert.equal(options.timeout, 15000);
  assert.equal(options.maxBuffer, 16 * 1024 * 1024);
  assert.equal(options.windowsHide, true);
});

function toCi(store, story, url) {
  store.record({ story, key: story + '-start', type: 'create', title: 'T ' + story, detail: 'Brief.', branch: story, worktree: '/w/' + story, harness: 'Codex' });
  const record = (type, input = {}) => {
    const { revision } = store.snapshot().find(item => item.id === story);
    return store.record({ story, type, revision, key: story + '-' + revision, ...input });
  };
  record('handoff', { detail: 'Context pack ready.' });
  record('plan', { detail: 'Plan.' });
  record('approve');
  record('handoff', { detail: 'Tests ready.' });
  record('handoff', { detail: 'Valid red.', command: 'npm test' });
  record('handoff', { detail: 'Verified green.', command: 'npm test' });
  record('handoff', { detail: 'Gates passed.', command: 'node --test' });
  record('handoff', { detail: 'No survivors.', command: 'npx stryker run' });
  record('handoff', { detail: 'Reviewed.' });
  record('comparison-choice', { run: false });
  record('pr-opened', { url });
  return record;
}

const windowsOnly = { skip: process.platform !== 'win32' && 'a stand-in az.cmd runs only on Windows' };

function withStandIn(answers, body) {
  return async () => {
    const folder = mkdtempSync(join(tmpdir(), 'az-pr-standin-'));
    const log = join(folder, 'argv.log');
    const savedPath = process.env.PATH;
    try {
      mkdirSync(folder, { recursive: true });
      writeFileSync(log, '');
      writeFileSync(join(folder, 'az-standin.mjs'), [
        "import { appendFileSync } from 'node:fs';",
        'const args = process.argv.slice(2);',
        `appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');`,
        `const answers = ${JSON.stringify(answers)};`,
        "const joined = args.slice(0, 4).join(' ');",
        "const key = joined.startsWith('repos pr policy') ? 'policies' : joined.startsWith('repos pr show') ? 'show' : joined.startsWith('devops invoke') ? 'threads' : null;",
        'if (key === null) { process.stderr.write("unexpected " + args.join(" ")); process.exit(2); }',
        'console.log(JSON.stringify(answers[key]));',
      ].join('\n'));
      writeFileSync(join(folder, 'az.cmd'), `@"${process.execPath}" "%~dp0az-standin.mjs" %*\r\n`);
      process.env.PATH = folder + delimiter + savedPath;
      await body(() => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
    } finally {
      process.env.PATH = savedPath;
      rmSync(folder, { recursive: true, force: true });
    }
  };
}

const standInAnswers = { show: shown(), policies: [policy('Build', 'approved')], threads: { count: 1, value: [discussion(5, 'active', [note(1, author('dev@example.test'), 'Rename this.')], onFile('/a.mjs', 3))] } };

test('on Windows the stand-in az receives each = of the thread read intact', windowsOnly, withStandIn(standInAnswers, async logged => {
  const observation = await reader('readAzurePr')(ORG_URL, undefined, []);
  assert.equal(observation.status, 'passed');
  assert.equal(observation.review.unresolved, 1);
  const invoke = logged().find(args => args[0] === 'devops' && args[1] === 'invoke');
  assert.ok(invoke, 'az devops invoke never ran');
  assert.ok(consecutive(invoke, '--route-parameters', 'project=' + PROJECT_ID, 'repositoryId=' + REPO_ID, 'pullRequestId=12'), JSON.stringify(invoke));
  assert.ok(consecutive(invoke, '--api-version', '7.1'));
}));

test('on Windows Hawkeye reads an Azure DevOps pull request through the stand-in az without an injected reader', windowsOnly, withStandIn(standInAnswers, async logged => {
  const directory = mkdtempSync(join(tmpdir(), 'ado-sweep-'));
  const store = openStore(join(directory, 'stories.db'));
  try {
    toCi(store, 'sweep', ORG_URL);
    await watcher.watchOnce(store, { warn: message => assert.fail(message) });
    const { prObservation } = store.handover('sweep').story;
    assert.equal(prObservation.head, HEAD);
    assert.equal(prObservation.status, 'passed');
    assert.ok(logged().length >= 3);
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
}));
