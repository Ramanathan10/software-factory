import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check, current } from './delivery-model.mjs';

const version = (filterSent, handReserves, startRegistersTurn, waitsForAdoptedTurns, recordsAtSpawn = true) => ({ filterSent, handReserves, startRegistersTurn, waitsForAdoptedTurns, recordsAtSpawn });

test('the code as it is: one turn per session, each decision handed once, no delivery stuck', () => {
  const result = check(current);
  assert.ok(result.states > 1000, JSON.stringify(result));
});

test('before 05c45f7 a decision could be handed twice', () => {
  const result = check(version(false, false, false, false), ['NoDuplicateDelivery']);
  assert.equal(result.invariant, 'NoDuplicateDelivery');
});

test('after 05c45f7 an overlapping delivery could still hand a decision twice', () => {
  assert.equal(check(version(true, false, true, true), ['NoDuplicateDelivery']).invariant, 'NoDuplicateDelivery');
});

test('a message did not wait for the kickoff turn startWorker began', () => {
  assert.equal(check(version(true, true, false, true), ['OneTurnPerSession']).invariant, 'OneTurnPerSession');
});

test('after a restart a message did not wait for the turn the earlier daemon left running', () => {
  assert.equal(check(version(true, true, true, false), ['OneTurnPerSession']).invariant, 'OneTurnPerSession');
});

test('after a restart while a new turn settled, the turn was in no store for the next message to wait for', () => {
  const result = check(version(true, true, true, true, false), ['OneTurnPerSession']);
  assert.equal(result.invariant, 'OneTurnPerSession');
  assert.ok(result.trace.indexOf('Restart') > result.trace.findIndex(step => step.startsWith('Spawn')), result.trace.join(' → '));
});
