import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { pullRequestUrl } from './pull-request-url.mjs';
import { InputError } from './store.mjs';

const run = promisify(execFile);
const completed = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const failed = new Set(['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'STALE']);

export function githubPr(url) {
  const found = pullRequestUrl(url);
  return found?.kind === 'github' ? found.canonical : null;
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

function withheld(env, host) {
  if (host.toLowerCase() === process.env.GH_HOST?.toLowerCase()) return env;
  for (const name of enterpriseTokens) delete env[name];
  return env;
}

const enterpriseTokens = ['GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN'];

const readOptions = (signal, host) => ({
  cwd: fileURLToPath(new URL('.', import.meta.url)),
  signal, timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  env: withheld({ ...process.env, GH_PROMPT_DISABLED: '1' }, host),
});

export async function readGitHubPr(url, signal, posted = [], { run: runner = run } = {}) {
  const found = pullRequestUrl(url);
  if (found?.kind !== 'github') throw new Error('Unsupported PR URL.');
  const options = readOptions(signal, found.host);
  const { stdout } = await runner('gh', ['pr', 'view', found.canonical, '--json', 'url,state,headRefOid,statusCheckRollup'], options);
  const data = JSON.parse(stdout);
  if (pullRequestUrl(data.url)?.key !== found.key) throw new Error('GitHub returned a different PR.');
  const checks = summarizePr(data);
  const [owner, name, , number] = new URL(found.canonical).pathname.split('/').filter(Boolean);
  const answer = await runner('gh', ['api', 'graphql', '--hostname', found.host, '-f', 'query=' + reviewQuery, '-f', 'owner=' + owner, '-f', 'name=' + name, '-F', 'number=' + number], options);
  return { ...checks, review: summarizeReview(JSON.parse(answer.stdout).data?.repository?.pullRequest, { head: checks.head, posted }) };
}

const azSafe = /^[A-Za-z0-9._:/=-]+$/;
const azOrganization = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const guid = /^[0-9A-Fa-f-]{36}$/;
const azureChecks = new Set(['Build', 'Status']);
const azureFailed = new Set(['rejected', 'broken']);
const azureGood = new Set(['approved', 'notApplicable']);
const azureEnded = { completed: 'merged', abandoned: 'closed' };
const approving = new Set([10, 5]);
const objecting = new Set([-10, -5]);
const unresolvedThread = thread => thread?.isDeleted !== true && ['active', 'pending'].includes(thread?.status) && spoken(thread).length > 0;

export async function runAz(file, args, { platform = process.platform, exec = run, ...options } = {}) {
  const settings = { timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...options };
  if (platform !== 'win32') return exec(file, args, settings);
  const unsafe = args.find(argument => typeof argument !== 'string' || !azSafe.test(argument));
  if (unsafe !== undefined) throw new Error('Refused an az argument: ' + JSON.stringify(unsafe));
  return exec([file, ...args].join(' '), { ...settings, shell: true });
}

export function summarizeAzureChecks(data, policies) {
  const counts = { good: 0, failed: 0, pending: 0 };
  const names = new Set();
  for (const policy of policies) {
    const name = policy?.configuration?.type?.displayName;
    if (!azureChecks.has(name)) continue;
    if (azureFailed.has(policy.status)) {
      counts.failed += 1;
      names.add(name);
    } else if (azureGood.has(policy.status)) {
      counts.good += 1;
    } else {
      counts.pending += 1;
    }
  }
  return {
    head: data.lastMergeSourceCommit.commitId.toLowerCase(),
    status: azureEnded[data.status] ?? (counts.failed > 0 ? 'failed' : counts.pending > 0 ? 'running' : counts.good > 0 ? 'passed' : 'no-checks'),
    failedCount: counts.failed, failures: [...names].sort().slice(0, 10),
  };
}

const fit = (value, max) => String(value).slice(0, max);
const azureName = person => fit((person?.isContainer === true ? person.displayName : undefined) ?? person?.uniqueName ?? person?.displayName ?? 'ghost', 100);
const spoken = thread => (Array.isArray(thread?.comments) ? thread.comments : []).filter(comment => comment && comment.commentType !== 'system' && comment.isDeleted !== true);
const stamp = comment => String(comment.lastUpdatedDate ?? comment.publishedDate);

export function summarizeAzureReview(data, threads, { canonical, posted = [] }) {
  const ours = new Set(posted);
  const reviewers = Array.isArray(data.reviewers) ? data.reviewers : [];
  const open = threads.filter(unresolvedThread);
  const items = [];
  for (const thread of open) {
    const kept = thread.comments.filter(comment => comment?.isDeleted !== true);
    const first = kept[0];
    const last = kept.at(-1);
    const key = thread.id + '/' + last.id;
    if (ours.has(key)) continue;
    const file = thread.threadContext?.filePath;
    items.push({
      key: fit(key, 200), kind: file ? 'thread' : 'comment', author: azureName(first.author), bot: !/^[^@\s]+@[^@\s]+$/.test(String(first.author?.uniqueName ?? '')),
      path: file === undefined || file === null ? undefined : fit(file, 500), line: file ? thread.threadContext.rightFileStart?.line : undefined,
      excerpt: excerpt(first.content), url: fit(canonical + '?discussionId=' + thread.id, 500), at: stamp(last),
    });
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  const times = [data.creationDate, ...threads.flatMap(thread => spoken(thread).flatMap(comment => [comment.publishedDate, comment.lastUpdatedDate]))]
    .filter(time => typeof time === 'string');
  return {
    approvals: reviewers.filter(reviewer => approving.has(reviewer.vote)).map(azureName).slice(0, 100),
    changesRequested: reviewers.filter(reviewer => objecting.has(reviewer.vote)).map(azureName).slice(0, 100),
    unresolved: open.length,
    earlier: 0,
    items: items.slice(0, 10).map(({ at, ...item }) => JSON.parse(JSON.stringify(item))),
    keys: items.map(item => item.key).slice(0, 1000),
    more: items.length > 1000,
    lastActivityAt: times.sort().at(-1),
  };
}

export async function readAzurePr(url, signal, posted = [], { run: runner = runAz } = {}) {
  const found = pullRequestUrl(url);
  if (found?.kind !== 'azure-devops') throw new Error('Unsupported PR URL.');
  if (!azOrganization.test(found.org)) throw new Error('Refused an Azure DevOps organization.');
  const organization = found.host === 'dev.azure.com' ? 'https://dev.azure.com/' + found.org : 'https://' + found.host;
  const options = { cwd: fileURLToPath(new URL('.', import.meta.url)), signal };
  const az = async args => JSON.parse((await runner('az', [...args, '--org', organization, '-o', 'json'], options)).stdout);
  const data = await az(['repos', 'pr', 'show', '--id', found.id]);
  if (pullRequestUrl(data?.repository?.webUrl + '/pullrequest/' + data?.pullRequestId)?.key !== found.key) {
    throw new Error('Azure DevOps returned a different PR.');
  }
  const commit = data.lastMergeSourceCommit?.commitId;
  if (!['active', ...Object.keys(azureEnded)].includes(data.status) || typeof commit !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commit)) {
    throw new Error('Azure DevOps returned an incomplete PR observation.');
  }
  const repository = data.repository.id;
  const project = data.repository.project?.id;
  if (!guid.test(repository) || !guid.test(project)) throw new Error('Azure DevOps returned an incomplete PR observation.');
  const policies = await az(['repos', 'pr', 'policy', 'list', '--id', found.id]);
  const threads = await az(['devops', 'invoke', '--area', 'git', '--resource', 'pullRequestThreads', '--route-parameters',
    'project=' + project, 'repositoryId=' + repository, 'pullRequestId=' + found.id, '--api-version', '7.1']);
  if (!Array.isArray(policies) || !Array.isArray(threads?.value)) throw new Error('Azure DevOps returned an incomplete PR observation.');
  return { ...summarizeAzureChecks(data, policies), review: summarizeAzureReview(data, threads.value, { canonical: found.canonical, posted }) };
}

const readers = { github: readGitHubPr, 'azure-devops': readAzurePr };
const warnings = {
  github: (story, found) => 'Hawkeye could not observe ' + story + '. Check GitHub CLI access to ' + found.host + ' and the next poll.',
  'azure-devops': story => 'Hawkeye could not observe ' + story + '. Check Azure CLI access (az extension add --name azure-devops, then az login) and the next poll.',
};

export const readPullRequest = (url, signal, posted) => readers[pullRequestUrl(url)?.kind](url, signal, posted);

export async function watchOnce(store, { readPr = readPullRequest, signal, warn = console.error } = {}) {
  const changed = [];
  for (const story of store.watchTargets()) {
    if (signal?.aborted) break;
    const found = pullRequestUrl(story.pr);
    if (!(found?.kind in readers) || story.prObservation?.status === 'merged') continue;
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
      warn(warnings[found.kind](story.id, found));
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
