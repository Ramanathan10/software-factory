import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import * as trackerModule from './trackers.mjs';
import { checkStory } from './check-story.mjs';

const { trackers } = trackerModule;
const azure = trackers['azure-devops'];
const settings = { tracker: 'azure-devops', organization: 'your-org', project: 'Your Project' };
const org = 'https://dev.azure.com/your-org';
const taskUrl = tail => `${org}/_apis/wit/workItems/${tail}`;
const prUrl = tail => `vstfs:///Git/PullRequestId/${tail}`;
const child = url => ({ rel: 'System.LinkTypes.Hierarchy-Forward', url });
const artifact = url => ({ rel: 'ArtifactLink', url });

const recorder = relations => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    const text = args.join(' ');
    if (text.includes('account show')) return 'owner@example.test';
    if (text.includes('--expand relations')) return { id: 1, fields: { 'System.AssignedTo': { uniqueName: 'owner@example.test' }, 'Microsoft.VSTS.Scheduling.StoryPoints': 3 }, relations };
    if (text.includes('repos pr show')) return { pullRequestId: Number(args[args.indexOf('--id') + 1]), status: 'completed', targetRefName: 'refs/heads/main' };
    const id = Number(args[args.indexOf('--id') + 1]);
    return { id, fields: { 'System.Title': `Task ${id}`, 'System.State': 'Closed' } };
  };
  return { calls, run };
};
const idsCalled = calls => calls.flatMap(call => call.includes('--id') ? [call[call.indexOf('--id') + 1]] : []);
const refuses = (read, value) => {
  const { run, calls } = recorder([]);
  assert.throws(() => read(run), error => value === '' || error.message.includes(value));
  assert.deepEqual(calls, []);
};

const runJson = (...args) => {
  assert.equal(typeof trackerModule.runJson, 'function', 'runJson is exported so its platform and process call can be chosen');
  return trackerModule.runJson(...args);
};

for (const id of ['12&34', '1 2', '', 'abc', '-1', '1.5', '12\n34', '%7']) {
  test(`a story id that is not all digits is refused before any call: ${JSON.stringify(id)}`, () => {
    refuses(run => azure.read(id, settings, run), id);
  });
}

test('a numeric story id is read', () => {
  const { run, calls } = recorder([]);
  assert.equal(azure.read(1, settings, run).story.id, 1);
  assert.equal(azure.read('15', settings, run).story.id, '15');
  assert.ok(calls.length > 0);
});

for (const organization of ['a&b', 'a b', '-a', 'a-', '', 'a%b', 'a"b', 'a.b', 'a/b', 'a|b', 'a\nb']) {
  test(`an organization that breaks the naming rules is refused before any call: ${JSON.stringify(organization)}`, () => {
    refuses(run => azure.read(1, { ...settings, organization }, run), organization);
  });
}

for (const organization of ['your-org', 'a', 'A1-b2', 'x--y']) {
  test(`an organization that follows the naming rules is read: ${organization}`, () => {
    const { run, calls } = recorder([]);
    azure.read(1, { ...settings, organization }, run);
    assert.ok(calls.every(call => call.includes(`https://dev.azure.com/${organization}`) || call.includes('account')));
  });
}

test('a child relation whose id has shell metacharacters is skipped, and the other tasks are still read', () => {
  const bad = taskUrl('11&22');
  const { run, calls } = recorder([child(bad), child(taskUrl('10'))]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.tasks.map(task => task.id), [10]);
  assert.deepEqual(snapshot.skippedRelations, [{ kind: 'task', url: bad }]);
  assert.deepEqual(idsCalled(calls), ['1', '10']);
  assert.ok(calls.flat().every(part => !part.includes('&')));
});

test('a child relation id with a percent sign is read from the last digits after the split', () => {
  const { run, calls } = recorder([child(taskUrl('bad%34'))]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.tasks.map(task => task.id), [34]);
  assert.deepEqual(snapshot.skippedRelations, []);
  assert.deepEqual(idsCalled(calls), ['1', '34']);
});

test('a child relation url with a trailing slash is read', () => {
  const { run } = recorder([child(taskUrl('10/'))]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.tasks.map(task => task.id), [10]);
  assert.deepEqual(snapshot.skippedRelations, []);
});

test('a child relation whose last piece is not digits is skipped', () => {
  const bad = taskUrl('ten');
  const { run, calls } = recorder([child(bad)]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.tasks, []);
  assert.deepEqual(snapshot.skippedRelations, [{ kind: 'task', url: bad }]);
  assert.deepEqual(idsCalled(calls), ['1']);
});

test('a child relation without a url is skipped with a null url', () => {
  const { run, calls } = recorder([{ rel: 'System.LinkTypes.Hierarchy-Forward' }, child(42), child(taskUrl('10'))]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.tasks.map(task => task.id), [10]);
  assert.deepEqual(snapshot.skippedRelations, [{ kind: 'task', url: null }, { kind: 'task', url: null }]);
  assert.deepEqual(idsCalled(calls), ['1', '10']);
});

