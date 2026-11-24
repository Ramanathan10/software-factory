# CARD-1: Animate the agent glyph on story cards and simplify the card

Branch `story/card-1-animate-card-glyph`, base `origin/main` 30b49b7. Feature lane. Context pack: `context-pack.md` (registered). Revised after plan feedback (event 493) and the answers to `glyph-corner` and `status-words`.

## Problem
On a busy story card the owner glyph stays still, though the same glyph animates in the crew strip: `storyCard` builds the avatar without `moving` (`command-center/ui/app.js:265`), and every glyph keyframe runs only under `.avatar.moving` (`app.css:114-123`). Cards also carry a repository line (`app.js:263`), a phase pill in the header (`app.js:261`), and an owner row with a small glyph, the agent's name and a pulse dot, which make each card taller than the board needs.

## The card after this change
1. Header: story ID on the left; the agent glyph on the right, in place of the phase pill. Its tooltip and screen-reader label give the agent and the phase, for example "Bruce Banner · Writing tests".
2. The story title in bold.
3. The last-event line, only when the story waits on you or is blocked. Its text is unchanged; it moves from below the old owner row to above the bottom row, so the bottom row is the last text line.
4. Bottom row: status words on the left only when the story is not busy ("Waiting on you", "Blocked", "Idle · no tester session active", "Done"); on the right the PR link and the time since the last update ("8s ago"), with Plan and Run links replacing the time on hover (unchanged behaviour); a card with neither link keeps its time on hover, so a busy card's bottom row never empties. A busy card shows no status words: the moving glyph says the agent is working.
5. The progress meter as the last line (unchanged).

## Acceptance criteria
1. When a story is busy, the glyph in the card's top right animates the same way that agent's glyph animates in the crew strip.
2. The glyph stays still when the story is idle, waiting on you, blocked, or closed.
3. The glyph stops when the viewer has turned on reduced motion.
4. Cards no longer show the repository line, whatever the number of repositories. The toolbar's repository filter and the Repository row in the story detail stay.
5. The card header shows the story ID on the left and the glyph on the right; the phase pill is gone from the card. The glyph's tooltip and accessible label name the agent and the phase.
6. Cards no longer show the agent's name or a second glyph. The time since the last update sits at the bottom right.
7. The bottom row shows the status words on the left when the story is waiting on you, blocked, idle or done, and none while it is busy.
8. The card markup and CSS have nothing left over from the repository line, the phase pill, the owner row's glyph and name, or the busy pulse dot.

## Change
- `storyCard` (`app.js`): move the avatar into the header in place of `span.phase`, built with `moving: busy`, `small: true`, and a `title`/`aria-label` of agent and phase label. The glyph follows today's owner-avatar rules: the role's glyph when someone works the story, your "You" glyph with the amber ring when it waits on you, the dashed `··` placeholder when idle. `isBusy` is already false for idle, waiting, blocked and closed, so AC2 needs no new logic.
- Delete the `p.repo` element. Turn the owner row into the bottom row: the existing `who` span with the status words (omitted while busy), then the existing `aside` (links, PR, time). Remove the agent name and the `pulse` dot.
- `app.css`: delete `.card .repo`, `.card header .phase` and `.pulse` (used only by the card); move the card's busy and waiting ring selectors from `.card .owner .avatar` to the header glyph. The existing global `prefers-reduced-motion` rule covers AC3.
- Keep `repos()`, the toolbar's repository filter and the detail's Repository row. The track (list) view is unchanged; the Agents view reuses the same card.

## Tests (settled: source-reading node tests)
Written first by a separate test author, in `command-center/`, in the style of `badge.test.mjs`, run by `node --test`:
- the card's header glyph is built with `moving` tied to the card's busy state, and with a title naming agent and phase (AC1, AC2, AC5);
- `storyCard` builds no `repo` element, no `phase` pill and no `pulse` dot, and shows no agent name (AC4, AC6, AC8);
- the status words are omitted while busy (AC7);
- `app.css` has no `.card .repo`, `.card header .phase` or `.pulse` rule, and the toolbar's `repo-filter` and the detail's Repository row remain (AC4, AC8);
- the reduced-motion block still sets `animation: none` for every element (AC3; a regression guard that passes today).

## Before and after (settled: recordings, stills and a per-state table)
- Environment: a throwaway Command Center from a worktree on a spare port (not 4174) with its own temporary database, viewed in headless Edge driven over the DevTools protocol from a scratch script (no repository dependency). Seeded with stories in two repositories: busy (worker turn running), idle, waiting on you, blocked, closed.
- Before reference: `origin/main` 30b49b7, captured right after approval from a detached scratch worktree, before any implementation.
- Evidence: (1) a short recording of a busy card beside the crew strip, before and after; (2) stills of the board in Pipeline view showing every card state, before and after; (3) a table of the computed `animation-name` on each card glyph's animated part per state, with reduced motion off and emulated on.
- Attached to the pull request, not committed.

