# HDR-1: Move the layout tabs and repository picker into the Command Center header

Context pack: below.

## Problem

The layout tabs (Lanes, Agents, Track, Archive), the repository picker and the crew filter chip sit in a toolbar row at the top of the main pane, above the board. That row takes height from the lanes. The owner asked for it to move next to "JARVIS Command Center" in the header, so the main pane holds only the lanes.

## Settled decisions (owner, round 1 events 2044-2050, round 2 events 2076-2078)

1. Header order: brand, layout tabs, repository picker, crew filter chip, then the stats, Notify me and the clock pushed to the right as today.
2. The crew filter chip (`#filter`) moves into the header after the picker.
3. The "Waiting on you" decisions banner (`#decisions`) stays in the main pane above the board, unchanged, including inbox focus mode.
4. Narrow windows: the header wraps. Tabs, picker and chip stay together as one group; when the row is too narrow, the stats, Notify me and the clock drop to a second header row. The existing 1100px rule (clock hidden, stats tightened) stays.
5. Before-and-after: screenshots (see Run decisions).
6. No architecture diagram.
7. Test level: text tests on `index.html` and `app.css`, like `card.test.mjs`; the screenshots carry the visual check.
8. Compact header (`header-fit`): header gap 24px to 16px, stats gap 22px to 14px, the repository picker capped at 170px wide (long names cut with an ellipsis; the full name stays in the dropdown), so the header fits one row from about 1400px.
9. The full chip stays in the header (`chip-fit`); while a crew filter is on, the header may wrap to two rows and the lanes move down until the filter is cleared.
10. Very narrow windows (`very-narrow`): the tab-and-picker group stays on one line whenever it fits; only when it is wider than the window does it break inside itself, with the four tabs always kept together as one control and the picker and chip moving under them.

## Behaviour

- `command-center/ui/index.html`: the `.toolbar` block moves from `section.board-wrap` into `header.bar`, directly after `.brand`. It keeps its children, ids, classes, roles, aria labels and titles: `.views` (`role="tablist" aria-label="Layout"`, four `role="tab"` buttons with `data-view`), `#repo-filter` (`aria-label="Repository"`), `#filter`. `.board-wrap` then holds `#decisions`, `#board` and `#empty`.
- `command-center/ui/index.html` also wraps `.stats`, `#notify` and `#clock` in one right-hand group (refinement A), which takes `margin-left: auto`; their own ids and classes are unchanged.
- `command-center/ui/app.css`: `.bar` wraps (`flex-wrap: wrap`, gap `10px 16px`). The `.toolbar` in the header is `flex: 0 1 auto; min-width: 0; flex-wrap: wrap; gap: 8px`, so it moves to its own row as a whole and breaks inside itself only when wider than the window; `.views` stays one inline-flex control. The right-hand group is a flex row with gap 16px and `margin-left: auto`; `.stats` gap 14px and no own `margin-left`. `.repo-filter` gets `max-width: 170px`. The 1100px rule (clock hidden, stats tightened) stays. On one row the header is 60px tall at 1440px, against 55px today (measured).
- `command-center/ui/app.js`: no change. `renderToolbar()` and the listeners find `.views button`, `#repo-filter` and `#filter` by id and class.
- `command-center/ui/markdown.js`: not touched (MD-1 changes it in parallel).
- Keyboard: unchanged. Tab reaches each tab button and the picker in document order (now right after the brand, before the stats); Enter or Space presses a tab. No arrow keys, `aria-controls` or `tabpanel` are added.

## Acceptance criteria (observable)

1. In `index.html`, the `role="tablist" aria-label="Layout"` element with its four `role="tab"` buttons (`data-view` lanes, agents, track, archive), `#repo-filter` and `#filter` are inside `header.bar`, after `.brand` and before `.stats`.
2. `section.board-wrap` contains no `.toolbar`, no `.views`, no `#repo-filter` and no `#filter`; it still contains `#decisions` before `#board`.
3. `app.css` lets `.bar` wrap; the header `.toolbar` keeps `.views` as one control and may break only inside itself; the stats, Notify and clock sit in one group with `margin-left: auto`; `.repo-filter` has `max-width: 170px`; header and stats gaps are 16px and 14px.
4. Every id, class, role, aria label and title on the moved elements is unchanged, and `app.js` and `markdown.js` are unchanged.
5. Clicking a tab still switches the view; choosing a repository still filters; a crew filter still shows the chip with "Show everyone". (Existing `archive.test.mjs` and `card.test.mjs` keep passing; screenshots show it.)
6. At 1440px with two repositories, no crew filter and the Notify button hidden, the header is one row: brand, tabs, picker, stats, clock; the main pane starts with the board (or the decisions banner when something waits).
7. At about 1100px with a crew filter on, and at about 640px, the header wraps without overlap; every tab, the picker, the chip, the stats and Notify are fully visible, the four tabs stay together, and the stats, Notify and clock stay on one row together.

