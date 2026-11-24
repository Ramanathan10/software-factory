import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const helper = async () => {
  try {
    return await import('./ui/jarvis.js');
  } catch (error) {
    assert.fail('The board has no plain-words helper for Jarvis at command-center/ui/jarvis.js (' + error.code + ').');
  }
};

const now = Date.parse('2026-11-24T10:00:00.000Z');
const minutesAgo = minutes => new Date(now - minutes * 60000).toISOString();

test('a story waiting on Jarvis says so, with how long and why', async () => {
  const { jarvisStatus } = await helper();
  const story = { id: 'tl-1', phase: 'red', waitingOnJarvis: { since: minutesAgo(4), why: 'tester handed off red' } };
  assert.equal(jarvisStatus(story, now), 'Waiting on Jarvis · 4m · tester handed off red');
});

test('a story whose Jarvis turn is running says Jarvis is checking it', async () => {
  const { jarvisStatus } = await helper();
  const story = { id: 'tl-1', phase: 'red', jarvis: { session: 'jarvis-1', turn: { pid: 4100, at: minutesAgo(1) } } };
  assert.match(jarvisStatus(story, now), /^Jarvis is checking/);
});

test('a story with nothing waiting on Jarvis has no Jarvis status, so the board falls back to its usual one', async () => {
  const { jarvisStatus } = await helper();
  assert.ok(!jarvisStatus({ id: 'tl-1', phase: 'building' }, now));
  assert.ok(!jarvisStatus({ id: 'tl-1', phase: 'red', jarvis: { session: 'jarvis-1', lastTurn: { outcome: 'failed', code: 1, at: minutesAgo(2) } } }, now),
    'a failed Jarvis turn reaches the owner through its action question, not this status');
});

test('the Command Center page uses the Jarvis helper', () => {
  const app = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8');
  assert.match(app, /from '\.\/jarvis\.js'/);
});
