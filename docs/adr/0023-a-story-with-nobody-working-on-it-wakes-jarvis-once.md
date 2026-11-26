# 0023. A story with nobody working on it wakes Jarvis once per idle spell

Status: Accepted
Date: 2026-11-26
Amends: [0012](0012-jarvis-is-woken-only-for-news.md), [0019](0019-a-background-jarvis-session-is-woken-for-news.md)

## Context
DIAG-1 sat in planning for over an hour with no worker and nothing pending. Jarvis was woken only for news, twice acked it without staffing the story, and then nothing was left to wake anyone. The card showed nothing.

## Decision
- A command-line story that is stuck wakes Jarvis once per idle spell, with a kickoff that says nobody is working on it. Stuck means: a worker phase other than `ci`; no worker; not blocked; no cleanup; no Jarvis turn or worker start running; every question answered; no unhandled news; no pending plan approval (the daemon starts the test author for it); quiet for the quiet period. `ci` is a normal unstaffed wait, and the other phases have their own wake or no worker.
- The idle spell starts at the story's latest event that is not Jarvis's own and not an answer to an `action-jarvis-` question. The wake is marked in the `jarvis-turn-ended` detail of its turn, which starts with "No-news turn". The mark is a stored event, so a restart neither repeats nor loses it. It is not kept in `jarvis.handled`: with no news there is no seq to put there, and the story's latest seq can be the spell's first event, which gave two wakes in one spell.
- If the story is still stuck after a no-news turn, the coordinator posts an `action-jarvis-<seq>` question. "Done" gives one more turn and the question returns if the story is still stuck; "Hold" stops every wake and question until a new event starts a new spell.
- The daemon does not wait for a released worker's process to exit. The supervisor keeps that private, and a hung process would block the wake forever, which is the silent idle this decision removes. A process that is still writing keeps resetting the quiet period.
- `deliver` answers `nobody` with a reason when the story has no worker. `onDecision` still answers `coordinator` to the dashboard's batch path, so the delivery model does not change.

## Consequences
- A story left unstaffed costs at most one extra Jarvis turn per spell, then waits for the owner.
- A daemon restart during a no-news turn ends it with the generic detail, so one more no-news wake can follow. It is bounded, and never a loop.
- Stories already stuck when this ships each get their one wake on the first start.

## Where
- `command-center/coordinator.mjs`: `unstaffed`, `stuck`, `wake`, `end`
- `command-center/console-service.mjs`: `deliverPending`
- `skills/jarvis/BACKGROUND.md`, `skills/jarvis/RUNBOOK.md`
