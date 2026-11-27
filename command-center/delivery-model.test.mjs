import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { check, current, invariants } from './delivery-model.mjs';

const version = (filterSent, handReserves, startRegistersTurn, waitsForAdoptedTurns, recordsAtSpawn = true, rechecksAssignment = true) => ({ filterSent, handReserves, startRegistersTurn, waitsForAdoptedTurns, recordsAtSpawn, rechecksAssignment, startupDelivers: true, rechecksPending: true });
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

const resumeInvariants = ['OneTurnPerSession', 'OneTurnPerWorktree', 'ReleasedSessionNeverResumed', 'NoDuplicateDelivery'];

test('with the assignment rechecked, no released session is resumed and no decision is lost, in every order of release and assignment', () => {
  const result = check(version(true, true, true, true, true, true), resumeInvariants);
  assert.deepEqual([result.invariant, result.lost, result.stuck], [undefined, undefined, undefined], JSON.stringify(result));
  assert.ok(result.states > 1000, JSON.stringify(result));
});

test('the code as it is releases the decisions a turn carried when the turn ends, and the model says so', () => {
  assert.equal(current.releasesAtTurnEnd, true);
});

test('a decision that is pending, carried by no running turn or unresolved hand, with a worker assigned and still in sent, is a state the model forbids', () => {
  assert.ok(Object.keys(invariants).includes('NeverBlocked'), 'NeverBlocked is not one of the invariants');
  assert.equal(check(current, ['NeverBlocked']).invariant, undefined);
  assert.ok(check(current).states > 1000);
});

test('without the release at turn end, a decision is left in sent after its turn failed, and the model reaches that state', () => {
  assert.ok(Object.keys(invariants).includes('NeverBlocked'), 'NeverBlocked is not one of the invariants');
  const result = check({ ...current, releasesAtTurnEnd: false }, ['NeverBlocked']);
  assert.equal(result.invariant, 'NeverBlocked');
  for (const step of ['Settled', 'TurnEnd']) assert.ok(result.trace.some(label => label.startsWith(step)), step + ' is not in the trace: ' + result.trace.join(' → '));
});

test('the verify-decision-delivery skill lists the Release and Assign steps and every flag in current', () => {
  for (const flag of Object.keys(current)) assert.ok(skill.includes('`' + flag + '`'), flag + ' is not in the skill');
  for (const step of ['Release', 'Assign']) assert.match(skill, new RegExp('[|] *`' + step + '` *[|]'), step + ' is not in the skill\'s table of steps');
  assert.match(skill, /ReleasedSessionNeverResumed/);
  assert.match(skill, /NeverBlocked/);
  assert.match(skill, /[|] *`TurnEnd` *[|][^\n]*sent/);
  assert.doesNotMatch(skill, /issue #49/);
});

test('hand keeps only decisions still pending, so none is reserved after it was acknowledged', () => {
  assert.equal(current.handsOnlyPending, true);
  assert.equal(check(current, ['NoReserveAfterAck']).invariant, undefined);
  const result = check({ ...current, handsOnlyPending: false }, ['NoReserveAfterAck']);
  assert.equal(result.invariant, 'NoReserveAfterAck');
  for (const step of ['Ack', 'BatchFire']) assert.ok(result.trace.some(label => label.startsWith(step)), step + ' is not in the trace: ' + result.trace.join(' → '));
});

const violation = result => result.invariant ?? (result.unowned ? 'Unowned' : undefined);

test('the code as it is delivers at start-up and rechecks what a delivery carries before it resumes the worker, and the model says so', () => {
  assert.equal(current.startupDelivers, true);
  assert.equal(current.rechecksPending, true);
  const result = check(current);
  assert.deepEqual([violation(result), result.lost, result.stuck], [undefined, undefined, undefined], JSON.stringify(result));
  assert.ok(result.states > 1000, JSON.stringify(result));
});

test('without delivery at start-up, a decision pending on a worker assigned after a restart is carried by nobody, and the model reaches that state', () => {
  const result = check({ ...current, startupDelivers: false });
  assert.equal(violation(result), 'Unowned', JSON.stringify(result));
  assert.ok(result.trace.some(label => label.startsWith('Restart')), 'Restart is not in the trace: ' + result.trace.join(' → '));
  assert.ok(!result.trace.some(label => label.startsWith('StartupDeliver')), result.trace.join(' → '));
});

test('the verify-decision-delivery skill lists the StartupDeliver step, the Unowned check and the invariant for a resume that carries only acknowledged decisions', () => {
  assert.match(skill, /[|] *`StartupDeliver` *[|]/, 'StartupDeliver is not in the table of steps in the skill');
  assert.match(skill, /Unowned/);
  assert.match(skill, /NoResumeForAcknowledged/);
});

test('without the recheck before a resume, a worker is resumed for decisions it had already acknowledged, and the model reaches that state', () => {
  const result = check({ ...current, rechecksPending: false });
  assert.ok(Object.keys(invariants).includes('NoResumeForAcknowledged'), 'NoResumeForAcknowledged is not one of the invariants');
  assert.equal(result.invariant, 'NoResumeForAcknowledged', JSON.stringify(result));
  for (const step of ['Ack', 'Spawn']) assert.ok(result.trace.some(label => label.startsWith(step)), step + ' is not in the trace: ' + result.trace.join(' → '));
});

test('a resume for acknowledged decisions is reachable without a restart, on the live path, when any running turn of the assigned session may acknowledge any pending decision', () => {
  const result = check({ ...current, rechecksPending: false });
  assert.equal(result.invariant, 'NoResumeForAcknowledged', JSON.stringify(result));
  assert.ok(!result.trace.some(label => label.startsWith('Restart')), result.trace.join(' → '));
  assert.ok(result.trace.some(label => label.startsWith('BatchFire')), result.trace.join(' → '));
});
