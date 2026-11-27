# DLV-3: Deliver a waiting decision after the Command Center restarts

Work item: GitHub issue #48 (P0). Branch `story/dlv-3-deliver-after-restart`, worktree `C:/repos/software-factory-worktrees/story/dlv-3-deliver-after-restart`, base origin/main `fa90a29`. The spec is committed after approval as `docs/specs/story/dlv-3-deliver-after-restart.md`, the branch's first commit.

## Context

The scout's context pack (registered on the story) is part of this spec: files, entry points, conventions and commands. In short:

- `command-center/serve.mjs`: `start()` start-up loop, `onDecision`, `deliver`.
- `command-center/console-service.mjs`: `notify`, `sent`, `hand`, `deliverPending`.
- `command-center/supervisor.mjs`: `running`, `idle`, `sweep`, `turnVerdict`. `running()` reads the assigned worker's turn from the store, so `idle()` waits on a turn the old daemon left running from the first call.
- `command-center/coordinator.mjs`: `needs`, `notices`, `waiting`.
- `adapters/harnesses.mjs`: `messageWorker` (`turns`, `options.after`, `options.current`).
- `command-center/delivery-model.mjs`, its test, and `.claude/skills/verify-decision-delivery/SKILL.md`.
- `e2e/rig.mjs`, `e2e/daemon.mjs`, `e2e/scenarios/`, `e2e/README.md`.

## Problem

When the Command Center restarts, a decision the owner made for a story whose worker is assigned is never delivered. It stays pending, the worker is never resumed, Jarvis is never woken, and the card does not show "waiting on Jarvis". Nobody is responsible for it.

Reproduced on fa90a29, after DLV-2 (`repro-restart.mjs`, `repro-fa90a29.txt` in the story folder): two throwaway daemons on one temporary database. The worker has a live turn and asks a question, and the owner answers. The first daemon stops, either 2.5 s after the answer (the answer is queued behind the running turn) or 0.2 s after it (inside the 1.5 s batch window). The second daemon starts on the same database. When the turn ends, the answer is still pending, nobody messages the worker, and Jarvis is never launched.

Root cause:

1. Start-up calls `deliverPending` only for testing stories with no worker.
2. `batches`, `sent` and the `messageWorker` wait on `supervisor.idle` exist only in memory and die with the daemon.
3. The coordinator's `needs()` hides decisions on a story with an assigned worker. The adopted turn ends with outcome `ended` and `wake: false`, because the worker recorded its question during it.

The delivery model passes with this bug because its `JarvisDeliver` step is limited only by a call budget. The model lets Jarvis deliver after a restart where the real coordinator would never wake.

## Settled decisions

The owner answered all six in the console (events 3808 to 3813, and 3868 for the reopened Q2).

1. Fix site: at start-up, deliver every pending human decision on every command-line story with an assigned worker, blocked and cleanup stories included, through the live `hand` path. Jarvis is not woken for this.
2. Blocked and cleanup stories: start-up delivers to them as well, exactly as the live path does (event 3868, after Q2 was reopened in event 3816). The first answer to skip them rested on a wrong premise: the live path never checks blocked or cleanup, resuming a staffed story wakes no background Jarvis, and cleanup has no resume.
3. Delivery checks again, after the wait for the earlier turn and right before it resumes the worker, that the decisions it carries are still pending. When every one was acknowledged during the wait, it does not resume the worker, releases them from `sent`, and tells nobody, Jarvis included. This applies on the live path too, for example a dashboard batch queued behind a running turn. When at least one is still pending, it resumes the worker as today.
4. All three restart cases are acceptance criteria and are proved in e2e: the answer queued behind a running turn, the answer inside the batch window while a turn runs, and the answer inside the batch window while the worker is idle.
5. Before-and-after: none. The test output is the evidence in the pull request.
6. Architecture diagram: none.

## Acceptance criteria

