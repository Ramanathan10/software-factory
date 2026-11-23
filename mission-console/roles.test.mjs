import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lanes, phases, roles } from './roles.mjs';

// 70e432b: the Mission Console's lane list had no step for `diagram`, so a story in it fell off the track.
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
