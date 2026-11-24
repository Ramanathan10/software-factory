import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8');

function modelOfWith(meta) {
  const match = /^function modelOf\(story\) \{\n[\s\S]*?^\}$/m.exec(source);
  assert.ok(match, 'app.js defines modelOf(story)');
  return new Function('meta', match[0] + '\nreturn modelOf;')(meta);
}

const meta = {
  phaseTiers: { planning: 'deep', building: 'standard' },
  models: { 'claude code': { deep: null, standard: 'model-beta' }, codex: {} },
};

test('the story window says the owner chose the harness default when the profile saves null for the tier', () => {
  const modelOf = modelOfWith(meta);
  assert.equal(modelOf({ harness: 'Claude Code', phase: 'planning' }), 'Claude Code default · chosen in the profile');
});

test('the story window keeps its wording for a named model and for a tier never asked', () => {
  const modelOf = modelOfWith(meta);
  assert.equal(modelOf({ harness: 'Claude Code', phase: 'building' }), 'model-beta · set in the profile, not run yet');
  assert.equal(modelOf({ harness: 'Codex', phase: 'planning' }), 'Not run yet · Codex will choose');
  assert.equal(modelOf({ harness: 'Claude Code', phase: 'planning', worker: { ran: { model: 'model-gamma', effort: 'high' } } }), 'model-gamma · high effort');
});
