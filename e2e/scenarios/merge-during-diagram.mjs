import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '../../mission-console/store.mjs';
import { summarizePr, watchOnce } from '../../mission-console/watcher.mjs';
import { gh } from '../gh-stand-in.mjs';
import { expect } from '../rig.mjs';

export const title = 'A pull request merged while Rocket draws a diagram started from ci is seen by the watcher; Jarvis releases Rocket, records the merge, and the retro closes the story';

const story = 'E2E-MERGED';
const url = 'https://github.com/e2e-owner/greetings/pull/1';
const head = 'a'.repeat(40);

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
    record('diagram-start', { detail: 'E2E diagram scope.' });
    for (const event of store.pendingFor(story)) store.ack(event.seq);
  } finally {
    store.close();
  }
}

export async function run(rig) {
  rig.create(story);
  mkdirSync(rig.github, { recursive: true });
  writeFileSync(join(rig.github, 'pulls.json'), JSON.stringify([{
    number: 1, url, title: 'E2E pull request', body: 'Body.', base: 'main', head: 'e2e', headAtOpen: head, draft: false, state: 'OPEN', origin: '', comments: [],
  }]));
  rig.playbook(story, {
    turns: [
      { role: 'diagrammer', phase: 'diagram', turn: 'first', steps: [
        { record: { type: 'activity', detail: 'E2E drawing the architecture diagram.' } },
      ] },
      { role: 'coordinator', phase: 'retro', turn: 'first', steps: [
        { record: { type: 'activity', detail: 'E2E running the retro after the merge.' } },
        { record: { type: 'release-worker', detail: 'E2E retro finished.' } },
        { record: { type: 'handoff', detail: 'E2E lessons recorded after the merge.' } },
      ] },
    ],
    jarvis: [{ wake: 1, steps: [
      { record: { type: 'release-worker', detail: 'The PR merged while Rocket was drawing; Rocket is stopped.' } },
      { record: { type: 'merged', detail: 'GitHub reports the registered PR merged.' } },
      { ack: ['pr-observed'] },
    ] }],
  });
  await rig.step('a story in diagram, entered from ci with its PR open, has Rocket drawing', async () => {
    seed(rig);
    const seeded = rig.snapshot(story);
    expect(seeded.phase === 'diagram' && seeded.diagram?.returnPhase === 'ci' && seeded.pr === url,
      'The story is in ' + seeded.phase + ', not in diagram entered from ci with the PR registered.');
    await rig.start(story, 'You are the scripted Rocket for story ' + story + '.');
    await rig.worker(story, 1, 'the diagram work', () => rig.event(story, 'activity', item => /E2E drawing/.test(item.detail)));
    await rig.until('the end of the diagram turn', () => rig.turnsEnded(story, 1));
    expect(rig.snapshot(story).worker?.role === 'diagrammer', 'Rocket did not keep its assignment between turns.');
  });
  await rig.step('the PR merges, and the watcher sees the merge in diagram and wakes Jarvis', async () => {
    gh(rig.github, ['pr', 'merge', url]);
    const readPr = async target => summarizePr(JSON.parse(gh(rig.github, ['pr', 'view', target, '--json', 'url,state,headRefOid,statusCheckRollup'])));
    const store = openStore(rig.db);
    let changes;
    try {
      changes = await watchOnce(store, { readPr });
    } finally {
      store.close();
    }
    expect(changes.length === 1 && changes[0].story === story && changes[0].status === 'merged',
      'The watcher did not report the merge of ' + story + ' while it was in diagram: ' + JSON.stringify(changes.map(change => [change.story, change.status])));
    const seen = rig.event(story, 'pr-observed', item => item.observation?.status === 'merged');
    expect(seen && seen.phase === 'diagram', 'No merged pr-observed event was recorded in diagram.');
  });
  await rig.step('a background Jarvis releases Rocket, records the merge, and the story moves to the retro with the merge recorded', async () => {
    await rig.until('Jarvis to record the merge', () => rig.event(story, 'merged'), 60000);
    const merged = rig.event(story, 'merged');
    const released = rig.event(story, 'release-worker', item => item.worker?.role === 'diagrammer');
    expect(released && released.seq < merged.seq, 'Jarvis did not release Rocket before recording the merge.');
    const now = rig.snapshot(story);
    expect(now.phase === 'retro' && now.retro?.mergedAt, 'The merge did not start the retro with the merge recorded: ' + JSON.stringify(now.retro));
    expect(rig.jarvisWakes(story).some(wake => wake.seq < merged.seq), 'Jarvis was not woken before the merge was recorded.');
  });
  await rig.step('the retro runs and its handoff closes the story', async () => {
    await rig.worker(story, 2, 'the retro to close the story', () => rig.snapshot(story).phase === 'closed');
    const closed = rig.snapshot(story);
    expect(closed.retro?.completedAt && /lessons recorded after the merge/.test(closed.retro.detail), 'The retro handoff was not recorded: ' + JSON.stringify(closed.retro));
    const retro = rig.history(story).filter(item => item.type === 'turn-started').at(-1);
    expect(retro.seq > rig.event(story, 'merged').seq, 'The retro worker did not start after the merge.');
    await rig.until('the retro worker process to end', () => rig.processEnded(retro.worker.turn.pid));
  });
}
