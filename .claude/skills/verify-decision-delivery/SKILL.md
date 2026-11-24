---
name: verify-decision-delivery
description: Check a change to how the owner's decisions reach a story worker, or how worker turns start, against every interleaving of the daemon's steps. Use when a change touches hand, notify or deliverPending in command-center/console-service.mjs, deliver or onDecision in command-center/serve.mjs, messageWorker, startWorker or turns in adapters/harnesses.mjs, or idle and sweep in command-center/supervisor.mjs.
---

# Verify decision delivery

`command-center/delivery-model.mjs` models one story's worker session and two of the owner's decisions. Several actors can act in any order: the dashboard's batch timer, two `serve.mjs deliver` calls from Jarvis, the worker acknowledging, its turns ending, and one daemon restart. The model's steps break exactly where the code `await`s, so every order the event loop can produce is an order the model explores. `check` walks every reachable state breadth-first, about 2,000 states in under a tenth of a second, and holds these invariants:

| Invariant | Harm when it breaks |
|---|---|
| `OneTurnPerSession`: at most one turn of the session runs | Two harness programs resume the same conversation and race on one worktree |
| `NoDuplicateDelivery`: one daemon hands each decision to the worker at most once | The worker acts on the owner's answer twice |
| No call of `hand` can be left waiting forever (reported as `stuck`) | A decision never reaches the worker and nobody is told |

A decision handed again after a restart is allowed. The new daemon cannot know what the old one sent, and the worker acknowledges each decision only after acting on it, so it is still pending.

## Run it

```
node --test command-center/delivery-model.test.mjs
node --test command-center/approval-model.test.mjs
```

`node --test` runs it with everything else, so CI runs it on every pull request.

`approval-model.mjs` additionally models an approved story with its planner released but its process still finishing, two overlapping manual/automatic start requests, launch failure and a restart before assignment. `OneWriterPerWorktree` and `OneApprovedStartup` protect the separate-session handoff. The launch leaves approval pending for the agent to handle. `RequestStart` mirrors the per-story promise and durable start intent in `serve.mjs`; `Spawn` waits on `supervisor.idle`, including released turns; `Restart` blocks an intent without a recorded assignment/outcome. Tests in `serve.test.mjs` pin coalescing, restart recovery, interrupted-start refusal and failure handling; `supervisor.test.mjs` pins waits for owned and adopted released planners. This model covers automatic approval starts, not arbitrary manual starts or concurrent daemons; the existing assigned-session model retains its bounds below.

`ReleaseTester` leaves approval pending after a successfully assigned test session; `stopsDeliveredApproval` pins the guard that forbids automatically launching that approval again. This is verified against full event history, including after the dashboard's recent-event window is exceeded. The first start after an approval, manual or automatic, uses the same fresh approved kickoff and intent, and records a blocker when its launch fails; the manual-first integration test and the failed-manual-start test pin that contract. A manual start after that approval's worker was assigned carries the coordinator's prompt alone, and a start for a story with an assigned worker is refused before the wait on `supervisor.idle`; each has its own test in `serve.test.mjs`.

## The code each step stands for

Each step in `delivery-model.mjs` stands for this code:

| Step | Code |
|---|---|
| `Record` | `console-service.mjs`: `/api/decision` calls `recordEvent`, and `notify` queues the decision in `batches` |
| `BatchFire` | `console-service.mjs`: `notify`'s timer calls `hand` with the batch |
| `JarvisDeliver` | `console-service.mjs`: `deliverPending` (`serve.mjs deliver`) filters the pending decisions and calls `hand` |
| `Hand` | `console-service.mjs`: `hand` up to `await onDecision`; `harnesses.mjs`: `messageWorker` up to `await previous` |
| `Spawn` | `harnesses.mjs`: `messageWorker` spawns the turn, which is handed the decisions in its prompt; with `recordsAtSpawn`, `onTurn` records it in the store in the same step |
| `Settled` | `console-service.mjs`: `onDecision` resolves to `'worker'` once the turn has settled and `hand` marks `sent`; without `recordsAtSpawn` the turn is recorded only now |
| `Ack` | the worker records `ack` on the store for a decision it acted on |
| `TurnEnd` | the harness program exits, and its entry in `harnesses.mjs` `turns` resolves |
| `Restart` | the daemon stops and starts again: `sent`, `batches` and `turns` are gone, turns keep running, and the new daemon adopts those recorded in the store |

