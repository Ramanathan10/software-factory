import { expect } from '../rig.mjs';

export const title = 'A merge recorded while the retro worker is assigned keeps the retro open, so the owner\'s answer reaches the same worker, and the worker releases itself with the lessons and Jarvis closes the story';

const story = 'E2E-RETRO';

export async function run(rig) {
  rig.create(story);
  await rig.step('the story reaches the retro with its pull request open', () => {
    rig.record(story, 'plan', { detail: 'Plan.' });
    rig.record(story, 'approve');
    rig.record(story, 'handoff', { detail: 'Tests ready.' });
    rig.record(story, 'handoff', { detail: 'Valid red.', command: 'npm test' });
    rig.record(story, 'handoff', { detail: 'Verified green.', command: 'npm test' });
    rig.record(story, 'handoff', { detail: 'Gates passed.', command: 'npm run lint' });
    rig.record(story, 'handoff', { detail: 'No survivors.', command: 'npx stryker run' });
    rig.record(story, 'handoff', { detail: 'Review passed.' });
    rig.record(story, 'comparison-choice', { run: false });
    rig.record(story, 'pr-opened', { url: 'https://github.com/example/repo/pull/9' });
    rig.record(story, 'retro-start', { detail: 'Review lessons.' });
    expect(rig.snapshot(story).phase === 'retro', 'The story is not in the retro.');
  });
  rig.playbook(story, {
    jarvis: [
      { wake: 1, steps: [
        { record: { type: 'handoff', detail: 'E2E lessons: {{answer:lesson}}', by: 'jarvis' } },
      ] },
    ],
    turns: [
      { role: 'coordinator', phase: 'retro', turn: 'first', steps: [
        { record: { type: 'question', question: 'lesson', prompt: 'Keep the lesson?', options: ['keep', 'drop'], recommended: 0 } },
      ] },
      { role: 'coordinator', phase: 'retro', turn: 'resumed', steps: [
        { record: { type: 'activity', detail: 'E2E answer received: {{answer:lesson}}' } },
        { ack: ['answer'] },
        { record: { type: 'release-worker', detail: 'E2E lessons: {{answer:lesson}}' } },
      ] },
    ] });
  const first = await rig.step(rig.harness + ' starts the retro worker, which asks its question', async () => {
    const started = await rig.start(story, 'You are the scripted retro worker for story ' + story + '.');
    await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    await rig.until('the end of the first turn', () => rig.turnsEnded(story, 1));
    return started;
  });
  await rig.step('Jarvis records the merge without releasing the retro worker, and the story stays in the retro', () => {
    rig.record(story, 'merged', { detail: 'Merged during the retro.', by: 'jarvis' });
    const held = rig.snapshot(story);
    expect(held.phase === 'retro', 'The story left the retro on the merge: ' + held.phase + '.');
    expect(held.worker?.session === first.session, 'The retro worker was released by the merge.');
  });
  const answer = await rig.step('the owner answers the open retro question', async () => {
    const recorded = await rig.decide({ story, type: 'answer', question: 'lesson', answer: 1 });
    expect(rig.snapshot(story).questions.find(item => item.id === 'lesson')?.answer === 'drop', 'The answer was not recorded.');
    return recorded;
  });
  await rig.step('the same worker receives the answer and releases itself with the lessons, and the woken Jarvis closes the story', async () => {
    const acted = await rig.worker(story, 2, 'acting on the answer', () => rig.event(story, 'activity', item => /E2E answer received: drop/i.test(item.detail)));
    expect(acted.worker.session === first.session, 'A different session acted on the answer.');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq));
    await rig.until('the story to close', () => rig.snapshot(story).phase === 'closed');
    const released = rig.event(story, 'release-worker');
    expect(released?.detail === 'E2E lessons: drop', 'The worker did not release itself with the lessons: ' + released?.detail);
    const closed = rig.snapshot(story);
    expect(closed.retro.detail === 'E2E lessons: drop', 'The lessons were not recorded: ' + closed.retro.detail);
    await rig.until('the second turn process to end', () => rig.processEnded(rig.history(story).filter(item => item.type === 'turn-started').at(-1).worker.turn.pid));
  });
}
