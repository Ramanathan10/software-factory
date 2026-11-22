// Pure readiness rule engine: (snapshot, settings) -> { checklist, questions }.
// It reads nothing and writes nothing: a tracker reader in trackers.mjs builds the snapshot, and the caller
// raises each question with the owner. `settings` is the repository's `readiness` section of the AI SDLC
// profile, with defaults filled in by `withDefaults`.
//
// A snapshot is the same shape for every tracker:
//   user        who is signed in to the tracker
//   story       { id, assignee, effort }
//   tasks       [{ id, title, state, assignee, assigneeName }]   the story's child items
//   prs         [{ id, status: 'active' | 'completed' | 'abandoned', target, linked }]
//   testsPass   true when the caller has test evidence; leave out when it has none
//   noPrConfirmed, handoffConfirmed   true once the owner has said so

export const checks = ['testsPass', 'tasksClosed', 'prMergedToTarget', 'prLinked', 'effortSet', 'userConfirm'];

const defaults = {
  tracker: 'none',
  targetBranch: 'main',
  checklist: ['prMergedToTarget', 'prLinked', 'userConfirm'],
  closedTaskStates: ['Closed', 'Done'],
  unestimatedValue: null,
  handoffTaskTitle: '',
  handoffAssignee: '',
  phases: ['ci', 'merge', 'closed'],
};
export const withDefaults = (settings = {}) => ({ ...defaults, ...settings });

const same = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

function checklist(snapshot, settings) {
  const { story, tasks, prs } = snapshot;
  const target = settings.targetBranch;
  const closed = task => settings.closedTaskStates.some(state => same(state, task.state));
  const noPr = snapshot.noPrConfirmed === true;
  const results = {
    testsPass: [snapshot.testsPass === true, snapshot.testsPass === undefined ? 'no test evidence yet' : 'tests not passing'],
    tasksClosed: [tasks.length > 0 && tasks.every(closed), tasks.length ? 'open tasks remain' : 'the story has no tasks'],
    prMergedToTarget: [(prs.length > 0 && prs.every(pr => pr.status === 'completed' && pr.target === target)) || noPr, `a PR is not completed into ${target}`],
    prLinked: [prs.every(pr => pr.linked) && (prs.length > 0 || noPr), 'a PR is not linked to the story'],
    effortSet: [story.effort !== undefined && story.effort !== null && story.effort !== settings.unestimatedValue, 'effort missing or unestimated'],
    userConfirm: [snapshot.handoffConfirmed === true, 'handoff not yet confirmed'],
  };
  return settings.checklist.map(id => ({ id, met: results[id][0], reason: results[id][0] ? '' : results[id][1] }));
}

// Whether a story that has just entered this console phase should be checked.
export const appliesAt = (phase, settings) => settings.tracker !== 'none' && settings.phases.includes(phase);

export function evaluate(snapshot, rawSettings) {
  const settings = withDefaults(rawSettings);
  const questions = [];
  if (!same(snapshot.story.assignee, snapshot.user)) {
    return { checklist: [], questions, skipped: 'story is not assigned to the signed-in user' };
  }
  const items = checklist(snapshot, settings);
  const unmet = items.filter(item => !item.met && item.id !== 'userConfirm');
  const { handoffTaskTitle, handoffAssignee } = settings;
  const handedOff = Boolean(handoffTaskTitle) && snapshot.tasks.some(task => task.title === handoffTaskTitle && (same(task.assignee, handoffAssignee) || same(task.assigneeName, handoffAssignee)));
  // While a pull request is still open the checklist alone reports the gaps. Once every one is merged,
  // the owner is asked for what only they can give: the effort, or the handoff.
  const merged = snapshot.prs.length > 0 && snapshot.prs.every(pr => pr.status === 'completed');
  if (!handedOff && merged) {
    const effort = items.find(item => item.id === 'effortSet');
    if (effort && !effort.met) questions.push({ rule: 'effort', text: `Story ${snapshot.story.id}: what effort should be assigned? (${effort.reason})` });
    else if (!unmet.length) questions.push({ rule: 'doneDone', text: `Story ${snapshot.story.id} meets every readiness check. Confirm handoff to ${handoffAssignee || 'the reviewer'}?` });
  }
  return { checklist: items, questions, handedOff };
}