test('a pull request relation whose id has shell metacharacters is skipped, and well-formed ones are still read', () => {
  const bad = prUrl('proj%2Frepo%2F7%267');
  const { run, calls } = recorder([artifact(bad), artifact(prUrl('proj%2Frepo%2F77'))]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.prs, [{ id: 77, status: 'completed', target: 'main', linked: true }]);
  assert.deepEqual(snapshot.skippedRelations, [{ kind: 'pr', url: bad }]);
  assert.deepEqual(idsCalled(calls), ['1', '77']);
  assert.ok(calls.flat().every(part => !part.includes('&')));
});

test('a pull request relation whose id is not all digits is skipped', () => {
  const bad = prUrl('proj%2Frepo%2Fseven');
  const { run, calls } = recorder([artifact(bad)]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.prs, []);
  assert.deepEqual(snapshot.skippedRelations, [{ kind: 'pr', url: bad }]);
  assert.deepEqual(idsCalled(calls), ['1']);
});

test('a pull request relation whose url cannot be decoded is skipped', () => {
  const bad = prUrl('proj%2Frepo%2F7%E0%A4%A');
  const { run, calls } = recorder([artifact(bad), artifact(prUrl('proj%2Frepo%2F77'))]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.prs.map(pr => pr.id), [77]);
  assert.deepEqual(snapshot.skippedRelations, [{ kind: 'pr', url: bad }]);
  assert.deepEqual(idsCalled(calls), ['1', '77']);
});

test('a relation without a url is not a pull request relation, and a relation to something else is ignored', () => {
  const { run, calls } = recorder([{ rel: 'ArtifactLink' }, { rel: 'ArtifactLink', url: 42 }, { rel: 'Hyperlink', url: 'https://example.test/page' }]);
  const snapshot = azure.read(1, settings, run);
  assert.deepEqual(snapshot.prs, []);
  assert.deepEqual(snapshot.tasks, []);
  assert.deepEqual(snapshot.skippedRelations, []);
  assert.deepEqual(idsCalled(calls), ['1']);
});

test('a bad organization is a problem for the readiness check, which reads nothing', () => {
  for (const organization of ['a&b', 'a b', '-a', 'a-', 'a%b']) {
    const profile = { repos: { 'a/b': { readiness: { ...settings, organization } } } };
    const { run, calls } = recorder([]);
    const result = checkStory({ id: 1, repo: 'a/b' }, { profile, run });
    assert.deepEqual(calls, []);
    assert.match(result.problem, /readiness\.organization/);
    assert.ok(result.problem.includes(organization));
    assert.match(result.problem, /ai-sdlc-setup/);
  }
});

test('a good organization is read by the readiness check', () => {
  const { run, calls } = recorder([]);
  const profile = { repos: { 'a/b': { readiness: { ...settings, checklist: ['prLinked'] } } } };
  const result = checkStory({ id: 1, repo: 'a/b' }, { profile, run });
  assert.equal(result.problem, undefined);
  assert.ok(calls.length > 0);
});

test('the readiness check lists the relations the reader skipped and judges the checklist as before', () => {
  const bad = taskUrl('11&22');
  const profile = { repos: { 'a/b': { readiness: { ...settings, checklist: ['tasksClosed', 'prLinked'] } } } };
  const skipped = checkStory({ id: 1, repo: 'a/b' }, { profile, run: recorder([child(bad), child(taskUrl('10'))]).run });
  assert.deepEqual(skipped.skippedRelations, [{ kind: 'task', url: bad }]);
  const clean = checkStory({ id: 1, repo: 'a/b' }, { profile, run: recorder([child(taskUrl('10'))]).run });
  assert.equal('skippedRelations' in clean, false);
  assert.deepEqual(skipped.checklist, clean.checklist);
  assert.deepEqual(skipped.questions, clean.questions);
});

test('the readiness check passes skipped relations from a snapshot through unchanged', () => {
  const profile = { repos: { 'a/b': { readiness: { tracker: 'linear', checklist: ['prLinked'] } } } };
  const snapshot = { user: 'u', story: { id: 1, assignee: 'u', effort: 1 }, tasks: [], prs: [{ id: 5, status: 'active', target: 'main', linked: true }] };
  const relations = [{ kind: 'pr', url: 'x' }, { kind: 'task', url: null }];
  assert.deepEqual(checkStory({ id: 1, repo: 'a/b', snapshot: { ...snapshot, skippedRelations: relations } }, { profile }).skippedRelations, relations);
  assert.equal('skippedRelations' in checkStory({ id: 1, repo: 'a/b', snapshot: { ...snapshot, skippedRelations: [] } }, { profile }), false);
  assert.equal('skippedRelations' in checkStory({ id: 1, repo: 'a/b', snapshot }, { profile }), false);
});

const options = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
const exec = (calls, output = '{"ok":true}') => (...call) => { calls.push(call); return output; };
const readArgs = ['boards', 'work-item', 'show', '--id', '10', '--org', org, '-o', 'json'];

