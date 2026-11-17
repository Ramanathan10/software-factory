export const roles = {
  coordinator: { job: 'Coordinator', alias: 'Jarvis', skill: 'AI SDLC' },
  planner: { job: 'Planner', alias: 'Captain America', skill: 'Grill Me' },
  scout: { job: 'Scout', alias: 'Black Widow', skill: 'Repository investigation' },
  tester: { job: 'Test author', alias: 'Doctor Strange', skill: 'AI SDLC test-first handoff' },
  implementer: { job: 'Implementer', alias: 'Iron Man', skill: 'Ponytail' },
  reviewer: { job: 'Independent reviewer', alias: 'Banner', skill: 'Adversarial Code Review' },
  watcher: { job: 'PR watcher', alias: 'Hawkeye', skill: 'GitHub checks and GrepLoop' },
  approver: { job: 'Your decision', alias: 'Fury' },
};

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
