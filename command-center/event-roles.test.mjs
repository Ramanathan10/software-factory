import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8');

function eventRoles() {
  const match = /^const eventRoles = \{[\s\S]*?^\};$/m.exec(source);
  assert.ok(match, 'app.js defines eventRoles');
  return new Function(match[0] + '\nreturn eventRoles;')();
}

test('the feed shows the pull request opening as Hawkeye, not Jarvis', () => {
  assert.equal(eventRoles()['pr-opened'], 'watcher');
});
