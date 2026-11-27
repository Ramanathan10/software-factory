import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const feed = await import('./ui/feed.js').catch(() => ({}));
const need = name => {
  assert.equal(typeof feed[name], 'function', `command-center/ui/feed.js must export ${name}()`);
  return feed[name];
};

const event = (seq, type, detail, extra = {}) => ({ seq, type, detail, phase: 'building', at: '2026-11-27T10:00:00.000Z', ...extra });

const stories = [
  { id: 'FEED-1', title: 'Filter the live feed', events: [event(10, 'handoff', 'Tests are red'), event(7, 'activity', 'Reading the HANDOFF notes'), event(3, 'create', 'Brief')] },
  { id: 'QFMT-1', title: 'Question cards', events: [event(9, 'question', 'Which format?'), event(8, 'handoff', 'Plan ready'), event(2, 'create', 'Brief')] },
  { id: 'BAA-1', title: 'Before and after card', events: [event(6, 'activity', 'Capturing the screen'), event(1, 'create', 'Brief')] },
];
const ids = entries => entries.map(entry => entry.seq);
const none = { keyword: '', story: null };

test('no filter returns every event newest first with its story id and title', () => {
  const entries = need('feedEntries')(stories, none);
  assert.deepEqual(ids(entries), [10, 9, 8, 7, 6, 3, 2, 1]);
  assert.equal(entries[0].story, 'FEED-1');
  assert.equal(entries[0].title, 'Filter the live feed');
  assert.equal(entries[1].story, 'QFMT-1');
});

test('AC1: a keyword matches story id, type and detail in any case', () => {
  const entries = need('feedEntries');
  assert.deepEqual(ids(entries(stories, { keyword: 'handoff', story: null })), [10, 8, 7]);
  assert.deepEqual(ids(entries(stories, { keyword: 'HANDOFF', story: null })), [10, 8, 7]);
  assert.deepEqual(ids(entries(stories, { keyword: 'baa-1', story: null })), [6, 1]);
  assert.deepEqual(ids(entries(stories, { keyword: 'which', story: null })), [9]);
  assert.deepEqual(ids(entries(stories, { keyword: 'no such text', story: null })), []);
});

test('AC1: the time an entry shows is not searched', () => {
  assert.deepEqual(ids(need('feedEntries')(stories, { keyword: '2026', story: null })), []);
  assert.deepEqual(ids(need('feedEntries')(stories, { keyword: 'just now', story: null })), []);
});

test('the keyword is a plain substring, not a pattern', () => {
  const entries = need('feedEntries');
  assert.deepEqual(ids(entries(stories, { keyword: '.*', story: null })), []);
  assert.deepEqual(ids(entries(stories, { keyword: '?', story: null })), [9]);
  assert.deepEqual(ids(entries(stories, { keyword: '(', story: null })), []);
});

test('an event with no detail still matches on its id and type', () => {
  const sparse = [{ id: 'X-1', title: 't', events: [{ seq: 1, type: 'turn-started', phase: 'building', at: 'now' }] }];
  assert.deepEqual(ids(need('feedEntries')(sparse, { keyword: 'turn-started', story: null })), [1]);
  assert.deepEqual(ids(need('feedEntries')(sparse, { keyword: 'undefined', story: null })), []);
});

test('AC16: leading and trailing spaces are ignored, inner spaces count', () => {
  const entries = need('feedEntries');
  assert.deepEqual(ids(entries(stories, { keyword: '  handoff  ', story: null })), ids(entries(stories, { keyword: 'handoff', story: null })));
  assert.deepEqual(ids(entries(stories, { keyword: '   ', story: null })), ids(entries(stories, none)));
  assert.deepEqual(ids(entries(stories, { keyword: 'Plan ready', story: null })), [8]);
  assert.deepEqual(ids(entries(stories, { keyword: 'Plan  ready', story: null })), []);
});

test('AC2: a story filter keeps only that story', () => {
  assert.deepEqual(ids(need('feedEntries')(stories, { keyword: '', story: 'QFMT-1' })), [9, 8, 2]);
  assert.deepEqual(ids(need('feedEntries')(stories, { keyword: '', story: 'FEED-1' })), [10, 7, 3]);
});

test('AC3: keyword and story must both match', () => {
  assert.deepEqual(ids(need('feedEntries')(stories, { keyword: 'handoff', story: 'FEED-1' })), [10, 7]);
  assert.deepEqual(ids(need('feedEntries')(stories, { keyword: 'handoff', story: 'BAA-1' })), []);
});

test('the story filter matches the whole id, not a prefix', () => {
  const near = [{ id: 'FEED-1', title: 'a', events: [event(2, 'x', 'one')] }, { id: 'FEED-12', title: 'b', events: [event(1, 'x', 'twelve')] }];
  assert.deepEqual(ids(need('feedEntries')(near, { keyword: '', story: 'FEED-1' })), [2]);
});

test('AC9: a picked story that is not among the visible stories leaves nothing', () => {
  const visible = stories.filter(story => story.id !== 'QFMT-1');
  assert.deepEqual(ids(need('feedEntries')(visible, { keyword: '', story: 'QFMT-1' })), []);
});

