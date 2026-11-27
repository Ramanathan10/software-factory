# FEED-1: filter the live feed by keyword or story ID

## Problem

The owner wants to narrow the Command Center's live feed by keyword or by story ID. Today the feed shows the newest 80 events across every story that passes the role and repository filters, with no way to narrow it further.

## How the feed works today

Every /events frame carries each non-deleted story with its newest 40 events (mission-console/store.mjs:503). renderFeed (command-center/ui/app.js:672) keeps stories that pass the role and repository filters, sorts their events by seq descending and shows the newest 80. seenSeqs holds the last rendered set; entries not in it animate as new, add to the events/min rate and, while minimized, to the unread badge. render() (app.js:807) re-renders the feed when its key changes. Entries are built with el() and text nodes, never HTML.

## Settled decisions (owner's answers)

1. Controls: a keyword box in a row under the "Live feed" title. Clicking a story ID in a feed entry filters to that story; clicking it again clears the story filter.
2. Combining: with both set, an entry must match the keyword and the story (AND).
3. Picked story: shown as a removable chip "FEED-1 ×" beside the keyword box. Each entry's story ID is a keyboard-reachable button titled "Show only <ID>", or "Show all stories" when it is the picked story.
4. Keyword match: case-insensitive substring over what the entry shows: story ID, event type and detail. No regex. Leading and trailing spaces are ignored.
5. Reload: both filters clear on reload; nothing is written to localStorage.
6. Counting: the unread badge and events/min count only entries the filtered feed shows. Changing a filter never animates, counts or adds to unread any entry.
7. Reach: the events the dashboard already holds (newest 40 per story), filtered before the 80-entry cut. No /api/history fetch.
8. Visibility: while minimized, the feed header shows a "filtered" marker when either filter is on. When no entry matches, the feed shows "No entries match" with a Clear button that resets both filters.
9. Hidden story: if the role or repository filter hides the picked story, the story filter stays and the empty state with Clear shows.
10. Escape in the keyword box clears the keyword only.
11. Test seam: new pure module command-center/ui/feed.js with a node unit test; app.js wires it to the DOM.
12. Before and after: screenshots, as below.
13. Architecture diagram: none.
14. Arrival rule applies to all feed filters: changing the role or repository filter also stops replaying the arrival animation and adding entries to events/min and unread.
15. Keyword: leading and trailing spaces are ignored; spaces inside it count.
16. Focus: after picking a story, keyboard focus moves to the chip's ×; after clearing the story (ID button, ×, or Clear), to the keyword box.

## Design

- feed.js exports pure functions: `matches(event, { keyword, story })` and `feedEntries(stories, { keyword, story }, limit = 80)` returning the filtered, seq-sorted (newest first), limited list, each entry carrying `story` (the story ID) and `title`; and `freshEntries(shown, previousMaxSeq)`, which returns the shown entries with seq above previousMaxSeq, and nothing when previousMaxSeq is null (the first frame).
- Freshness: an entry is new only if its seq is higher than the highest seq among all events the dashboard had received at the previous feed render (every story, before any filter or cut). The watermark starts null, so the first frame after load counts and animates nothing. Role and repository filter changes get the same rule.
- app.js: keyword and story state in module variables; the keyword box's input event and the chip/ID buttons set state and call renderFeed; both join the feed key in render(). The story ID button stops click propagation so it never toggles the panel. After a story pick or clear, focus moves as decision 16 says. The keyword box handles Escape itself and stops propagation, so the document-level Escape handler does not also clear the role filter.
- index.html: a row `<div class="feed-filters">` between the h2 and the ol, holding the keyword input (`id="feed-keyword"`, `type="search"`, `aria-label="Filter live feed"`) and the chip (`id="feed-story"`). The marker `<b id="feed-filtered" hidden>filtered</b>` sits inside the h2 beside the unread badge, so it stays visible when the row and the list are hidden. Values go in only through .value and textContent.
- app.css: `.feed` grid rows become `auto auto 1fr`; `.feed-filters` is hidden while minimized; `#feed-filtered` shows only while minimized and a filter is on; the narrow layout keeps the row.
- command-center/console-service.mjs serves feed.js. The test author found this: its asset map lists every module the page imports, so the plan's "out of scope" for that file needs this one entry.
- Touches only the feed parts of app.js; stays out of QFMT-1 question cards and BAA-1 before-and-after card. Merge main before publishing.

## Acceptance criteria

