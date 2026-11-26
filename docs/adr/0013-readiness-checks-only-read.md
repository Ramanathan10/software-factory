# 0013. Readiness checks only read the tracker, and decide from a snapshot

Status: Accepted
Date: 2026-11-23

## Context
Before a story is handed back, the factory checks its work item in the owner's tracker (Azure DevOps, GitHub issues, Linear): tasks closed, pull requests merged and linked, effort set. A check must never change a story, and trackers differ in how they can be read.

## Decision
- `engine.mjs` is a pure rule engine: `(snapshot, settings) -> { checklist, questions }`. It imports nothing, so it can neither read nor write; a test fails if it does. `settings` is the repository's `readiness` section of the profile, with defaults filled in by `withDefaults`. `appliesAt` says whether a story that has just entered a console phase should be checked.
- A snapshot is the same shape for every tracker: `user` (who is signed in), `story` `{ id, assignee, effort }`, `tasks` `[{ id, title, state, assignee, assigneeName }]` (the story's child items), `prs` `[{ id, status: 'active' | 'completed' | 'abandoned', target, linked }]`, `testsPass` (true when the caller has test evidence; left out otherwise), and `noPrConfirmed` and `handoffConfirmed` (true once the owner has said so).
- While a pull request is still open the checklist alone reports the gaps. Once every one is merged, the owner is asked for what only they can give: the effort, or the handoff.
- `trackers.mjs` is the one table of trackers, keyed by the profile's `readiness.tracker`. `reads: 'command-line'` means `command` can read a story, and `read(id, settings, run)` returns the snapshot, with `run` passed in so tests can stand in for the program. `reads: 'in-app'` means only the agent's own tools can read it: the agent builds the snapshot from what `supply` describes and passes it to `check-story.mjs --snapshot` on stdin.
- Each reader's `run` is wrapped in `readOnly`, which refuses any command that is not a read.
- Azure DevOps people are compared by `uniqueName`, which is stable, with the display name as a fallback. On GitHub the story is an issue in `settings.repository`, its tasks are its sub-issues and its pull requests are the ones that close it; GitHub issues carry no effort, so `effortSet` never passes there. A story assigned to the signed-in person counts even when others are assigned too.
- `check-story.mjs` resolves to what was found, or to what the caller must do next; a story id may carry a prefix such as `ABC-123`.

## Consequences
- On Windows `az` is a script and is run through a shell; 0023 says how that is made safe. A profile that cannot be parsed is treated as no tracker; issue #14 tracks that.

## Where
- `readiness-sync/engine.mjs`, `readiness-sync/trackers.mjs`, `readiness-sync/check-story.mjs`
