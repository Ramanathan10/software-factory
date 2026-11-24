import { expect, onAnswer } from '../rig.mjs';

export const title = 'A worker that releases before it asks leaves an answer nobody can take; Jarvis hears it and a replacement handles it';

const story = 'E2E-RELEASES';

export async function run(rig) {
  rig.create(story);
  const gone = await rig.step(rig.harness + ' starts a worker', () => rig.start(story, [
    rig.brief(story),
    'Steps for this turn:',
    '1. Read the story.',
    '2. Record {"story":"' + story + '","type":"release-worker","assignment":"<story.worker.id>","detail":"Stopped at a blocker."} with key and revision filled in.',
    '3. Record {"story":"' + story + '","type":"question","question":"runtime","prompt":"Install the runtime?","options":["install","hold"],"recommended":1} with key and the new revision filled in.',
    '4. End your turn. Do nothing else, now or later.',
  ].join('\n\n')));
  const question = await rig.step('the worker releases, then asks, and its process ends', async () => {
    const asked = await rig.worker(story, 1, 'the question', () => rig.event(story, 'question'));
    const released = rig.event(story, 'release-worker');
    expect(released && released.seq < asked.seq, 'The worker did not release before asking.');
    expect(!rig.snapshot(story).worker, 'The story still has a worker.');
    await rig.until('the worker process to end', () => rig.processEnded(rig.event(story, 'turn-started').worker.turn.pid));
    return asked;
  });
  const answer = await rig.step('the owner answers, nobody can take it, and the background wait ends with that answer', async () => {
    const waiting = rig.waitAny(question.seq, 60);
    const recorded = await rig.decide({ story, type: 'answer', question: 'runtime', answer: 0 });
    const news = await waiting;
    expect(news.length === 1 && news[0].type === 'answer' && news[0].seq === recorded.seq, 'The wait ended with ' + JSON.stringify(news.map(item => item.type)) + ' instead of the answer.');
    await rig.until('the daemon to report the decision undelivered', () => rig.daemonSaid(new RegExp(story + '.*no worker is assigned')), 10000);
    expect(!rig.acknowledged(story, recorded.seq), 'The answer did not stay pending.');
    return recorded;
  });
  const replacement = await rig.step('a replacement is started, as the runbook tells Jarvis to', async () => {
    const started = await rig.start(story, [
      rig.brief(story),
      'You replace a worker that stopped.',
      'Steps for this turn:',
      '1. Read the story.',
      '2. Record {"story":"' + story + '","type":"activity","assignment":"<story.worker.id>","detail":"E2E replacement ready"} with key and revision filled in.',
      '3. End your turn now. Do not act on any pending event yet.',
      onAnswer(story, 'runtime'),
    ].join('\n\n'));
    expect(started.session !== gone.session, 'The replacement reused the released session.');
    return started;
  });
  await rig.step('the pending answer is delivered to the replacement after its kickoff turn', async () => {
    const handed = await rig.deliver(story);
    expect(handed.told === 'worker' && handed.seqs.includes(answer.seq), 'Delivery reported ' + JSON.stringify(handed) + '.');
    const ready = await rig.worker(story, 1, 'reporting ready', () => rig.event(story, 'activity', item => /E2E replacement ready/i.test(item.detail)));
    const acted = await rig.worker(story, 2, 'acting on the answer', () => rig.event(story, 'activity', item => /E2E answer received: install/i.test(item.detail)));
    expect(acted.worker.session === replacement.session && ready.seq < acted.seq, 'The answer was not handled by the replacement after its kickoff.');
    await rig.until('the acknowledgement', () => rig.acknowledged(story, answer.seq));
    await rig.until('the end of the replacement\'s turns', () => rig.turnsEnded(story, 2));
  });
}
