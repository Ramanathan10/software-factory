import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '../../mission-console/store.mjs';
import { summarizePr, watchOnce } from '../../mission-console/watcher.mjs';
import { gh } from '../gh-stand-in.mjs';
import { expect } from '../rig.mjs';

export const title = 'A pull request that starts conflicting with main while Hawkeye is assigned in ci is seen by the watcher; Jarvis releases Hawkeye and returns the story to build with no readiness';

const story = 'E2E-CONFLICT';
const url = 'https://github.com/e2e-owner/greetings/pull/1';
const head = 'a'.repeat(40);
const checks = [{ __typename: 'CheckRun', name: 'Tests', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const fields = 'url,state,headRefOid,statusCheckRollup,mergeable,mergeStateStatus';

function seed(rig) {
  const store = openStore(rig.db);
  const record = (type, input = {}) => {
    const { revision } = store.snapshot().find(item => item.id === story);
    return store.record({ story, type, revision, key: story + '-seed-' + revision, ...input });
  };
  try {
    record('plan', { detail: 'E2E plan.' });
    record('approve');
    record('handoff', { detail: 'E2E tests ready.' });
    record('handoff', { detail: 'E2E red.', command: 'node --test' });
    record('handoff', { detail: 'E2E green.', command: 'node --test' });
    record('handoff', { detail: 'E2E gates.', command: 'node --test' });
    record('handoff', { detail: 'E2E mutation.', command: 'node --test' });
    record('handoff', { detail: 'E2E review.' });
    record('comparison-choice', { run: false });
    record('pr-opened', { url });
    record('pr-observed', { url, observation: { head, status: 'passed', failedCount: 0, failures: [], merge: 'clean' } });
    for (const event of store.pendingFor(story)) store.ack(event.seq);
  } finally {
    store.close();
  }
}

const readPr = rig => async target => summarizePr(JSON.parse(gh(rig.github, ['pr', 'view', target, '--json', fields])));

export async function run(rig) {
  rig.create(story);
  mkdirSync(rig.github, { recursive: true });
  const file = join(rig.github, 'pulls.json');
  writeFileSync(file, JSON.stringify([{
    number: 1, url, title: 'E2E pull request', body: 'Body.', base: 'main', head: 'e2e', headAtOpen: head, draft: false, state: 'OPEN', origin: '', comments: [],
    checks, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  }]));
  rig.playbook(story, {
    turns: [
      { role: 'watcher', phase: 'ci', turn: 'first', steps: [
        { record: { type: 'activity', detail: 'E2E watching the checks.' } },
      ] },
    ],
    jarvis: [{ wake: 1, steps: [
      { record: { type: 'release-worker', detail: 'The PR conflicts with main; Hawkeye is idle and released.' } },
      { record: { type: 'return-to-build', detail: 'Merge conflict with main: merge origin/main and resolve the conflict.' } },
      { ack: ['pr-observed'] },
    ] }],
  });
  await rig.step('a story in ci has a passed, clean PR and Hawkeye assigned between turns', async () => {
    seed(rig);
    const seeded = rig.snapshot(story);
    expect(seeded.phase === 'ci' && seeded.pr === url && seeded.prObservation?.status === 'passed',
      'The story is in ' + seeded.phase + ', not in ci with a passed observation.');
    await rig.start(story, 'You are the scripted Hawkeye for story ' + story + '.');
    await rig.worker(story, 1, 'the checks watch', () => rig.event(story, 'activity', item => /E2E watching/.test(item.detail)));
    await rig.until('the Hawkeye turn to end', () => rig.turnsEnded(story, 1));
    expect(rig.snapshot(story).worker?.role === 'watcher', 'Hawkeye did not keep its assignment between turns.');
  });
  await rig.step('the watcher reads a clean PR, then sees it start conflicting, and reports only the conflict', async () => {
    const store = openStore(rig.db);
    try {
      const quiet = await watchOnce(store, { readPr: readPr(rig) });
      expect(quiet.length === 0, 'The watcher reported a change for a clean, unchanged PR: ' + JSON.stringify(quiet.map(change => [change.story, change.status, change.merge])));
      const pulls = JSON.parse(readFileSync(file, 'utf8'));
      writeFileSync(file, JSON.stringify(pulls.map(pull => ({ ...pull, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }))));
      const changes = await watchOnce(store, { readPr: readPr(rig) });
      expect(changes.length === 1 && changes[0].story === story && changes[0].merge === 'conflicting',
        'The watcher did not report the conflict of ' + story + ': ' + JSON.stringify(changes.map(change => [change.story, change.status, change.merge])));
    } finally {
      store.close();
    }
    const seen = rig.event(story, 'pr-observed', item => item.conflict === true);
    expect(seen && seen.phase === 'ci' && seen.observation.merge === 'conflicting', 'No conflict pr-observed event with conflict: true was recorded in ci.');
  });
  await rig.step('a background Jarvis is woken past the assigned worker, releases Hawkeye, and returns the story to build', async () => {
    await rig.until('Jarvis to record the return to build', () => rig.event(story, 'return-to-build'), 60000);
    const returned = rig.event(story, 'return-to-build');
    const released = rig.event(story, 'release-worker', item => item.worker?.role === 'watcher');
    expect(released && released.seq < returned.seq, 'Jarvis did not release Hawkeye before returning the story to build.');
    const now = rig.snapshot(story);
    expect(now.phase === 'building' && !now.readyHead && !now.worker, 'The story is in ' + now.phase + ' with readyHead ' + now.readyHead + ' and worker ' + now.worker?.role + ', not in building with neither.');
    expect(rig.jarvisWakes(story).some(wake => wake.seq < returned.seq), 'Jarvis was not woken before the return to build.');
  });
}
