import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { workerPhases } from '../../mission-console/store.mjs';
import { expect } from '../rig.mjs';

export const title = 'A feature story runs from scout to an open pull request, with the lifecycle skills driving every phase and the owner deciding only in the console';

const exec = promisify(execFile);
const slashes = path => path.replaceAll('\\', '/');
const checkout = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/, '');
const skills = join(checkout, 'skills');
const preflight = join(skills, 'ai-sdlc-setup', 'scripts', 'preflight.mjs');
const git = (cwd, ...args) => exec('git', args, { cwd }).then(({ stdout }) => stdout.trim());

const story = 'E2E-FAREWELL';
const slug = 'e2e-owner/greetings';
const branch = 'story/E2E-FAREWELL-farewell';
const heading = 'Add a farewell greeting';
const workItem = [
  'Title: ' + heading,
  'Description: The greetings library can welcome a person but cannot say goodbye. Add a farewell beside the greeting.',
  'Acceptance criteria:',
  '- greet.mjs exports farewell(name), which returns "Goodbye, <name>!". farewell(\'Ada\') returns \'Goodbye, Ada!\'.',
  '- greet(name) behaves as before.',
  '- node --test passes, with a test for farewell.',
  'Out of scope: other languages, and names that are not strings.',
].join('\n');
const lifecycle = ['scout', 'planning', 'approval', 'testing', 'red', 'building', 'gates', 'mutation', 'review', 'comparison-choice', 'publishing', 'ci'];