test('AC4: the filter runs before the 80-entry cut', () => {
  const many = Array.from({ length: 100 }, (_, index) => event(1000 - index, 'activity', index === 95 ? 'needle' : 'hay'));
  const crowded = [{ id: 'A-1', title: 'a', events: many }];
  const entries = need('feedEntries');
  assert.equal(entries(crowded, none).length, 80);
  assert.deepEqual(ids(entries(crowded, { keyword: 'needle', story: null })), [1000 - 95]);
});

test('AC4: a filter that matches more than 80 still shows 80, newest first', () => {
  const many = Array.from({ length: 120 }, (_, index) => event(500 - index, 'activity', 'hay'));
  const shown = need('feedEntries')([{ id: 'A-1', title: 'a', events: many }], { keyword: 'hay', story: null });
  assert.equal(shown.length, 80);
  assert.equal(shown[0].seq, 500);
  assert.equal(shown[79].seq, 421);
});

test('the limit argument overrides 80', () => {
  assert.deepEqual(ids(need('feedEntries')(stories, none, 3)), [10, 9, 8]);
});

test('feedEntries does not change the stories it is given', () => {
  const before = JSON.stringify(stories);
  need('feedEntries')(stories, { keyword: 'handoff', story: 'FEED-1' });
  assert.equal(JSON.stringify(stories), before);
});

test('matches() applies the same keyword and story rules to one entry', () => {
  const matches = need('matches');
  const entry = { ...event(5, 'handoff', 'Ready for review'), story: 'FEED-1' };
  assert.equal(matches(entry, { keyword: 'READY', story: null }), true);
  assert.equal(matches(entry, { keyword: ' feed-1 ', story: null }), true);
  assert.equal(matches(entry, { keyword: 'ready', story: 'FEED-1' }), true);
  assert.equal(matches(entry, { keyword: 'ready', story: 'QFMT-1' }), false);
  assert.equal(matches(entry, { keyword: 'absent', story: 'FEED-1' }), false);
  assert.equal(matches(entry, none), true);
});

test('markup in the keyword is only ever text to match', () => {
  const entries = need('feedEntries');
  const markup = '<img src=x onerror=alert(1)>';
  assert.deepEqual(ids(entries(stories, { keyword: markup, story: null })), []);
  const carrying = [{ id: 'A-1', title: 'a', events: [event(1, 'activity', 'saw ' + markup)] }];
  assert.deepEqual(ids(entries(carrying, { keyword: markup, story: null })), [1]);
});

test('AC14: the first frame has no previous watermark, so nothing is new', () => {
  const shown = need('feedEntries')(stories, none);
  assert.deepEqual(need('freshEntries')(shown, null), []);
});

test('AC6: only events above the previous watermark are new', () => {
  const shown = need('feedEntries')(stories, none);
  assert.deepEqual(ids(need('freshEntries')(shown, 8)), [10, 9]);
  assert.deepEqual(ids(need('freshEntries')(shown, 10)), []);
  assert.deepEqual(ids(need('freshEntries')(shown, 0)), ids(shown));
});

test('AC5: widening a filter does not make older entries new', () => {
  const watermark = Math.max(...stories.flatMap(story => story.events.map(item => item.seq)));
  const narrow = need('feedEntries')(stories, { keyword: 'handoff', story: null });
  const wide = need('feedEntries')(stories, none);
  assert.ok(wide.length > narrow.length);
  assert.deepEqual(need('freshEntries')(narrow, watermark), []);
  assert.deepEqual(need('freshEntries')(wide, watermark), []);
});

test('AC5: hiding and re-showing a story through the role or repository filter is not an arrival', () => {
  const watermark = 10;
  const hidden = stories.filter(story => story.id !== 'QFMT-1');
  assert.deepEqual(need('freshEntries')(need('feedEntries')(hidden, none), watermark), []);
  assert.deepEqual(need('freshEntries')(need('feedEntries')(stories, none), watermark), []);
});

test('AC6: a new matching event is fresh and a new non-matching one is not shown at all', () => {
  const arrived = stories.map(story => story.id === 'FEED-1'
    ? { ...story, events: [event(11, 'handoff', 'Another handoff'), event(12, 'activity', 'Unrelated'), ...story.events] }
    : story);
  const shown = need('feedEntries')(arrived, { keyword: 'handoff', story: null });
  assert.ok(!ids(shown).includes(12));
  assert.deepEqual(ids(need('freshEntries')(shown, 10)), [11]);
});

test('the watermark covers events the filter hides, so they never arrive later by widening', () => {
  const watermark = 12;
  const after = [{ id: 'A-1', title: 'a', events: [event(12, 'activity', 'Unrelated'), event(11, 'handoff', 'Matches')] }];
  assert.deepEqual(need('freshEntries')(need('feedEntries')(after, none), watermark), []);
});

test('the Command Center serves feed.js and app.js imports it', () => {
  const service = readFileSync(new URL('./console-service.mjs', import.meta.url), 'utf8');
  assert.ok(service.includes("['/feed.js', ['feed.js', 'text/javascript; charset=utf-8']]"), 'console-service.mjs must serve /feed.js');
  const app = readFileSync(new URL('./ui/app.js', import.meta.url), 'utf8');
  assert.match(app, /from '\.\/feed\.js'/, 'app.js must import ./feed.js');
});