## Architecture diagram (settled: yes)
A small diagram of how a story's busy state reaches the card glyph: story store, Command Center snapshot stream, `isBusy` in `app.js`, `storyCard` passing `moving`, the `.avatar.moving` keyframes in `app.css`, and the reduced-motion rule that stops them; the crew strip shown as the path that already did this. Drawn with `diagram-design`, rendered as an image for the PR description.

## Overlap with parallel stories
WAKE-1's approved plan puts "Waiting on Jarvis · 4m · <why>" and "Jarvis is checking" in the card's status words. This plan keeps that slot (the `who` span, now in the bottom row), so WAKE-1 lands its wording there. Whichever merges second rebases and resolves a textual conflict in `storyCard` and `app.css`. MODELS-1 touches `modelOf`; no overlap.

## Gates
`node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation and other gates are not required by the profile.

## Review
Cross-model sharing is authorized. Codex refused the profile's deep model and is at its usage limit until 2:12 AM on 24 Nov; if it is still unavailable at review, the panel uses two distinct Claude model classes (Opus and Sonnet). The plan critique did not run for the same reason.

## Out of scope
The track view, the toolbar filter, the story detail, the crew strip, WAKE-1's wording, any change to glyph keyframes or badge designs.

## Context pack

Worktree `C:/repos/software-factory-worktrees/story/card-1-animate-card-glyph`, branch `story/card-1-animate-card-glyph`, base `origin/main` 30b49b7.

### Relevant code (line numbers checked on 30b49b7; they match the brief)

- `command-center/ui/app.js:121-125` `avatar(role, { small, moving })` adds class `moving` when asked.
- `app.js:151-155` `isBusy(story)`: false when closed, blocked or waiting on the owner; true while a worker turn runs, or for a short window after activity with no worker.
- `app.js:217-242` `renderCrew` passes `moving: state === 'busy'`.
- `app.js:244-276` `storyCard`: line 263 is the repo line (`story.repo && repos().length > 1 && el('p', { class: 'repo' }, ...)`); line 265 builds the owner avatar with `{ small: true }` only. Idle cards show a `··` placeholder, not the glyph.
- `app.js:310-319` `renderAgents` (Agents view) uses `storyCard` too, and animates its swim-lane head with `moving: busy && role !== 'approver'`.
- `app.js:321-352` `renderTrack` (list view) has no avatar and no repo line: out of scope.
- `app.js:169` `repos()` stays: the toolbar's repository filter uses it (`renderToolbar`, `render`).
- `app.js:647` the story detail's Repository row stays.
- `app.js:679-689` `render` rebuilds the board only when stories or busy state change, so a running glyph animation is not restarted on every poll (same guard as the crew strip).
- `command-center/ui/app.css:114-132` glyph keyframes, all under `.avatar.moving .k-*`.
- `app.css:203` `.card .repo` rule: the only CSS for the repo line.
- `app.css:387-390` `@media (prefers-reduced-motion: reduce)` sets `animation: none !important` on every element, which already stops the glyph.
- `command-center/ui/badge.js` + `mission-console/roles.mjs`: each role's badge names its motion (`k-reactor`, `k-swing`, ...).

### Rules that apply

- `AGENTS.md` "Changing the factory": no comments in source (comment ratchet), no package dependencies, no owner or repository names in tracked files (`private-details.test.mjs`), run `node --test` before committing.
- UI tests in this repository are node tests that read source files (`command-center/badge.test.mjs` checks `app.css` has a `.avatar.moving .k-<motion>` rule per badge; `ui-lint.test.mjs`, `no-html.test.mjs`). Pure UI helpers live in small modules tested in node (`ui/attention.js`). There is no DOM or browser test harness.
- Team rule: reply to every pull request comment before resolving it.

### Commands

- Focused: `node --test command-center/`
- Full gate: `node --test`; secrets gate: `gitleaks git --no-banner --log-opts=origin/main..HEAD`
- Throwaway Command Center: `node command-center/serve.mjs` from the worktree with `AI_SDLC_CONSOLE_DB` pointing at a temp database, on a port other than 4174.

### Parallel work

- WAKE-1 (building) will change the card's status text (the `who` span, `app.js:266`) and the track status, through a new `ui/jarvis.js`. Its branch has no UI commit yet. CARD-1 edits lines 263 and 265: adjacent, so whichever merges second resolves a small textual conflict.
- MODELS-1 touches `modelOf` (`app.js:~640`): no overlap.

### Risks

- A static source test is coupled to the code's spelling; a browser test is new infrastructure.
- Small glyphs (24 px) with the same keyframes: `reactor-glow` drop shadow and `rise` translate are sized for the 24-unit view box, so they scale with the avatar.
