// Links this repository's skills into each agent harness on the machine, or reports what is linked.
//   node install.mjs [--check] [harness ...]
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('.', import.meta.url));

// `marker` is the folder whose presence shows the harness is installed; `skills` is where it reads skills.
export const harnesses = [
  { id: 'codex', name: 'Codex', marker: '.codex', skills: join('.agents', 'skills') },
  { id: 'claude-code', name: 'Claude Code', marker: '.claude', skills: join('.claude', 'skills') },
  { id: 'cursor', name: 'Cursor', marker: '.cursor', skills: join('.cursor', 'skills') },
];

const stat = path => { try { return lstatSync(path); } catch { return null; } };
const real = path => { try { return realpathSync(path); } catch { return null; } };

// One link per skill, so skills from other repositories can sit beside them. Nothing existing is replaced.
// Each result is { harness, skill, path, state }: created, linked, missing (when `write` is false),
// kept (something else is already there), or folder-is-link (the whole skills folder points elsewhere).
export function linkSkills({ home = homedir(), skillsDir = join(repo, 'skills'), only = [], write = true } = {}) {
  const skills = readdirSync(skillsDir).filter(name => existsSync(join(skillsDir, name, 'SKILL.md')));
  const results = [];
  for (const harness of harnesses) {
    if (only.length ? !only.includes(harness.id) : !existsSync(join(home, harness.marker))) continue;
    const folder = join(home, harness.skills);
    if (stat(folder)?.isSymbolicLink()) {
      results.push({ harness: harness.name, path: folder, state: 'folder-is-link' });
      continue;
    }
    for (const skill of skills) {
      const source = resolve(skillsDir, skill);
      const path = join(folder, skill);
      let state = 'missing';
      if (stat(path)) {
        state = real(path) === real(source) ? 'linked' : 'kept';
      } else if (write) {
        mkdirSync(folder, { recursive: true });
        symlinkSync(source, path, 'junction');
        state = 'created';
      }
      results.push({ harness: harness.name, skill, path, state });
    }
  }
  return results;
}

function main(args) {
  const check = args.includes('--check');
  const only = args.filter(arg => arg !== '--check');
  const unknown = only.filter(id => !harnesses.some(harness => harness.id === id));
  if (unknown.length) {
    console.error('Usage: node install.mjs [--check] [' + harnesses.map(harness => harness.id).join('] [') + ']');
    return 1;
  }
  if (Number(process.versions.node.split('.')[0]) < 24) console.warn('Node 24 or newer is recommended; Node 22 needs --experimental-sqlite.');
  if (spawnSync('git', ['--version']).status !== 0) console.warn('git was not found on PATH; install it before running Jarvis.');

  const results = linkSkills({ only, write: !check });
  if (!results.length) {
    console.log('No supported harness was found. Name one to set it up anyway: ' + harnesses.map(harness => harness.id).join(', ') + '.');
    return 1;
  }
  for (const name of new Set(results.map(result => result.harness))) {
    const mine = results.filter(result => result.harness === name);
    const count = state => mine.filter(result => result.state === state).length;
    if (mine[0].state === 'folder-is-link') {
      console.log(name + ': ' + mine[0].path + ' is a single link to another folder, so nothing was changed. Replace it with a real folder of per-skill links, then run this again.');
      continue;
    }
    console.log(name + ': ' + ['created', 'linked', 'missing', 'kept'].filter(count).map(state => count(state) + ' ' + state).join(', '));
    for (const result of mine.filter(result => result.state === 'kept')) {
      console.log('  kept the existing ' + result.skill + ' at ' + result.path + '; this repository\'s copy is not linked.');
    }
  }
  if (existsSync(join(homedir(), '.copilot'))) {
    console.log('GitHub Copilot app: it needs copies, so run adapters/copilot/install.ps1 for it.');
  }
  if (check) return results.some(result => result.state === 'missing') ? 1 : 0;
  console.log('\nRestart open agent sessions, then say "Be Jarvis. Run AI SDLC." The first run asks the setup questions once.');
  console.log('Dashboard: node ' + join(repo, 'command-center', 'serve.mjs'));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
