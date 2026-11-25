import { expect } from '../rig.mjs';

export const title = 'A worker that releases before it asks leaves an answer nobody can take; a background Jarvis staffs a replacement that handles it';

const story = 'E2E-RELEASES';

export async function run(rig) {
  rig.create(story);
  rig.playbook(story, { next: 'You replace a worker that stopped on story ' + story + '.', turns: [
    { role: 'planner', phase: 'planning', turn: 'first', worker: 1, steps: [
      { record: { type: 'release-worker', detail: 'Stopped at a blocker.' } },
      { record: { type: 'question', question: 'runtime', prompt: 'Install the runtime?', options: ['install', 'hold'], recommended: 1 } },
    ] },
    { role: 'planner', phase: 'planning', turn: 'first', worker: 2, steps: [
      { record: { type: 'activity', detail: 'E2E replacement ready' } },
    ] },
    { role: 'planner', phase: 'planning', turn: 'resumed', worker: 2, steps: [
      { record: { type: 'activity', detail: 'E2E answer received: {{answer:runtime}}' } },
      { ack: ['answer'] },
    ] },
  ] });
  const gone = await rig.step(rig.harness + ' starts a worker', () => rig.start(story, 'You are the scripted worker for story ' + story + '.'));
  const question = await rig.step('the worker releases, then asks, and its process ends', async () => {
    const asked = await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    const released = rig.event(story, 'release-worker');
    expect(released && released.seq < asked.seq, 'The worker did not release before asking.');
    expect(!rig.snapshot(story).worker, 'The story still has a worker.');
    await rig.until('the worker process to end', () => rig.processEnded(rig.event(story, 'turn-started').worker.turn.pid));
    return asked;
  });
  const answer = await rig.step('the owner answers, nobody can take it, and it is handed to the background Jarvis rather than only logged', async () => {
    const recorded = await rig.decide({ story, type: 'answer', question: 'runtime', answer: 0 });
    const woken = await rig.until('a background Jarvis turn for the answer', () => rig.jarvisWakes(story).find(item => item.seq > recorded.seq), 60000);
    expect(woken, 'No background Jarvis turn was recorded.');
    expect(!rig.daemonSaid(new RegExp(story + '.*no worker is assigned')), 'The daemon only logged the answer as undelivered.');
    expect(question.seq < recorded.seq, 'The answer was recorded before the question.');
    return recorded;
  });
  await rig.step('the background Jarvis staffs a replacement, which handles the answer after its kickoff', async () => {
    const assigned = await rig.until('the replacement to be assigned', () => rig.event(story, 'assign-worker', item => item.seq > answer.seq), 120000);
    expect(assigned.worker.session !== gone.session, 'The replacement reused the released session.');
    const ready = await rig.worker(story, 1, 'reporting ready', () => rig.event(story, 'activity', item => /E2E replacement ready/i.test(item.detail)));
    const acted = await rig.worker(story, 2, 'acting on the answer', () => rig.event(story, 'activity', item => /E2E answer received: install/i.test(item.detail)));
    expect(acted.worker.session === assigned.worker.session && ready.seq < acted.seq, 'The answer was not handled by the replacement after its kickoff.');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq));
    await rig.until('the end of the replacement\'s turns', () => rig.turnsEnded(story, 2));
  });
}
