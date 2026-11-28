import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as watcher from './watcher.mjs';

const HEAD = 'c'.repeat(40);
const OLD = 'd'.repeat(40);
const PR = 'https://github.com/acme/widgets/pull/7';
const user = login => ({ __typename: 'User', login });
const bot = login => ({ __typename: 'Bot', login });
const at = minutes => new Date(Date.UTC(2026, 0, 1, 12, minutes)).toISOString();

function comment(id, author, minutes, body = 'Please rename this helper.') {
  return { id, author, body, createdAt: at(minutes), url: PR + '#' + id };
}

function thread(id, comments, { outdated = false, resolved = false, path = 'src/widget.mjs', line = 12 } = {}) {
  return { id, isResolved: resolved, isOutdated: outdated, path, line, comments: { nodes: comments } };
}

function pullRequest({ opinions = [], reviews = [], threads = [], comments = [], more = false } = {}) {
  return {
    createdAt: at(0),
    latestOpinionatedReviews: { nodes: opinions },
    reviews: { pageInfo: { hasNextPage: false }, nodes: reviews },
    reviewThreads: { pageInfo: { hasNextPage: more }, nodes: threads },
    comments: { pageInfo: { hasNextPage: false }, nodes: comments },
  };
}

function summarize(data, options = {}) {
  assert.equal(typeof watcher.summarizeReview, 'function', 'watcher.mjs does not export summarizeReview(pullRequest, { head, posted })');
  return watcher.summarizeReview(data, { head: HEAD, posted: [], ...options });
}

const opinion = (login, state, oid, minutes) => ({ state, submittedAt: at(minutes), commit: { oid }, author: user(login) });

const mixed = () => pullRequest({
  opinions: [
    opinion('reviewer-a', 'APPROVED', HEAD, 30),
    opinion('reviewer-b', 'CHANGES_REQUESTED', HEAD, 31),
    opinion('reviewer-c', 'CHANGES_REQUESTED', OLD, 5),
  ],
  reviews: [
    { id: 'PRR_b1', state: 'COMMENTED', body: 'A few naming nits below.', submittedAt: at(32), url: PR + '#r1', commit: { oid: HEAD }, author: user('reviewer-b') },
    { id: 'PRR_a1', state: 'APPROVED', body: '', submittedAt: at(30), url: PR + '#r2', commit: { oid: HEAD }, author: user('reviewer-a') },
  ],
  threads: [
    thread('PRRT_current', [comment('PRRC_1', bot('review-bot'), 20, 'Possible null dereference here.')]),
    thread('PRRT_outdated', [comment('PRRC_2', user('reviewer-c'), 6)], { outdated: true }),
    thread('PRRT_resolved', [comment('PRRC_3', user('reviewer-b'), 7)], { resolved: true }),
  ],
  comments: [
    comment('IC_human', user('reviewer-d'), 40, 'Could this ship behind a flag?'),
    comment('IC_bot', user('helper[bot]'), 41, 'Coverage dropped by 0.2%.'),
  ],
});

test('Hawkeye reduces a PR review to approvals, change requests, current threads and earlier-head feedback', () => {
  const review = summarize(mixed());
  assert.deepEqual(review.approvals, ['reviewer-a']);
  assert.deepEqual(review.changesRequested, ['reviewer-b'], 'a change request on an earlier head is not a current one');
  assert.equal(review.unresolved, 1, 'only the unresolved thread that is not outdated is current');
  assert.equal(review.earlier, 2, 'the outdated thread and the change request on the earlier head are earlier-head feedback');
  assert.equal(review.more, false);
  assert.equal(review.lastActivityAt, at(41));
});

test('each current feedback item is labeled bot or human and carries its place and an excerpt', () => {
  const review = summarize(mixed());
  const byAuthor = Object.fromEntries(review.items.map(item => [item.author, item]));
  assert.deepEqual(Object.keys(byAuthor).sort(), ['helper[bot]', 'review-bot', 'reviewer-b', 'reviewer-d'],
    'items are the current thread, the review with a body and both conversation comments; not the outdated or resolved thread or the empty approval');
  assert.deepEqual([byAuthor['review-bot'].kind, byAuthor['review-bot'].bot, byAuthor['review-bot'].path, byAuthor['review-bot'].line],
    ['thread', true, 'src/widget.mjs', 12]);
  assert.deepEqual([byAuthor['reviewer-b'].kind, byAuthor['reviewer-b'].bot], ['review', false]);
  assert.deepEqual([byAuthor['reviewer-d'].kind, byAuthor['reviewer-d'].bot], ['comment', false]);
  assert.equal(byAuthor['helper[bot]'].bot, true, 'a login ending [bot] marks a bot');
  assert.equal(byAuthor['review-bot'].excerpt, 'Possible null dereference here.');
  for (const item of review.items) {
    assert.equal(typeof item.key, 'string');
    assert.ok(item.url.startsWith(PR), 'item ' + item.key + ' links to the PR');
  }
  assert.deepEqual(review.items.map(item => item.author), ['helper[bot]', 'reviewer-d', 'reviewer-b', 'review-bot'], 'items are newest first');
  assert.deepEqual([...review.keys].sort(), review.items.map(item => item.key).sort(), 'keys hold every current item, and only those');
});