1. Queued behind a running turn: a worker is assigned with a running turn, the owner answers, and the daemon restarts after the batch fired but before the turn ended. When the adopted turn ends, the new daemon resumes the same worker session once with the answer. The worker acknowledges it.
2. Batch window, turn running: as in 1, but the daemon restarts within the 1.5 s batch window. The outcome is the same.
3. Batch window, worker idle: a worker is assigned with no running turn, the owner answers, and the daemon restarts within the batch window. The new daemon resumes the worker once with the answer soon after start-up, without waiting for any turn.
4. No overlap, clean history: in 1 and 2 the resumed turn starts only after the adopted turn has ended and its `turn-ended` is recorded. Today `idle()` resolves as soon as the adopted process dies, before `sweep` records `turn-ended`. The resumed turn's `turn-started` then overwrites `story.worker.turn`, and the adopted turn never gets its `turn-ended`. The wait for an adopted turn must end only once that turn's end is recorded. The history must show turn-started, turn-ended, turn-started, and never two turn-started events in a row, whatever the sweep interval.
5. Replacement: when the assignment changes while start-up delivery waits, the decision goes to the worker assigned when the wait ends, never to the released session. The existing stale-assignment path covers this.
6. Already acknowledged: the daemon restarts while a turn that carries the answer is running, and the worker acknowledges the answer during that turn. When the turn ends, the new daemon does not resume the worker again, and the answer is not left in `sent`.
7. Live-path re-check: a dashboard batch queued behind a running turn whose decisions are all acknowledged before that turn ends does not resume the worker and does not wake Jarvis.
8. Blocked and cleanup: at start-up, a pending answer on a blocked story with an assigned worker, and a pending `request-cleanup` on a story in cleanup, are delivered to the assigned worker, as the live path delivers them. Start-up and the live path apply the same rule. No new blocked or cleanup check is added to either.
9. Only command-line harnesses: start-up delivery runs only for stories whose harness runs workers from the command line. In-app harness stories are unchanged.
10. Unchanged start-up: the existing start-up delivery of a pending approval to an unstaffed testing story behaves as before. Its tests stay green unchanged.
11. Out of scope: #53, #54 and #55 behave as they do on fa90a29. A spawn failure after a restart takes the existing undelivered path (#54 owns its improvement).

## Test levels and verification

- Tests for 4, 6 and 7 use the real `messageWorker` with a `spawnProcess` stand-in, or a stand-in that honours `after`, `current` and the new re-check, because a stand-in that only counts calls would count a resume the real code skips. Two daemons in one process share the module-level `turns` map, so at least one restart test must not depend on it (e2e covers a real process restart). In 6 and 7 the worker's turn records a non-ack event as well as the ack, so `turnVerdict` is not silent and the test checks the re-check, not the verdict. A test for 4 runs with a slow sweep (for example `turnPollMs: 60000`).
- Unit and integration (`serve.test.mjs`, `console-service.test.mjs`, `harnesses.test.mjs` as needed): restart tests for criteria 1, 2, 3, 6, 8 (a blocked story and a cleanup request), 9 and 10, run as in `repro-restart.mjs` with two daemons in one process on a temporary database and a stand-in adapter. They also cover the live-path re-check (7) and a stale assignment during the start-up wait (5).
- Delivery model (`.claude/skills/verify-decision-delivery/SKILL.md`):
  - Limit `JarvisDeliver` to what the code's coordinator does. Jarvis is woken when no worker is assigned (a `Release`), or when a turn of the assigned worker ends with a waking verdict (failed, or silent per `turnVerdict`). That gives `TurnEnd` a waking and a quiet outcome. The wake is latched: it holds across a later `Assign`, because a woken Jarvis staffs a replacement and then delivers to it, as in `worker-releases-before-asking`. A guard read at call time with `assign === null` would never fire, since `hand` returns null with no assignment. Match the guard to the code, no stricter and no looser. Check that the traces the existing past-version tests rely on (the 88b9cce `lost` case, the assignment re-check) are still reachable, and adjust their scenarios if they are not, without weakening what they show.
  - Widen `Ack`: any running turn of the assigned session may acknowledge any pending decision, as a worker reading the console can. This makes the live-path case in 7 reachable in the model.
  - Add a terminal check, for example `Unowned`: no step is left, a worker is assigned, and a decision is pending that no hand or turn carries.
  - Add a `StartupDeliver` step after `Restart` behind a new flag in `current`, pinned by the serve.test.mjs restart test.
  - Add a flag for the re-check before spawn, with an invariant that no spawn carries only acknowledged decisions, pinned by the tests for 6 and 7.
  - With either new flag off, `check` must report the corresponding violation. A test asserts both. Existing past-version tests stay meaningful. Update the skill's step table, flag table, invariant table and "What it does not cover".
