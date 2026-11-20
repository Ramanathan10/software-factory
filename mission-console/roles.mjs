export const roles = {
  coordinator: { job: 'Coordinator', alias: 'Jarvis', skills: ['AI SDLC'] },
  planner: { job: 'Planner', alias: 'Captain America', skills: ['Grill Me'] },
  scout: { job: 'Scout', alias: 'Black Widow', skills: ['AI SDLC · Planning research'] },
  tester: { job: 'Test author', alias: 'Bruce Banner', skills: ['AI SDLC · Test-first handoff'] },
  implementer: { job: 'Implementer', alias: 'Iron Man', skills: ['Ponytail'] },
  reviewer: { job: 'Independent reviewer', alias: 'Doctor Strange', skills: ['Adversarial Code Review'] },
  verifier: { job: 'Before-and-after verifier', alias: 'Bruce Banner', skills: ['Before and After'] },
  watcher: { job: 'PR watcher', alias: 'Hawkeye', skills: ['GrepLoop · Current-head checks and feedback'] },
  diagrammer: { job: 'Architecture diagram designer', alias: 'Rocket', skills: ['Diagram Design'] },
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
  comparison: ['verifier', 'Capture before and after'],
  diagram: ['diagrammer', 'Design architecture diagram'],
  publishing: ['coordinator', 'Open pull request'],
  ci: ['watcher', 'Watching checks'],
  merge: ['watcher', 'PR ready to merge'],
  closed: ['coordinator', 'Merged'],
};
