import test from 'node:test';
import assert from 'node:assert/strict';
import { appliesAt, checks, evaluate, withDefaults } from './engine.mjs';
import { checkStory } from './check-story.mjs';
import { trackers } from './trackers.mjs';

const settings = {
  tracker: 'azure-devops', organization: 'your-org', project: 'Your Project',
  checklist: ['testsPass', 'tasksClosed', 'prMergedToTarget', 'prLinked', 'effortSet', 'userConfirm'],
  closedTaskStates: ['Closed'], unestimatedValue: -1,
  handoffTaskTitle: 'Done-Done review', handoffAssignee: 'Your Manager',
};
const base = () => ({
  user: 'the owner',
  story: { id: 1, assignee: 'the owner', effort: 3 },
  tasks: [{ id: 10, title: 'Build', state: 'Closed' }],
  prs: [{ id: 5, status: 'completed', target: 'main', linked: true }],
  testsPass: true,
});
const unmet = result => result.checklist.filter(item => !item.met).map(item => item.id);

test('merged PR with all checks asks only for handoff confirmation', () => {
  const result = evaluate(base(), settings);
  assert.deepEqual(unmet(result), ['userConfirm']);
  assert.deepEqual(result.questions.map(question => question.rule), ['doneDone']);
  assert.match(result.questions[0].text, /Confirm handoff to Your Manager/);
});

test('unestimated effort asks for effort instead of handoff', () => {
  const snapshot = base(); snapshot.story.effort = -1;
  assert.deepEqual(evaluate(snapshot, settings).questions.map(question => question.rule), ['effort']);
});

test('a story owned by someone else is untouched', () => {
  const snapshot = base(); snapshot.story.assignee = 'Other';
  const result = evaluate(snapshot, settings);
  assert.deepEqual([result.checklist, result.questions], [[], []]);
  assert.match(result.skipped, /not assigned/);
});

test('while a PR is open the checklist reports the gaps and nothing is asked', () => {
  const snapshot = base();
  snapshot.tasks = [{ id: 10, title: 'Build', state: 'Active' }];
  snapshot.prs = [{ id: 5, status: 'active', target: 'main', linked: true }];
  const result = evaluate(snapshot, settings);
  assert.deepEqual(unmet(result), ['tasksClosed', 'prMergedToTarget', 'userConfirm']);
  assert.deepEqual(result.questions, []);
});

test('a story already handed off is not asked about again, matching the person by either name', () => {
  const snapshot = base();
  snapshot.tasks.push({ id: 11, title: 'Done-Done review', state: 'Closed', assignee: 'manager@example.test', assigneeName: 'your manager' });
  const result = evaluate(snapshot, settings);
  assert.equal(result.handedOff, true);
  assert.deepEqual(result.questions, []);
});

test('task states are compared without regard to case, and only the chosen checks are listed', () => {
  const snapshot = base(); snapshot.tasks[0].state = 'closed';
  const result = evaluate(snapshot, { tracker: 'github', checklist: ['tasksClosed', 'prLinked'] });
  assert.deepEqual(result.checklist.map(item => [item.id, item.met]), [['tasksClosed', true], ['prLinked', true]]);
});

test('defaults fill what a repository does not set, and a repository without a tracker is never checked', () => {
  const filled = withDefaults({ tracker: 'github' });
  assert.deepEqual([filled.targetBranch, filled.phases], ['main', ['ci', 'merge', 'closed']]);
  assert.ok(filled.checklist.every(id => checks.includes(id)));
  assert.equal(appliesAt('merge', filled), true);
  assert.equal(appliesAt('planning', filled), false);
  assert.equal(appliesAt('merge', withDefaults()), false);
});

// Stands in for a tracker's command-line program: answers each call from a table keyed by its arguments.
const program = answers => (command, args) => {
  const key = Object.keys(answers).find(key => [command, ...args].join(' ').includes(key));
  if (!key) throw new Error('unexpected call: ' + [command, ...args].join(' '));
  return answers[key];
};

