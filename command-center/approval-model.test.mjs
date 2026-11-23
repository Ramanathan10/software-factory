import assert from 'node:assert/strict';
import { test } from 'node:test';
import { approvalCurrent, checkApproval } from './approval-model.mjs';

test('approved startup has one independent writer, including a restart before assignment', () => {
  const result = checkApproval();
  assert.ok(result.states > 0, JSON.stringify(result));
  assert.equal(result.invariant, undefined);
});

for (const flag of Object.keys(approvalCurrent)) {
  test('the approved startup model detects a regression in ' + flag, () => {
    const result = checkApproval({ ...approvalCurrent, [flag]: false });
    assert.ok(result.invariant, JSON.stringify(result));
    assert.ok(result.trace.includes('Spawn'));
  });
}
