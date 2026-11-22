// Read-only: node check-story.mjs <adoId|PCS-id> [--profile <file>] [--tests-pass]  (profile: readiness-profile.json in the AI SDLC home)
// Reads one story through the az CLI, builds a snapshot, prints evaluate() output as JSON. Never writes to ADO.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { evaluate } from './engine.mjs';

const az = (...args) => JSON.parse(execFileSync('az', [...args.map(a => `"${a}"`), '-o', 'json'], { shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
const id = Number(String(process.argv[2] ?? '').replace(/^PCS-/, ''));
if (!id) throw new Error('Usage: node check-story.mjs <adoId|PCS-id> [--profile <file>] [--tests-pass]  (profile: readiness-profile.json in the AI SDLC home)');
const flag = name => process.argv.indexOf(name);
const profile = JSON.parse(readFileSync(flag('--profile') > 0 ? process.argv[flag('--profile') + 1] : new URL('./profiles/default.json', import.meta.url), 'utf8'));
const { organization, project } = profile.ado;
const org = `https://dev.azure.com/${organization}`;

// Identities are compared by uniqueName (UPN), which is stable; display names are only a fallback for lookups.
const user = JSON.parse(execFileSync('az', ['account', 'show', '--query', 'user.name', '-o', 'json'], { shell: true, encoding: 'utf8' }));
const names = new Map();
const who = identity => {
  if (!identity) return undefined;
  const key = identity.uniqueName ?? identity.displayName;
  names.set(String(identity.displayName).toLowerCase(), key);
  return key;
};

const item = wid => az('boards', 'work-item', 'show', '--id', wid, '--org', org);
const relations = az('boards', 'work-item', 'show', '--id', id, '--expand', 'relations', '--org', org).relations ?? [];
const story = item(id);
const tail = url => url.split(/[/%]/).filter(Boolean).pop();
const tasks = relations.filter(r => r.rel === 'System.LinkTypes.Hierarchy-Forward').map(r => {
  const t = item(tail(r.url));
  return { id: t.id, title: t.fields['System.Title'], state: t.fields['System.State'], assignee: who(t.fields['System.AssignedTo']) };
});

const prs = relations.filter(r => r.url.includes('/Git/PullRequestId/')).map(r => {
  const [, repo, prId] = decodeURIComponent(r.url.split('/Git/PullRequestId/')[1]).split('/');
  const pr = az('repos', 'pr', 'show', '--id', prId, '--org', org);
  const threads = az('devops', 'invoke', '--area', 'git', '--resource', 'pullRequestThreads', '--route-parameters', `project=${project}`, `repositoryId=${repo}`, `pullRequestId=${prId}`, '--org', org, '--api-version', '7.1').value ?? [];
  const reviewers = pr.reviewers.map(v => ({ name: who(v), vote: v.vote, isGroup: Boolean(v.isContainer) }));
  // Commenter-only reviewers: people with a text comment who are not already in the reviewer list.
  for (const thread of threads) for (const c of thread.comments ?? []) {
    if (c.commentType === 'system') continue;
    const name = who(c.author);
    const existing = reviewers.find(v => v.name?.toLowerCase() === name?.toLowerCase());
    if (existing) existing.commented = true; else reviewers.push({ name, vote: 0, commented: true });
  }
  return { id: pr.pullRequestId, status: pr.status, target: pr.targetRefName.replace('refs/heads/', ''), linked: true, reviewers };
});

// Profile handoff assignee may be a display name; resolve to uniqueName when that person appears on the story.
const handoff = profile.doneDone?.handoffAssignee;
if (handoff && names.has(handoff.toLowerCase())) profile.doneDone.handoffAssignee = names.get(handoff.toLowerCase());

const effort = story.fields[profile.workItems.effortField];
const snapshot = {
  user,
  story: { id, assignee: who(story.fields['System.AssignedTo']), effort: effort ?? profile.workItems.unestimatedValue },
  tasks, prs,
  testsPass: flag('--tests-pass') > 0 ? true : undefined
};
console.log(JSON.stringify({ state: story.fields['System.State'], snapshot, ...evaluate(snapshot, profile) }, null, 1));