- End to end (`node e2e/run.mjs`): add `rig.restart()`, which stops the daemon process and starts it again on the same port, database and environment while the scripted worker processes keep running. It resets the captured daemon output, so the "Command Center: " check waits for the new daemon. Turn exits must still reach `scripted-turns.jsonl` after the daemon that spawned the turn has gone: today `e2e/daemon.mjs` writes `exited` from its own `exit` listener, so a turn outliving the first daemon stays `spawned`, `checkTurns` times out, and `rig.close` may kill a reused pid. Move the exit note into the scripted worker itself, or have the rig check liveness. Add one or more scenarios under `e2e/scenarios/` for criteria 1 and 3 (2 where timing allows it reliably). Each fails on fa90a29 and passes with the fix; record the red run. Criterion 6 already holds on fa90a29, because nothing hands after a restart there. Its scenario or test is red against the fix without the re-check, and that red run is recorded instead. Add them to the README's scenario table. The runner's turn-order and leftover-process checks must still pass.
- Gates: `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation testing on the changed production files, as the profile says.
- AGENTS.md rules: no source comments (`comment-ratchet.mjs` must not go up; a reason the code cannot show goes in an ADR under `docs/adr/`, next free number at publish time). No new package dependencies. The story store stays harness-neutral, and harness-specific code stays under `adapters/`. No private names (`private-details.test.mjs`).
- A manual restart check, if one is run, uses a throwaway Command Center on its own port and database. Never stop or restart the Command Center on port 4174.

## Out of scope

- #54: a delivery whose spawn fails before a process exists tells nobody.
- #55: `serve.mjs start` and `deliver` give up after five minutes while the daemon still works.
- #53: a worker whose assignment is refused after launch keeps running unrecorded.
- Waking Jarvis for staffed stories after a restart, and showing "waiting on Jarvis" for them. With this fix the worker is responsible.
- Concurrent daemons on one database.

## Plan critique

Cross-model sharing is authorized, but Codex could not run (usage limit until 30 November 2026), so a single Claude reviewer critiqued the plan. Its eight findings were checked against the code. Findings 1, 5 and 6 were confirmed by reading the code. All eight are folded in above: criteria 4 and 8, the delivery-model guard and `Ack`, the e2e restart details, the red run for 6, and the test-harness notes.

## Run decisions

- Before-and-after: none.
- Architecture diagram: none.
- Implementation level, review round limit, cross-model sharing, gates, pipeline ("Tests", which also runs `node e2e/run.mjs`): as the profile gives them.

## Risks

- Many staffed stories at start-up each wait on their own `supervisor.idle`, which polls once a second. This is fine at the story counts seen.
- The e2e restart must not kill the scripted worker processes. They are spawned detached, and the rig must not count the daemon's stop as a lost turn.
- The re-check must not send `hand` into its stale loop. "All acknowledged" is its own outcome, not `STALE_ASSIGNMENT`.


---

## Context pack


Story: a decision waiting on an assigned worker is never delivered after the daemon restarts. Work item: GitHub issue #48 (P0). Base: origin/main fa90a29 (DLV-2 merged). Branch `story/dlv-3-deliver-after-restart`, worktree `C:/repos/software-factory-worktrees/story/dlv-3-deliver-after-restart`.

### Reproduction: still reproduces on fa90a29

Script: `C:\Users\trojanmini\.ai-sdlc\stories\DLV-3\repro-restart.mjs <worktree> queued|window`. Output: `repro-fa90a29.txt` in the same folder. Windows 11, Node 24.18.0, throwaway database in the temp folder, two in-process `start()` daemons on free ports, a stand-in adapter that records `messageWorker` calls, and a stand-in `launch` that records Jarvis starts. The live Command Center on 4174 was not touched.

Steps: story in planning, worker `w1` assigned, a live turn process (8 s) recorded with `turn-started`, the worker asks a question. The owner answers through `/api/decision`. Daemon 1 stops; daemon 2 starts on the same database; the turn process exits; wait 6 s.

| Variant | When daemon 1 stops | Result on daemon 2 |
|---|---|---|
| `queued` | 2.5 s after the answer: the batch fired and `messageWorker` is waiting on `supervisor.idle` for the running turn | adopted turn recorded `turn-ended` outcome `ended` (no wake); answer still pending; 0 `messageWorker` calls; 0 Jarvis launches; no `waitingOnJarvis` on the card |
| `window` | 0.2 s after the answer, inside the 1.5 s batching window | same |

Both print `REPRODUCED`. DLV-2 (ADR 0027) did not change this: it releases `sent` when a carrying turn ends, but after a restart `sent` is empty anyway; the problem is that nothing calls `hand` at all. (The `Assertion failed ... async.c` line after each run is Node on Windows exiting with handles open in the script; unrelated.)

### Root cause

Three things together leave the decision with nobody:

1. `command-center/serve.mjs` start-up (lines 222-226) calls `service.deliverPending` only for stories in `testing` with no worker. A story with an assigned worker and a pending human decision gets nothing.
2. The in-memory delivery is gone: `batches`, `sent` (`console-service.mjs` `notify`/`hand`) and the `messageWorker` call waiting on `options.after = supervisor.idle(story)` (`harnesses.mjs` `messageWorker`, `turns`) all die with the process. Stopping the daemon rejects the `idle` wait ("The Command Center stopped before the earlier turn ended."), and `deliver` logs "nobody".
3. Jarvis is not woken. `coordinator.mjs` `needs()` (about lines 62-72 of the file) drops decisions on a story with a worker (`!story.worker || !decisions.has(event.type)`) and returns nothing while `story.worker.turn` is set, or unless a `turn-ended` for this worker is pending. The supervisor's `sweep` ends the adopted turn with `turnVerdict({ code: null, recorded })`: when the worker recorded anything during the turn (here, the question), the outcome is `ended` with `wake: false`, so the `turn-ended` is not pending and `needs()` stays empty. `waiting()` therefore shows no "waiting on Jarvis".

The same fix must cover a worker that is assigned and idle (no turn) when the answer lands inside the batching window and the daemon stops (issue step 1): that story has a worker, no turn and no pending `turn-ended`, so `needs()` is empty there too. Not run separately; it follows from the same code.

Live path for comparison: the dashboard batch calls `hand` → `onDecision` → `deliver` → `messageWorker(after: supervisor.idle)`, which waits for the running turn and then resumes the session. After a restart nothing re-enters that path.

### Files and entry points

- `command-center/serve.mjs`: `start()` start-up loop (222-226), `onDecision` (181-207), `deliver` (29-53).
- `command-center/console-service.mjs`: `notify`, `sent`, `hand`, `deliverPending` (`humanDecisions` set).
- `command-center/supervisor.mjs`: `adopted`, `running`, `idle`, `sweep`, `turnVerdict` (an adopted turn's verdict gets `adopted: true` but ignores it).
- `command-center/coordinator.mjs`: `needs`, `unhandled`, `waiting`, `owe` (the owed set is in memory too).
- `adapters/harnesses.mjs`: `messageWorker` (`turns`, `options.after`, `options.current`).
- Model: `command-center/delivery-model.mjs` + `delivery-model.test.mjs`; `.claude/skills/verify-decision-delivery/SKILL.md`. Its `Restart` step clears `sent`/`batches`/`turns`, and `JarvisDeliver` (delivery-model.mjs line 57) is guarded only by its call budget `JARVIS_CALLS`, not by anything that would wake Jarvis, so the model never asks whether anything actually calls `hand` after a restart. That gap is why the model passes with this bug. The fix should add the start-up delivery as a model step (and a flag in `current` pinned by a test) or an invariant that a pending decision after a restart has a responsible actor.
- e2e: `e2e/rig.mjs` starts one `e2e/daemon.mjs` per scenario and has no restart helper; the new scenario needs one (stop the daemon process, start it again on the same port, database and env). Model: `e2e/scenarios/failed-turn-answer-redelivered.mjs`, `answer-before-release.mjs`. `e2e/README.md` "A bug becomes a scenario" and its scenario table.
- Existing restart tests: `serve.test.mjs` "an approval already pending when the daemon restarts starts its missing test worker", "restart refuses another launch when …"; `supervisor.test.mjs` adopted-turn waits.

### Conventions and rules that apply

- AGENTS.md: `node --test` before committing; no package dependencies; no source comments (`comment-ratchet.mjs`; reasons go in an ADR); keep store and Command Center harness-neutral; a delivery change is checked with `verify-decision-delivery` and tried end to end with `node e2e/run.mjs`; a live-story bug gets an e2e scenario that fails without the fix; no names or private details (`private-details.test.mjs`).
- Profile: required gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; pipeline "Tests" (also runs `node e2e/run.mjs`); spec at `docs/specs/story/dlv-3-deliver-after-restart.md` (named like the other files there), first commit after approval; implementation level full; review round limit 3; cross-model review authorized; before-and-after and diagram: recommend none (not visible as a UI change beyond the missing card state).
- ADR: only if the fix needs a reason the code cannot show; take the next free number at publish time (currently 0028 would be next).

### Commands

- Focused: `node --test command-center/serve.test.mjs command-center/console-service.test.mjs command-center/supervisor.test.mjs command-center/coordinator.test.mjs command-center/delivery-model.test.mjs`
- Full: `node --test`; e2e: `node e2e/run.mjs` (or `node e2e/run.mjs "Claude Code" <scenario>`).

### Decisions the reproduction leaves open (for the planner)

1. Where the fix lives. Recommended: widen the start-up loop so every command-line story with an assigned worker and pending human decisions gets `service.deliverPending(story.id)`; that re-enters the live path, which waits on the adopted turn through `supervisor.idle` and then resumes the same session (or hands to the replacement via `current`/`stale`). Alternative: make the coordinator surface such decisions to a background Jarvis after a restart, which costs a model turn per story and still depends on Jarvis running `deliver`.
2. Blocked or cleanup stories. The existing start-up loop skips them; the live `onDecision` path does not check `blocked`. Recommended: skip them at start-up, since `resume` already wakes Jarvis, which delivers.
3. Re-delivery of a decision the old daemon already sent whose turn is still running at restart and that the worker acknowledges during that turn. `hand` computes its seqs before waiting, so after the adopted turn ends the worker would be resumed with an already-handled decision. The model already allows a hand again after a restart; decide whether `current` should also re-check that the seqs are still pending before spawning (small, but it changes the live path too).
4. Whether a story whose decision cannot be delivered after a restart should show "waiting on Jarvis" (the issue's "never sits with no one responsible"). With fix 1 the worker is responsible; an adapter failure is #54's scope.

### Out of scope (queued in the same area)

- #54: a delivery whose spawn fails before a process exists tells nobody.
- #55: `serve.mjs start`/`deliver` give up after five minutes while the daemon still does the work.
- #53: a worker whose assignment is refused after launch keeps running unrecorded.

### Known risks

- Start-up delivery for many stories at once: each waits on its own `supervisor.idle`, which polls per second; fine at the story counts seen.
- Two daemons at once are not modelled; `serve.mjs` refuses a second one on the same port.
- The e2e restart must keep the scripted worker processes alive across the daemon stop (they are spawned `detached`), and the rig's `checkTurns` must still see a clean turn history.