## Test level

Text tests in a new `command-center/header.test.mjs` (or added to `card.test.mjs`) that read `index.html` and `app.css`, covering criteria 1-4. Visual layout (6, 7) rests on the before-and-after screenshots.

## Out of scope

- Moving the decisions banner or changing inbox focus mode.
- Arrow-key tab navigation or other new keyboard behaviour.
- Any change to `markdown.js`, the crew strip, the feed or the legacy Mission Console.
- An ADR (a layout move records no decision the code cannot show).

## Run decisions

- Before-and-after: screenshots. Environment: a throwaway Command Center from a worktree (`node command-center/serve.mjs`, `AI_SDLC_CONSOLE_DB` and `AI_SDLC_HOME` pointing at temporary paths) on a spare port, never 4174, viewed in headless Edge over the DevTools protocol from a scratch script outside the repository. Seeded with open stories in two repositories so the picker shows, and one waiting on the owner so the decisions banner shows. Shots: full window at 1440px and at about 1100px, plus one with a crew filter on (at 1440px), and one at about 640px. Before reference: `origin/main` at 88b9cce, captured right after approval from a detached scratch worktree, before any implementation.
- Architecture diagram: none.
- Profile settings used as saved: gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; required pipeline "Tests" (also runs `node e2e/run.mjs`); spec at `docs/specs/story/`.

## Plan critique

Two reviewers from different providers (OpenAI Codex gpt-6-sol, Anthropic Claude Opus) read the same neutral packet. Findings, checked against a prototype measured in headless Edge:

- Header does not fit one row at 1440px with two repositories (Claude; confirmed: about 1490px needed). Put to the owner as `header-fit`.
- The filter chip (about 290px) wraps the header on most screens (Claude; confirmed). Put to the owner as `chip-fit`.
- Below the group's width the no-wrap group is clipped, since `body` has `overflow: hidden` (both). Put to the owner as `very-narrow`.
- With `margin-left: auto` on `.stats` alone, the stats, Notify and clock can split across rows (Codex; confirmed at 1440px, where only the clock wrapped). Refinement A below.
- Criterion 7's "no horizontal scroll" cannot fail under `overflow: hidden` (Claude). Reworded to "fully visible".
- "Header control heights match the brand row" had no check (Claude). Replaced by a measured height bound.

## Refinements found while planning

A. The stats, Notify me and the clock sit in one right-hand wrapper that carries `margin-left: auto`, so they wrap together as decision 4 says. Their own ids and classes are unchanged.

## Facts measured while planning

- Prototype in headless Edge (scratch files outside the repository), two repositories, picker showing: today's header is 55px at 1440px. With the final CSS, one 60px row fits from about 1390px of width; the chip (about 290px) wraps it at any common width; at 640px the group breaks inside itself with the tabs whole.
- `#notify` shows only while the browser's notification permission is undecided (`app.js` 831). While it shows, it adds about 68px, so the one-row width becomes about 1460px.

## Context pack

From the scout (`context-pack.md`, registered on the story):

- `index.html`: `header.bar` holds `.brand`, `.stats` (`margin-left: auto`), `#notify`, `#clock`. `section.crew` sits between the header and `main.layout`. `.board-wrap` holds `#decisions`, `.toolbar`, `#board`, `#empty`.
- `app.css`: `body` grid rows `auto auto 1fr`; `.bar` flex, gap 24px, no wrap; `.toolbar`, `.views`, `.repo-filter`, `.filter` styles; `@media (max-width: 1100px)` hides the clock and tightens stats.
- `app.js`: `renderToolbar()` (296) and listeners (827-830) use ids and classes only; `#repo-filter` hides with fewer than two repositories; `#filter` hides unless a crew member is selected.
- Tests reading the UI as text: `archive.test.mjs`, `card.test.mjs`, `badge.test.mjs`. No e2e scenario references the toolbar.
- Rules: AGENTS.md (no source comments, comment ratchet; no package dependencies; no names, profiles or databases; `node --test` before committing). Team rule: reply to every PR comment before resolving it.
- Commands: focused `node --test command-center/archive.test.mjs command-center/card.test.mjs`; full `node --test`; e2e `node e2e/run.mjs`.
- Similar changes: ARC-1 (#44) added the Archive tab; CARD-1 (#38) pinned markup in `card.test.mjs`.
- Risks: header crowding at 1100-1300px; header width changes when the picker or chip appears; chip text grows with names.
