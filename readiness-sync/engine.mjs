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

const livePrs = prs => prs.filter(pr => pr.status !== 'abandoned');

const same = (a, b) => Boolean(a) && Boolean(b) && String(a).toLowerCase() === String(b).toLowerCase();

function checklist(snapshot, settings) {
  const { story, tasks, prs } = snapshot;
  const target = settings.targetBranch;
  const closed = task => settings.closedTaskStates.some(state => same(state, task.state));
  const noPr = snapshot.noPrConfirmed === true;
  const live = livePrs(prs);
  const results = {
    testsPass: [snapshot.testsPass === true, snapshot.testsPass === undefined ? 'no test evidence yet' : 'tests not passing'],
    tasksClosed: [tasks.length > 0 && tasks.every(closed), tasks.length ? 'open tasks remain' : 'the story has no tasks'],
    prMergedToTarget: [(live.length > 0 && live.every(pr => pr.status === 'completed' && pr.target === target)) || noPr, `a PR is not completed into ${target}`],
    prLinked: [live.every(pr => pr.linked) && (live.length > 0 || noPr), 'a PR is not linked to the story'],
    effortSet: [story.effort !== undefined && story.effort !== null && story.effort !== settings.unestimatedValue, 'effort missing or unestimated'],
    userConfirm: [snapshot.handoffConfirmed === true, 'handoff not yet confirmed'],
  };
  return settings.checklist.map(id => ({ id, met: results[id][0], reason: results[id][0] ? '' : results[id][1] }));
}

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
  const live = livePrs(snapshot.prs);
  const merged = live.length > 0 && live.every(pr => pr.status === 'completed');
  if (!handedOff && merged) {
    const effort = items.find(item => item.id === 'effortSet');
    if (effort && !effort.met) questions.push({ rule: 'effort', text: `Story ${snapshot.story.id}: what effort should be assigned? (${effort.reason})` });
    else if (!unmet.length) questions.push({ rule: 'doneDone', text: `Story ${snapshot.story.id} meets every readiness check. Confirm handoff to ${handoffAssignee || 'the reviewer'}?` });
  }
  return { checklist: items, questions, handedOff };
}