- AC1 Typing "handoff" shows only entries whose story ID, type or detail contains "handoff" in any case; time text is not matched.
- AC2 Clicking a story ID shows only that story's entries and a "<ID> ×" chip; clicking the same ID again, or the chip's ×, shows all stories.
- AC3 Keyword and story both set: only entries matching both show.
- AC4 With a filter on, matches older than the newest 80 overall but within the received events still show (filtering happens before the cut), up to 80.
- AC5 Changing the keyword, story, role or repository filter never adds the "new" class, never increases events/min, never increases unread.
- AC6 A new matching event arriving while filtered animates and counts; a new non-matching event does neither.
- AC7 Minimized with a filter on: the header shows "filtered" and the unread badge counts only matching arrivals.
- AC8 No matches: "No entries match" and a Clear button; Clear empties the keyword box and removes the chip.
- AC9 The role or repository filter hiding the picked story leaves the chip and shows the empty state.
- AC10 Escape in the keyword box clears it; the story filter and the role filter stay.
- AC11 Reload starts with no filter.
- AC12 Filter text containing markup renders as text only; no-html.test.mjs and ui-lint.test.mjs pass with feed.js in their file lists.
- AC13 node --test and node e2e/run.mjs pass; no package dependency; no source comments.
- AC14 The first frame after load marks no entry new, adds nothing to events/min and nothing to unread, minimized or not.
- AC15 After clicking a story ID, focus is on the chip's ×; after clearing the story by its ID, the × or Clear, focus is in the keyword box.
- AC16 The keyword "  handoff  " matches the same entries as "handoff".

## Test level

Unit: command-center/feed.test.mjs covers matching (AC1, AC3, AC16), the pre-cut filter (AC4), the story filter including a hidden story (AC2 data, AC9) and freshness (AC5, AC6, AC14). It sits beside the other command-center tests, not under ui/, which the server serves. Static: no-html and ui-lint file lists gain feed.js; header.test.mjs gains structural checks for the filter row, the marker and the CSS. The repository has no DOM harness, so browser behaviour (AC2 clicks, AC7, AC8, AC10, AC11, AC15) is checked by hand on the throwaway Command Center during before and after (phase 6).

## Before and after

Screenshots of the feed panel from a throwaway Command Center with a seeded fixture database on its own free port (never 4174, never start() on a copy of the live database). Before at main with no filter. After on the branch: a keyword filter, a story filter with chip, both, the empty state, and the minimized marker.

## Out of scope

Server changes beyond serving feed.js (serve.mjs, store.mjs), adapters/harnesses.mjs, older history, regex, multi-story selection, persisting filters, docs.

## Run decisions from the profile

Gates node --test and gitleaks; pipeline Tests; implementation level full; review round limit 3.

## Context pack

Scout: Black Widow. Base: origin/main cb0ffc5. Worktree: C:/repos/software-factory-worktrees/story/feed-1-filter-live-feed.

### Work item

Owner's words: "New story: Add Log filtering for the live feed. I could filter for keywords, or I could filter for story IDs." No GitHub issue.

### How the live feed works today

- Markup: `command-center/ui/index.html:45-50`. `<aside id="feed-panel">` holds an `<h2>` with the title, `#feed-rate`, `#feed-unread` and the `#feed-toggle` minimize button, then `<ol id="feed">`. No filter control exists.
- Data: the page opens `EventSource('/events')` (`app.js:822`). Each `stories` frame (`console-service.mjs:162`, pushed when anything changes, `beat` otherwise once a second) carries every non-deleted story, open and closed, each with its newest **40** events (`store.mjs:503`, `withHistory(story, 40)`). There is no separate feed route.
- Rendering: `renderFeed()` (`app.js:672-689`) takes stories from `visible()` (the existing role filter `filterRole` and repository picker `filterRepo`, `app.js:179`), flattens their events, sorts by `seq` descending and keeps the newest **80**. Each entry shows role avatar, story ID, event type, relative time and `detail`. All text goes in through `el()` / text nodes, never HTML.
- Fresh events: `seenSeqs` tracks the last rendered set; entries not seen before get the `new` arrival animation, push a timestamp into `eventTimes` (feed rate) and, when minimized, add to `unread`.
- Feed rate: `tick()` (`app.js:810-815`) keeps timestamps from the last 60 s and shows "N events/min". It counts only what the filtered feed (role and repo) showed as new.
- Unread badge: `#feed-unread`, counted only while minimized, reset on restore (`app.js:655-670`).
- Re-render trigger: `render()` (`app.js:807`) re-renders the feed when the newest seq of any story, `filterRole` or `filterRepo` changes, via the `changed()` signature cache. A new filter must join that key.
- Persistence pattern: `localStorage` keys `aisdlc-view` and `aisdlc-feed-min` persist; `filterRole` and `filterRepo` do not.
- Older history: `GET /api/history?story=<id>` (`console-service.mjs:183`) returns a story's full event list; the UI uses it only in a closed story's detail window (`app.js:777`). Using it needs no server change.
- Before screenshot: `before/dashboard-feed.png` (live dashboard, 1600x1000, all repositories, no filter).

