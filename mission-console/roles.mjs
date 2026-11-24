const circle9 = 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0';
const reactor = circle9 + 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0';

export const roles = {
  coordinator: { job: 'Coordinator', alias: 'Jarvis', skills: ['AI SDLC'], badge: {
    fill: '#0e2742', accent: '#6fd3ff', ink: '#6fd3ff', ring: 'hud', motion: 'reactor', glyph: reactor,
    move: 'M16.95 13.61L19.04 14.29M15.06 16.21L16.35 17.99M12 17.2L12 19.4M8.94 16.21L7.65 17.99M7.05 13.61L4.96 14.29M7.05 10.39L4.96 9.71M8.94 7.79L7.65 6.01M12 6.8L12 4.6M15.06 7.79L16.35 6.01M16.95 10.39L19.04 9.71' } },
  planner: { job: 'Planner', alias: 'Captain America', skills: ['Grill Me'], badge: {
    fill: '#1f3b7a', accent: '#e0464b', ink: '#ffffff', ring: 'band', motion: 'swing', glyph: circle9,
    move: 'M15.5 8.5L13.4 13.4L8.5 15.5L10.6 10.6Z' } },
  scout: { job: 'Scout', alias: 'Black Widow', skills: ['AI SDLC · Planning research'], badge: {
    fill: '#16161c', accent: '#ff5c61', ink: '#ff5c61', ring: 'thin', motion: 'orbit', glyph: '',
    move: 'M10 10m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0M14.5 14.5L20 20' } },
  tester: { job: 'Test author', alias: 'Bruce Banner', skills: ['AI SDLC · Test-first handoff'], badge: {
    fill: '#23804a', accent: '#b38cff', ink: '#ffffff', ring: 'arc', motion: 'rise',
    glyph: 'M9 3h6M10 3v6L5 18.5A1.5 1.5 0 0 0 6.3 21h11.4a1.5 1.5 0 0 0 1.3-2.5L14 9V3M6.9 15h10.2',
    move: 'M10.5 18.6m-0.8 0a0.8 0.8 0 1 0 1.6 0a0.8 0.8 0 1 0 -1.6 0M13.8 17.8m-0.6 0a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0' } },
  implementer: { job: 'Implementer', alias: 'Iron Man', skills: ['Ponytail'], badge: {
    fill: '#a8231c', accent: '#f7c548', ink: '#f7c548', ring: 'thin', motion: 'rock', glyph: '',
    move: 'M7 10h3v-3l-3.5-3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1-3 3l-6-6a6 6 0 0 1-8-8l3.5 3.5' } },
  reviewer: { job: 'Independent reviewer', alias: 'Doctor Strange', skills: ['Adversarial Code Review'], badge: {
    fill: '#0f4f55', accent: '#ff9d42', ink: '#ff9d42', ring: 'dotted', motion: 'blink', glyph: '',
    move: 'M2 12c2.7-4.7 6-7 10-7s7.3 2.3 10 7c-2.7 4.7-6 7-10 7s-7.3-2.3-10-7zM12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0' } },
  verifier: { job: 'Before-and-after verifier', alias: 'Bruce Banner', skills: ['Before and After'], badge: {
    fill: '#6b42b8', accent: '#4fd18b', ink: '#ffffff', ring: 'arc', motion: 'slide',
    glyph: 'M5 4h14a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM6.5 10.5l3 3M9.5 10.5l-3 3M14 12.2l1.6 1.6l2.6-2.8',
    move: 'M12 4v16' } },
  watcher: { job: 'PR watcher', alias: 'Hawkeye', skills: ['PR checks · Current-head checks and feedback'], badge: {
    fill: '#4a2a7c', accent: '#b38cff', ink: '#e9dcff', ring: 'tick', motion: 'sweep',
    glyph: circle9 + 'M12 12m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0', move: 'M12 12L18.4 5.6' } },
  diagrammer: { job: 'Architecture diagram designer', alias: 'Rocket', skills: ['Diagram Design'], badge: {
    fill: '#3d434c', accent: '#f08a4b', ink: '#f08a4b', ring: 'thin', motion: 'flow',
    glyph: 'M3 4h6v5H3zM15 4h6v5h-6zM9 15h6v5H9z', move: 'M6 9v3h12V9M12 12v3' } },
  approver: { job: 'Human approver', alias: 'Fury', skills: [], badge: {
    fill: '#121316', accent: '#8a93a6', ink: '#f5b544', ring: 'thin', motion: '', glyph: circle9 + 'M8.5 12.2l2.4 2.4l4.6-4.8',
    move: '' } },
};

export function harnessKey(harness) {
  return harness?.trim().toLowerCase() ?? '';
}

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

export function lanes(table, at) {
  const out = [];
  for (const [phase, entry] of Object.entries(table)) {
    if (out.at(-1)?.name === entry[at]) out.at(-1).phases.push(phase);
    else out.push({ name: entry[at], phases: [phase] });
  }
  return out;
}

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
  coordinator: 'standard',
};
