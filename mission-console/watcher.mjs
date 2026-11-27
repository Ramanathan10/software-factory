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
  const merge = data.state !== 'OPEN' ? null :
    data.mergeable === 'CONFLICTING' || data.mergeStateStatus === 'DIRTY' ? 'conflicting' :
    data.mergeable === 'MERGEABLE' ? (data.mergeStateStatus === 'BEHIND' ? 'behind' : 'clean') : null;
  return { head: data.headRefOid.toLowerCase(), status, failedCount: counts.failed, failures: [...names].sort().slice(0, 10), ...(merge && { merge }) };
}

const login = actor => actor?.login ?? 'ghost';
const isBot = actor => actor?.__typename === 'Bot' || login(actor).endsWith('[bot]');
const excerpt = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
const nodes = (connection, field) => {
  if (!Array.isArray(connection?.nodes)) throw new Error('GitHub returned incomplete ' + field + '.');
  return connection.nodes.filter(Boolean);
};

export function summarizeReview(data, { head, posted = [] }) {
  if (!data || typeof data !== 'object' || typeof data.createdAt !== 'string') throw new Error('GitHub returned an incomplete review.');
  const opinions = nodes(data.latestOpinionatedReviews, 'opinions');
  const reviews = nodes(data.reviews, 'reviews');
  const threads = nodes(data.reviewThreads, 'threads');
  const comments = nodes(data.comments, 'comments');
  const ours = new Set(posted);
  const current = review => review.commit?.oid?.toLowerCase() === head;
  const approvals = opinions.filter(review => review.state === 'APPROVED' && current(review)).map(review => login(review.author));
  const changesRequested = opinions.filter(review => review.state === 'CHANGES_REQUESTED' && current(review)).map(review => login(review.author));
  const open = threads.filter(thread => !thread.isResolved);
  const items = [];
  for (const thread of open.filter(thread => !thread.isOutdated)) {
    const said = nodes(thread.comments, 'thread comments');
    const first = said[0];
    const last = said.at(-1);
    if (!last || ours.has(last.id)) continue;
    items.push({ key: thread.id + ':' + last.id, kind: 'thread', author: login(first.author), bot: isBot(first.author),
      path: thread.path ?? undefined, line: thread.line ?? undefined, excerpt: excerpt(first.body), url: last.url ?? first.url, at: last.createdAt });
  }
  for (const review of reviews) {
    if (!current(review) || ours.has(review.id) || !(review.state === 'CHANGES_REQUESTED' || review.body?.trim())) continue;
    items.push({ key: review.id, kind: 'review', author: login(review.author), bot: isBot(review.author), excerpt: excerpt(review.body), url: review.url, at: review.submittedAt });
  }
  for (const comment of comments) {
    if (ours.has(comment.id)) continue;
    items.push({ key: comment.id, kind: 'comment', author: login(comment.author), bot: isBot(comment.author), excerpt: excerpt(comment.body), url: comment.url, at: comment.createdAt });
  }
  items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const times = [data.createdAt, ...reviews.map(review => review.submittedAt), ...comments.map(comment => comment.createdAt),
    ...threads.flatMap(thread => nodes(thread.comments, 'thread comments').map(comment => comment.createdAt))].filter(time => typeof time === 'string');
  return {
    approvals, changesRequested,
    unresolved: open.filter(thread => !thread.isOutdated).length,
    earlier: open.filter(thread => thread.isOutdated).length +
      opinions.filter(review => review.state === 'CHANGES_REQUESTED' && !current(review)).length,
    items: items.slice(0, 10).map(({ at, ...item }) => JSON.parse(JSON.stringify(item))),
    keys: items.map(item => item.key),
    more: [data.reviews, data.reviewThreads, data.comments].some(connection => connection.pageInfo?.hasNextPage === true),
    lastActivityAt: times.sort().at(-1),
  };
}

const reviewQuery = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      createdAt
      latestOpinionatedReviews(first: 100) { nodes { state submittedAt commit { oid } author { __typename login } } }
      reviews(last: 100) { pageInfo { hasNextPage: hasPreviousPage } nodes { id state body submittedAt url commit { oid } author { __typename login } } }
      reviewThreads(first: 100) { pageInfo { hasNextPage } nodes { id isResolved isOutdated path line
        comments(last: 100) { nodes { id body createdAt url author { __typename login } } } } }
      comments(last: 100) { pageInfo { hasNextPage: hasPreviousPage } nodes { id body createdAt url author { __typename login } } }
    }
  }
}`;

export async function readGitHubPr(url, signal, posted = []) {
  const canonical = githubPr(url);
  if (!canonical) throw new Error('Unsupported PR URL.');
  const options = {
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    signal, timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GH_PROMPT_DISABLED: '1' },
  };
  const { stdout } = await run('gh', ['pr', 'view', canonical, '--json', 'url,state,headRefOid,statusCheckRollup,mergeable,mergeStateStatus'], options);
  const data = JSON.parse(stdout);
  if (githubPr(data.url)?.toLowerCase() !== canonical.toLowerCase()) throw new Error('GitHub returned a different PR.');
  const checks = summarizePr(data);
  const [owner, name, , number] = new URL(canonical).pathname.split('/').filter(Boolean);
  const answer = await run('gh', ['api', 'graphql', '-f', 'query=' + reviewQuery, '-f', 'owner=' + owner, '-f', 'name=' + name, '-F', 'number=' + number], options);
  return { ...checks, review: summarizeReview(JSON.parse(answer.stdout).data?.repository?.pullRequest, { head: checks.head, posted }) };
}

export async function watchOnce(store, { readPr = readGitHubPr, signal, warn = console.error } = {}) {
  const changed = [];
  for (const story of store.watchTargets()) {
    if (signal?.aborted) break;
    if (!githubPr(story.pr) || story.prObservation?.status === 'merged') continue;
    try {
      const observation = await readPr(story.pr, signal, story.prPosted ?? []);
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
