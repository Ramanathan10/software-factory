import { expect } from '../rig.mjs';

export const title = 'A scout that releases, hands off and keeps planning leaves nobody working; Jarvis acks twice without staffing, and the daemon wakes it again until the planner is staffed';

const story = 'E2E-IDLE-SCOUT';

export async function run(rig) {
  rig.create(story, { scouted: false });
  rig.playbook(story, { next: 'You are the planner for story ' + story + '.',
    jarvis: [
      { wake: 1, steps: [{ ack: ['release-worker', 'handoff', 'question'] }] },
      { wake: 2, steps: [{ ack: ['answer'] }] },
    ],
    turns: [
      { role: 'scout', phase: 'scout', turn: 'first', steps: [
        { record: { type: 'release-worker', detail: 'Scout finished.' } },
        { record: { type: 'handoff', detail: 'E2E context pack ready.' } },
        { record: { type: 'draft-plan', detail: 'E2E working plan from the scout.' } },
        { record: { type: 'question', question: 'scope', prompt: 'Which rows?', options: ['All', 'Selected'], recommended: 0 } },
        { record: { type: 'question', question: 'format', prompt: 'Which format?', options: ['CSV', 'JSON'], recommended: 0 } },
      ] },
      { role: 'planner', phase: 'planning', turn: 'first', steps: [
        { record: { type: 'activity', detail: 'E2E planner staffed' } },
      ] },
    ] });
  await rig.step(rig.harness + ' starts a scout that releases, hands off, then plans with no assignment and asks', async () => {
    await rig.start(story, 'You are the scripted scout for story ' + story + '.');
    await rig.worker(story, 1, 'both questions', () => rig.snapshot(story).questions.length === 2);
    const planning = rig.snapshot(story);
    expect(planning.phase === 'planning', 'The story is in ' + planning.phase + ', not planning.');
    expect(!planning.worker, 'The story still has a worker.');
    expect(planning.draftPlan, 'The scout recorded no draft plan.');
  });
  await rig.step('a background Jarvis turn acks the news without staffing anyone', async () => {
    await rig.until('the first Jarvis turn to end', () => rig.jarvisWakes(story).length >= 1 && rig.snapshot(story).jarvis?.lastTurn && !rig.snapshot(story).jarvis.turn, 60000);
    expect(!rig.snapshot(story).worker, 'Jarvis staffed the story on its first turn.');
  });
  await rig.step('the owner answers, and delivering to a story with nobody on it says nobody was told, and why', async () => {
    for (const [question, answer] of [['scope', 1], ['format', 0]]) {
      await rig.decide({ story, type: 'answer', question, answer, revision: rig.snapshot(story).revision });
    }
    const reply = await rig.deliver(story);
    expect(reply.told === 'nobody', 'deliver said ' + JSON.stringify(reply.told) + ', not nobody.');
    expect(/^No worker is assigned to E2E-IDLE-SCOUT/.test(reply.reason ?? ''), 'deliver gave the reason ' + JSON.stringify(reply.reason) + '.');
  });
  await rig.step('a second Jarvis turn acks the answers and still staffs nobody', async () => {
    await rig.until('the second Jarvis turn to end', () => rig.jarvisWakes(story).length >= 2 && rig.snapshot(story).jarvis?.lastTurn && !rig.snapshot(story).jarvis.turn, 60000);
    expect(!rig.snapshot(story).worker, 'Jarvis staffed the story on its second turn.');
  });
  const staffed = await rig.step('with no worker, nothing pending and no open question, the daemon wakes Jarvis a third time and it staffs the planner', async () => {
    const woken = await rig.until('a third Jarvis wake', () => rig.jarvisWakes(story).length >= 3, 60000);
    expect(woken, 'Nobody woke Jarvis for the story left with no worker.');
    const assigned = await rig.until('the planner to be assigned', () => rig.event(story, 'assign-worker', item => item.worker?.role === 'planner'), 60000);
    expect(assigned.worker.role === 'planner', 'The next worker is a ' + assigned.worker.role + ', not the planner.');
    return assigned;
  });
  await rig.step('the planner follows its kickoff, and Jarvis is not woken again for the staffed story', async () => {
    await rig.worker(story, 1, 'reporting ready', () => rig.event(story, 'activity', item => /E2E planner staffed/i.test(item.detail)));
    await rig.until('the planner\'s turn to end', () => rig.turnsEnded(story, 1));
    await rig.until('the third Jarvis turn to end', () => rig.snapshot(story).jarvis?.lastTurn && !rig.snapshot(story).jarvis.turn);
    await new Promise(resolve => setTimeout(resolve, rig.quietMs * 3));
    expect(rig.snapshot(story).worker?.session === staffed.worker.session, 'The planner is no longer assigned.');
    expect(rig.jarvisWakes(story).length <= 4, 'Jarvis was woken ' + rig.jarvisWakes(story).length + ' times.');
    expect(!rig.snapshot(story).questions.some(question => question.id.startsWith('action-jarvis-') && !question.answer), 'The owner was asked to act on a story that is staffed.');
  });
}
