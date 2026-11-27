import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../', import.meta.url);
const text = path => readFileSync(new URL(path, root), 'utf8').replace(/\s+/g, ' ');
const says = (path, ...phrases) => {
  const body = text(path);
  const missing = phrases.filter(phrase => !body.includes(phrase.replace(/\s+/g, ' ')));
  assert.deepEqual(missing, [], path + ' does not say it');
};

test('the console README says which hosts Hawkeye watches, with which CLIs, and what a failed read does', () => {
  says('mission-console/README.md',
    'Hawkeye observes pull requests on GitHub, GitHub Enterprise and Azure DevOps once the publisher registers them with `pr-opened`.',
    'with the GitHub CLI signed in to each GitHub host and, for Azure DevOps, the Azure CLI with its `azure-devops` extension',
    'The watcher polls registered PRs on github.com, GitHub Enterprise and Azure DevOps',
    '`az repos pr show`, `az repos pr policy list` and one `az devops invoke` read of the threads, where only Build and Status policies count as checks',
    'A failed read records nothing and warns, naming the CLI to check. A PR on any other host is not watched, and its `pr-opened` event says so.',
    'Hawkeye supplies evidence from the PR\'s host.',
    'does not modify the PR\'s host',
    'unavailable response from it',
    'Hawkeye polls registered GitHub, GitHub Enterprise and Azure DevOps PRs with their CLIs');
});

test('the console README documents the canonical pr-opened URL and its refusals', () => {
  says('mission-console/README.md',
    'The store keeps its canonical form, `https://<host>/<owner>/<repo>/pull/<n>` on GitHub and GitHub Enterprise or the Azure DevOps address up to `/pullrequest/<id>`, dropping any suffix, query or fragment.',
    'A github.com or dev.azure.com URL that is not a pull request is refused.',
    'A later `pr-opened` must name the same pull request, compared in canonical form without regard to case.',
    'Any other HTTPS URL is kept as given, and the event says Hawkeye does not watch it.');
  const body = text('mission-console/README.md');
  assert.ok(!body.includes('Hawkeye observes GitHub pull requests'), 'the old GitHub-only sentence is still there');
  assert.ok(!body.includes('It only reads GitHub (`gh pr view` and one `gh api graphql` query)'), 'the old GitHub-only read sentence is still there');
});

test('the Jarvis skill omits the head only when pr-opened said Hawkeye does not watch the host', () => {
  says('skills/jarvis/SKILL.md', 'omit the head only when its `pr-opened` event said Hawkeye does not watch the PR\'s host, or no watcher is running');
  assert.ok(!text('skills/jarvis/SKILL.md').includes('only when the PR is not on github.com'));
});

test('the runbook says Azure DevOps stories need unrestricted workers', () => {
  says('skills/jarvis/RUNBOOK.md', 'A story whose repository is on Azure DevOps needs `unrestricted` workers: a restricted Claude Code worker is not allowed to run `az`.');
});

test('phase 8 of the ai-sdlc skill publishes and reviews on Azure DevOps', () => {
  says('skills/ai-sdlc/SKILL.md',
    'A repository is on Azure DevOps when its `origin` is on dev.azure.com or visualstudio.com',
    'On Azure DevOps, give the comparison in words and list each file in the Evidence section; do not upload.',
    'GrepLoop runs on GitHub only; on Azure DevOps record `activity` saying the review bot was skipped.',
    '`gh pr create`, or `az repos pr create` on Azure DevOps',
    '`az repos pr list --source-branch <branch> --status active`',
    '`az repos pr create --source-branch <branch> --target-branch <default branch> --title <title> --description @<file>`',
    '`--work-items <id>`',
    '`az extension add --name azure-devops` and `az login`',
    '`repository.webUrl` + `/pullrequest/` + `pullRequestId`',
    'never its `url` field',
    '`az repos pr show --id <id>` for `repository.id` and `repository.project.id`',
    '`az devops invoke --area git --resource pullRequestThreads --route-parameters project=<project id> repositoryId=<repository id> pullRequestId=<id> --api-version 7.1`',
    'A thread without a file is a conversation comment.',
    'an author whose unique name is not an email address is a bot',
    'az devops invoke --area git --resource pullRequestThreadComments --route-parameters',
    '--http-method POST --in-file <file> --api-version 7.1',
    '--http-method PATCH',
    '`{"status":"fixed"}`',
    'Resolve a conversation-comment thread too.',
    '`<threadId>/<commentId>` in `posted`',
    'On GitHub, conversation comments get a reply only.',
    'the thread left for the rebuild keeps status `active`');
});

test('an ADR records why the watcher runs az through a shell and lets = through', () => {
  const adrs = readdirSync(new URL('docs/adr/', root)).filter(name => name.endsWith('the-watcher-runs-az-with-equals-in-its-safe-set.md'));
  assert.equal(adrs.length, 1, 'docs/adr has no 00NN-the-watcher-runs-az-with-equals-in-its-safe-set.md');
  assert.match(adrs[0], /^00(2[9]|[3-9]\d)-/, 'the ADR takes a number after 0028');
  const body = text('docs/adr/' + adrs[0]);
  for (const phrase of ['0004', '0025', '--route-parameters', 'az.cmd']) assert.ok(body.includes(phrase), 'the ADR never mentions ' + phrase);
  assert.ok(existsSync(new URL('docs/adr/README.md', root)));
  assert.ok(text('docs/adr/README.md').includes(adrs[0]), 'the ADR index has no row for ' + adrs[0]);
});