const files = {
  'package.json': JSON.stringify({ name: 'greetings', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2) + '\n',
  'greet.mjs': 'export function greet(name) {\n  return `Hello, ${name}!`;\n}\n',
  'greet.test.mjs': "import assert from 'node:assert/strict';\nimport { test } from 'node:test';\nimport { greet } from './greet.mjs';\n\ntest('greet welcomes a person by name', () => {\n  assert.equal(greet('Ada'), 'Hello, Ada!');\n});\n",
  'AGENTS.md': '# Greetings\n\nA small library of greetings. Test it with `node --test`. Keep it free of package dependencies.\n',
};

async function makeRepository(rig) {
  const origin = join(rig.root, 'remote', ...slug.split('/')) + '.git';
  const primary = join(rig.root, 'greetings');
  const worktreeRoot = join(rig.root, 'greetings-worktrees');
  mkdirSync(origin, { recursive: true });
  mkdirSync(primary);
  await git(origin, 'init', '-q', '--bare', '--initial-branch=main');
  await git(primary, 'init', '-q', '--initial-branch=main');
  await git(primary, 'config', 'user.name', 'Factory E2E');
  await git(primary, 'config', 'user.email', 'factory-e2e@example.invalid');
  for (const [name, text] of Object.entries(files)) writeFileSync(join(primary, name), text);
  await git(primary, 'add', '.');
  await git(primary, 'commit', '-q', '-m', 'Start the greetings library');
  await git(primary, 'remote', 'add', 'origin', slashes(origin));
  await git(primary, 'push', '-q', '-u', 'origin', 'main');
  await git(primary, 'remote', 'set-head', 'origin', 'main');
  await git(primary, 'fetch', '-q', 'origin');
  const worktree = join(worktreeRoot, ...branch.split('/'));
  await git(primary, 'worktree', 'add', '-q', worktree, '-b', branch, 'origin/main');
  return { origin, primary, worktreeRoot, worktree, base: await git(primary, 'rev-parse', 'origin/main') };
}

function writeProfile(rig, repo) {
  writeFileSync(join(rig.home, 'profile.json'), JSON.stringify({
    ...rig.profile,
    schemaVersion: 1,
    ownerName: 'E2E Owner',
    crossModelReviewAuthorized: false,
    sharedResources: [],
    defaultVerificationEnvironment: 'localhost',
    declinedComponents: ['ffmpeg', 'hyperframes'],
    implementationLevel: 'full',
    reviewRoundLimit: 2,
    beforeAndAfter: 'never',
    architectureDiagram: 'never',
    commandCenterPath: checkout,
    repos: {
      [slug]: {
        gates: { test: 'node --test', lint: null, typecheck: null, build: null, secrets: null, dependencies: null, staticAnalysis: null, mutation: null },
        branchPattern: 'story/{id}-{slug}',
        worktreeRoot: repo.worktreeRoot,
        teamRules: [],
        readiness: { tracker: 'none' },
        requiredPipelines: [],
        reviewBot: 'none',
        specDir: 'docs/specs',
      },
    },
  }, null, 2));
}

function kickoff(rig, repo, replacing) {
  return [
    'You are the dedicated worker for console story ' + story + '. Jarvis directs; you do every phase of the work through the ai-sdlc skill and the persona skills it names.',
    replacing ? 'An earlier worker on this story finished its phase or stopped. Read the handover, continue from the phase the story is in, and act on its pending events.' : '',
    'This story is an automated end-to-end check of the software factory. Everything in it is real except two stand-ins: the repository\'s origin is a local bare repository, and `gh` on your PATH records pull requests instead of sending them to GitHub. Use both exactly as you would the real ones.',
    'Skills: read ' + slashes(join(skills, 'ai-sdlc', 'SKILL.md')) + ' and follow it. Read each skill it names from ' + slashes(skills) + '/<name>/SKILL.md, even where your harness has its own copy installed.',
    'Work item ' + story + ', quoted verbatim:\n' + workItem,
    'Repository: ' + slug + ', with its primary checkout at ' + slashes(repo.primary) + '. Your worktree is ' + slashes(repo.worktree) + ' on branch ' + branch + ', cut from origin/main at ' + repo.base + '. Jarvis recorded it on the story; work only there.',
    'Preflight: AI_SDLC_HOME is set for you. Run phase 0\'s check as node "' + slashes(preflight) + '" check "' + slashes(repo.worktree) + '"',
    'Console: node "' + slashes(rig.console) + '" handover|snapshot|record|ack "' + slashes(rig.db) + '". The Mission Console reference at ' + slashes(join(checkout, 'mission-console', 'README.md')) + ' lists every event and its fields. Record the events that the phase table in ' + slashes(join(skills, 'jarvis', 'SKILL.md')) + ' lists for each phase. Use the story\'s current revision and a fresh key for every write.',
    'Your assignment: the Command Center recorded assign-worker with your session, which handover shows as story.worker.session. A phase change needs the worker released first: record release-worker, then the phase\'s event, then assign-worker again with that same session wherever the new phase has a worker, so the owner\'s decisions keep reaching you.',
    'Ask the owner only through console question events, never in chat. After posting questions or a plan, end your turn; the owner\'s console decisions come back to you as a message. Acknowledge only this story\'s events, and only after handling them.',
    'Gates: no tests or code before the owner approves the plan; tests first, written by a separate subagent; no pull request until every phase before it is done.',
  ].filter(Boolean).join('\n\n');
}

const staff = (rig, repo) => rig.start(story, kickoff(rig, repo, true)).catch(error => {
  if (!/already has a worker|already in progress/.test(error.message)) throw error;
});

const turnsStarted = rig => rig.history(story).filter(item => item.type === 'turn-started');
const idle = rig => turnsStarted(rig).every(item => rig.processEnded(item.worker.turn.pid));

async function drive(rig, repo, done, limit, tally) {
  for (;;) {
    if (done(rig.snapshot(story))) return;
    await rig.until('the worker to end its turn', () => idle(rig), limit);
    const current = rig.snapshot(story);
    if (done(current)) return;
    expect(tally.rounds < 25, 'The owner and Jarvis have acted ' + tally.rounds + ' times and the story is still in ' + current.phase + '.');
    tally.rounds += 1;
    expect(!current.blocked, 'The story is blocked in ' + current.phase + ': ' + current.blocked);
    const open = current.questions.filter(item => !item.answer);
    const action = open.find(item => item.id.startsWith('action-'));
    expect(!action, 'The worker needs the owner to act outside the console: ' + action?.prompt);
    let last = rig.history(story).at(-1);
    let waiting = 'a worker turn to take the decision';
    if (open.length) {
      for (const item of open) last = await rig.decide({ story, type: 'answer', question: item.id, answer: item.recommended });
      if (!rig.snapshot(story).worker) {
        await staff(rig, repo);
        await rig.deliver(story);
      }
    } else if (current.phase === 'approval') {
      last = await rig.decide({ story, type: 'approve' });
      waiting = 'the Command Center to start the test author after approval';
    } else if (!current.worker && workerPhases.has(current.phase)) {
      await staff(rig, repo);
      waiting = 'the worker Jarvis started for ' + current.phase;
    } else {
      throw new Error('The worker ended its turn in ' + current.phase + ' with nothing for the owner or Jarvis to do. Its log ends:\n' + rig.lastLog());
    }
    await rig.until(waiting, () => {
      expect(!rig.snapshot(story).blocked, 'The story was blocked while waiting for ' + waiting + ': ' + rig.snapshot(story).blocked);
      return turnsStarted(rig).some(item => item.seq > last.seq);
    }, 120000);
  }
}

export async function run(rig) {
  const repo = await makeRepository(rig);
  writeProfile(rig, repo);
  const limit = Math.max(rig.turnMs, 90 * 60 * 1000);
  const tally = { rounds: 0 };

  await rig.step('the target repository passes the AI SDLC preflight check', async () => {
    const { stdout } = await exec(process.execPath, [preflight, 'check', repo.primary], { env: rig.env }).catch(error => error);
    const checked = JSON.parse(stdout);
    expect(checked.ok, 'Preflight reported: ' + checked.problems.join(' '));
    expect(checked.repo.slug === slug, 'Preflight named the repository ' + checked.repo.slug + '.');
  });
  rig.create(story, { scouted: false, title: heading, detail: workItem, branch, worktree: repo.worktree, repo: slug });
  await rig.step(rig.harness + ' starts the story worker in scout', async () => {
    const started = await rig.start(story, kickoff(rig, repo, false));
    expect(rig.snapshot(story).worker?.session === started.session, 'The story is not assigned to the session the start call printed.');
  });
  await rig.step('the worker scouts and plans, and the owner answers every question with its recommendation and approves the plan', () =>
    drive(rig, repo, current => !['scout', 'planning', 'approval'].includes(current.phase), limit, tally));
  await rig.step('the story runs from tests to an open pull request', () => drive(rig, repo, current => Boolean(current.pr), limit, tally));
  await rig.step('the worker ends its turn after opening the pull request', () => rig.until('the worker to end its turn', () => idle(rig), limit));

  await rig.step('the console records every lifecycle phase in order, and every owner decision was acknowledged', () => {
    const visited = [];
    for (const item of rig.history(story)) if (visited.at(-1) !== item.phase) visited.push(item.phase);
    const missing = lifecycle.filter(phase => !visited.includes(phase));
    expect(!missing.length, 'The story never reached ' + missing.join(', ') + '. It went ' + visited.join(' > ') + '.');
    const firsts = lifecycle.map(phase => visited.indexOf(phase));
    expect(firsts.every((at, n) => !n || at > firsts[n - 1]), 'The phases ran out of order: ' + visited.join(' > ') + '.');
    const unacknowledged = rig.history(story).filter(item => ['answer', 'approve'].includes(item.type) && !rig.acknowledged(story, item.seq));
    expect(!unacknowledged.length, 'No worker acknowledged ' + unacknowledged.map(item => item.type + ' (seq ' + item.seq + ')').join(', ') + '.');
  });

  const pull = await rig.step('one pull request is open from the story branch into main, and its description carries the spec and the gate results', () => {
    const pulls = JSON.parse(readFileSync(join(rig.github, 'pulls.json'), 'utf8'));
    expect(pulls.length === 1, 'Expected one pull request, found ' + pulls.length + '.');
    const [opened] = pulls;
    const current = rig.snapshot(story);
    expect(opened.url === current.pr, 'The console records ' + current.pr + ', but the pull request is ' + opened.url + '.');
    expect(opened.base === 'main' && opened.head === current.branch, 'The pull request goes from ' + opened.head + ' into ' + opened.base + '.');
    expect(/node --test/.test(opened.body), 'The description does not report the test gate.');
    expect(/docs\/specs\/|acceptance criteria/i.test(opened.body), 'The description neither links nor contains the spec.');
    return opened;
  });

  await rig.step('the pushed branch starts with the spec, passes its tests, and says goodbye', async () => {
    const pushed = join(rig.root, 'pushed');
    await exec('git', ['clone', '-q', '--branch', pull.head, slashes(repo.origin), pushed]);
    const own = (await git(pushed, 'log', '--reverse', '--format=%H', 'origin/main..HEAD')).split('\n').filter(Boolean);
    expect(own.length, 'The branch has no commits of its own.');
    const first = await git(pushed, 'show', '--name-status', '--format=', own[0]);
    expect(/^A\s+docs\/specs\/\S+\.md$/m.test(first), 'The branch\'s first commit does not add the spec under docs/specs:\n' + first);
    await git(pushed, 'merge-base', '--is-ancestor', pull.headAtOpen, 'HEAD').catch(() => { throw new Error('The pull request\'s head is not on the pushed branch.'); });
    await exec(process.execPath, ['--test'], { cwd: pushed }).catch(error => { throw new Error('node --test fails on the pushed branch:\n' + (error.stdout + error.stderr).trim().slice(-1500)); });
    const tested = await git(pushed, 'grep', '-l', 'farewell', '--', '*.test.mjs').catch(() => '');
    expect(tested, 'No test mentions farewell.');
    const { stdout } = await exec(process.execPath, ['--input-type=module', '-e', "import { greet, farewell } from './greet.mjs'; console.log(JSON.stringify([greet('Ada'), farewell('Ada')]));"], { cwd: pushed });
    expect(stdout.trim() === JSON.stringify(['Hello, Ada!', 'Goodbye, Ada!']), 'greet and farewell returned ' + stdout.trim() + '.');
  });
}