const shellCharacters = ['"', '%', '^', '&', '|', '<', '>', '!', '(', ')', ',', ';', '=', ' ', '\r', '\n'];
for (const character of [...shellCharacters, '']) {
  const label = character === '' ? 'an empty argument' : `U+${character.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`;
  test(`on Windows an az argument holding ${label} is refused and nothing starts`, () => {
    const bad = character === '' ? '' : `1${character}2`;
    const calls = [];
    assert.equal(typeof trackerModule.runJson, 'function', 'runJson is exported so its platform and process call can be chosen');
    assert.throws(() => runJson('az', ['boards', 'work-item', 'show', '--id', bad], { platform: 'win32', exec: exec(calls) }),
      error => error.message.includes('Refused an az argument') && error.message.includes(JSON.stringify(bad)));
    assert.deepEqual(calls, []);
  });
}

test('on Windows safe az arguments go to the shell as one command string', () => {
  const calls = [];
  const result = runJson('az', readArgs, { platform: 'win32', exec: exec(calls, '{"id":10}') });
  assert.deepEqual(result, { id: 10 });
  assert.deepEqual(calls, [[`az ${readArgs.join(' ')}`, { ...options, shell: true }]]);
});

test('on Windows every character of the safe set is allowed in an az argument', () => {
  const calls = [];
  const args = ['abcXYZ019._:/-'];
  runJson('az', args, { platform: 'win32', exec: exec(calls) });
  assert.deepEqual(calls, [['az abcXYZ019._:/-', { ...options, shell: true }]]);
});

test('off Windows az starts without a shell and its arguments pass as they are', () => {
  const calls = [];
  const args = [...readArgs, 'a&b'];
  assert.deepEqual(runJson('az', args, { platform: 'linux', exec: exec(calls) }), { ok: true });
  assert.deepEqual(calls, [['az', args, { ...options, shell: false }]]);
});

test('on Windows a native program such as gh starts without a shell', () => {
  const calls = [];
  const args = ['issue', 'view', '4', '--repo', 'acme/widgets', '--json', 'number'];
  runJson('gh', args, { platform: 'win32', exec: exec(calls) });
  assert.deepEqual(calls, [['gh', args, { ...options, shell: false }]]);
});

const windowsOnly = { skip: process.platform !== 'win32' && 'a stand-in az.cmd runs only on Windows' };
const standIn = (folder, log) => {
  writeFileSync(join(folder, 'az-standin.mjs'), [
    "import { appendFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');`,
    'const id = Number(args[args.indexOf("--id") + 1]);',
    'let out = {};',
    'if (args[0] === "account") out = "owner@example.test";',
    'else if (args.includes("--expand")) out = { id, fields: { "System.AssignedTo": { uniqueName: "owner@example.test" }, "Microsoft.VSTS.Scheduling.StoryPoints": 3 }, relations: JSON.parse(process.env.AZ_STANDIN_RELATIONS) };',
    'else out = { id, fields: { "System.Title": "Task " + id, "System.State": "Closed" } };',
    'console.log(JSON.stringify(out));',
  ].join('\n'));
  writeFileSync(join(folder, 'az.cmd'), `@"${process.execPath}" "%~dp0az-standin.mjs" %*\r\n`);
};
const withStandIn = (relations, body) => {
  const folder = mkdtempSync(join(tmpdir(), 'az-standin-'));
  const log = join(folder, 'argv.log');
  const saved = { PATH: process.env.PATH, relations: process.env.AZ_STANDIN_RELATIONS };
  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(log, '');
    standIn(folder, log);
    process.env.PATH = folder + delimiter + saved.PATH;
    process.env.AZ_STANDIN_RELATIONS = JSON.stringify(relations);
    body(() => readFileSync(log, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)));
  } finally {
    process.env.PATH = saved.PATH;
    if (saved.relations === undefined) delete process.env.AZ_STANDIN_RELATIONS;
    else process.env.AZ_STANDIN_RELATIONS = saved.relations;
    rmSync(folder, { recursive: true, force: true });
  }
};

test('on Windows the stand-in az receives safe arguments unchanged and its JSON comes back', windowsOnly, () => {
  withStandIn([], logged => {
    const result = runJson('az', readArgs);
    assert.equal(result.id, 10);
    assert.deepEqual(logged(), [readArgs]);
  });
});

test('on Windows a story with a child id holding shell metacharacters reaches the stand-in az without that id', windowsOnly, () => {
  const bad = taskUrl('11&no-such-program');
  withStandIn([child(bad), child(taskUrl('10'))], logged => {
    const snapshot = azure.read(1, settings);
    assert.deepEqual(logged(), [
      ['account', 'show', '--query', 'user.name', '-o', 'json'],
      ['boards', 'work-item', 'show', '--id', '1', '--expand', 'relations', '--org', org, '-o', 'json'],
      ['boards', 'work-item', 'show', '--id', '10', '--org', org, '-o', 'json'],
    ]);
    assert.ok(logged().flat().every(argument => !argument.includes('&') && !argument.includes('no-such-program')));
    assert.deepEqual(snapshot.tasks.map(task => task.id), [10]);
    assert.deepEqual(snapshot.skippedRelations, [{ kind: 'task', url: bad }]);
  });
});
