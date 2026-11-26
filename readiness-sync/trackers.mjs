import { execFileSync } from 'node:child_process';

const words = args => {
  const flag = args.findIndex(arg => arg.startsWith('-'));
  return flag < 0 ? args : args.slice(0, flag);
};
const writesThroughApi = args => args.some(arg => /^-[XfF]|^--(method|field|raw-field|input)(=|$)/.test(arg));
const readCommands = {
  gh: args => (args[0] === 'api' && !writesThroughApi(args)) || (['issue', 'pr'].includes(args[0]) && ['view', 'list'].includes(args[1])),
  az: args => ['show', 'list'].includes(words(args).at(-1)),
};

export function readOnly(run) {
  return (command, args) => {
    if (!readCommands[command]?.(args)) throw new Error(`Refused "${command} ${args.join(' ')}": a readiness check only reads its tracker.`);
    return run(command, args);
  };
}

const safeArgument = /^[A-Za-z0-9._:/-]+$/;
const outputOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };

export function runJson(command, args, { platform = process.platform, exec = execFileSync } = {}) {
  if (platform === 'win32' && command === 'az') {
    const unsafe = args.find(arg => !safeArgument.test(arg));
    if (unsafe !== undefined) throw new Error(`Refused an az argument that a Windows shell could reinterpret: ${JSON.stringify(unsafe)}`);
    return JSON.parse(exec(`az ${args.join(' ')}`, { ...outputOptions, shell: true }));
  }
  return JSON.parse(exec(command, args, { ...outputOptions, shell: false }));
}

const digits = /^[0-9]+$/;
const organizationName = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;

export const trackers = {
  'azure-devops': {
    reads: 'command-line',
    command: 'az',
    needs: ['organization', 'project'],
    invalid: settings => organizationName.test(settings.organization) ? undefined
      : `readiness.organization "${settings.organization}" is not a valid Azure DevOps organization name: use letters, digits and hyphens, starting and ending with a letter or digit. Run the ai-sdlc-setup skill.`,
    read(id, settings, run = runJson) {
      if (!digits.test(String(id))) throw new Error(`The story id "${id}" is not all digits.`);
      if (!organizationName.test(settings.organization)) throw new Error(`The organization "${settings.organization}" is not a valid Azure DevOps organization name.`);
      run = readOnly(run);
      const org = `https://dev.azure.com/${settings.organization}`;
      const az = (...args) => run('az', [...args, '--org', org, '-o', 'json']);
      const who = identity => identity ? identity.uniqueName ?? identity.displayName : undefined;
      const user = run('az', ['account', 'show', '--query', 'user.name', '-o', 'json']);
      const story = az('boards', 'work-item', 'show', '--id', String(id), '--expand', 'relations');
      const relations = story.relations ?? [];
      const skippedRelations = [];
      const tail = url => url.split(/[/%]/).filter(Boolean).pop();
      const taskId = url => { const last = tail(url); return digits.test(last ?? '') ? last : undefined; };
      const prId = url => {
        try { const last = decodeURIComponent(url).split('/').pop(); return digits.test(last) ? last : undefined; } catch { return undefined; }
      };
      const tasks = [];
      for (const relation of relations.filter(relation => relation.rel === 'System.LinkTypes.Hierarchy-Forward')) {
        const url = typeof relation.url === 'string' ? relation.url : null;
        const number = url === null ? undefined : taskId(url);
        if (number === undefined) { skippedRelations.push({ kind: 'task', url }); continue; }
        const task = az('boards', 'work-item', 'show', '--id', number);
        const assigned = task.fields['System.AssignedTo'];
        tasks.push({ id: task.id, title: task.fields['System.Title'], state: task.fields['System.State'], assignee: who(assigned), assigneeName: assigned?.displayName });
      }
      const prs = [];
      for (const relation of relations.filter(relation => typeof relation.url === 'string' && relation.url.includes('/Git/PullRequestId/'))) {
        const number = prId(relation.url);
        if (number === undefined) { skippedRelations.push({ kind: 'pr', url: relation.url }); continue; }
        const pr = az('repos', 'pr', 'show', '--id', number);
        prs.push({ id: pr.pullRequestId, status: pr.status, target: pr.targetRefName.replace('refs/heads/', ''), linked: true });
      }
      const effort = story.fields[settings.effortField ?? 'Microsoft.VSTS.Scheduling.StoryPoints'];
      return { user, story: { id, assignee: who(story.fields['System.AssignedTo']), effort: effort ?? settings.unestimatedValue ?? null }, tasks, prs, skippedRelations };
    },
  },
  github: {
    reads: 'command-line',
    command: 'gh',
    needs: [],
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
