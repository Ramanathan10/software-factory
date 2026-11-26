# OWN-1: Show Jarvis as the holder of a story while Jarvis is checking it or it waits on Jarvis

Branch `story/own-1-jarvis-holds-story`, cut from origin/main 88b9cce. To be committed as `docs/specs/story/own-1-jarvis-holds-story.md` after approval.

## Context

Context pack: C:/Users/trojanmini/.ai-sdlc/stories/OWN-1/context-pack.md. Every view that answers "who holds this story" (card glyph, crew strip and its filter, lane heat, Agents swimlanes, track view, Agents-working stat, story window Owner row) reads `ownerOf` and `isBusy` in `command-center/ui/app.js`. The frame already carries `story.jarvis` (`turn`, `waking`) and `waitingOnJarvis`. Jarvis is the `coordinator` role. No store, daemon or phase-table change.

## Problem

While the background Jarvis runs a turn on a story, or the story waits on Jarvis, the card shows the "··" placeholder, the crew strip lists the story under the phase role, and Jarvis' tile says "standing by". The words "Jarvis is checking <id>" also repeat the id the card already shows and get cut off at card width.

## Settled decisions

| Question | Answer |
|---|---|
| jarvis-status-words-question | Do this now: the words become "Jarvis is checking", without the story id |
| waiting-moves | Waiting on Jarvis moves the story to Jarvis, badge still; it overrides the 10-minute recent-activity rule |
| idle-worker | No: any assigned worker keeps the story, as brief item 4 says |
| keep-words | A card Jarvis holds keeps its Jarvis words even when busy |
| waking | `jarvis.waking` counts as checking: badge moving, "Jarvis is checking" |
| test-level | Unit test on a helper in `ui/jarvis.js` plus board tests in `card.test.mjs` |
| before-after | Screenshots, as below |
| diagram | No diagram |

## Rule

Jarvis holds a story when all of these hold: no worker is assigned, the story is not blocked or closed, nothing waits on the owner (no open question, not in `approval` or `comparison-choice`), and either Jarvis is checking it (`jarvis.turn` or `jarvis.waking`) or it waits on Jarvis (`waitingOnJarvis`). Checking wins when both are set.

Consequence of idle-worker = No: when Jarvis is woken after an assigned worker's turn ends and that worker stays assigned, the card keeps the worker's attribution and today's "··" beside "Jarvis is checking". Only stories with no assigned worker move to Jarvis.

## Changes

1. `ui/jarvis.js`: new pure `jarvisHold(story)` returning `'checking'` (turn or waking), `'waiting'` (`waitingOnJarvis`), or `undefined`. `jarvisStatus` returns "Jarvis is checking" (no id) for turn or waking; the waiting words are unchanged.
2. `ui/app.js`: a held-by-Jarvis check applies the precedence above on top of `jarvisHold`. `ownerOf` returns `coordinator` when Jarvis holds the story. `isBusy` returns true for checking and false for waiting.
3. `storyCard`: a card Jarvis holds draws Jarvis' badge (moving when checking, still when waiting) instead of "··", and keeps its Jarvis words while busy. Other busy cards are unchanged.
4. Crew strip, filter, swimlanes, track view, lane heat, Agents-working stat and Owner row follow through `ownerOf` and `isBusy` with no code of their own.
5. Out of scope: `ui/markdown.js` (MD-1), the toolbar and repository picker (HDR-1), the store, daemon, coordinator and phase table, the approver's busy rule. Merge main before publishing.

## Acceptance criteria

1. A story with no worker and a running Jarvis turn (or `jarvis.waking`): the card shows Jarvis' badge, moving, and the words "Jarvis is checking"; Jarvis' crew tile lists it and shows busy; the phase role's tile does not list it; the Jarvis filter shows it; the Agents swimlane places it under Jarvis; the Agents-working stat counts Jarvis; the story window Owner row says Jarvis.
2. A story with no worker and `waitingOnJarvis`: Jarvis' badge, still, with "Waiting on Jarvis · <age> · <why>"; Jarvis' tile lists it as queued; the card does not move even with activity in the last 10 minutes.
3. A story with an assigned worker, an open owner question, a blocker, or in `approval` or `comparison-choice` keeps today's owner, glyph and busy state while Jarvis checks it or it waits on Jarvis.
4. Once the turn ends and `waitingOnJarvis` clears, the story returns to its phase role.
5. The track view and story window Jarvis row also read "Jarvis is checking" without the id.
6. `node --test` and gitleaks pass.

## Tests

- Unit: `command-center/jarvis-status.test.mjs` for `jarvisHold` and the new words.
- Board: `command-center/card.test.mjs` for criteria 1 to 4 (card glyph and motion, crew tiles, filter, swimlane, stat, Owner row).
- No e2e scenario: delivery and worker starts do not change.

## Run decisions

- Before and after: screenshots. A throwaway Command Center on its own port and database, seeded with three stories: Jarvis checking, waiting on Jarvis, and a running worker turn as control. Four views via headless Edge: lanes board, crew strip, Agents swimlane, story window Owner row. Before reference: origin/main 88b9cce, captured right after approval. Cropped so HDR-1's header move does not show.
- Architecture diagram: none.
- From the profile: gates `node --test` and gitleaks; pipeline Tests; implementation level full; review round limit 3; cross-model review authorized.
- ADR: none expected.
