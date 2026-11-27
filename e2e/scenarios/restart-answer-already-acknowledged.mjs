import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from '../rig.mjs';

export const title = 'When the daemon restarts during a turn that carries an answer and the worker acknowledges it before the turn ends, the new daemon does not resume the worker again';

const story = 'E2E-RESTART-ACKED';
const waitFor = marker => ({ run: ['node', '-e', 'const fs = require("fs"); const file = process.argv.at(-1); (function wait() { if (fs.existsSync(file)) process.exit(0); setTimeout(wait, 100); })();', marker] });

export async function run(rig) {
  const marker = join(rig.home, 'restarted');
  rig.create(story);
  rig.playbook(story, { turns: [
    { role: 'planner', phase: 'planning', turn: 'first', steps: [
      { record: { type: 'question', question: 'color', prompt: 'Which color?', options: ['red', 'blue'], recommended: 0 } },
    ] },
    { role: 'planner', phase: 'planning', turn: 'resumed', steps: [
      { record: { type: 'activity', detail: 'E2E answer received: {{answer:color}}' } },
      waitFor(marker),
      { ack: ['answer'] },
    ] },
  ] });
  const answered = {};
  const first = await rig.step('a worker asks its question and ends its turn, and the owner\'s answer starts a resumed turn', async () => {
    const started = await rig.start(story, 'You are the scripted worker for story ' + story + '.');
    await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    await rig.until('the end of the first turn', () => rig.turnsEnded(story, 1));
    answered.seq = (await rig.decide({ story, type: 'answer', question: 'color', answer: 1 })).seq;
    await rig.until('the resumed turn reading the answer', () => rig.event(story, 'activity', item => /E2E answer received: blue/.test(item.detail)), 30000);
    return started;
  });
  await rig.step('the daemon restarts while that turn waits, then the worker acknowledges the answer and the turn ends', async () => {
    expect(rig.snapshot(story).worker?.turn, 'The resumed turn ended before the daemon restarted.');
    await rig.restart();
    writeFileSync(marker, 'restarted');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answered.seq), 20000);
    await rig.until('the end of the resumed turn', () => rig.turnsEnded(story, 2), 20000);
  });
  await rig.step('the new daemon does not resume the worker for the answer it already handled', async () => {
    await new Promise(resolve => setTimeout(resolve, rig.quietMs * 3));
    const runs = rig.calls().filter(call => call.session === first.session).length;
    expect(runs === 2, 'The session ran ' + runs + ' times; the answer was handed again after it was acknowledged.');
    expect(rig.history(story).filter(item => item.type === 'turn-started').length === 2, 'A third turn started.');
    expect(rig.jarvisWakes(story).length === 0, 'Jarvis was woken.');
  });
}
