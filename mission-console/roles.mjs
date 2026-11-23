export const roles = {
  coordinator: { job: 'Coordinator', alias: 'Jarvis', skills: ['AI SDLC'] },
  planner: { job: 'Planner', alias: 'Captain America', skills: ['Grill Me'] },
  scout: { job: 'Scout', alias: 'Black Widow', skills: ['AI SDLC · Planning research'] },
  tester: { job: 'Test author', alias: 'Bruce Banner', skills: ['AI SDLC · Test-first handoff'] },
  implementer: { job: 'Implementer', alias: 'Iron Man', skills: ['Ponytail'] },
  reviewer: { job: 'Independent reviewer', alias: 'Doctor Strange', skills: ['Adversarial Code Review'] },
  verifier: { job: 'Before-and-after verifier', alias: 'Bruce Banner', skills: ['Before and After'] },
  watcher: { job: 'PR watcher', alias: 'Hawkeye', skills: ['PR checks · Current-head checks and feedback'] },
  diagrammer: { job: 'Architecture diagram designer', alias: 'Rocket', skills: ['Diagram Design'] },
  approver: { job: 'Human approver', alias: 'Fury', skills: [] },
};

export function harnessKey(harness) {
  return harness?.trim().toLowerCase() ?? '';
}

// Each phase: the role that owns it, its label, its column on the Command Center board, and its step on the
// Mission Console track. Both dashboards build their lanes from these, so a new phase always has a lane.
export const phases = {
  scout: ['scout', 'Scouting', 'Plan', 'Scout'],
  planning: ['planner', 'Planning', 'Plan', 'Plan'],
  approval: ['approver', 'Plan approval', 'Plan', 'Plan'],
  testing: ['tester', 'Writing tests', 'Tests', 'Test'],
  red: ['coordinator', 'Verify red', 'Tests', 'Test'],
  building: ['implementer', 'Implementation', 'Build', 'Build'],
  gates: ['implementer', 'Deterministic gates', 'Build', 'Gates'],
  mutation: ['tester', 'Mutation check', 'Build', 'Mutation'],
  review: ['reviewer', 'Review', 'Review', 'Review'],
  'comparison-choice': ['approver', 'Before-and-after decision', 'Verify', 'Before & after'],
  comparison: ['verifier', 'Capture before and after', 'Verify', 'Before & after'],
  diagram: ['diagrammer', 'Design architecture diagram', 'Verify', 'Architecture'],
  publishing: ['coordinator', 'Open pull request', 'Ship', 'PR'],
  ci: ['watcher', 'Watching checks', 'Ship', 'PR'],
  merge: ['watcher', 'PR ready to merge', 'Ship', 'PR'],
  retro: ['coordinator', 'Retro', 'Ship', 'PR'],
  closed: ['coordinator', 'Merged', 'Done', 'PR'],
};

// The lanes of a dashboard, in phase order: `at` is 2 for the board's columns and 3 for the track's steps.
export function lanes(table, at) {
  const out = [];
  for (const [phase, entry] of Object.entries(table)) {
    if (out.at(-1)?.name === entry[at]) out.at(-1).phases.push(phase);
    else out.push({ name: entry[at], phases: [phase] });
  }
  return out;
}

// How capable a model a phase's work needs, named without naming a model: the owner's profile says which
// model each harness uses for a tier. A worker turn runs at the tier of the phase it starts in, and a
// subagent a worker hands a phase to runs at that phase's tier. `scout` is deep because the turn it starts
// runs on into planning. A phase left out is the owner's or the daemon's, and needs no model.
export const tiers = ['deep', 'standard', 'fast'];
export const phaseTiers = {
  scout: 'deep',
  planning: 'deep',
  testing: 'standard',
  red: 'standard',
  building: 'standard',
  gates: 'standard',
  mutation: 'standard',
  review: 'deep',
  comparison: 'standard',
  diagram: 'standard',
  publishing: 'standard',
  ci: 'standard',
  retro: 'deep',
};
