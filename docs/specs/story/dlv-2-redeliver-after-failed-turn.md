# DLV-2: `serve.mjs deliver` cannot hand over a decision again after its delivery failed

Issue #49. Bug lane. Branch `story/dlv-2-redeliver-after-failed-turn`.

## Context pack

Issue #49. Bug lane. Branch `story/dlv-2-redeliver-after-failed-turn`, cut from `origin/main` at 08859fd.

### Area and entry points

- `command-center/console-service.mjs`: `sent` (line 86), `hand` (87-101), `deliverPending` (109-113), `notify` (74-85).
- `command-center/serve.mjs`: `deliver` (29-53), the `onDecision` passed in `start` (180-203), which builds `onTurn = turn => supervisor.track(...)`.
- `adapters/harnesses.mjs`: `messageWorker` (269-289), `settled` (253-265, 10 s settle; e2e uses 2 s). `onTurn` receives `{ session, pid, log, ended }`, and `ended` resolves when the program exits.
- `command-center/supervisor.mjs`: `track` records `turn-started`, then `turn-ended` when `ended` resolves; a failed turn has `wake: true`.
- `command-center/coordinator.mjs`: a `turn-ended` of the assigned worker is news for Jarvis; `owe` (DLV-1).
- `command-center/delivery-model.mjs` and its test; `.claude/skills/verify-decision-delivery/SKILL.md`, whose "What it does not cover" names issue #49.
- `e2e/`: `rig.mjs` (`checkTurns` fails any worker turn whose outcome is not `ended`), `scripted.mjs` (playbook entries match on role, phase, turn and worker only; the scripted Jarvis runs `deliver` when a decision is pending), scenarios.
- ADR 0023 ("A decision goes to the worker assigned when it is delivered"): its consequences name #49 as still open.

### Rules that apply

- AGENTS.md: no source comments (comment ratchet), no package dependencies, store and Command Center stay harness-neutral, no personal names or real work details, `node --test` before committing.
- A delivery change reruns the delivery model (`verify-decision-delivery`). A changed behaviour changes its model step and its `current` flag in the same PR and gets a pinning test. Do not relax an invariant to make the model pass. Every past-version replay that fails today must still fail.
- A live bug gets an e2e scenario that fails without the fix (`e2e/README.md`); `node e2e/run.mjs` runs on every PR.
- ADR only if the fix needs a reason the code cannot show; number taken at publish.
- Profile: gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; spec at `docs/specs/story/<branch>.md` as the first commit; pipeline "Tests"; no review bot; implementation level full; review limit 3; cross-model review authorized.

### Commands

- Focused: `node --test command-center/console-service.test.mjs command-center/serve.test.mjs adapters/harnesses.test.mjs command-center/supervisor.test.mjs command-center/coordinator.test.mjs command-center/delivery-model.test.mjs`
- Full: `node --test`; `node e2e/run.mjs`.

### Similar changes

