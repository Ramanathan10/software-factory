import { expect } from '../rig.mjs';

export const title = 'An answer recorded inside the batch window for an idle assigned worker is handed to it by the daemon that starts next, without waiting for any turn and without waking Jarvis';

const story = 'E2E-RESTART-IDLE';

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
  const first = await rig.step('a worker asks its question, keeps its assignment, and its turn ends', async () => {
    const started = await rig.start(story, 'You are the scripted worker for story ' + story + '.');
    await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    await rig.until('the end of the first turn', () => rig.turnsEnded(story, 1));
    expect(rig.snapshot(story).worker?.session === started.session, 'The worker released its assignment.');
    return started;
  });
  const answer = await rig.step('the owner answers, and the daemon restarts inside the batch window', async () => {
    const recorded = await rig.decide({ story, type: 'answer', question: 'color', answer: 1 });
    expect(!rig.acknowledged(story, recorded.seq), 'The answer was acknowledged before the restart.');
    await rig.restart();
    return recorded;
  });
  await rig.step('the new daemon resumes the same session, which acts on the answer and acknowledges it', async () => {
    const acted = await rig.until('the worker acting on the answer', () => rig.event(story, 'activity', item => /E2E answer received: blue/.test(item.detail)), 30000);
    expect(acted.worker.session === first.session, 'A different session acted on the answer.');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq), 10000);
    await rig.until('the end of the resumed turn', () => rig.turnsEnded(story, 2), 20000);
  });
  await rig.step('the session ran two turns and Jarvis was not woken', async () => {
    const runs = rig.calls().filter(call => call.session === first.session).length;
    expect(runs === 2, 'The session ran ' + runs + ' times, not a first turn and one resumed turn.');
    expect(rig.jarvisWakes(story).length === 0, 'Jarvis was woken for a decision the worker owns.');
  });
}
