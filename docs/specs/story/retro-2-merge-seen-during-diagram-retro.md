# RETRO-2 plan: a pull request merged during diagram or retro work goes unseen (issue #63)

Context pack: `C:\Users\trojanmini\.ai-sdlc\stories\RETRO-2\context-pack.md`. Reproduced on fa90a29 (script and output beside it).

## Problem

1. In `diagram` entered from `ci`, `watchTargets` is empty and both `merged` and `pr-observed` are refused 409.
2. In `retro`, `watchTargets` is empty and `pr-observed` is refused, so nothing prompts Jarvis to record `merged`.
3. `merged` in `ci` closes the story and `retro-start` is then refused, so the retro never runs.

Root cause: `watchTargets` (`mission-console/store.mjs:519`) and `observePr` (104) cover only `ci`, `merge` and `pr-review`; `merged` (421) always closes; `retro-start` (333) needs `ci` or `merge`; a closed story refuses questions and wakes no Jarvis. The same unwatched gap exists in building, gates, mutation, review, comparison and publishing when a story re-enters them with `story.pr` set after `return-to-build`.

## Settled decisions (owner's answers)

1. One merge rule, shared with RETRO-1: a merge never closes a story whose retro has not finished. It holds the story in retro until the retro's lessons handoff, which closes it.
2. Watch every open phase that has a registered PR.
3. Outside ci, merge and pr-review, an observation wakes Jarvis only for a merged or closed PR; review comments seen there stay unmarked and wake Jarvis once the story is back in ci.
4. A merge while a worker is mid-phase (diagram, building and the other non-retro phases): Jarvis stops and releases the worker, records `merged`, the story goes to the retro, and Jarvis reports the unfinished work to the owner. In retro the retro worker is not released: `merged` is accepted with it assigned.
5. A merged story whose retro is running stays in the Ship lane, labelled "Merged · finishing retro", and goes to the Archive only when the retro closes it.
6. No before-and-after. 7. No architecture diagram.

## Reconciliation with RETRO-1 (#78)

- Same rule, split by when the merge lands: RETRO-1 builds `merged` while already in retro; RETRO-2 builds `merged` before the retro starts, the watcher and the skills. Both end the same way: the retro handoff closes the story.
- Shared representation (RETRO-1 landed first, so this story follows it): `story.retro.mergedAt`. `merged` in retro sets it; `merged` from another open phase starts the retro with it; the retro handoff closes a story whose retro has `mergedAt`. One label: "Merged · finishing retro". `merged` from ci, merge and pr-review closes the story as RETRO-1 left it.
- RETRO-2 implements `merged` in retro only if RETRO-1 has not landed by the time RETRO-2 builds, identically.

## Changes

1. `mission-console/store.mjs`
   - `watchTargets`: every story with `story.pr`, no cleanup, and a phase other than `closed`.
   - `observePr`: accept any phase except `closed` when the URL is the registered PR. In phases other than ci, merge and pr-review, store and wake only for a `merged` or `closed` status; otherwise record nothing, so neither `prObservation` nor `prSeen` changes.
   - `merged`: accepted in every open phase that has a registered PR (refused in `closed` and when `story.pr` is unset). If `story.retro.completedAt` is set, close as today. From ci, merge and pr-review, close. From any other open phase, move to retro with `story.retro = { startedAt, detail, mergedAt, mergeDetail }`; in retro, RETRO-1 sets `mergedAt` and keeps the phase. Clear blocked as today. Outside retro the worker-assigned refusal still applies; in retro `merged` is accepted with the retro worker assigned.
   - `handoff` in retro: accept `returnPhase 'closed'` and move to `closed` with the lessons recorded.
   - `retro-start` unchanged. No change to `pr-ready` (CHK-1).
2. `mission-console/watcher.mjs`, `command-center/coordinator.mjs`: no logic change expected; confirm in tests.
3. Dashboard (`mission-console/console.mjs`, `command-center/ui/app.js`): a story in retro with `retro.returnPhase 'closed'` reads "Merged · finishing retro", Ship lane; closed stays "Merged".
4. `mission-console/lifecycle-model.mjs` and `.test.mjs`: the property "From ci, merge, retro or pr-review with a registered PR, merged closes the story" becomes "merged from an open phase with a registered PR closes the story when its retro has finished, and otherwise moves it to retro with return phase closed, whose handoff closes it". Add the new `merged` sources, `merged` in retro with a worker assigned, and the retro handoff with return phase closed. No property is weakened; the change and reason go in the PR description, and the verify-story-lifecycle coverage commit moves.
5. Skills and docs: `skills/ai-sdlc/SKILL.md` phase 9, `skills/jarvis/SKILL.md` rows 7, 8, 9 and section 6, RUNBOOK, `mission-console/README.md` event reference.

## Acceptance criteria

- A merge observed in diagram, retro, or any other open phase with a registered PR is recorded as `pr-observed` and wakes Jarvis.
- `merged` is accepted in those phases. Unless the retro has finished, the story moves to (or stays in) retro with return phase closed.
- A story merged before or during its retro accepts retro questions, answers and the lessons handoff; the handoff closes it.
- `merged` after a finished retro closes the story directly, as today.
- Review feedback or a passed or failed check observed outside ci, merge and pr-review does not wake Jarvis, leaves `prObservation` and `prSeen` unchanged, and still wakes Jarvis when the story is back in ci.
- `merged` in retro is accepted with the retro worker assigned; the worker keeps its assignment.
- The board shows "Merged · finishing retro" in the Ship lane until the retro closes the story.
- `node --test` passes, including the lifecycle model; `node e2e/run.mjs` passes; gitleaks is clean.

## Tests (written first by a separate test author)

- `store.test.mjs`: merged in diagram (from ci), in ci, in building after return-to-build; retro handoff with return phase closed; merged after a finished retro; merged with no PR refused; the retro-start test updated; `watchTargets`; `observePr` outside ci; merged in retro keeps the worker.
- Lifecycle model: updated property and transitions.
- e2e scenario: a PR merges while Rocket is on a diagram started from ci; the watcher sees it, Jarvis is woken, releases the worker, records `merged`, the retro runs and its handoff closes the story. It fails on main.

Out of scope: CHK-1's `pr-ready`; a PR closed without merging; reopening a merged story; pr-review questions stranded by a merge (RETRO-1's follow-up).

Run decisions (profile): gates `node --test` and gitleaks; implementation level full; review round limit 3; cross-model review authorized. Merge main before publishing.