### Conventions and rules that apply

- `AGENTS.md`: run `node --test` before committing; no package dependencies; no comments in source (`comment-ratchet.mjs`); harness-neutral console; keep real names out of tracked files (`private-details.test.mjs`); ADR only for a reason the code cannot show, number taken at publish time.
- `command-center/no-html.test.mjs`: no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`DOMParser`/... in the UI files. Filter text must go in only as `value`/text.
- `command-center/ui-lint.test.mjs`: no `list.length && el(...)`.
- Both tests list UI files explicitly; a new UI module must be added to both lists.
- UI tests are static source checks plus node unit tests of small pure modules (`attention.js`, `badge.js`, `jarvis.js`, `markdown.js`); there is no DOM or browser test harness. A pure filter function in its own module is the testable seam.
- `header.test.mjs` asserts header and CSS structure, including the narrow (`max-width: 1100px`) layout; feed CSS is at `app.css:295-320` and `374-377`.
- No README or skill describes the live feed, so no doc file must change.
- Profile: gates `node --test` and gitleaks (`--log-opts=origin/main..HEAD`); pipeline "Tests" (also runs `node e2e/run.mjs`); spec at `docs/specs/story/feed-1-filter-live-feed.md` (earlier stories use the branch name without the `story/` prefix); implementation level full; review round limit 3; reply to every PR comment before resolving.

### Test commands

- Focused: `node --test command-center/no-html.test.mjs command-center/ui-lint.test.mjs command-center/header.test.mjs` plus the new module's test.
- Full: `node --test`; `node e2e/run.mjs` (unaffected: no worker or delivery change).

### Parallel work and risks

- QFMT-1 (question cards) and BAA-1 (before-and-after card) edit `app.js`; this story touches only `renderFeed`, the feed key in `render()`, the feed header, and feed CSS. Merge main before publishing.
- LAUNCH-1 owns `serve.mjs` and `adapters/harnesses.mjs`; the plan does not need them.
- Risk: a filter that survives silently hides news; the minimized feed and unread badge must make an active filter visible.
- Risk: filtering after the 80-entry cut would hide matches that are still in the received window.
- Risk: a typed filter re-rendering the whole `<ol>` on every keystroke replays the arrival animation; the `seenSeqs` logic must not treat filter changes as fresh events.
- Before-and-after needs a throwaway Command Center on its own port and its own database; port 4174 is the live one.

### Evidence note

`before/dashboard-feed.png` came from the live Command Center on port 4174 with live data. It shows today's feed for the plan only; it is not the before reference. A matched before and after must come from one throwaway Command Center with a seeded fixture database on its own port, before at cb0ffc5. Do not run `start()` on a copy of the live database: start-up delivers waiting decisions to every staffed story (ADR 0028) and could message real workers. Check `e2e/rig.mjs` for a fixture server, or serve `/events` from `createConsoleService` without the supervisor.

### Proposed first interview round (for the planner)

Independent questions, each worded so "yes" accepts the recommendation:

1. Control shape: a keyword box plus a story picker in the feed header, applied together (AND)? Alternatives: one search box matching story ID, type and detail; a keyword box plus clicking a story ID in an entry. "What the picker lists" depends on this and waits for round two.
2. Keyword matching: case-insensitive plain substring over story ID, title, event type and detail, no regex?
3. Reload: the filter clears on reload, like the role and repository filters (view and feed-min persist)?
4. Counting: unread badge and feed rate count only entries the filtered feed shows (today they already count only the role/repo-filtered feed), and changing the filter never counts or animates entries as new?
5. Reach: filter the events the dashboard already holds (40 newest per story) before the 80-entry cut, without fetching `/api/history`?
6. Visibility: show that a filter is on while the feed is minimized, and an empty state with a Clear control when nothing matches?
7. Test seam: put the filter logic in a new pure module `command-center/ui/feed.js` with a node unit test, added to the no-html and ui-lint file lists?
8. Before and after: screenshots of the feed panel from a throwaway Command Center with a seeded fixture database on its own port, before at cb0ffc5, after on the branch with a keyword and a story filter applied?
9. Architecture diagram: none?

Not asked (facts): no doc describes the feed; frames carry 40 events per story (`store.mjs:503`); the feed shows 80 (`app.js:675`); role/repo filters don't persist, view and feed-min do (`app.js:24,660`); no server change is needed.
