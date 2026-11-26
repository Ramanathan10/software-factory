import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnesses, launchProblem } from './adapters/harnesses.mjs';
import { isMain } from './mission-console/is-main.mjs';

const repo = fileURLToPath(new URL('.', import.meta.url));

const stat = path => { try { return lstatSync(path); } catch { return null; } };
const real = path => { try { return realpathSync(path); } catch { return null; } };

const keptCopies = ['diagram-design'];
const extensionParts = ['command-center', 'mission-console', 'readiness-sync', join('adapters', 'harnesses.mjs')];

const list = folder => { try { return readdirSync(folder); } catch { return []; } };

const files = root => readdirSync(root, { recursive: true, withFileTypes: true })
  .filter(entry => !entry.isDirectory())
  .map(entry => relative(root, join(entry.parentPath, entry.name)));

function wanted(parts) {
  const found = new Map();
  for (const [name, source] of parts) {
    if (stat(source).isDirectory()) for (const file of files(source)) found.set(join(name, file), join(source, file));
    else found.set(name, source);
  }
  return found;
}

function matches(parts, target) {
  const expected = wanted(parts);
  const have = stat(target)?.isDirectory() ? files(target) : [];
  try {
    return have.length === expected.size && have.every(file => expected.has(file) && readFileSync(join(target, file)).equals(readFileSync(expected.get(file))));
  } catch {
    return false;
  }
}

function copy(source, target) {
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
}

const older = (folder, names) => list(folder).filter(entry => names.some(name => entry.startsWith(name + '.bak-') && /^\d+$/.test(entry.slice(name.length + 5))));

