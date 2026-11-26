import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lanes, phases, roles } from './roles.mjs';

test('every phase names its role, label, board column, and track step', () => {
  for (const [phase, entry] of Object.entries(phases)) {
    assert.equal(entry.length, 4, phase + ' needs [role, label, board column, track step] in mission-console/roles.mjs');
    assert.ok(roles[entry[0]], phase + ' names the unknown role ' + entry[0]);
    assert.ok(entry.every(field => typeof field === 'string' && field.trim()), phase + ' has an empty field');
  }
});

test('each dashboard lane is one run of consecutive phases', () => {
  for (const at of [2, 3]) {
    const names = lanes(phases, at).map(lane => lane.name);
    assert.deepEqual(names, [...new Set(names)], 'a lane is split: move its phases next to each other in mission-console/roles.mjs');
  }
  assert.deepEqual(lanes(phases, 2).flatMap(lane => lane.phases), Object.keys(phases));
});

const luminance = hex => {
  const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('every role has a badge the Command Center can draw and tell apart', () => {
  const drawings = new Map();
  for (const [id, { badge }] of Object.entries(roles)) {
    assert.ok(badge, id + ' needs a badge in mission-console/roles.mjs');
    for (const color of ['fill', 'accent', 'ink']) assert.match(badge[color] ?? '', /^#[0-9a-f]{6}$/i, id + ' badge ' + color);
    assert.ok(contrast(badge.ink, badge.fill) >= 3, id + ' glyph is ' + contrast(badge.ink, badge.fill).toFixed(2) + ':1 on its fill; graphics need 3:1');
    for (const path of [badge.glyph, badge.move]) assert.match(path, /^[MmLlHhVvCcSsQqTtAaZz0-9 .,-]*$/, id + ' badge path');
    assert.ok(badge.glyph || badge.move, id + ' badge draws nothing');
    assert.equal(Boolean(badge.move), Boolean(badge.motion), id + ' needs both a moving part and a motion, or neither');
    const drawing = badge.glyph + '|' + badge.move;
    assert.ok(!drawings.has(drawing), id + ' draws the same glyph as ' + drawings.get(drawing));
    drawings.set(drawing, id);
  }
});

test('PR review is Hawkeye\'s own lane between Ship and Archive, inside the PR track step, on the standard tier', async () => {
  assert.deepEqual(phases['pr-review'], ['watcher', 'PR review', 'PR review', 'PR']);
  const names = lanes(phases, 2).map(lane => lane.name);
  assert.deepEqual(names.slice(names.indexOf('Ship'), names.indexOf('Ship') + 3), ['Ship', 'PR review', 'Archive']);
  assert.ok(roles.watcher.skills.includes('PR review'), 'Hawkeye\'s skills name PR review');
  const { phaseTiers } = await import('./roles.mjs');
  assert.equal(phaseTiers['pr-review'], 'standard');
});

test('shipped stories sit in the Archive lane, which no other phase shares', () => {
  assert.equal(phases.closed[2], 'Archive');
  assert.deepEqual(lanes(phases, 2).find(lane => lane.name === 'Archive')?.phases, ['closed']);
  assert.ok(!lanes(phases, 2).some(lane => lane.name === 'Done'));
});

test('Hawkeye runs publishing in the Ship lane, and Open pull request is a skill of Hawkeye', () => {
  assert.deepEqual(phases.publishing, ['watcher', 'Open pull request', 'Ship', 'PR']);
  assert.ok(roles.watcher.skills.includes('Open pull request'), 'Hawkeye\'s skills name Open pull request');
  assert.ok(roles.watcher.skills.includes('PR review'), 'Hawkeye keeps PR review');
});
