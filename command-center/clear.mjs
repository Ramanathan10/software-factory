import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { InputError } from '../mission-console/store.mjs';

const run = promisify(execFile);
const git = async (cwd, ...args) => (await run('git', args, { cwd, encoding: 'utf8', windowsHide: true })).stdout.trim();
const validId = id => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(id);

export function samePath(a, b) {
  const norm = path => {
    let full = resolve(path);
    try { full = realpathSync.native(full); } catch {}
    full = full.replace(/\\/g, '/').replace(/\/+$/, '');
    return process.platform === 'win32' ? full.toLowerCase() : full;
  };
  return norm(a) === norm(b);
}

const inside = (root, path) => {
  const rel = relative(resolve(root), resolve(path));
  return Boolean(rel) && !rel.startsWith('..') && !isAbsolute(rel);
};

async function locate(path) {
  if (!existsSync(path)) return { gone: true };
  let listing;
  try {
    listing = await git(path, 'worktree', 'list', '--porcelain');
  } catch {
    return { stray: true };
  }
  const entries = listing.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/)).map(lines => ({
    path: lines.find(line => line.startsWith('worktree '))?.slice(9),
    branch: lines.find(line => line.startsWith('branch '))?.slice(7).replace(/^refs\/heads\//, ''),
    detached: lines.includes('detached'),
  })).filter(entry => entry.path);
  const at = entries.findIndex(entry => samePath(entry.path, path));
  if (at < 0) return { stray: true };
  if (at === 0) return { main: true };
  return { repo: entries[0].path, ...entries[at] };
}

async function mergedHead(cwd, story) {
  const head = story.prObservation?.status === 'merged' ? story.prObservation.head : story.readyHead;
  if (!head) return [];
  try {
    await git(cwd, 'cat-file', '-e', head + '^{commit}');
    return [head];
  } catch {
    return [];
  }
}

