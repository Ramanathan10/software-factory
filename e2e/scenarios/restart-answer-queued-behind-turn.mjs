import { expect } from '../rig.mjs';

export const title = 'An answer waiting behind a running turn when the daemon restarts, whether its batch fired or not, is handed to the same worker once the adopted turn ends, and Jarvis is not woken';

const ask = { record: { type: 'question', question: 'color', prompt: 'Which color?', options: ['red', 'blue'], recommended: 0 } };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const holds = ms => ({ run: ['node', '-e', 'setTimeout(() => {}, ' + ms + ')'] });

async function restartWith(rig, story, pauseMs) {
  rig.playbook(story, { turns: [
    { role: 'planner', phase: 'planning', turn: 'first', steps: [ask, holds(rig.quietMs * 7)] },
    { role: 'planner', phase: 'planning', turn: 'resumed', steps: [
      { record: { type: 'activity', detail: 'E2E answer received: {{answer:color}}' } },
      { ack: ['answer'] },
    ] },
  ] });
  rig.create(story);
  const first = await rig.step('start a worker whose first turn asks a question and keeps running', async () => {
    const started = await rig.start(story, 'You are the scripted worker for story ' + story + '.');
    await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    return started;
  });
  const answer = await rig.step('the owner answers while the turn runs, and the daemon restarts ' + (pauseMs ? 'after the batch fired' : 'inside the batch window'), async () => {
    const recorded = await rig.decide({ story, type: 'answer', question: 'color', answer: 1 });
    await sleep(pauseMs);
    expect(rig.snapshot(story).worker?.turn, 'The turn ended before the daemon restarted, so this run cannot show the bug.');
    await rig.restart();
    expect(rig.snapshot(story).worker?.turn || rig.turnsEnded(story, 1), 'The story lost its turn across the restart.');
    return recorded;
  });
  await rig.step('when the adopted turn ends, the new daemon resumes the same session, which acts on the answer and acknowledges it', async () => {
    const acted = await rig.until('the worker acting on the answer', () => rig.event(story, 'activity', item => /E2E answer received: blue/.test(item.detail)), 40000);
    expect(acted.worker.session === first.session, 'A different session acted on the answer.');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq), 10000);
    await rig.until('the end of the resumed turn', () => rig.turnsEnded(story, 2), 20000);
  });
  await rig.step('the history shows the adopted turn ending before the resumed turn starts, one resume, and no Jarvis wake', async () => {
    const turns = rig.history(story).filter(item => ['turn-started', 'turn-ended'].includes(item.type)).map(item => item.type);
    expect(turns.join(' ') === 'turn-started turn-ended turn-started turn-ended', 'The turns were ' + turns.join(', ') + '.');
    const runs = rig.calls().filter(call => call.session === first.session).length;
    expect(runs === 2, 'The session ran ' + runs + ' times, not a first turn and one resumed turn.');
    expect(rig.jarvisWakes(story).length === 0, 'Jarvis was woken for a decision the worker owns.');
  });
}

export async function run(rig) {
  await restartWith(rig, 'E2E-RESTART-QUEUED', rig.quietMs + 500);
  await restartWith(rig, 'E2E-RESTART-WINDOW', 0);
}