- DLV-1 (#47, dd2dba2, spec `docs/specs/story/dlv-1-resume-after-release.md`, ADR 0023): stale re-hand loop in `hand`, `current()` recheck in `messageWorker`, seqs owed to Jarvis.
- 05c45f7: `sent` reservation before the first await (`filterSent`, `handReserves`).

### Reproduction (unchanged code at 08859fd)

An e2e scenario, kept outside Git at `C:\Users\trojanmini\.ai-sdlc\stories\DLV-2\repro-scenario.mjs` and run temporarily from `e2e/scenarios/`. Output: `reproduction-output.txt` and `reproduction-output-2.txt` in the same folder.

1. Worker 1 (planner) asks a question and ends its turn.
2. The owner answers (seq 7). The daemon resumes worker 1's session; the turn runs past the 2 s settle and exits 1. `turn-ended` records `failed`, code 1.
3. The background Jarvis is woken by the failed turn, and its scripted policy runs `deliver`. No worker turn starts; the answer stays pending.
4. `serve.mjs deliver` returns `{"seqs":[],"told":"nobody"}` with seq 7 still pending.
5. After worker 1 is released and a replacement is assigned and finishes its kickoff, `deliver` again returns `{"seqs":[],"told":"nobody"}`.

### Root cause

`hand` reserves its seqs in `sent` and keeps them there when `onDecision` returns `worker`, which it does once the turn has settled. Nothing removes them afterwards: not the turn failing, not it ending without an `ack`, not a release. `deliverPending` and `hand` skip any seq in `sent`, so until the daemon restarts, no path can hand that decision again, to the same worker or a replacement.

### Known risks

- The redefinition of "handed once" in the model must stay strict enough that every past-version replay in `delivery-model.test.mjs` still fails.
- The testing-phase `approve` path in `onDecision` returns `worker` from `beginWorker` with no turn hook. It keeps its seqs in `sent` the same way, and re-handing it would hit the "already started a test worker" refusal.
- IDLE-1 (#66) changes the final return of `deliverPending` and the Jarvis kickoff text. Keep the change to the filter on line 110 to a single helper call so the merge stays trivial.
- #48, #53, #54, #55 are queued in the same area. Do not change their behaviour.
- `rig.checkTurns` rejects a failed worker turn, and playbook matching cannot tell a first resumed turn from a second one. The scenario needs a narrow rig change or a marker file.

## Problem (bug, issue #49)

Reproduced on 08859fd by the scout (e2e scenario outside Git; output in the story folder). A resumed worker turn that carries the owner's answer fails after the settle window. The failed turn wakes the background Jarvis, whose `serve.mjs deliver` returns `{"seqs":[],"told":"nobody"}` while the answer is pending. After a release and a replacement's kickoff, `deliver` again hands nothing.

Root cause: `hand` in `command-center/console-service.mjs` keeps a seq in `sent` once `onDecision` returns `worker`, which happens as soon as the turn settles. Nothing removes it afterwards, so `deliverPending` and `hand` skip it until the daemon restarts.

## Fix

1. `sent` becomes a map from seq to the reservation that holds it (a token per `hand` call). `hand` gives `onDecision` a hook; `serve.mjs` calls it from the `onTurn` it already builds, with the turn's `ended`. `hand` releases its own reservation once both have happened: `onDecision` returned and the carrying turn ended, in either order. A turn that exits within the settle window resolves `ended` before `hand` returns, so the release cannot depend on the order. A release removes only entries still holding this call's token, so a newer reservation stays. The existing release on a non-`worker` result goes through the same token check. An acknowledged decision is no longer pending, so it is not handed again.
2. `deliverPending`'s filter on `sent` becomes one helper call; its final `return` line is left for IDLE-1.
3. `serve.mjs` `deliver` and the stale loop are unchanged. The hook passes through each pass of the loop, and a stale pass starts no turn.
4. Approval start path: when `onDecision` starts the test author for an `approve`, `startStoryWorker`'s kickoff turn goes to the same hook. A kickoff that fails or ends without acknowledging the approval releases it, and `deliver` resumes that session with it. Rerun `approval-model.test.mjs`.
5. Delivery model (`command-center/delivery-model.mjs`, checked as `.claude/skills/verify-decision-delivery/SKILL.md` says):
   - New flag `releasesAtTurnEnd` in `current`, pinned by a `console-service.test.mjs` test. With it, `TurnEnd` releases the `sent` entries its turn carried, once that hand's `Settled` has also happened, matching the code.
   - `NoDuplicateDelivery` stays a per-daemon rule, as today, checked when `hand` reserves. Within one daemon, no decision is reserved while an earlier hand of this daemon, or a turn it started carrying it, is unresolved or running. None is reserved after it was acknowledged. `Restart` resets this record as it resets `handed` today, so the documented re-hand after a restart stays allowed and #48 keeps its behaviour: an adopted turn carrying the decision does not count. A decision handed again after its turn ended unacknowledged is allowed, which is what the issue asks for.
   - Every past-version replay in `delivery-model.test.mjs` must still fail. The pre-05c45f7 trace now fails at reservation, because the second hand starts while the first is unresolved.
   - New check `NeverBlocked`: no reachable state has a decision pending, carried by no running turn or unresolved hand, with a worker assigned, and still in `sent`. With `releasesAtTurnEnd` off, `check` fails it, and a test asserts that.
   - The test "with the assignment rechecked, no released session is resumed and no decision is lost" runs with the new flag off, so it narrows to the invariants it was written for. `current` keeps every invariant.
   - The skill gains the flag in its `current` table (its test requires every flag), a new `TurnEnd` row, the invariant, and a rewritten "Read a failure" example. It drops #49 from "What it does not cover" and moves its coverage record forward.
6. e2e scenario `failed-turn-answer-redelivered` (`e2e/README.md`):
   - Same worker: worker 1 asks; the owner answers; the resumed turn runs past the 2 s e2e settle (`e2e/daemon.mjs`) and only then exits 1. A faster exit takes the fails-before-start path (#54) and passes today. The background Jarvis is woken and runs `deliver`, and the same worker receives the answer and acknowledges it. A marker file in the worktree lets the redelivered turn act instead of failing again.
   - Replacement: worker 1 releases before its failing turn ends; once it ends, a replacement is assigned. Its kickoff entry acknowledges nothing; only its resumed turn acknowledges the answer. So this part passes only when `deliver` hands the answer over, not because the kickoff read it from the handover.
   - The rig gains a narrow option for a scenario to name the failed turns it expects; `checkTurns` still rejects any other. The scenario must fail on 08859fd at the redelivery step. The README table gains its row.
7. ADR (number taken at publish): `sent` now means "in flight on a running turn or an unresolved hand". It amends the last consequence of ADR 0023.

## Settled decisions (owner, console)

1. A clean exit (code 0) without an ack makes the decision deliverable on the next `deliver`; no new wake in this story.
2. A failed turn's decision is handed again only through `deliver`, after Jarvis looks at the failure; the daemon never retries by itself.
3. A replacement is handed the decision once the released worker's carrying turn ends; `sent` is not tracked per assignment.
4. The approval start path is fixed here: the test author's kickoff turn releases the approval when it ends unacknowledged.
5. Before and after: no comparison; the e2e scenario's output, failing on 08859fd and passing with the fix, is the evidence.
6. Architecture diagram: none.

## Acceptance criteria

- After a delivered turn fails, or ends cleanly without an ack, `serve.mjs deliver` hands the still-pending decision to the worker assigned then, once.
- While a turn carrying a decision runs, or a hand of it is unresolved, `deliver` and the dashboard batch hand it to nobody else.
- An acknowledged decision is never handed again by the same daemon.
- A release from an earlier hand never removes a newer reservation.
- The delivery model passes with `current`, fails `NeverBlocked` without the new flag, and every past-version replay still fails.

## Tests and gates

Test level: unit (`console-service.test.mjs`; `serve.test.mjs` for the hook passing through `onTurn` and the approval kickoff), the model tests, and the e2e scenario. Gates: `node --test`, `gitleaks git --no-banner --log-opts=origin/main..HEAD`, `node e2e/run.mjs`, and the `verify-decision-delivery` check. Spec at `docs/specs/story/dlv-2-redeliver-after-failed-turn.md` as the first commit. Merge main (IDLE-1) before publishing.

## Out of scope

#48, #53, #54 and #55 keep their behaviour. The wake rules in `coordinator.mjs` and `supervisor.mjs` stay unchanged: a clean exit without an ack wakes nobody new. The daemon never re-hands on its own. `sent` is not tracked per assignment.

## Plan critique

No second provider could run. Codex hit its usage limit until Nov 30, and the Copilot CLI is not installed. One Claude (Opus) seat reviewed the neutral packet. All six of its findings held against the code and are folded in above:

- the per-daemon duplicate rule across a restart
- the narrowed all-flags test
- the skill rows
- the approval start path
- the clean-exit wake gap (question dlv2-clean-end-without-ack)
- a replacement part that could pass without the fix

It also confirmed two points: the hook ordering (`ended` resolves before `settled` on an early exit), and that a stale pass starts no turn.