The model's state mirrors the code: `procs` are calls of `hand` that have not resolved, each with the `turns` entry its `messageWorker` awaits; `tail` is the session's entry in `turns`; `turns` are the session's running turns. Turn 0 is the kickoff turn `startWorker` began, and it starts recorded, because the story has no worker to hand decisions to until the worker is recorded.

`current` in `delivery-model.mjs` names five behaviors that differ between versions of the code, so `check` can replay a past version, and each one is pinned in the real code by a test, so the model cannot claim a fix the code lacks:

| Flag | What the code does | Test that holds the code to it |
|---|---|---|
| `filterSent`, `handReserves` | `hand` claims its seqs in `sent` before its first await, on both the batch and the `deliverPending` path, and releases them unless the worker was told | `console-service.test.mjs`: "overlapping deliveries hand each decision to the worker once", "a dashboard decision and a delivery request that overlap hand the decision once", "a decision that did not reach the worker is handed again" |
| `startRegistersTurn` | `startWorker` puts the kickoff turn in `turns` | `harnesses.test.mjs`: "a message to a new session waits for the kickoff turn startWorker began" |
| `waitsForAdoptedTurns` | `serve.mjs` passes `supervisor.idle(story)` to `messageWorker` as `after`, and stopping the daemon rejects those waits | `supervisor.test.mjs`: "a message waits until the turn left by an earlier daemon has ended", "stopping the daemon ends a wait for an earlier daemon's turn"; `harnesses.test.mjs`: "a message waits for what the caller says is still running" |
| `recordsAtSpawn` | `messageWorker` calls `onTurn`, which records `turn-started`, as soon as the process exists, before the turn settles | `harnesses.test.mjs`: "a message reports its turn as soon as the process exists, before the turn settles" |

When you change one of these behaviors, change the step in the model and its flag in `current` in the same pull request, and keep or replace the test that pins it.

## Read a failure

`check` returns the shortest trace to the violation, for example `Record(d0) → BatchFire → JarvisDeliver → Spawn(batch#1) → Settled(batch#1) → TurnEnd(#1) → Spawn(jarvis#2)`. In words: the owner answers, the dashboard's batch starts handing the answer over, Jarvis asks for delivery before that hand-off has finished, and both turns carry the same answer.

Before you treat a failure as a bug, check that the step it names still matches the code: a new `await` splits a step in two, and a removed one merges two. A failure that matches the code is a bug. Do not remove the step, lower the bounds, or relax the invariant to make it pass.

## What it does not cover

- One story and one session, two decisions, two `deliver` calls, one restart. A larger bound adds no new interleaving of these code paths, but it has not been run.
- A `messageWorker` that fails to start its program. The code releases the claimed seqs in that case, and `console-service.test.mjs` covers it, but the model has no failure step.
- The order of decisions within one turn, the store's own transactions (see `verify-story-lifecycle`), and harnesses whose workers run in-app.
- Several daemons running at once. `serve.mjs` refuses to start a second one on the same port.
- A decision on a command-line story with no worker. `onDecision` hands it to nobody: it nudges the coordinator and returns `coordinator`, so `hand` releases its seqs and the decision stays pending until a background Jarvis turn handles it (ADR 0019). The background Jarvis's own turns go through `messageWorker` on a session no worker shares. `coordinator.test.mjs` covers both.
- A restart while a kickoff turn settles. The story has no worker recorded until `startWorker` returns, so no decision can be handed to it, but Jarvis could start a second worker for the story.

## Coverage record

- `command-center/console-service.mjs`: `notify`, `hand`, `deliverPending`
- `command-center/serve.mjs`: `deliver`, the `onDecision` passed in `start`
- `adapters/harnesses.mjs`: `messageWorker`, `startWorker`, `turns`
- `command-center/supervisor.mjs`: `idle`, `sweep`, `adopted`

Last confirmed to describe these files at the commit that last changed this skill: `git log -1 --format=%h -- .claude/skills/verify-decision-delivery/SKILL.md`. When any of them changes, rerun the model. Move this record forward to a new commit only after you have checked that the steps and `current` still match the code at that commit.
