import assert from 'node:assert/strict';
import { test } from 'node:test';

const loaded = await import('./pull-request-url.mjs').catch(() => null);

function recognise(url) {
  assert.ok(loaded, 'mission-console/pull-request-url.mjs does not exist');
  assert.equal(typeof loaded.pullRequestUrl, 'function', 'pull-request-url.mjs does not export pullRequestUrl(url)');
  return loaded.pullRequestUrl(url);
}

const github = 'https://github.com/o/r/pull/3';

test('every GitHub spelling of one pull request reduces to its canonical address', () => {
  for (const url of [
    github,
    github + '/',
    github + '/files',
    github + '/commits/abc123',
    github + '/checks?check_run_id=1',
    github + '#discussion_r1',
    github + '?diff=split#issuecomment-2',
  ]) {
    const found = recognise(url);
    assert.equal(found?.kind, 'github', url);
    assert.equal(found.canonical, github, url);
    assert.equal(found.host, 'github.com', url);
  }
});

test('GitHub Enterprise is any other host with the pull request path', () => {
  const found = recognise('https://ghe.example.com/o/r/pull/3/files');
  assert.equal(found?.kind, 'github');
  assert.equal(found.host, 'ghe.example.com');
  assert.equal(found.canonical, 'https://ghe.example.com/o/r/pull/3');
});

test('a GitHub host is lowercased and the key ignores owner and repository case', () => {
  const upper = recognise('https://GitHub.com/O/R/pull/3#x');
  assert.equal(upper.canonical, 'https://github.com/O/R/pull/3');
  assert.equal(upper.key, recognise(github).key);
  assert.notEqual(recognise('https://github.com/o/r/pull/30').key, recognise(github).key);
  assert.notEqual(recognise('https://github.com/o/r/pull/4').key, recognise(github).key);
  assert.notEqual(recognise('https://ghe.example.com/o/r/pull/3').key, recognise(github).key, 'the same path on another host is another pull request');
});

const azure = 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/12';
const legacy = 'https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12';

test('Azure DevOps addresses reduce to their host and the path up to the pull request id', () => {
  for (const url of [azure, azure + '/', azure + '?_a=files', azure + '/files#x', azure + '?_a=overview&discussionId=4']) {
    const found = recognise(url);
    assert.equal(found?.kind, 'azure-devops', url);
    assert.equal(found.canonical, azure, url);
    assert.equal(found.host, 'dev.azure.com', url);
  }
  for (const url of [legacy, legacy + '#x', legacy + '/']) {
    const found = recognise(url);
    assert.equal(found?.kind, 'azure-devops', url);
    assert.equal(found.canonical, legacy, url);
    assert.equal(found.host, 'org.visualstudio.com', url);
  }
  assert.equal(recognise('https://org.visualstudio.com/Proj/_git/repo/pullrequest/12?_a=files').canonical,
    'https://org.visualstudio.com/Proj/_git/repo/pullrequest/12');
});

test('both Azure DevOps hosts share one key, ignoring case, and another id or repository does not', () => {
  const key = recognise(azure).key;
  assert.equal(recognise(legacy).key, key);
  assert.equal(recognise('https://org.visualstudio.com/Proj/_git/repo/pullrequest/12').key, key);
  assert.equal(recognise('https://dev.azure.com/ORG/proj/_git/REPO/pullrequest/12/').key, key);
  assert.equal(key, 'azure:org/proj/repo/12');
  assert.notEqual(recognise('https://dev.azure.com/org/Proj/_git/repo/pullrequest/120').key, key);
  assert.notEqual(recognise('https://dev.azure.com/org/Proj/_git/other/pullrequest/12').key, key);
  assert.notEqual(recognise('https://dev.azure.com/org/Other/_git/repo/pullrequest/12').key, key);
  assert.notEqual(recognise('https://dev.azure.com/other/Proj/_git/repo/pullrequest/12').key, key);
});

test('an Azure DevOps project name with a space keeps the encoding the URL parser gives it', () => {
  const found = recognise('https://dev.azure.com/org/My Proj/_git/repo/pullrequest/12');
  assert.equal(found.canonical, 'https://dev.azure.com/org/My%20Proj/_git/repo/pullrequest/12');
  assert.equal(found.key, recognise('https://dev.azure.com/org/My%20Proj/_git/repo/pullrequest/12').key);
  assert.equal(found.key, 'azure:org/my proj/repo/12');
});