export function install({ home = homedir(), repoDir = repo, skillsDir = join(repoDir, 'skills'), only = [], write = true, replace: replaceBlocked = false, stamp = Date.now() } = {}) {
  const skills = readdirSync(skillsDir).filter(name => existsSync(join(skillsDir, name, 'SKILL.md')));
  const results = [];
  for (const [name, harness] of Object.entries(harnesses)) {
    if (only.length ? !only.includes(harness.id) : !existsSync(join(home, harness.marker))) continue;
    const folder = join(home, harness.skills);
    const add = (skill, path, state, more = {}) => results.push({ harness: name, skill, path, state, ...more });

    let backup;
    const backupFolder = () => {
      if (backup !== undefined) return backup;
      const base = join(dirname(folder), 'ai-sdlc-backups');
      const top = stat(base);
      if (top && !top.isDirectory() && !top.isSymbolicLink()) {
        backup = null;
        results.push({ harness: name, path: base, state: 'backup-is-file' });
        return backup;
      }
      let link = top?.isSymbolicLink() ? base : null;
      for (let n = 1; !link; n++) {
        const candidate = join(base, n === 1 ? String(stamp) : stamp + '-' + n);
        const found = stat(candidate);
        if (!found) { backup = candidate; break; }
        if (found.isSymbolicLink()) link = candidate;
      }
      if (link) {
        backup = null;
        results.push({ harness: name, path: link, state: 'backup-is-link' });
      }
      return backup;
    };
    const moveAside = (path, kind, entry) => {
      const root = backupFolder();
      if (!root) return null;
      const to = join(root, kind, entry);
      mkdirSync(dirname(to), { recursive: true });
      renameSync(path, to);
      return to;
    };
    const sweep = (scanned, kind, names) => {
      for (const entry of older(scanned, names)) {
        const path = join(scanned, entry);
        if (!write) { add(entry, path, 'old-backup'); continue; }
        const movedTo = moveAside(path, kind, entry);
        add(entry, path, movedTo ? 'moved' : 'old-backup', movedTo ? { movedTo } : {});
      }
    };
    const put = (parts, path, kind, entry, label, assemble) => {
      const there = Boolean(stat(path));
      if (!write) return add(label, path, !there ? 'missing' : matches(parts, path) ? 'current' : 'outdated');
      if (there && matches(parts, path)) return add(label, path, 'current');
      const movedTo = there ? moveAside(path, kind, entry) : undefined;
      if (movedTo === null) return add(label, path, 'not-moved');
      assemble();
      add(label, path, there ? 'updated' : 'copied', movedTo ? { movedTo } : {});
    };

    if (harness.install === 'copy') {
      if (harness.extension) {
        const target = join(home, harness.extension);
        const parts = [['extension.mjs', join(repoDir, 'adapters', harness.id, 'extension.mjs')], ...extensionParts.map(part => [part, join(repoDir, part)])];
        put(parts, target, 'extensions', basename(target), 'extension', () => { for (const [part, source] of parts) copy(source, join(target, part)); });
      }
      for (const skill of skills) {
        const path = join(folder, skill);
        if (stat(path) && keptCopies.includes(skill)) add(skill, path, 'kept');
        else put([['', join(skillsDir, skill)]], path, 'skills', skill, skill, () => copy(join(skillsDir, skill), path));
      }
      sweep(folder, 'skills', skills);
      if (harness.extension) sweep(dirname(join(home, harness.extension)), 'extensions', [basename(harness.extension)]);
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
        const movedTo = write && replaceBlocked ? moveAside(path, 'skills', skill) : null;
        if (movedTo) link();
        add(skill, path, movedTo ? 'replaced' : 'blocked', movedTo ? { existing, movedTo } : { existing });
      }
    }
    sweep(folder, 'skills', skills);
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
    const label = state => state === 'old-backup' ? (count(state) === 1 ? 'old backup' : 'old backups') : state;
    console.log(name + ': ' + ['created', 'linked', 'replaced', 'copied', 'updated', 'current', 'moved', 'outdated', 'missing', 'blocked', 'kept', 'old-backup', 'not-moved', 'backup-is-link', 'backup-is-file'].filter(count).map(state => count(state) + ' ' + label(state)).join(', '));
    const problem = harnesses[name].workers === 'command-line' && launchProblem(name);
    if (problem) console.log('  Story sessions will not start: ' + problem);
    for (const result of mine.filter(result => result.state === 'kept')) {
      console.log('  kept your own ' + result.skill + ' at ' + result.path + '.');
    }
    for (const result of mine.filter(result => result.state === 'replaced')) {
      console.log('  replaced ' + result.skill + ', which was ' + result.existing + '; it is now at ' + result.movedTo + '.');
    }
    for (const result of mine.filter(result => result.state === 'updated')) {
      console.log('  moved the previous ' + result.skill + ' to ' + result.movedTo + '.');
    }
    for (const result of mine.filter(result => result.state === 'moved')) {
      console.log('  moved ' + result.path + ' to ' + result.movedTo + '.');
    }
    if (check && count('old-backup')) console.log('  a plain run moves the old .bak- folders in the skills folders into ai-sdlc-backups.');
    for (const result of mine.filter(result => result.state === 'backup-is-link')) {
      console.log('  NOT MOVED: ' + result.path + ' is a link, so nothing that needed moving aside was changed. Replace it with a real folder, then run this again.');
    }
    for (const result of mine.filter(result => result.state === 'backup-is-file')) {
      console.log('  NOT MOVED: ' + result.path + ' is a file, so nothing that needed moving aside was changed. Remove or rename it, then run this again.');
    }
    for (const result of mine.filter(result => result.state === 'not-moved')) {
      console.log('  NOT UPDATED: ' + result.skill + ' at ' + result.path + ' differs and could not be moved aside.');
    }
    for (const result of mine.filter(result => result.state === 'blocked')) {
      console.log('  NOT INSTALLED: ' + result.skill + '. ' + result.path + ' is ' + result.existing + ', so the harness uses that one.');
    }
  }
  const unusable = results.filter(result => ['blocked', 'folder-is-link', 'backup-is-link', 'backup-is-file', 'not-moved', ...(check ? ['missing'] : [])].includes(result.state));
  if (!replaceBlocked && unusable.some(result => result.state === 'blocked')) {
    console.log('\nSome skills are blocked by ones already there. Run "node install.mjs --replace" to move those aside (into each harness\'s ai-sdlc-backups folder, nothing is deleted) and install these.');
  }
  if (check || unusable.length) return unusable.length ? 1 : 0;
  console.log('\nRestart open agent sessions, then say "Be Jarvis. Run AI SDLC." The first run asks the setup questions once.');
  console.log('Dashboard: node ' + join(repo, 'command-center', 'serve.mjs'));
  return 0;
}

if (isMain(import.meta.url)) process.exitCode = main(process.argv.slice(2));
