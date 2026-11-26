import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check, current } from './delivery-model.mjs';

const version = (filterSent, handReserves, startRegistersTurn, waitsForAdoptedTurns, recordsAtSpawn = true, rechecksAssignment = true) => ({ filterSent, handReserves, startRegistersTurn, waitsForAdoptedTurns, recordsAtSpawn, rechecksAssignment });
const skill = readFileSync(new URL('../.claude/skills/verify-decision-delivery/SKILL.md', import.meta.url), 'utf8');

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

test('without the wait on every running turn of the story, a replacement turn could run beside a released one', () => {
  assert.equal(check(version(true, true, true, false), ['OneTurnPerWorktree']).invariant, 'OneTurnPerWorktree');
  assert.equal(check(current, ['OneTurnPerWorktree']).invariant, undefined);
});

test('the code as it is rechecks the assignment before it resumes a session, and the model says so', () => {
  assert.equal(current.rechecksAssignment, true);
});

test('at 88b9cce a released worker session could be resumed after its replacement was assigned', () => {
  const result = check(version(true, true, true, true, true, false), ['ReleasedSessionNeverResumed']);
  assert.equal(result.invariant, 'ReleasedSessionNeverResumed');
  const release = result.trace.findIndex(step => step.startsWith('Release'));
  assert.ok(release >= 0, result.trace.join(' → '));
  assert.ok(result.trace.findIndex((step, at) => at > release && step.startsWith('Assign')) > release, 'a replacement is assigned after the release: ' + result.trace.join(' → '));
  assert.ok(result.trace.findIndex(step => step.startsWith('Spawn')) > release, result.trace.join(' → '));
});

test('at 88b9cce a decision could be lost: handed to a session nobody reads and never answered', () => {
  const result = check(version(true, true, true, true, true, false), []);
  assert.equal(result.lost, true, JSON.stringify(result));
  assert.ok(result.trace.some(step => step.startsWith('Release')), result.trace.join(' → '));
});

test('with the assignment rechecked, no released session is resumed and no decision is lost, in every order of release and assignment', () => {
  const result = check(version(true, true, true, true, true, true));
  assert.deepEqual([result.invariant, result.lost, result.stuck], [undefined, undefined, undefined], JSON.stringify(result));
  assert.ok(result.states > 1000, JSON.stringify(result));
});

test('the verify-decision-delivery skill lists the Release and Assign steps and every flag in current', () => {
  for (const flag of Object.keys(current)) assert.ok(skill.includes('`' + flag + '`'), flag + ' is not in the skill');
  for (const step of ['Release', 'Assign']) assert.match(skill, new RegExp('[|] *`' + step + '` *[|]'), step + ' is not in the skill\'s table of steps');
  assert.match(skill, /ReleasedSessionNeverResumed/);
});
