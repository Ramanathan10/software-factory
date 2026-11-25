import { expect } from '../rig.mjs';

export const title = 'A worker that asks a question keeps its assignment, and the owner\'s answer resumes its session';

const story = 'E2E-KEEPS';

export async function run(rig) {
  rig.create(story);
  rig.playbook(story, { turns: [
    { role: 'planner', phase: 'planning', turn: 'first', steps: [
      { record: { type: 'question', question: 'color', prompt: 'Which color?', options: ['red', 'blue'], recommended: 0 } },
    ] },
    { role: 'planner', phase: 'planning', turn: 'resumed', steps: [
      { record: { type: 'activity', detail: 'E2E answer received: {{answer:color}}' } },
      { ack: ['answer'] },
    ] },
  ] });
  const first = await rig.step(rig.harness + ' starts a worker and the daemon assigns it', async () => {
    const started = await rig.start(story, 'You are the scripted worker for story ' + story + '.');
    expect(rig.snapshot(story).worker?.session === started.session, 'The story is not assigned to the session the start call printed.');
    return started;
  });
  const question = await rig.step('the worker asks its question, keeps its assignment, and its turn is recorded as ended', async () => {
    const asked = await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    await rig.until('the end of the first turn', () => rig.turnsEnded(story, 1));
    expect(rig.snapshot(story).worker?.session === first.session, 'The worker released its assignment.');
    return asked;
  });
  const answer = await rig.step('the owner answers in the console, and the wait stays quiet because a worker is assigned', async () => {
    const recorded = await rig.decide({ story, type: 'answer', question: 'color', answer: 1 });
    expect((await rig.waitAny(question.seq, 0)).every(item => item.type !== 'answer'), 'The wait reported an answer that has a worker to take it.');
    return recorded;
  });
  await rig.step('the daemon resumes the same session, which reads the answer and acknowledges it', async () => {
    const acted = await rig.worker(story, 2, 'acting on the answer', () => rig.event(story, 'activity', item => /E2E answer received: blue/i.test(item.detail)));
    expect(acted.worker.session === first.session, 'A different session acted on the answer.');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq));
    await rig.until('the end of the second turn', () => rig.turnsEnded(story, 2));
    expect(rig.history(story).filter(item => item.type === 'turn-started').length === 2, 'Expected exactly two turns on the session.');
  });
}