test('a change request stays standing when the same reviewer later leaves a comment-only review', () => {
  const data = mixed();
  data.reviews.nodes.push({ id: 'PRR_b2', state: 'COMMENTED', body: 'Also, one more thing.', submittedAt: at(50), url: PR + '#r3', commit: { oid: HEAD }, author: user('reviewer-b') });
  assert.deepEqual(summarize(data).changesRequested, ['reviewer-b']);
});

test('a reply in an existing thread is new feedback, and nothing else changes key', () => {
  const before = summarize(mixed());
  const data = mixed();
  data.reviewThreads.nodes[0].comments.nodes.push(comment('PRRC_4', user('reviewer-b'), 45, 'Still seeing this on the latest head.'));
  const after = summarize(data);
  const added = after.keys.filter(key => !before.keys.includes(key));
  const dropped = before.keys.filter(key => !after.keys.includes(key));
  assert.equal(added.length, 1, 'the thread with a new reply gets a new key');
  assert.equal(dropped.length, 1, 'the old key of that thread is replaced');
  assert.equal(after.items.find(item => item.key === added[0]).kind, 'thread');
  assert.equal(after.lastActivityAt, at(45));
});

test('comments the worker posted are not feedback, nor is a thread whose last comment the worker posted', () => {
  const data = mixed();
  data.reviewThreads.nodes[0].comments.nodes.push(comment('PRRC_ours', user('reviewer-d'), 46, 'Fixed in the next commit.'));
  data.comments.nodes.push(comment('IC_ours', user('reviewer-d'), 47, 'Thanks, replied in the threads.'));
  const review = summarize(data, { posted: ['PRRC_ours', 'IC_ours'] });
  assert.ok(!review.items.some(item => item.kind === 'thread'), 'the thread the worker answered last is not new feedback');
  assert.ok(!review.items.some(item => item.excerpt.includes('replied in the threads')), 'the worker\'s own conversation comment is skipped');
  assert.ok(review.items.some(item => item.author === 'reviewer-d' && item.kind === 'comment'), 'the owner\'s own GitHub comment still counts');
});

test('a comment-only review on an earlier head is not current feedback', () => {
  const data = mixed();
  data.reviews.nodes[0].commit.oid = OLD;
  const review = summarize(data);
  assert.ok(!review.items.some(item => item.kind === 'review'));
});

test('the wake evidence is capped at 10 items with short excerpts, while the keys stay complete and the observation small', () => {
  const long = 'x'.repeat(5000);
  const threads = Array.from({ length: 100 }, (_, n) => thread('PRRT_kwDOAbCdEf4' + String(n).padStart(6, '0'),
    [comment('PRRC_kwDOAbCdEf4' + String(n).padStart(8, '0'), user('reviewer-' + n), n, long)]));
  const comments = Array.from({ length: 100 }, (_, n) => comment('IC_kwDOAbCdEf4' + String(n).padStart(8, '0'), bot('bot-' + n), 200 + n, long));
  const review = summarize(pullRequest({ threads, comments, more: true }));
  assert.equal(review.items.length, 10);
  assert.ok(review.items.every(item => item.excerpt.length <= 200), 'excerpts are at most 200 characters');
  assert.equal(review.keys.length, 200, 'the full key set is kept for the wake comparison');
  assert.equal(review.items[0].author, 'bot-99', 'the newest item comes first');
  assert.equal(review.more, true, 'the observation says when more threads or comments exist');
  const event = { observation: { head: HEAD, status: 'running', failedCount: 0, failures: [], review } };
  assert.ok(Buffer.byteLength(JSON.stringify(event)) < 24 * 1024, 'the observation stays well under the 32 KiB event cap');
});

