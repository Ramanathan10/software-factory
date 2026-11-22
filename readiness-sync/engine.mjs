// Pure readiness rule engine: (snapshot, profile) -> { checklist, actions, questions }.
// It never writes to Azure DevOps. Callers apply `actions` according to profile.safety.mode.
// Rules mirror SKILL.md "Permitted changes" and "CRUD safety"; there is deliberately no delete action.

const closed = (profile, task) => profile.workItems.closedTaskStates.includes(task.state);
const same = (a, b) => a && b && a.toLowerCase() === b.toLowerCase();

function prRules(snapshot, profile, actions, questions) {
  const { story, tasks, prs, user } = snapshot;
  const rules = profile.prTasks;
  if (!rules.enabled) return;
  for (const pr of prs) {
    if (!pr.linked) {
      if ((pr.candidateIds ?? []).length === 1) actions.push({ rule: 'prLink', op: 'linkPr', pr: pr.id, story: story.id });
      else questions.push({ rule: 'prLink', text: `PR ${pr.id} has ${pr.candidateIds?.length ?? 0} candidate work items; link it manually.` });
      continue;
    }
    const prTask = tasks.find(t => t.title === rules.prTitle);
    if (!prTask) actions.push({ rule: 'prTask', op: 'createTask', title: rules.prTitle, assignee: user, state: pr.status === 'active' ? 'Active' : undefined });
    else if (pr.status === 'active' && prTask.state !== 'Active') actions.push({ rule: 'prTask', op: 'setState', task: prTask.id, state: 'Active' });
    else if (pr.status === 'completed' && pr.target === profile.doneDone.targetBranch && !closed(profile, prTask)) {
      actions.push({ rule: 'prTask', op: 'setState', task: prTask.id, state: 'Closed' });
    }
    for (const reviewer of pr.reviewers ?? []) {
      if (reviewer.isGroup || same(reviewer.name, user) || (!reviewer.vote && !reviewer.commented)) continue;
      if (rules.reviewerMembers.length && !rules.reviewerMembers.some(m => same(m, reviewer.name))) {
        questions.push({ rule: 'reviewTask', text: `${reviewer.name} reviewed PR ${pr.id} but is not a listed team member; create a ${rules.reviewTitle} card anyway?` });
        continue;
      }
      const task = tasks.find(t => t.title === rules.reviewTitle && same(t.assignee, reviewer.name));
      const positive = rules.positiveVotes.includes(reviewer.vote);
      if (!task) {
        actions.push({ rule: 'reviewTask', op: 'createTask', title: rules.reviewTitle, assignee: reviewer.name, state: positive ? 'Closed' : 'Active' });
      } else if (positive && !closed(profile, task)) {
        actions.push({ rule: 'reviewTask', op: 'setState', task: task.id, state: 'Closed' });
      } else if (!positive && pr.status === 'active' && closed(profile, task)) {
        actions.push({ rule: 'reviewTask', op: 'setState', task: task.id, state: 'Active' });
      }
    }
  }
}

function checklist(snapshot, profile) {
  const { story, tasks, prs } = snapshot;
  const target = profile.doneDone.targetBranch;
  const effort = story.effort;
  const noPr = snapshot.noPrConfirmed === true;
  const checks = {
    testsPass: [snapshot.testsPass === true, snapshot.testsPass === undefined ? 'no test evidence yet' : 'tests not passing'],
    tasksClosed: [tasks.length > 0 && tasks.every(t => closed(profile, t)), 'open tasks remain'],
    prMergedToTarget: [(prs.length > 0 && prs.every(p => p.status === 'completed' && p.target === target)) || noPr, `a PR is not completed into ${target}`],
    prLinked: [prs.every(p => p.linked) && (prs.length > 0 || noPr), 'a PR is not linked to the story'],
    effortSet: [effort !== undefined && effort !== null && effort !== profile.workItems.unestimatedValue, 'effort missing or unestimated'],
    userConfirm: [snapshot.handoffConfirmed === true, 'handoff not yet confirmed']
  };
  return profile.doneDone.checklist.map(id => ({ id, met: checks[id][0], reason: checks[id][0] ? '' : checks[id][1] }));
}

// Maps a console phase transition or ADO service-hook event to one story id (PCS-<ADO id>), or null if irrelevant.
export function storyIdFor(event, profile) {
  const trigger = profile.triggers;
  if (event.source === 'console') {
    if (!trigger.consolePhases.includes(event.phase)) return null;
    const m = /^PCS-(\d+)$/.exec(event.story ?? '');
    return m ? Number(m[1]) : null;
  }
  if (event.source === 'ado' && trigger.adoEvents.includes(event.type)) {
    const ids = event.workItemIds ?? [];
    return ids.length === 1 ? ids[0] : null;
  }
  return null;
}

// Event-driven entry point: one trigger -> one targeted read of the affected story -> evaluate. Read-only.
// `fetchSnapshot(storyId)` is injected (ADO MCP or az); it is never called for irrelevant events.
export async function onEvent(event, profile, fetchSnapshot) {
  const id = storyIdFor(event, profile);
  if (id === null) return { ignored: true };
  const result = evaluate(await fetchSnapshot(id), profile);
  return { story: id, mode: profile.safety.mode, ...result };
}

export function evaluate(snapshot, profile) {
  const actions = [];
  const questions = [];
  if (!same(snapshot.story.assignee, snapshot.user)) {
    return { checklist: [], actions, questions, skipped: 'story is not assigned to the signed-in user' };
  }
  prRules(snapshot, profile, actions, questions);
  const items = checklist(snapshot, profile);
  const unmet = items.filter(i => !i.met && i.id !== 'userConfirm');
  const { handoffTaskTitle, handoffAssignee } = profile.doneDone;
  const handedOff = Boolean(handoffTaskTitle) && snapshot.tasks.some(t => t.title === handoffTaskTitle && same(t.assignee, handoffAssignee));
  const merged = snapshot.prs.length > 0 && snapshot.prs.every(p => p.status === 'completed');
  if (!handedOff && merged) {
    const effort = items.find(i => i.id === 'effortSet');
    if (effort && !effort.met) questions.push({ rule: 'effort', text: `Story ${snapshot.story.id}: what effort should be assigned? (${effort.reason})` });
    else if (!unmet.length) {
      questions.push({ rule: 'doneDone', text: `Story ${snapshot.story.id} meets every Done-Done check. Confirm handoff to ${handoffAssignee || 'the reviewer'}?` });
    }
  }
  return { checklist: items, actions, questions, handedOff };
}
