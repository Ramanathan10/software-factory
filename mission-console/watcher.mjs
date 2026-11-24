import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { InputError } from './store.mjs';

const run = promisify(execFile);
const completed = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const failed = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);

export function githubPr(url) {
  const parsed = URL.parse(url);
  return parsed?.origin === 'https://github.com' && !parsed.username && !parsed.password &&
    /^\/[\w.-]+\/[\w.-]+\/pull\/[1-9]\d*\/?$/.test(parsed.pathname)
    ? parsed.origin + parsed.pathname.replace(/\/$/, '') : null;
}

export function summarizePr(data) {
  if (!['OPEN', 'MERGED', 'CLOSED'].includes(data?.state) ||
      typeof data.headRefOid !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(data.headRefOid) ||
      !Array.isArray(data.statusCheckRollup)) {
    throw new Error('GitHub returned an incomplete PR observation.');
  }
  const counts = { good: 0, failed: 0, pending: 0 };
  const names = new Set();
  for (const check of data.statusCheckRollup) {
    const conclusion = check?.state ?? (check?.status === 'COMPLETED' ? check.conclusion : null);
    if (failed.has(conclusion)) {
      counts.failed += 1;
      const name = check.name ?? check.context;
      if (typeof name === 'string' && name.trim()) names.add(name.trim().slice(0, 160));
    } else if (completed.has(conclusion)) {
      counts.good += 1;
    } else {
      counts.pending += 1;
    }
  }
  const status = data.state === 'MERGED' ? 'merged' :
    data.state === 'CLOSED' ? 'closed' :
    counts.failed > 0 ? 'failed' :
    counts.pending > 0 ? 'running' :
    counts.good > 0 ? 'passed' : 'no-checks';
  return { head: data.headRefOid.toLowerCase(), status, failedCount: counts.failed, failures: [...names].sort().slice(0, 10) };
}

export async function readGitHubPr(url, signal) {
  const canonical = githubPr(url);
  if (!canonical) throw new Error('Unsupported PR URL.');
  const { stdout } = await run('gh', ['pr', 'view', canonical, '--json', 'url,state,headRefOid,statusCheckRollup'], {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    signal, timeout: 15000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  });
  const data = JSON.parse(stdout);
  if (githubPr(data.url)?.toLowerCase() !== canonical.toLowerCase()) throw new Error('GitHub returned a different PR.');
  return summarizePr(data);
}

export async function watchOnce(store, { readPr = readGitHubPr, signal, warn = console.error } = {}) {
  const changed = [];
  for (const story of store.watchTargets()) {
    if (signal?.aborted) break;
    if (!githubPr(story.pr) || story.prObservation?.status === 'merged') continue;
    try {
      const observation = await readPr(story.pr, signal);
      if (signal?.aborted) break;
      const result = store.record({
        key: randomUUID(), type: 'pr-observed', story: story.id, revision: story.revision,
        url: story.pr, observation,
      });
      if (result.wake) changed.push({ story: story.id, seq: result.seq, ...observation });
    } catch (error) {
      if (signal?.aborted) break;
      if (error instanceof InputError && error.status === 409) continue;
      warn('Hawkeye could not observe ' + story.id + '. Check GitHub CLI access and the next poll.');
    }
  }
  return changed;
}

export async function waitForWake(store, story, seconds) {
  const deadline = performance.now() + seconds * 1000;
  while (true) {
    const pending = store.pendingFor(story);
    if (pending.length || performance.now() >= deadline) return pending;
    await delay(Math.min(1000, Math.max(0, deadline - performance.now())));
  }
}

const forWorker = new Set(['answer', 'approve', 'plan-feedback', 'comparison-choice', 'request-cleanup']);

export async function waitForAny(store, { after, seconds, pollMs = 1000 }) {
  const from = after ?? Math.max(0, ...store.pending().map(event => event.seq));
  const deadline = performance.now() + seconds * 1000;
  while (true) {
    const news = store.pending().filter(event => event.seq > from && (!forWorker.has(event.type) || !store.hasWorker(event.story)));
    if (news.length || performance.now() >= deadline) return news;
    await delay(Math.min(pollMs, Math.max(0, deadline - performance.now())));
  }
}

export async function watch(store, seconds, signal, emit = console.log) {
  while (!signal.aborted) {
    const wakes = await watchOnce(store, { signal });
    for (const wake of wakes) emit(JSON.stringify(wake));
    if (!signal.aborted) await delay(seconds * 1000, undefined, { signal });
  }
}
