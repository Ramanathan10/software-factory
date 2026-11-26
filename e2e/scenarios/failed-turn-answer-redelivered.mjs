import { expect } from '../rig.mjs';

export const title = 'An answer whose resumed turn failed after the settle window is handed again by deliver, to the same worker or to the replacement assigned by then';

const ask = { record: { type: 'question', question: 'color', prompt: 'Which color?', options: ['red', 'blue'], recommended: 0 } };
const failsOnce = (marker, ms) => ({ run: ['node', '-e', `const fs = require('fs'); if (fs.existsSync('${marker}')) process.exit(0); fs.writeFileSync('${marker}', 'failed once'); setTimeout(() => process.exit(1), ${ms});`] });

async function ownerAnswers(rig, story) {
  await rig.step('the worker asks and ends its turn', async () => {
    await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    await rig.until('the end of the first turn', () => rig.turnsEnded(story, 1));
  });
  return rig.step('the owner answers', () => rig.decide({ story, type: 'answer', question: 'color', answer: 1 }));
}

async function afterJarvisTurn(rig, story) {
  await rig.step('the failed turn wakes the background Jarvis, and its turn ends', async () => {
    await rig.until('a Jarvis wake after the failed turn', () => rig.event(story, 'jarvis-woken'));
    await rig.until('the Jarvis turn to end', () => !rig.snapshot(story).jarvis?.turn && !rig.snapshot(story).jarvis?.waking && rig.event(story, 'jarvis-turn-ended'));
  });
}

async function sameWorker(rig) {
  const story = 'E2E-REDELIVER-SAME';
  rig.create(story);
  rig.expectFailedTurns(story, 1);
  rig.playbook(story, { turns: [
    { role: 'planner', phase: 'planning', turn: 'first', worker: 1, steps: [ask] },
    { role: 'planner', phase: 'planning', turn: 'resumed', worker: 1, steps: [
      failsOnce('.redelivery-same', rig.quietMs * 3),
      { record: { type: 'activity', detail: 'E2E answer received: {{answer:color}}' } },
      { ack: ['answer'] },
    ] },
  ] });
  await rig.step('start worker 1', () => rig.start(story, 'You are the scripted worker for story ' + story + '.'));
  const answer = await ownerAnswers(rig, story);
  await rig.step('the resumed turn runs past the settle window and then fails, without acknowledging', async () => {
    await rig.until('the end of the resumed turn', () => rig.turnsEnded(story, 2));
    const ended = rig.history(story).filter(item => item.type === 'turn-ended').at(-1);
    expect(ended.worker.lastTurn.outcome === 'failed', 'The resumed turn ended as ' + ended.worker.lastTurn.outcome + ', not as a failure after the settle window.');
    expect(!rig.acknowledged(story, answer.seq), 'The answer was acknowledged.');
  });
  await afterJarvisTurn(rig, story);
  await rig.step('deliver hands the still-pending answer to the same worker, which acknowledges it', async () => {
    const result = await rig.deliver(story);
    expect(result.seqs.includes(answer.seq) && result.told === 'worker', 'deliver handed ' + JSON.stringify(result) + ' while the answer is pending.');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq));
    await rig.until('the end of the redelivered turn', () => rig.turnsEnded(story, 3));
    expect(rig.event(story, 'activity', item => /E2E answer received: blue/.test(item.detail)), 'The redelivered turn did not act on the answer.');
  });
  await rig.step('an acknowledged answer is not handed again', async () => {
    const result = await rig.deliver(story);
    expect(result.seqs.length === 0, 'deliver handed ' + JSON.stringify(result) + ' after the answer was acknowledged.');
  });
}

async function replacement(rig) {
  const story = 'E2E-REDELIVER-NEW';
  rig.create(story);
  rig.playbook(story, { next: 'You replace a worker that stopped on story ' + story + '.', turns: [
    { role: 'planner', phase: 'planning', turn: 'first', worker: 1, steps: [ask] },
    { role: 'planner', phase: 'planning', turn: 'resumed', worker: 1, steps: [
      { record: { type: 'release-worker', detail: 'Stopped after the answer arrived.' } },
      failsOnce('.redelivery-new', rig.quietMs * 3),
    ] },
    { role: 'planner', phase: 'planning', turn: 'first', worker: 2, steps: [
      { record: { type: 'activity', detail: 'E2E replacement kickoff done.' } },
    ] },
    { role: 'planner', phase: 'planning', turn: 'resumed', worker: 2, steps: [
      { record: { type: 'activity', detail: 'E2E replacement received: {{answer:color}}' } },
      { ack: ['answer'] },
    ] },
  ] });
  const first = await rig.step('start worker 1', () => rig.start(story, 'You are the scripted worker for story ' + story + '.'));
  const answer = await ownerAnswers(rig, story);
  await rig.step('worker 1 releases during the resumed turn, which goes on to fail after the settle window', async () => {
    const released = await rig.until('the release', () => rig.event(story, 'release-worker'));
    expect(released.seq > answer.seq, 'The worker released before the answer.');
    expect(!rig.acknowledged(story, answer.seq), 'The answer was acknowledged.');
  });
  await rig.step('a replacement is assigned, and its kickoff acknowledges nothing', async () => {
    const assigned = await rig.until('the replacement to be assigned', () => rig.event(story, 'assign-worker', item => item.seq > answer.seq), 120000);
    expect(assigned.worker.session !== first.session, 'The replacement reused the released session.');
    await rig.until('the replacement kickoff', () => rig.event(story, 'activity', item => /E2E replacement kickoff done/.test(item.detail)), 90000);
  });
  await afterJarvisTurn(rig, story);
  await rig.step('deliver hands the pending answer to the replacement, whose resumed turn acknowledges it', async () => {
    const replacement = rig.snapshot(story).worker;
    const kickoff = rig.event(story, 'activity', item => /E2E replacement kickoff done/.test(item.detail));
    const received = () => rig.event(story, 'activity', item => /E2E replacement received: blue/.test(item.detail));
    if (!received()) {
      expect(!rig.acknowledged(story, answer.seq), 'The kickoff acknowledged the answer.');
      const result = await rig.deliver(story);
      expect(result.seqs.includes(answer.seq) && result.told === 'worker', 'deliver handed ' + JSON.stringify(result) + ' while the answer is pending.');
    }
    await rig.until('the replacement acting on the answer', received, 90000);
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq));
    expect(received().seq > kickoff.seq && received().worker.session === replacement.session, 'The answer was not handled by the replacement after its kickoff.');
    const resumes = rig.calls().filter(call => call.session === replacement.session && call.actor !== 'jarvis').length;
    expect(resumes === 2, 'The replacement session ran ' + resumes + ' turns, not a kickoff and one resumed turn.');
    await rig.until('the end of the replacement\'s turns', () => rig.turnsEnded(story, 3));
  });
}

export async function run(rig) {
  await sameWorker(rig);
  await replacement(rig);
}
