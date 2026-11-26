import { expect } from '../rig.mjs';

export const title = 'A story Jarvis leaves unstaffed after its no-news wake is put to the owner on its card, and Hold stops every further wake';

const story = 'E2E-IDLE-HOLD';

export async function run(rig) {
  rig.create(story);
  rig.playbook(story, { jarvis: [
    { wake: 1, steps: [{ ack: ['handoff'] }] },
    { wake: 2, steps: [] },
  ] });
  await rig.step('a background Jarvis turn takes the handoff news and staffs nobody', async () => {
    await rig.until('the first Jarvis turn to end', () => rig.jarvisWakes(story).length >= 1 && rig.snapshot(story).jarvis?.lastTurn && !rig.snapshot(story).jarvis.turn, 60000);
    expect(!rig.snapshot(story).worker, 'Jarvis staffed the story.');
  });
  const notice = await rig.step('the daemon wakes Jarvis once more with no news, and when that turn staffs nobody the owner is asked to act', async () => {
    const asked = await rig.until('the stuck-story question', () => rig.snapshot(story).questions.find(question => question.id.startsWith('action-jarvis-')), 60000);
    expect(rig.jarvisWakes(story).length === 2, 'Jarvis was woken ' + rig.jarvisWakes(story).length + ' times, not twice.');
    expect(/^Action for you: nobody is working on E2E-IDLE-HOLD in planning, and Jarvis's turn did not staff it\. /.test(asked.prompt), 'The question reads: ' + asked.prompt);
    expect(/Then choose Done\.$/.test(asked.prompt), 'The question does not end with what to choose: ' + asked.prompt);
    expect(/^Done/.test(asked.options[0]) && /^Hold/.test(asked.options[1]), 'The options are ' + JSON.stringify(asked.options) + '.');
    return asked;
  });
  await rig.step('no third wake and no second question come while the owner has not answered', async () => {
    await new Promise(resolve => setTimeout(resolve, rig.quietMs * 3));
    expect(rig.jarvisWakes(story).length === 2, 'Jarvis was woken again before the owner answered.');
    expect(rig.snapshot(story).questions.filter(question => question.id.startsWith('action-jarvis-')).length === 1, 'The owner was asked twice.');
  });
  await rig.step('answering Hold leaves Jarvis stopped and the answer acknowledged', async () => {
    const recorded = await rig.decide({ story, type: 'answer', question: notice.id, answer: 1, revision: rig.snapshot(story).revision });
    await rig.until('the Hold to be acknowledged', () => rig.acknowledged(story, recorded.seq), 30000);
    await new Promise(resolve => setTimeout(resolve, rig.quietMs * 3));
    expect(rig.jarvisWakes(story).length === 2, 'Jarvis was woken after Hold.');
    expect(rig.snapshot(story).questions.filter(question => question.id.startsWith('action-jarvis-')).length === 1, 'The owner was asked again after Hold.');
  });
}
