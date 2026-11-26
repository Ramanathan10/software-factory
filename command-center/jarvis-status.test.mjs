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
  assert.equal(jarvisStatus(story, now), 'Jarvis is checking');
});

test('a story whose Jarvis turn is about to start says Jarvis is checking it, without the story id', async () => {
  const { jarvisStatus } = await helper();
  const story = { id: 'tl-1', phase: 'red', jarvis: { session: 'jarvis-1', waking: minutesAgo(0) } };
  assert.equal(jarvisStatus(story, now), 'Jarvis is checking');
});

test('a running turn wins over waiting in the words too', async () => {
  const { jarvisStatus } = await helper();
  const story = { id: 'tl-1', phase: 'red', jarvis: { session: 'jarvis-1', turn: { pid: 4100, at: minutesAgo(1) } }, waitingOnJarvis: { since: minutesAgo(4), why: 'tester handed off red' } };
  assert.equal(jarvisStatus(story, now), 'Jarvis is checking');
});

test('jarvisHold says checking for a running turn or a waking Jarvis, waiting for a story that waits on Jarvis, and nothing otherwise', async () => {
  const { jarvisHold } = await helper();
  assert.equal(typeof jarvisHold, 'function', 'ui/jarvis.js exports no jarvisHold');
  const waiting = { since: minutesAgo(4), why: 'tester handed off red' };
  assert.equal(jarvisHold({ id: 'tl-1', jarvis: { session: 'jarvis-1', turn: { pid: 4100, at: minutesAgo(1) } } }), 'checking');
  assert.equal(jarvisHold({ id: 'tl-1', jarvis: { session: 'jarvis-1', waking: minutesAgo(0) } }), 'checking');
  assert.equal(jarvisHold({ id: 'tl-1', waitingOnJarvis: waiting }), 'waiting');
  assert.equal(jarvisHold({ id: 'tl-1', jarvis: { session: 'jarvis-1', turn: { pid: 4100, at: minutesAgo(1) } }, waitingOnJarvis: waiting }), 'checking', 'checking wins when both hold');
  assert.equal(jarvisHold({ id: 'tl-1', jarvis: { session: 'jarvis-1', waking: minutesAgo(0) }, waitingOnJarvis: waiting }), 'checking');
  assert.equal(jarvisHold({ id: 'tl-1', phase: 'building' }), undefined);
  assert.equal(jarvisHold({ id: 'tl-1', jarvis: { session: 'jarvis-1', lastTurn: { outcome: 'ended', code: 0, at: minutesAgo(2) } } }), undefined, 'a turn that ended holds nothing');
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
