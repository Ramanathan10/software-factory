// Installs this repository's skills into each agent harness on the machine, or reports what is installed.
//   node install.mjs [--check] [--replace] [harness ...]
// The harnesses, and whether each reads the skills in place or needs copies, come from adapters/harnesses.mjs.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, renameSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnesses, launchProblem } from './adapters/harnesses.mjs';
import { isMain } from './mission-console/is-main.mjs';

const repo = fileURLToPath(new URL('.', import.meta.url));

const stat = path => { try { return lstatSync(path); } catch { return null; } };
const real = path => { try { return realpathSync(path); } catch { return null; } };

// A harness that needs copies keeps its own version of a skill it has customized.
const keptCopies = ['diagram-design'];
// The parts of this repository the Command Center needs to run from a harness's extension folder.
const extensionParts = ['command-center', 'mission-console', 'readiness-sync', join('adapters', 'harnesses.mjs')];

// Copies `source` to `target`, first moving what is already there aside so nothing is lost. `aside` is the
// folder to move when it is not `target` itself.
function replace(source, target, stamp, aside = target) {
  if (stat(aside)) renameSync(aside, `${aside}.bak-${stamp}`);
  mkdirSync(resolve(target, '..'), { recursive: true });
  cpSync(source, target, { recursive: true });
}

// Each result is { harness, skill, path, state }.
// For a harness that reads skills in place, one link per skill, so skills from other repositories can sit
// beside them: created, linked, blocked (something else has that name, described in `existing`, so this
// repository's skill is not in use), or folder-is-link (the whole skills folder points elsewhere). With
// `replace`, what blocks a skill is moved to a .bak-<time> folder beside it and the skill is linked: replaced.
// For a harness that needs copies: copied, or kept for a skill in `keptCopies` that is already there. A copy
// replaces the previous one, which is moved to a .bak-<time> folder beside it. `skill` is 'extension' for
// the Command Center extension.
// When `write` is false nothing changes, and anything not yet there is reported as missing.
export function install({ home = homedir(), repoDir = repo, skillsDir = join(repoDir, 'skills'), only = [], write = true, replace: replaceBlocked = false, stamp = Date.now() } = {}) {
  const skills = readdirSync(skillsDir).filter(name => existsSync(join(skillsDir, name, 'SKILL.md')));
  const results = [];
  for (const [name, harness] of Object.entries(harnesses)) {
    if (only.length ? !only.includes(harness.id) : !existsSync(join(home, harness.marker))) continue;
    const folder = join(home, harness.skills);
    const add = (skill, path, state, existing) => results.push({ harness: name, skill, path, state, ...(existing ? { existing } : {}) });

    if (harness.install === 'copy') {
      if (harness.extension) {
        const target = join(home, harness.extension);
        if (write) {
          // The extension folder is assembled from this repository's parts so the harness runs without the checkout.
          replace(join(repoDir, 'adapters', harness.id, 'extension.mjs'), join(target, 'extension.mjs'), stamp, target);
          for (const part of extensionParts) cpSync(join(repoDir, part), join(target, part), { recursive: true });
        }
        add('extension', target, write ? 'copied' : stat(target) ? 'installed' : 'missing');
      }
      for (const skill of skills) {
        const path = join(folder, skill);
        const there = Boolean(stat(path));
        if (there && keptCopies.includes(skill)) add(skill, path, 'kept');
        else if (!write) add(skill, path, there ? 'installed' : 'missing');
        else { replace(join(skillsDir, skill), path, stamp); add(skill, path, 'copied'); }
      }
      continue;
    }

    if (stat(folder)?.isSymbolicLink()) {
      results.push({ harness: name, path: folder, state: 'folder-is-link' });
      continue;
    }
    for (const skill of skills) {
      const source = resolve(skillsDir, skill);
      const path = join(folder, skill);
      const link = () => { mkdirSync(folder, { recursive: true }); symlinkSync(source, path, 'junction'); };
      const there = stat(path);
      if (!there) {
        if (write) link();
        add(skill, path, write ? 'created' : 'missing');
      } else if (real(path) === real(source)) {
        add(skill, path, 'linked');
      } else {
        const existing = there.isSymbolicLink() ? 'a link to ' + (real(path) ?? 'a folder that no longer exists') : 'a folder of its own';
        if (write && replaceBlocked) { renameSync(path, `${path}.bak-${stamp}`); link(); }
        add(skill, path, write && replaceBlocked ? 'replaced' : 'blocked', existing);
      }
    }
  }
  return results;
}

function main(args) {
  const check = args.includes('--check');
  const replaceBlocked = args.includes('--replace');
  const only = args.filter(arg => !arg.startsWith('--'));
  const ids = Object.values(harnesses).map(harness => harness.id);
  if (only.some(id => !ids.includes(id)) || args.some(arg => arg.startsWith('--') && !['--check', '--replace'].includes(arg))) {
    console.error('Usage: node install.mjs [--check] [--replace] [' + ids.join('] [') + ']');
    return 1;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) console.warn('Node 24 or newer is recommended; Node 22 needs --experimental-sqlite.');
  if (spawnSync('git', ['--version']).status !== 0) console.warn('git was not found on PATH; install it before running Jarvis.');

  const results = install({ only, write: !check, replace: replaceBlocked });
  if (!results.length) {
    console.log('No supported harness was found. Name one to set it up anyway: ' + ids.join(', ') + '.');
    return 1;
  }
  for (const name of new Set(results.map(result => result.harness))) {
    const mine = results.filter(result => result.harness === name);
    const count = state => mine.filter(result => result.state === state).length;
    if (mine[0].state === 'folder-is-link') {
      console.log(name + ': ' + mine[0].path + ' is a single link to another folder, so nothing was changed. Replace it with a real folder of per-skill links, then run this again.');
      continue;
    }
    console.log(name + ': ' + ['created', 'linked', 'replaced', 'copied', 'installed', 'missing', 'blocked', 'kept'].filter(count).map(state => count(state) + ' ' + state).join(', '));
    // The skills still install; the owner is told now that Jarvis could not start a story session here.
    const problem = harnesses[name].workers === 'command-line' && launchProblem(name);
    if (problem) console.log('  Story sessions will not start: ' + problem);
    for (const result of mine.filter(result => result.state === 'kept')) {
      console.log('  kept your own ' + result.skill + ' at ' + result.path + '.');
    }
    for (const result of mine.filter(result => result.state === 'replaced')) {
      console.log('  replaced ' + result.skill + ', which was ' + result.existing + '; it is now at ' + result.path + '.bak-<time>.');
    }
    for (const result of mine.filter(result => result.state === 'blocked')) {
      console.log('  NOT INSTALLED: ' + result.skill + '. ' + result.path + ' is ' + result.existing + ', so the harness uses that one.');
    }
  }
  // A skill of this repository that the harness will not actually use is a failure, not a success.
  const unusable = results.filter(result => ['blocked', 'folder-is-link', ...(check ? ['missing'] : [])].includes(result.state));
  if (unusable.some(result => result.state === 'blocked')) {
    console.log('\nSome skills are blocked by ones already there. Run "node install.mjs --replace" to move those aside (to <name>.bak-<time>, nothing is deleted) and install these.');
  }
  if (check || unusable.length) return unusable.length ? 1 : 0;
  console.log('\nRestart open agent sessions, then say "Be Jarvis. Run AI SDLC." The first run asks the setup questions once.');
  console.log('Dashboard: node ' + join(repo, 'command-center', 'serve.mjs'));
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