test('an incomplete GitHub answer is a read failure, not an empty review', () => {
  assert.equal(typeof watcher.summarizeReview, 'function', 'watcher.mjs does not export summarizeReview(pullRequest, { head, posted })');
  assert.throws(() => watcher.summarizeReview(null, { head: HEAD, posted: [] }), error => !(error instanceof assert.AssertionError));
  const data = mixed();
  delete data.reviewThreads;
  assert.throws(() => watcher.summarizeReview(data, { head: HEAD, posted: [] }), error => !(error instanceof assert.AssertionError));
});

test('an approval on the current head that has a comment is feedback; an empty approval or one on an earlier head is not', () => {
  const review = summarize(pullRequest({ reviews: [
    { id: 'PRR_said', state: 'APPROVED', body: 'Looks good, but drop the debug log.', submittedAt: at(50), url: PR + '#r3', commit: { oid: HEAD }, author: user('reviewer-a') },
    { id: 'PRR_empty', state: 'APPROVED', body: '  ', submittedAt: at(51), url: PR + '#r4', commit: { oid: HEAD }, author: user('reviewer-b') },
    { id: 'PRR_old', state: 'APPROVED', body: 'Fine on the old head.', submittedAt: at(52), url: PR + '#r5', commit: { oid: OLD }, author: user('reviewer-c') },
  ] }));
  assert.deepEqual(review.keys, ['PRR_said']);
  assert.deepEqual([review.items[0].kind, review.items[0].author, review.items[0].excerpt], ['review', 'reviewer-a', 'Looks good, but drop the debug log.']);
});

const green = [{ __typename: 'CheckRun', name: 'Tests', status: 'COMPLETED', conclusion: 'SUCCESS' }];
const mergeOf = (extra, state = 'OPEN') => watcher.summarizePr({ state, headRefOid: HEAD, statusCheckRollup: green, ...extra }).merge;

test('Hawkeye reads a conflicting PR as conflicting, from either GitHub field', () => {
  assert.equal(mergeOf({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), 'conflicting');
  assert.equal(mergeOf({ mergeable: 'CONFLICTING' }), 'conflicting');
  assert.equal(mergeOf({ mergeStateStatus: 'DIRTY' }), 'conflicting');
  assert.equal(mergeOf({ mergeable: 'MERGEABLE', mergeStateStatus: 'DIRTY' }), 'conflicting');
});

test('Hawkeye reads a mergeable PR behind its base as behind and any other mergeable PR as clean', () => {
  assert.equal(mergeOf({ mergeable: 'MERGEABLE', mergeStateStatus: 'BEHIND' }), 'behind');
  for (const state of ['CLEAN', 'BLOCKED', 'UNSTABLE', 'HAS_HOOKS', 'DRAFT', 'UNKNOWN', undefined, null]) {
    assert.equal(mergeOf({ mergeable: 'MERGEABLE', mergeStateStatus: state }), 'clean', 'MERGEABLE with ' + state);
  }
});

test('Hawkeye leaves merge out when GitHub has not computed it, or answers nothing, null or something unknown', () => {
  for (const extra of [{}, { mergeable: 'UNKNOWN' }, { mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }, { mergeable: null, mergeStateStatus: null },
    { mergeable: 'SOMETHING_NEW' }, { mergeable: 7 }, { mergeStateStatus: 'BEHIND' }]) {
    const summary = watcher.summarizePr({ state: 'OPEN', headRefOid: HEAD, statusCheckRollup: green, ...extra });
    assert.ok(!('merge' in summary), 'merge for ' + JSON.stringify(extra) + ' was ' + summary.merge);
  }
});

test('Hawkeye reports no merge answer for a merged or closed PR', () => {
  for (const state of ['MERGED', 'CLOSED']) {
    assert.ok(!('merge' in watcher.summarizePr({ state, headRefOid: HEAD, statusCheckRollup: green, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })), state);
  }
});

test('the merge answer does not change the check status, failures or head Hawkeye reports', () => {
  const summary = watcher.summarizePr({ state: 'OPEN', headRefOid: HEAD.toUpperCase(), statusCheckRollup: green, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' });
  assert.deepEqual(summary, { head: HEAD, status: 'passed', failedCount: 0, failures: [], merge: 'conflicting' });
});

test('the production gh pr view asks for mergeable and mergeStateStatus', () => {
  const fields = watcher.PR_VIEW_FIELDS.split(',');
  assert.ok(fields.includes('mergeable') && fields.includes('mergeStateStatus'));
});
