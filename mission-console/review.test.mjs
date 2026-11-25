import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as labels from './review.mjs';

const NOW = Date.parse('2026-01-02T14:00:00.000Z');
const review = extra => ({ approvals: [], changesRequested: [], unresolved: 0, earlier: 0, items: [], keys: [], more: false, ...extra });
const story = (phase, extra) => ({ phase, prObservation: { review: review(extra) } });

test('the Mission Console names the review state of an open PR and flags 24 hours without review activity', () => {
  assert.equal(typeof labels.reviewLabels, 'function', 'review.mjs does not export reviewLabels(story, now)');
  assert.deepEqual(labels.reviewLabels(story('ci', { changesRequested: ['reviewer-b'], unresolved: 3, earlier: 2, lastActivityAt: '2026-01-01T11:59:00.000Z' }), NOW),
    ['Changes requested · 1 reviewer', '3 unresolved threads', 'Earlier-head feedback · 2', 'No review activity for 1d 2h']);
  assert.deepEqual(labels.reviewLabels(story('merge', { changesRequested: ['a', 'b'], unresolved: 1, lastActivityAt: '2026-01-02T13:00:00.000Z' }), NOW),
    ['Changes requested · 2 reviewers', '1 unresolved thread']);
  assert.deepEqual(labels.reviewLabels(story('building', { unresolved: 1 }), NOW), [], 'only ci and merge show review state');
  assert.deepEqual(labels.reviewLabels({ phase: 'ci' }, NOW), [], 'no review observed yet');
});

test('the stall flag is part of what tells the Mission Console to redraw', () => {
  const quiet = story('ci', { lastActivityAt: '2026-01-01T14:01:00.000Z' });
  assert.equal(labels.stalled(quiet, NOW), false, '23h 59m is not stalled');
  assert.equal(labels.stalled(quiet, NOW + 2 * 60000), true, 'past 24 hours it is');
  assert.equal(labels.stalled(story('pr-review', { lastActivityAt: '2025-01-01T00:00:00.000Z' }), NOW), false, 'a story in PR review is not flagged');
});

test('the Mission Console redraws when the stall age it shows moves on, not every minute', () => {
  assert.equal(typeof labels.refreshKey, 'function', 'review.mjs does not export refreshKey(stories, now)');
  const stories = [{ id: 'PRR-9', revision: 4, ...story('ci', { lastActivityAt: '2026-01-01T14:00:00.000Z' }) }];
  assert.notEqual(labels.refreshKey(stories, NOW - 60000), labels.refreshKey(stories, NOW + 60000), 'the stall flag appears');
  assert.equal(labels.refreshKey(stories, NOW + 60000), labels.refreshKey(stories, NOW + 120000), 'the same shown age keeps the same key');
  assert.notEqual(labels.refreshKey(stories, NOW + 60000), labels.refreshKey(stories, NOW + 3600000), '1d 0h becomes 1d 1h');
  assert.notEqual(labels.refreshKey(stories, NOW), labels.refreshKey([{ ...stories[0], revision: 5 }], NOW), 'a new revision still redraws');
});
