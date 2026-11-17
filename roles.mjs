export const roles = {
  coordinator: { job: 'Coordinator', alias: 'Jarvis', skills: ['AI SDLC', 'Before and After', 'Diagram Design'] },
  planner: { job: 'Planner', alias: 'Captain America', skills: ['Grill Me'] },
  scout: { job: 'Scout', alias: 'Black Widow', skills: ['AI SDLC · Planning research'] },
  tester: { job: 'Test author', alias: 'Doctor Strange', skills: ['AI SDLC · Test-first handoff'] },
  implementer: { job: 'Implementer', alias: 'Iron Man', skills: ['Ponytail'] },
  reviewer: { job: 'Independent reviewer', alias: 'Banner', skills: ['Adversarial Code Review'] },
  watcher: { job: 'PR watcher', alias: 'Hawkeye', skills: ['GrepLoop · Current-head checks and feedback'] },
  approver: { job: 'Human approver', alias: 'Fury', skills: [] },
};

export function harnessKey(harness) {
  return harness?.trim().toLowerCase() ?? '';
}

export const phases = {
  planning: ['planner', 'Planning'],
  approval: ['approver', 'Plan approval'],
  testing: ['tester', 'Writing tests'],
  red: ['coordinator', 'Verify red'],
  building: ['implementer', 'Implementation'],
  review: ['reviewer', 'Review'],
  'comparison-choice': ['approver', 'Before-and-after decision'],
  comparison: ['coordinator', 'Verify comparison'],
  publishing: ['coordinator', 'Open pull request'],
  ci: ['watcher', 'Watching checks'],
  merge: ['watcher', 'PR ready to merge'],
  closed: ['coordinator', 'Merged'],
};