test('a GitHub-shaped path on an Azure DevOps host is not a GitHub pull request', () => {
  assert.notEqual(recognise('https://dev.azure.com/o/r/pull/3')?.kind, 'github');
  assert.notEqual(recognise('https://org.visualstudio.com/o/r/pull/3')?.kind, 'github');
});

test('a github.com or dev.azure.com URL that is not a pull request is named as such', () => {
  for (const url of [
    'https://github.com/o/r/issues/3',
    'https://github.com/o/r',
    'https://github.com/o/r/pull',
    'https://github.com/o/r/pull/',
    'https://github.com/',
    'https://dev.azure.com/org/Proj/_git/repo',
    'https://dev.azure.com/org/Proj/_git/repo/pullrequests',
    'https://dev.azure.com/org',
  ]) {
    assert.deepEqual(recognise(url), { kind: 'not-a-pr' }, url);
  }
});

test('a number that is not exactly a pull request number is never a recognised pull request', () => {
  for (const url of ['https://ghe.example.com/o/r/pull/30x', 'https://ghe.example.com/o/r/pull/0', 'https://ghe.example.com/o/r/pull/03']) {
    assert.equal(recognise(url), null, url);
  }
  for (const url of ['https://github.com/o/r/pull/30x', 'https://github.com/o/r/pull/0', 'https://github.com/o/r/pull/03',
    'https://dev.azure.com/org/Proj/_git/repo/pullrequest/0', 'https://dev.azure.com/org/Proj/_git/repo/pullrequest/12x']) {
    const found = recognise(url);
    assert.ok(found === null || found.kind === 'not-a-pr', url + ' must not be recognised as a pull request');
  }
});

test('other forges, other protocols and credentials give null', () => {
  for (const url of [
    'https://gitlab.example.com/o/r/-/merge_requests/3',
    'https://gitlab.com/o/r/-/merge_requests/3',
    'https://bitbucket.org/o/r/pull-requests/3',
    'http://github.com/o/r/pull/3',
    'http://ghe.example.com/o/r/pull/3',
    'https://user@github.com/o/r/pull/3',
    'https://user:secret@ghe.example.com/o/r/pull/3',
    'https://user@dev.azure.com/org/Proj/_git/repo/pullrequest/12',
    'ftp://github.com/o/r/pull/3',
    'not a url',
    '',
    undefined,
    null,
    42,
  ]) {
    assert.equal(recognise(url), null, String(url));
  }
});

test('the rule throws nothing for any input', () => {
  for (const url of ['https://', 'https://github.com:99999/o/r/pull/3', '//github.com/o/r/pull/3', 'https://github.com/o/r/pull/3\n/files', {}, []]) {
    assert.doesNotThrow(() => recognise(url), String(url));
  }
});

test('an Azure DevOps address without a project segment takes the repository name as the project, on both hosts', () => {
  const key = 'azure:org/repo/repo/12';
  const long = 'https://dev.azure.com/org/_git/repo/pullrequest/12';
  const short = 'https://org.visualstudio.com/_git/repo/pullrequest/12';
  const collection = 'https://org.visualstudio.com/DefaultCollection/_git/repo/pullrequest/12';
  for (const [url, host] of [[long, 'dev.azure.com'], [short, 'org.visualstudio.com'], [collection, 'org.visualstudio.com']]) {
    for (const spelling of [url, url + '/', url + '?_a=files', url + '/files#x']) {
      const found = recognise(spelling);
      assert.equal(found?.kind, 'azure-devops', spelling);
      assert.equal(found.canonical, url, spelling);
      assert.equal(found.host, host, spelling);
      assert.equal(found.org, 'org', spelling);
      assert.equal(found.key, key, spelling);
    }
  }
  assert.equal(recognise('https://dev.azure.com/org/repo/_git/repo/pullrequest/12').key, key);
  assert.equal(recognise('https://dev.azure.com/ORG/_git/REPO/pullrequest/12').key, key);
  assert.notEqual(recognise('https://dev.azure.com/org/_git/repo/pullrequest/120').key, key);
  assert.notEqual(recognise('https://dev.azure.com/org/_git/other/pullrequest/12').key, key);
});

test('a project-less dev.azure.com address that is not a pull request is still refused', () => {
  assert.equal(recognise('https://dev.azure.com/org/_git/repo')?.kind, 'not-a-pr');
  assert.equal(recognise('https://dev.azure.com/org/_git/repo/pullrequests')?.kind, 'not-a-pr');
});
