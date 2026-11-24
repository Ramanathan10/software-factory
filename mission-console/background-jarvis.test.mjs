import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createConsoleService } from '../command-center/console-service.mjs';

const cli = fileURLToPath(new URL('./jarvis.mjs', import.meta.url));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'background-jarvis-'));
  const dbPath = join(directory, 'stories.db');
  const service = createConsoleService({ dbPath });
  t.after(() => {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  });
  service.createStory({ story: 'tl-1', title: 'Add export', detail: 'Export rows.', branch: 'tl-1', worktree: directory, harness: 'Codex' });
  service.recordEvent({ story: 'tl-1', type: 'handoff', detail: 'Context pack ready.' });
  const story = () => service.snapshot().find(item => item.id === 'tl-1');
  const pendingTypes = () => service.pending().map(event => event.type);
  return { service, story, pendingTypes, dbPath, directory };
}

const woken = (service, handled) => service.recordEvent({ story: 'tl-1', type: 'jarvis-woken', handled });
const turnStarted = (service, pid = 4100) => service.recordEvent({ story: 'tl-1', type: 'jarvis-turn-started', session: 'jarvis-1', pid, log: '/logs/jarvis-1.log' });
const turnEnded = (service, outcome = 'ended', code = 0) => service.recordEvent({ story: 'tl-1', type: 'jarvis-turn-ended', outcome, code, detail: 'Jarvis ended its turn.' });

test('a background Jarvis turn is recorded on the story without changing its phase or becoming news', t => {
  const { service, story, pendingTypes } = fixture(t);
  const before = pendingTypes();
  const handoff = story().events.find(event => event.type === 'handoff');
  woken(service, handoff.seq);
  assert.equal(story().jarvis.handled, handoff.seq);
  turnStarted(service);
  assert.deepEqual([story().jarvis.session, story().jarvis.turn.pid, story().jarvis.turn.log], ['jarvis-1', 4100, '/logs/jarvis-1.log']);
  turnEnded(service, 'failed', 3);
  assert.equal(story().jarvis.turn, undefined);
  assert.deepEqual([story().jarvis.lastTurn.outcome, story().jarvis.lastTurn.code], ['failed', 3]);
  assert.equal(story().jarvis.session, 'jarvis-1', 'the next wake resumes the same session');
  assert.equal(story().phase, 'planning');
  assert.equal(story().worker, undefined);
  assert.deepEqual(pendingTypes(), before, 'Jarvis turn records are never news for Jarvis');
});

test('a story never has two background Jarvis turns running', t => {
  const { service, story } = fixture(t);
  woken(service, 1);
  turnStarted(service, 4100);
  assert.throws(() => turnStarted(service, 4200), error => error.status === 409);
  assert.equal(story().jarvis.turn.pid, 4100);
  turnEnded(service);
  woken(service, 2);
  turnStarted(service, 4300);
  assert.equal(story().jarvis.turn.pid, 4300);
});

test('a Jarvis turn that is not running cannot end, and its outcome must be one the store knows', t => {
  const { service } = fixture(t);
  assert.throws(() => turnEnded(service), error => error.status === 409);
  woken(service, 1);
  turnStarted(service);
  assert.throws(() => turnEnded(service, 'exploded'), error => error.status === 400);
});

test('Jarvis turns are recorded on a blocked story and on one awaiting cleanup', t => {
  const { service, story } = fixture(t);
  service.recordEvent({ story: 'tl-1', type: 'blocked', detail: 'Waiting on credentials.' });
  woken(service, 1);
  turnStarted(service);
  turnEnded(service, 'failed', 1);
  assert.equal(story().jarvis.lastTurn.outcome, 'failed');
  service.recordEvent({ story: 'tl-1', type: 'resume', detail: 'Credentials restored.' });
  service.recordEvent({ story: 'tl-1', type: 'request-cleanup' });
  woken(service, 2);
  turnStarted(service, 4400);
  turnEnded(service, 'lost', null);
  assert.equal(story().jarvis.lastTurn.outcome, 'lost');
});

test('the failure notice for Jarvis can be asked on a blocked story and on one awaiting cleanup; other questions cannot', t => {
  const { service, story } = fixture(t);
  const notice = id => ({ story: 'tl-1', type: 'question', question: id, prompt: 'Action for you: Jarvis could not run for tl-1.', options: ['Done - Jarvis can run again', 'Hold - not now'], recommended: 0 });
  service.recordEvent({ story: 'tl-1', type: 'blocked', detail: 'Waiting on credentials.' });
  assert.throws(() => service.recordEvent({ ...notice('scope'), question: 'scope' }), error => error.status === 409);
  service.recordEvent(notice('action-jarvis-10'));
  service.recordEvent({ story: 'tl-1', type: 'answer', question: 'action-jarvis-10', answer: 0 });
  service.recordEvent({ story: 'tl-1', type: 'resume', detail: 'Resolved.' });
  service.recordEvent({ story: 'tl-1', type: 'request-cleanup' });
  service.recordEvent(notice('action-jarvis-20'));
  assert.ok(story().questions.some(question => question.id === 'action-jarvis-20'));
});

test('an event Jarvis marks as its own is kept on the story but is not news', t => {
  const { service, story, pendingTypes } = fixture(t);
  const before = pendingTypes();
  service.recordEvent({ story: 'tl-1', type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0, by: 'jarvis' });
  assert.deepEqual(pendingTypes(), before);
  assert.equal(story().events.find(event => event.type === 'question').by, 'jarvis');
  service.recordEvent({ story: 'tl-1', type: 'question', question: 'format', prompt: 'Which format?', options: ['CSV', 'JSON'], recommended: 0 });
  assert.deepEqual(pendingTypes(), [...before, 'question'], 'the same event from anyone else is news');
  assert.equal(story().events.find(event => event.type === 'question').by, undefined);
  assert.throws(() => service.recordEvent({ story: 'tl-1', type: 'blocked', detail: 'Stuck.', by: 'someone' }), error => error.status === 400);
});

test('a session marked as Jarvis in its environment records every event as Jarvis\'s own', t => {
  const { story, dbPath, pendingTypes } = fixture(t);
  const before = pendingTypes();
  const record = (event, env) => JSON.parse(execFileSync(process.execPath, [cli, 'record', dbPath], { input: JSON.stringify(event), env: { ...process.env, ...env } }).toString());
  record({ story: 'tl-1', key: 'by-jarvis', type: 'blocked', detail: 'Needs the owner.', revision: story().revision }, { AI_SDLC_ACTOR: 'jarvis' });
  assert.equal(story().events.find(event => event.type === 'blocked').by, 'jarvis');
  assert.deepEqual(pendingTypes(), before, 'the background Jarvis never wakes itself');
  record({ story: 'tl-1', key: 'by-owner', type: 'resume', detail: 'Unblocked.', revision: story().revision }, { AI_SDLC_ACTOR: '' });
  assert.deepEqual(pendingTypes(), [...before, 'resume']);
});
