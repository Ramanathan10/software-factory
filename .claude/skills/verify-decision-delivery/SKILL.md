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
```

`node --test` runs it with everything else, so CI runs it on every pull request.

## The code each step stands for

The table at the top of `delivery-model.mjs` maps each step to the code it models. `current` in that file names four behaviors, and each one is pinned in the real code by a test, so the model cannot claim a fix the code lacks:

| Flag | What the code does | Test that holds the code to it |
|---|---|---|
| `filterSent`, `handReserves` | `hand` claims its seqs in `sent` before its first await, on both the batch and the `deliverPending` path, and releases them unless the worker was told | `console-service.test.mjs`: "overlapping deliveries hand each decision to the worker once", "a decision that did not reach the worker is handed again" |
| `startRegistersTurn` | `startWorker` puts the kickoff turn in `turns` | `harnesses.test.mjs`: "a message to a new session waits for the kickoff turn startWorker began" |
| `waitsForAdoptedTurns` | `serve.mjs` passes `supervisor.idle(story)` to `messageWorker` as `after` | `supervisor.test.mjs`: "a message waits until the turn left by an earlier daemon has ended"; `harnesses.test.mjs`: "a message waits for what the caller says is still running" |

When you change one of these behaviors, change the step in the model and its flag in `current` in the same pull request, and keep or replace the test that pins it.

## Read a failure

`check` returns the shortest trace to the violation, for example `Record(d0) → BatchFire → JarvisDeliver → Spawn(batch#1) → Settled(batch#1) → TurnEnd(#1) → Spawn(jarvis#2)`. In words: the owner answers, the dashboard's batch starts handing the answer over, Jarvis asks for delivery before that hand-off has finished, and both turns carry the same answer.

Before you treat a failure as a bug, check that the step it names still matches the code: a new `await` splits a step in two, and a removed one merges two. A failure that matches the code is a bug. Do not remove the step, lower the bounds, or relax the invariant to make it pass.

## What it does not cover

- One story and one session, two decisions, two `deliver` calls, one restart. A larger bound adds no new interleaving of these code paths, but it has not been run.
- A `messageWorker` that fails to start its program. The code releases the claimed seqs in that case, and `console-service.test.mjs` covers it, but the model has no failure step.
- The order of decisions within one turn, the store's own transactions (see `verify-story-lifecycle`), and harnesses whose workers run in-app.
- Several daemons running at once. `serve.mjs` refuses to start a second one on the same port.

## Coverage record

- `command-center/console-service.mjs`: `notify`, `hand`, `deliverPending`
- `command-center/serve.mjs`: `deliver`, the `onDecision` passed in `start`
- `adapters/harnesses.mjs`: `messageWorker`, `startWorker`, `turns`
- `command-center/supervisor.mjs`: `idle`, `sweep`, `adopted`

Last confirmed to describe these files at the commit that last changed this skill: `git log -1 --format=%h -- .claude/skills/verify-decision-delivery/SKILL.md`. When any of them changes, rerun the model. Move this record forward to a new commit only after you have checked that the steps and `current` still match the code at that commit.
