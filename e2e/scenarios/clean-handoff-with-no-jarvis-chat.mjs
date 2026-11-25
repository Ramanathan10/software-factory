import { expect } from '../rig.mjs';

export const title = 'A worker releases and hands off with no Jarvis chat open; a background Jarvis staffs the next worker within a minute';

const story = 'E2E-HANDOFF';

export async function run(rig) {
  rig.create(story, { scouted: false });
  rig.playbook(story, { next: 'You are the next worker on story ' + story + '.', turns: [
    { role: 'scout', phase: 'scout', turn: 'first', steps: [
      { record: { type: 'release-worker', detail: 'Scout finished.' } },
      { record: { type: 'handoff', detail: 'E2E context pack ready.' } },
    ] },
    { role: 'planner', phase: 'planning', turn: 'first', steps: [
      { record: { type: 'activity', detail: 'E2E next worker ready' } },
    ] },
  ] });
  await rig.step(rig.harness + ' starts a scout', () => rig.start(story, 'You are the scripted scout for story ' + story + '.'));
  const handoff = await rig.step('the scout releases, hands off, and its process ends', async () => {
    const handed = await rig.until('the handoff', () => rig.event(story, 'handoff'));
    const released = rig.event(story, 'release-worker');
    expect(released && released.seq < handed.seq, 'The scout did not release before handing off.');
    await rig.until('the scout process to end', () => rig.processEnded(rig.event(story, 'turn-started').worker.turn.pid));
    return handed;
  });
  await rig.step('with nobody waiting on the console, a background Jarvis turn starts and the next worker is assigned within 60 seconds of the handoff', async () => {
    const assigned = await rig.until('the next worker to be assigned', () => rig.event(story, 'assign-worker', item => item.seq > handoff.seq), 60000);
    const seconds = (Date.parse(assigned.at) - Date.parse(handoff.at)) / 1000;
    expect(seconds <= 60, 'The next worker was assigned ' + seconds + 's after the handoff.');
    const woken = rig.jarvisWakes(story);
    expect(woken.length >= 1 && woken[0].seq < assigned.seq, 'No background Jarvis turn was recorded before the assignment.');
    expect(assigned.worker.role === 'planner', 'The next worker is a ' + assigned.worker.role + ', not the planner.');
    console.log('# next worker assigned ' + seconds.toFixed(1) + 's after the handoff');
  });
  await rig.step('the next worker follows its kickoff, and the background Jarvis turn ends', async () => {
    await rig.worker(story, 1, 'reporting ready', () => rig.event(story, 'activity', item => /E2E next worker ready/i.test(item.detail)));
    await rig.until('the next worker\'s turn to end', () => rig.turnsEnded(story, 1));
    await rig.until('the background Jarvis turn to end', () => {
      const jarvis = rig.snapshot(story).jarvis;
      return jarvis && !jarvis.turn && jarvis.lastTurn;
    });
    const jarvis = rig.snapshot(story).jarvis;
    expect(jarvis.lastTurn.outcome === 'ended', 'The background Jarvis turn ' + jarvis.lastTurn.outcome + '.');
    expect(rig.jarvisWakes(story).length <= 2, 'Jarvis was woken ' + rig.jarvisWakes(story).length + ' times for one handoff.');
  });
}
