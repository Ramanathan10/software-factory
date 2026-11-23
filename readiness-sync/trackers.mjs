// The one table of work trackers: how each one's story is read into the snapshot engine.mjs evaluates.
import { execFileSync } from 'node:child_process';

const words = args => {
  const flag = args.findIndex(arg => arg.startsWith('-'));
  return flag < 0 ? args : args.slice(0, flag);
};
const writesThroughApi = args => args.some(arg => /^(-X|--method|-f|-F|--field|--raw-field|--input)(=|$)/.test(arg));
const readCommands = {
  gh: args => (args[0] === 'api' && !writesThroughApi(args)) || (['issue', 'pr'].includes(args[0]) && ['view', 'list'].includes(args[1])),
  az: args => ['show', 'list'].includes(words(args).at(-1)),
};

// Wraps `run` so a tracker reader can run only commands that read. A readiness check never changes a story.
export function readOnly(run) {
  return (command, args) => {
    if (!readCommands[command]?.(args)) throw new Error(`Refused "${command} ${args.join(' ')}": a readiness check only reads its tracker.`);
    return run(command, args);
  };
}

// On Windows `az` is a script, which needs a shell, and a shell needs each argument quoted.
function runJson(command, args) {
  const shell = process.platform === 'win32' && command === 'az';
  return JSON.parse(execFileSync(command, shell ? args.map(arg => `"${arg}"`) : args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell }));
}

// One row per tracker, keyed by the name the profile's `readiness.tracker` holds.
// `reads` is 'command-line' when `command` can read a story, in which case `read(id, settings, run)`
// returns the snapshot; `run(command, args)` returns the program's parsed JSON output and is passed in so
// tests can stand in for the program. `reads` is 'in-app' when only the agent's own tools for that tracker
// can read a story: the agent builds the snapshot from what `supply` describes and passes it in.
export const trackers = {
  'azure-devops': {
    reads: 'command-line',
    command: 'az',
    needs: ['organization', 'project'],
    read(id, settings, run = runJson) {
      run = readOnly(run);
      const org = `https://dev.azure.com/${settings.organization}`;
      const az = (...args) => run('az', [...args, '--org', org, '-o', 'json']);
      // People are compared by uniqueName, which is stable; a display name is the fallback.
      const who = identity => identity ? identity.uniqueName ?? identity.displayName : undefined;
      const user = run('az', ['account', 'show', '--query', 'user.name', '-o', 'json']);
      const story = az('boards', 'work-item', 'show', '--id', String(id), '--expand', 'relations');
      const relations = story.relations ?? [];
      const tail = url => url.split(/[/%]/).filter(Boolean).pop();
      const tasks = relations.filter(relation => relation.rel === 'System.LinkTypes.Hierarchy-Forward').map(relation => {
        const task = az('boards', 'work-item', 'show', '--id', tail(relation.url));
        const assigned = task.fields['System.AssignedTo'];
        return { id: task.id, title: task.fields['System.Title'], state: task.fields['System.State'], assignee: who(assigned), assigneeName: assigned?.displayName };
      });
      const prs = relations.filter(relation => relation.url.includes('/Git/PullRequestId/')).map(relation => {
        const pr = az('repos', 'pr', 'show', '--id', decodeURIComponent(relation.url).split('/').pop());
        return { id: pr.pullRequestId, status: pr.status, target: pr.targetRefName.replace('refs/heads/', ''), linked: true };
      });
      const effort = story.fields[settings.effortField ?? 'Microsoft.VSTS.Scheduling.StoryPoints'];
      return { user, story: { id, assignee: who(story.fields['System.AssignedTo']), effort: effort ?? settings.unestimatedValue ?? null }, tasks, prs };
    },
  },
  github: {
    reads: 'command-line',
    command: 'gh',
    needs: [],
    // The story is an issue in `settings.repository` (owner/name), its tasks are its sub-issues, and its
    // pull requests are the ones that close it. GitHub issues carry no effort, so `effortSet` never passes.
    read(id, settings, run = runJson) {
      run = readOnly(run);
      const repo = ['--repo', settings.repository];
      const user = run('gh', ['api', 'user']).login;
      const issue = run('gh', ['issue', 'view', String(id), ...repo, '--json', 'number,assignees,subIssues,closedByPullRequestsReferences']);
      const assignees = (issue.assignees ?? []).map(person => person.login);
      const tasks = (issue.subIssues?.nodes ?? issue.subIssues ?? []).map(task => ({ id: task.number, title: task.title, state: task.state === 'CLOSED' || task.closed ? 'Closed' : 'Open' }));
      const prs = (issue.closedByPullRequestsReferences ?? []).map(reference => {
        const pr = run('gh', ['pr', 'view', String(reference.number), ...repo, '--json', 'number,state,baseRefName']);
        const status = { MERGED: 'completed', OPEN: 'active', CLOSED: 'abandoned' }[pr.state] ?? 'active';
        return { id: pr.number, status, target: pr.baseRefName, linked: true };
      });
      // Assigned to the signed-in person counts even when others are assigned too.
      const assignee = assignees.find(login => login.toLowerCase() === String(user).toLowerCase()) ?? assignees[0];
      return { user, story: { id, assignee, effort: null }, tasks, prs };
    },
  },
  linear: {
    reads: 'in-app',
    needs: [],
    supply: 'Read the issue with your Linear tools and pass a snapshot: user (the signed-in person), story { id, assignee, effort: the estimate }, ' +
      'tasks (its sub-issues, each { id, title, state, assignee }), and prs (its attached pull requests, each { id, status: active | completed | abandoned, target: the base branch, linked: true }).',
  },
};