export function createClearer({ store, home, attachmentRoot, folderFor }) {
  const workers = join(home, 'workers');
  const clearing = new Set();
  const live = () => store.snapshot();

  const folders = id => [join(home, 'stories', id), join(home, 'notes', id), join(attachmentRoot, folderFor(id))];

  function logs(story, others) {
    const found = new Set();
    const add = path => path && found.add(resolve(path));
    const session = name => name && add(join(workers, name + '.log'));
    for (const event of store.history(story.id)) {
      add(event.worker?.turn?.log);
      session(event.worker?.session);
      if (event.type === 'jarvis-turn-ended') add(/\nSee (.+)\.$/.exec(event.detail ?? '')?.[1]);
    }
    session(story.jarvis?.session);
    const used = new Set(others.flatMap(other => [other.worker?.turn?.log, other.worker?.session && join(workers, other.worker.session + '.log'),
      other.jarvis?.session && join(workers, other.jarvis.session + '.log')]).filter(Boolean).map(path => resolve(path)));
    return [...found].filter(path => inside(workers, path) && !used.has(path));
  }

  function closedStory(id) {
    if (!validId(id)) throw new InputError('Invalid story ID.');
    const story = live().find(item => item.id === id);
    if (!story) throw new InputError('Story does not exist.', 404);
    if (story.phase !== 'closed') throw new InputError('Only shipped stories can be cleared.', 409);
    return story;
  }

  function preview(id) {
    const story = closedStory(id);
    const others = live().filter(item => item.id !== id);
    const exists = existsSync(story.worktree);
    return {
      story: id,
      worktree: { path: story.worktree, exists },
      branch: exists ? { name: story.branch, remove: true }
        : { name: story.branch, remove: false, reason: 'The worktree is gone, so the repository cannot be found; delete the branch by hand.' },
      folders: folders(id).filter(existsSync),
      logs: logs(story, others).filter(existsSync).length,
      record: true,
    };
  }

  async function clearOne(id) {
    const result = { story: id, result: 'refused', reason: '', deleted: [], gone: [], left: [] };
    const refuse = reason => ({ ...result, reason });
    if (!validId(id)) return refuse('Invalid story ID.');
    const story = live().find(item => item.id === id);
    if (!story) return refuse('Story does not exist.');
    if (story.phase !== 'closed') return refuse('Only shipped stories can be cleared.');
    if (story.worker) return refuse('A worker is still assigned.');
    if (story.jarvis?.turn) return refuse('A Jarvis turn is running.');
    if (clearing.has(id)) return refuse('This story is already being cleared.');
    clearing.add(id);
    try {
      return await clearClosed(story, result);
    } catch (error) {
      return blockFor(id, result, 'Could not finish the clear: ' + error.message);
    } finally {
      clearing.delete(id);
    }
  }

  const recordFor = (id, type, detail) => store.record({ story: id, type, by: 'jarvis', key: randomUUID(),
    revision: live().find(item => item.id === id).revision, ...(detail ? { detail } : {}) });

  function blockFor(id, result, reason) {
    let text = reason.replace(/\s+/g, ' ').trim().slice(0, 4000);
    try {
      recordFor(id, 'cleanup-blocked', text);
    } catch (error) {
      text = (text + ' The block could not be recorded: ' + error.message).slice(0, 4000);
    }
    return { ...result, result: 'blocked', reason: text };
  }

  async function clearClosed(story, result) {
    const { id } = story;
    const record = (type, detail) => recordFor(id, type, detail);
    const block = reason => blockFor(id, result, reason);
    if (!story.cleanup) record('request-cleanup');
    const others = live().filter(item => item.id !== id);
    const folder = folderFor(id).toLowerCase();
    const alias = others.find(other => other.id.toLowerCase() === id.toLowerCase() || folderFor(other.id).toLowerCase() === folder);
    if (alias || id.endsWith('.')) return block('Story ID ' + id + ' shares its folder name with ' + (alias?.id ?? id.replace(/\.+$/, '')) + ' on Windows; clear it by hand.');
    const twin = others.find(other => samePath(other.worktree, story.worktree) || (other.branch === story.branch && other.repo === story.repo));
    if (twin) return block('Story ' + twin.id + ' uses the same worktree or branch; clear it by hand.');
    const where = await locate(story.worktree);
    if (where.stray) return block('A folder at ' + story.worktree + ' is not a git worktree any more; remove ' + story.worktree + ' by hand.');
    if (where.main) return block(story.worktree + ' is the main checkout of its repository, not a story worktree.');
    if (!where.gone) {
      if (where.detached || where.branch !== story.branch) {
        return block('The worktree at ' + story.worktree + ' is on ' + (where.detached ? 'a detached HEAD' : 'branch ' + where.branch) + ', not ' + story.branch + '.');
      }
      if (await git(story.worktree, 'status', '--porcelain', '--untracked-files=all')) {
        return block('Uncommitted or untracked files in ' + story.worktree + '.');
      }
      const unpushed = await git(story.worktree, 'rev-list', '--count', 'HEAD', 'refs/heads/' + story.branch, '--not', '--remotes', ...await mergedHead(story.worktree, story), '--');
      if (Number(unpushed) > 0) {
        return block(unpushed + ' commits on ' + story.branch + ' are on no remote branch and not in the merged PR; push them or delete the branch by hand.');
      }
      try {
        await git(where.repo, 'worktree', 'remove', story.worktree);
        result.deleted.push(story.worktree);
      } catch (error) {
        return block('Could not remove the worktree ' + story.worktree + ': ' + error.message);
      }
      try {
        await git(where.repo, 'branch', '-D', story.branch);
        result.deleted.push('branch ' + story.branch);
      } catch (error) {
        return block('Removed the worktree, but could not delete branch ' + story.branch + ' in ' + where.repo + ' (' + (story.repo ?? 'repository') + '); delete it by hand: ' + error.message);
      }
    } else {
      result.gone.push(story.worktree);
      result.left.push('branch ' + story.branch + ' in ' + (story.repo ?? 'its repository') + ': the worktree is gone, so the repository cannot be found; delete the branch by hand.');
    }
    for (const path of [...folders(id), ...logs(story, others)]) {
      if (!existsSync(path)) { result.gone.push(path); continue; }
      try {
        rmSync(path, { recursive: true });
        result.deleted.push(path);
      } catch (error) {
        return block('Could not delete ' + path + ': ' + error.message);
      }
    }
    record('complete-cleanup', ('Cleared from the Command Center. Deleted: ' + (result.deleted.join(', ') || 'nothing') + '.' + (result.left.length ? ' Left: ' + result.left.join('; ') : '')).slice(0, 4000));
    return { ...result, result: 'cleared' };
  }

  return {
    preview,
    async clear(ids) {
      const results = [];
      for (const id of ids) results.push(await clearOne(id));
      return results;
    },
  };
}
