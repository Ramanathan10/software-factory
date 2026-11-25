import { expect } from '../rig.mjs';

export const title = 'A background Jarvis turn that fails asks the owner in plain words, and Jarvis is not run again until they answer';

export const profile = entry => ({ phaseTiers: { coordinator: 'fast' }, models: { [entry.id]: { fast: 'no-such-model-e2e' } } });

const story = 'E2E-JARVIS-FAILS';

export async function run(rig) {
  rig.create(story);
  const notice = await rig.step('news on a story with no worker wakes a background Jarvis, whose program fails, and the owner is asked what to do', async () => {
    const asked = await rig.until('the action question', () => rig.snapshot(story).questions.find(question => question.id.startsWith('action-jarvis-')), 90000);
    expect(rig.jarvisWakes(story).length === 1, 'Jarvis was woken ' + rig.jarvisWakes(story).length + ' times.');
    expect(['failed', 'lost'].includes(rig.snapshot(story).jarvis?.lastTurn?.outcome), 'The Jarvis turn is not recorded as failed.');
    expect(/^Action for you: Jarvis could not run for E2E-JARVIS-FAILS: /.test(asked.prompt), 'The question reads: ' + asked.prompt);
    expect(/Then choose Done\.$/.test(asked.prompt), 'The question does not end with what to choose: ' + asked.prompt);
    expect(/^Done/.test(asked.options[0]) && /^Hold/.test(asked.options[1]), 'The options are ' + JSON.stringify(asked.options) + '.');
    return asked;
  });
  await rig.step('no second Jarvis turn starts within three quiet periods while the owner has not answered', async () => {
    await new Promise(resolve => setTimeout(resolve, rig.quietMs * 3));
    expect(rig.jarvisWakes(story).length === 1, 'Jarvis was woken again before the owner answered.');
  });
  await rig.step('answering Hold leaves Jarvis stopped and the answer acknowledged', async () => {
    const recorded = await rig.decide({ story, type: 'answer', question: notice.id, answer: 1, revision: rig.snapshot(story).revision });
    await rig.until('the Hold to be acknowledged', () => rig.acknowledged(story, recorded.seq), 30000);
    await new Promise(resolve => setTimeout(resolve, rig.quietMs * 2));
    expect(rig.jarvisWakes(story).length === 1, 'Jarvis was woken after Hold.');
  });
}