test('Azure DevOps: the story, its child tasks and its linked pull requests become one snapshot', () => {
  const run = program({
    'account show': 'owner@example.test',
    '--id 1 --expand relations': {
      id: 1,
      fields: { 'System.AssignedTo': { uniqueName: 'owner@example.test', displayName: 'The Owner' }, 'Microsoft.VSTS.Scheduling.StoryPoints': 5 },
      relations: [
        { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://dev.azure.com/your-org/_apis/wit/workItems/10' },
        { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/proj%2Frepo%2F77' },
      ],
    },
    'work-item show --id 10': { id: 10, fields: { 'System.Title': 'Build', 'System.State': 'Closed', 'System.AssignedTo': { uniqueName: 'sam@example.test', displayName: 'Sam' } } },
    'pr show --id 77': { pullRequestId: 77, status: 'completed', targetRefName: 'refs/heads/main' },
  });
  assert.deepEqual(trackers['azure-devops'].read(1, settings, run), {
    user: 'owner@example.test',
    story: { id: 1, assignee: 'owner@example.test', effort: 5 },
    tasks: [{ id: 10, title: 'Build', state: 'Closed', assignee: 'sam@example.test', assigneeName: 'Sam' }],
    prs: [{ id: 77, status: 'completed', target: 'main', linked: true }],
  });
});

test('GitHub: the issue, its sub-issues and the pull requests that close it become one snapshot', () => {
  const run = program({
    'api user': { login: 'Owner' },
    'issue view 4': {
      number: 4, assignees: [{ login: 'someone' }, { login: 'owner' }],
      subIssues: [{ number: 6, title: 'Docs', state: 'CLOSED' }, { number: 7, title: 'Tests', state: 'OPEN' }],
      closedByPullRequestsReferences: [{ number: 9 }],
    },
    'pr view 9': { number: 9, state: 'MERGED', baseRefName: 'main' },
  });
  assert.deepEqual(trackers.github.read(4, { repository: 'acme/widgets' }, run), {
    user: 'Owner',
    story: { id: 4, assignee: 'owner', effort: null },
    tasks: [{ id: 6, title: 'Docs', state: 'Closed' }, { id: 7, title: 'Tests', state: 'Open' }],
    prs: [{ id: 9, status: 'completed', target: 'main', linked: true }],
  });
});

test('every tracker says how its stories are read', () => {
  for (const [name, tracker] of Object.entries(trackers)) {
    assert.ok(['command-line', 'in-app'].includes(tracker.reads), name);
    assert.ok(tracker.reads === 'command-line' ? tracker.command && tracker.read : tracker.supply, name);
  }
  assert.deepEqual(Object.keys(trackers), ['azure-devops', 'github', 'linear']);
});

test('the check reads the repository\'s tracker from the profile, and skips a repository without one', () => {
  const profile = { repos: { 'acme/widgets': { readiness: { tracker: 'github', checklist: ['prMergedToTarget'] } }, 'acme/plain': {} } };
  const table = { github: { reads: 'command-line', needs: [], read: (id, settings) => ({ ...base(), story: { id, assignee: 'the owner' }, seenRepository: settings.repository }) } };
  const result = checkStory({ id: 4, repo: 'acme/widgets' }, { profile, table });
  assert.deepEqual([result.tracker, result.story, result.checklist.map(item => item.id)], ['github', 4, ['prMergedToTarget']]);
  assert.match(checkStory({ id: 4, repo: 'acme/plain' }, { profile, table }).skipped, /No tracker is set for acme\/plain/);
  assert.match(checkStory({ id: 4, repo: 'acme/unknown' }, { profile, table }).skipped, /No tracker is set/);
});

test('a tracker only the agent can read asks for a snapshot, then checks the one it is given', () => {
  const profile = { repos: { 'acme/widgets': { readiness: { tracker: 'linear', checklist: ['prLinked', 'effortSet'] } } } };
  const asked = checkStory({ id: 12, repo: 'acme/widgets' }, { profile });
  assert.equal(asked.inApp, true);
  assert.match(asked.next, /Linear tools.*--snapshot/);
  const result = checkStory({ id: 12, repo: 'acme/widgets', snapshot: { ...base(), story: { id: 12, assignee: 'the owner', effort: null } } }, { profile });
  assert.deepEqual(result.checklist.map(item => [item.id, item.met]), [['prLinked', true], ['effortSet', false]]);
});

test('a tracker that needs settings the repository lacks, or an unknown tracker, is a problem', () => {
  const lacking = { repos: { 'a/b': { readiness: { tracker: 'azure-devops', organization: 'your-org' } } } };
  assert.match(checkStory({ id: 1, repo: 'a/b' }, { profile: lacking }).problem, /readiness\.project must be set for azure-devops/);
  const unknown = { repos: { 'a/b': { readiness: { tracker: 'jira' } } } };
  assert.match(checkStory({ id: 1, repo: 'a/b' }, { profile: unknown }).problem, /"jira" is not a known tracker/);
});
