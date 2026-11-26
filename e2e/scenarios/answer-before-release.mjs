import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from '../rig.mjs';

export const title = 'An answer given while the worker is still in its turn reaches the replacement it released for, and the released session is never resumed';

const story = 'E2E-MIDTURN';

export async function run(rig) {
  rig.create(story);
  const storeUrl = pathToFileURL(join(dirname(rig.console), 'store.mjs')).href;
  const holdUntilAnswered = `const { openStore } = await import(${JSON.stringify(storeUrl)});
const store = openStore(${JSON.stringify(rig.db)});
const deadline = Date.now() + 60000;
while (!store.handover(${JSON.stringify(story)}).story.questions.find(q => q.id === 'runtime')?.answer) {
  if (Date.now() > deadline) process.exit(1);
  await new Promise(resolve => setTimeout(resolve, 200));
}
await new Promise(resolve => setTimeout(resolve, ${rig.quietMs * 2}));
store.close();`;
  rig.playbook(story, { next: 'You replace a worker that stopped on story ' + story + '.', turns: [
    { role: 'planner', phase: 'planning', turn: 'first', worker: 1, steps: [
      { record: { type: 'question', question: 'runtime', prompt: 'Install the runtime?', options: ['install', 'hold'], recommended: 1 } },
      { run: ['node', '--input-type=module', '-e', holdUntilAnswered] },
      { record: { type: 'release-worker', detail: 'Stopped after the answer arrived.' } },
    ] },
    { role: 'planner', phase: 'planning', turn: 'first', worker: 2, steps: [
      { record: { type: 'activity', detail: 'E2E replacement ready' } },
    ] },
    { role: 'planner', phase: 'planning', turn: 'resumed', worker: 2, steps: [
      { record: { type: 'activity', detail: 'E2E answer received: {{answer:runtime}}' } },
      { ack: ['answer'] },
    ] },
  ] });
  const first = await rig.step(rig.harness + ' starts a worker', () => rig.start(story, 'You are the scripted worker for story ' + story + '.'));
  const answer = await rig.step('the worker asks, and the owner answers while its turn is still running', async () => {
    await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    expect(rig.snapshot(story).worker?.turn, 'The first turn already ended.');
    return rig.decide({ story, type: 'answer', question: 'runtime', answer: 0 });
  });
  await rig.step('the worker releases in that same turn, after the answer', async () => {
    const released = await rig.until('the release', () => rig.event(story, 'release-worker'));
    expect(released.seq > answer.seq, 'The worker released before the answer.');
  });
  await rig.step('the replacement is assigned, handles the answer after its kickoff, and acknowledges it', async () => {
    const assigned = await rig.until('the replacement to be assigned', () => rig.event(story, 'assign-worker', item => item.seq > answer.seq), 120000);
    expect(assigned.worker.session !== first.session, 'The replacement reused the released session.');
    const ready = await rig.until('the replacement reporting ready', () => rig.event(story, 'activity', item => /E2E replacement ready/i.test(item.detail)), 90000);
    const acted = await rig.until('the replacement acting on the answer', () => rig.event(story, 'activity', item => /E2E answer received: install/i.test(item.detail)), 90000);
    expect(acted.worker.session === assigned.worker.session && ready.seq < acted.seq, 'The answer was not handled by the replacement after its kickoff.');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq));
    await rig.until('the end of the replacement\'s turns', () => rig.turnsEnded(story, 2));
  });
  await rig.step('the released session was never resumed, and the daemon never reported a turn with nobody to record it for', async () => {
    const resumed = rig.calls().filter(call => call.session === first.session && call.actor !== 'jarvis').length - 1;
    expect(resumed === 0, 'The released session ' + first.session + ' was resumed ' + resumed + ' time(s).');
    expect(!rig.daemonSaid(/no worker is assigned/), 'The daemon reported a worker turn it could not record because no worker was assigned.');
  });
}
