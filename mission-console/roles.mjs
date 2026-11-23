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

export const phases = {
  scout: ['scout', 'Scouting'],
  planning: ['planner', 'Planning'],
  approval: ['approver', 'Plan approval'],
  testing: ['tester', 'Writing tests'],
  red: ['coordinator', 'Verify red'],
  building: ['implementer', 'Implementation'],
  gates: ['implementer', 'Deterministic gates'],
  mutation: ['tester', 'Mutation check'],
  review: ['reviewer', 'Review'],
  'comparison-choice': ['approver', 'Before-and-after decision'],
  comparison: ['verifier', 'Capture before and after'],
  diagram: ['diagrammer', 'Design architecture diagram'],
  publishing: ['coordinator', 'Open pull request'],
  ci: ['watcher', 'Watching checks'],
  merge: ['watcher', 'PR ready to merge'],
  retro: ['coordinator', 'Retro'],
  closed: ['coordinator', 'Merged'],
};

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
