# DLV-1: An answer given mid-turn is resumed into a worker that has already released

Issue #47. Bug lane. Branch `story/dlv-1-resume-after-release`, cut from `main` at 88b9cce.

## Context pack

- Area: decision delivery. `command-center/console-service.mjs` (`notify`, `hand`, `sent`, `deliverPending`), `command-center/serve.mjs` (`deliver`, `onDecision`, `startStoryWorker`), `adapters/harnesses.mjs` (`messageWorker`, `startWorker`, `turns`, `settled`), `command-center/supervisor.mjs` (`idle`, `running`, `track`), `command-center/coordinator.mjs` (`needs`, `unhandled`, `check`, `nudge`), `command-center/delivery-model.mjs` and its test, `e2e/` (`rig.mjs`, `scripted.mjs`, `daemon.mjs`, scenarios).
- Rules: AGENTS.md (no source comments, no package dependencies, store and Command Center harness-neutral, harness code under `adapters/`, no personal names or real work details). A delivery change reruns `.claude/skills/verify-decision-delivery/SKILL.md` and `node e2e/run.mjs`; a live bug gets an e2e scenario that fails without the fix (`e2e/README.md`). A changed model flag changes its step and its entry in `current` in the same PR and is pinned by a test.
- Similar changes: 05c45f7 and the model tests in `delivery-model.test.mjs` (`filterSent`, `handReserves`, `startRegistersTurn`, `waitsForAdoptedTurns`, `recordsAtSpawn`); WAKE-1 (#41, ADR 0019); E2E-1 (#45, ADR 0022).
- Focused tests: `node --test command-center/console-service.test.mjs command-center/serve.test.mjs adapters/harnesses.test.mjs command-center/supervisor.test.mjs command-center/coordinator.test.mjs command-center/delivery-model.test.mjs`. Full: `node --test`; `node e2e/run.mjs`.
- Risks: the delivery model and the verify skill's coverage record are shared with later delivery stories (#49, #48, #53, #54, #55); do not change their behaviour beyond what this story needs.

## Problem

The owner answers a question while the story's worker is still in its turn. If the worker releases in that turn and Jarvis staffs a replacement, the daemon resumes the old session anyway. Two agent processes run in one worktree, and the replacement never receives the answer.

Reproduction on 88b9cce (e2e scenario `answer-before-release`, run on a clean export of `main`): w1 asks (seq 5) and keeps its turn; the owner answers (seq 6); w1 releases in the same turn; the resumed w1 session, background Jarvis and the replacement w2 start together; the daemon logs "A worker turn on E2E-MIDTURN is running but could not be recorded (no worker is assigned)"; seq 6 stays in `sent`, Jarvis's `deliver` hands nothing, and w2 never gets the answer.

## Root cause

- `hand` (`console-service.mjs`) reads `worker.session` before `await onDecision` and keeps the seqs in `sent` when it returns `worker`.
- `onDecision` (`serve.mjs`) passes that session and `after: supervisor.idle(story)` to `deliver`.
- `messageWorker` (`harnesses.mjs`) awaits the session's running turn and `after`, then resumes that session without reading the assignment again.
- `deliverPending` skips seqs in `sent`, so Jarvis's deliver during the wait hands nothing.
- `supervisor.track` refuses the stray turn when nobody is assigned; had a replacement been assigned first, it would record the old session's pid under the new assignment.

## Fix

1. `messageWorker` takes an optional, per-call synchronous hook (e.g. `options.current()`), called after `await previous` with no `await` between it and `run(...)`. `serve.mjs` passes it only for worker deliveries; Jarvis resumes never get it. The hook compares the assignment id captured with the session against the current assignment. If it changed, `messageWorker` throws a distinct stale error before spawning, and the existing catch resolves `turns` for that session. The adapter learns nothing about the store.
2. `deliver` returns `stale` for that error, not the "could not be messaged" path.
3. `hand` captures session and assignment from one snapshot. On `stale` it keeps the seqs reserved in `sent` and hands again with a fresh snapshot, repeating while the result is `stale`. With a worker assigned, the answer goes to it, waiting on `supervisor.idle` and that session's turns. With none, `onDecision` returns `coordinator`, the seqs leave `sent` and stay pending, and Jarvis is woken.
4. `coordinator.mjs` keeps an in-memory set of seqs owed to Jarvis. A stale hand that ends with no worker adds its seqs; `check` treats them as news even when they are not newer than `jarvis.handled`, until a Jarvis wake carries them.

## Acceptance criteria

1. An answer recorded while worker A's turn runs, with A released in that turn and B assigned before the wait ends, is delivered to B's session; A's session is never resumed.
2. If B also releases and C is assigned before the re-hand's wait ends, C gets the answer.
3. If no worker is assigned when the wait ends, the answer stays pending, is not in `sent`, and Jarvis is woken with it, even if an earlier Jarvis turn already saw it.
4. A new assignment that reuses the released session string still counts as a change; the waiting delivery does not resume under the old assignment.
5. A Jarvis resume through `messageWorker` still spawns while a worker is assigned.
6. A `deliverPending` call while a stale hand is re-handing gets no seqs; no answer is delivered twice.
7. The delivery model has Release and Assign steps, a flag in `current` (e.g. `rechecksAssignment`), an invariant that a released assignment's session is never resumed, and a terminal-state check for a lost delivery. The 88b9cce flags fail both; the new flags pass. `.claude/skills/verify-decision-delivery/SKILL.md` lists the new steps, flags, what it still does not cover, and the coverage record.
8. `e2e/scenarios/answer-before-release.mjs` fails on 88b9cce and passes with the fix, under both harnesses. It orders the race (the worker holds its turn until the answer is recorded plus a margin above the 1.5 s batch delay, then releases) and asserts the replacement handles the answer, the daemon output has no "no worker is assigned" line, and the old session's log gets no new turn after the release.

## Test level

Unit tests for `messageWorker`, `deliver`, `hand` and the coordinator's owed seqs; the exhaustive delivery model; one e2e scenario.

## Out of scope

- #49: a delivered turn that fails after the settle window keeps its seq in `sent`.
- Enforcing that a worker ends its turn promptly after releasing.
- #48, #53, #54, #55.

## Settled decisions

- `scope-49`: #49 stays its own story, next in the queue.
- `scope-release-turn`: enforcing a prompt end of turn after release is out of scope.
- `stale-no-worker-wake`: make the Jarvis wake certain in this story through seqs owed to Jarvis in `coordinator.mjs`.
- From issue #47: a decision goes to the worker assigned when it is delivered; a released session is never resumed; an undelivered decision stays available for the replacement.
- From ADR 0019: a decision with no worker returns `coordinator` and wakes background Jarvis.

## Run decisions

- Before and after: skipped; the e2e scenario failing on `main` and passing with the fix is the evidence.
- Architecture diagram: none.
- Gates: `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`; pipeline "Tests". Mutation testing: none configured.
- Implementation level: full. Review round limit: 3. Cross-model sharing: authorized.
- Spec location: `docs/specs/story/dlv-1-resume-after-release.md`, the branch's first commit.

## Plan critique

Codex (gpt-6-sol; the configured gpt-6.2-sol is refused for this account) and a Claude subagent reviewed the same neutral packet. Each finding was checked against the code. Both found that a single re-hand could strand the answer after a second release. Codex found that session equality does not prove the assignment survived. Claude found that the model needs a terminal check, that the e2e race must be ordered, that the hook must be per-call, that the re-hand must keep the seqs reserved, and that the no-worker nudge could wake nobody. All are resolved above; the last one through the owner's `stale-no-worker-wake` answer.
