# WAKE-1 plan: wake Jarvis whenever a story needs it

## Problem

When a worker releases its assignment, or its turn fails, the next step waits on Jarvis. Jarvis is a chat, and only a background `wait-any` in Claude Code brings it back. In Codex nothing does, so the story sits with no worker until the owner types; the board says "Idle · no tester session active", which does not tell the owner anything is waiting. Context pack: `context-pack.md` on the story.

## Settled decisions

From the brief (not re-asked): Jarvis keeps the judgment; the daemon staffs only the existing test author after approval; a dedicated background Jarvis session is started and resumed through the harness row, one turn at a time, with its turns recorded; the owner's chat stays; store refusals prevent double staffing; the board shows "Waiting on Jarvis" with age and reason and shows background Jarvis failures with the owner's next step. Rejected: Command Center staffing roles, Codex heartbeats, resuming the owner's chat, harness automation files, OS scheduled tasks.

From planning:
1. **Session:** one background Jarvis session per story, in the story's harness.
2. **Tier:** a new `coordinator` entry in the phase-tier table, default `standard`; the owner can move it in the profile's `phaseTiers`.
3. **Powers:** the Jarvis chat's powers, console-only, read-only on worktrees. Anything for the owner becomes a console question; then it ends its turn.
4. **Batching:** a story is woken after 10 quiet seconds; one turn carries every pending news seq; news recorded by others during a turn gets exactly one follow-up turn; the background Jarvis's own events never wake it.
5. **Owner's chat:** drops its background `wait-any` in command-line harnesses and catches up from the console feed at the start of each turn.
6. **Failure:** no retry. The daemon posts an `action-jarvis-<seq>` question naming the cause and the fix; "Done" gives one new Jarvis turn, "Hold" gives none.
7. **Board:** "Waiting on Jarvis · 4m · <why>"; "Jarvis is checking <story>" during its turn.
8. **Before and after:** screenshots on a throwaway Command Center in three states; before captured from origin/main right after approval.
9. **Diagram:** architecture delta of the wake path, in the PR description.

## Design

### When a story needs Jarvis (harness-neutral, `command-center/coordinator.mjs`, new)
A story is **waiting on Jarvis** when all hold:
- its harness starts workers from the command line (Claude Code, Codex; the Copilot app keeps its in-app wake, Cursor has no workers);
- it has a pending news event: a store `wakes` event, or a `turn-ended` with `wake`, excluding owner decisions on a story whose worker is assigned (the same filter `waitForAny` uses today) and excluding the approval the daemon is already turning into a test-author start;
- either no worker is assigned, or the assigned worker is between turns and its last turn ended with `wake` (failed, lost, or silent);
- it is not closed, no worker start is in flight for it (`starts` in `serve.mjs`), no Jarvis wake is in flight or running (an in-memory `waking` map plus the stored turn), and no open `action-jarvis-*` question is waiting on the owner;
- it is not the approval case the daemon already handles (testing, approval pending, no worker assigned since it), and the coordinator starts only after the startup approval pass.

Not news: `create`, and any event recorded with `by: "jarvis"` (both Jarvis sessions mark their writes); an answer of "Hold" to an `action-jarvis-*` question, which the daemon acknowledges itself.

The daemon checks every few seconds (alongside the supervisor's sweep). A story is woken when it has been waiting and quiet (no new event) for 10 seconds, and some pending news has a seq above the highest seq the previous Jarvis turn was given. Older pending news that a finished turn saw and left unacknowledged does not wake it again. That makes "news during a turn gets exactly one follow-up" fall out of the rule, and bounds the loop.

### The background Jarvis session (`adapters/harnesses.mjs`, `serve.mjs`)
- Before launching, the daemon records `jarvis-woken` with `handled` (the highest news seq it hands over) and holds the story in `waking` until the launch settles. A launch that fails, including one that exits within the 10 s settle, records `jarvis-turn-ended` failed with the error text, which raises the failure question. A restart that finds `jarvis-woken` with no turn recorded after it records the turn as lost, as ADR 0018 does for an interrupted start.
- Jarvis turns are tracked apart from worker turns: `supervisor.idle(story)` and `deliver`'s `after` wait only on worker turns, so a Jarvis turn that calls `serve.mjs start` or `deliver` cannot deadlock on itself.
- First wake: `startWorker` in the story's harness and worktree, with the phase `coordinator` so `modelFor` picks the coordinator tier; later wakes: `messageWorker` on the same session. One turn per session, as for workers (ADR 0002).
- Its program runs with `AI_SDLC_ACTOR=jarvis` in its environment; `jarvis.mjs record` copies that onto each event it records as `by: "jarvis"`, and the store records such events as not pending. So the background Jarvis never wakes itself, deterministically, without relying on the model to mark its writes. Workers it starts are spawned by the daemon, not by it, so they do not inherit the marker.
- Kickoff (built by the daemon, like `testingKickoff`): story, harness, news seqs with their types, absolute paths to a new short `skills/jarvis/BACKGROUND.md`, the runbook and `ai-sdlc` skill from the daemon's own checkout, the console CLI, database and the daemon's port for `serve.mjs start|deliver`. Rules: console only; never edit a worktree or do phase work; check the handoff against the `ai-sdlc` gate; staff the next role with `serve.mjs start` or forward with `serve.mjs deliver`; anything for the owner is a console `question` (an `action-` question for things only they can do); ack what it handled; end the turn. Never ask in chat.
- `BACKGROUND.md` is short on purpose: the turn has to finish within the one-minute acceptance window, so it should not read the whole skill set each time.

### Store (`mission-console/store.mjs`)
- `story.jarvis = { session, handled, waking?, turn?, lastTurn? }`. New events `jarvis-woken` (`handled`), `jarvis-turn-started` (`session`, `pid`, `log`) and `jarvis-turn-ended` (`outcome`, `code`, `detail`). They change no phase, are allowed while blocked or awaiting cleanup, refuse a second running Jarvis turn, and are not pending.
- Optional `by` on any event, `"jarvis"` only; an event with it is stored not pending. The Jarvis skill tells the owner's chat to add it to everything it records, so the chat's own `create` or `question` does not wake the background Jarvis.
- A `question` whose id starts `action-jarvis-` is accepted while the story is blocked or awaiting cleanup, so the failure notice can always be shown.
- The supervisor's `recordedSince` ignores `jarvis-*` events and events marked `by: "jarvis"`, so Jarvis activity during a worker's turn cannot hide a silent worker turn.
- Lifecycle model updated for the new events.

### Supervisor (`command-center/supervisor.mjs`)
Tracks Jarvis turns the way it tracks worker turns: records the end with the outcome and log tail, adopts a turn left running by an earlier daemon, and records a lost turn after a restart. A failed or lost Jarvis turn makes the daemon record the `action-jarvis-<seq>` question.

### Failure text (`adapters/harnesses.mjs`)
Each command-line row gains `explain(logTail)`, returning a plain reason and the owner's next step for failures it recognises (usage limit, expired or missing sign-in). Anything else falls back to "Jarvis stopped with an error" plus the last log line and the log path. The question reads: "Action for you: Jarvis could not run for <story>: <reason>. <what to do>. Then choose Done." Options: "Done - Jarvis can run again" (recommended), "Hold - not now".

### Board (`command-center/ui/`)
- The dashboard's story frame gains `waitingOnJarvis = { since, why }` and `jarvis = { turn?, lastTurn? }`, computed by the coordinator (like `workerRan` today).
- Card and track status, ahead of "Idle": "Jarvis is checking" while its turn runs; "Waiting on Jarvis · 4m · tester handed off red" while waiting; a failed Jarvis turn shows as "Waiting on you" through its action question. The plain phrases come from a pure helper `ui/jarvis.js` (unit-tested like `attention.js`). The story window shows the same and the Jarvis turn line.

### Delivery
`deliver` for a command-line story with no worker returns `coordinator` and asks the coordinator to check that story now (still subject to the 10 s quiet period) instead of logging "no worker is assigned". The decision stays pending until handled.

### Docs
- ADR 0019 "A background Jarvis session is woken for news", superseding ADR 0012's wake mechanism (the background `wait-any` as the way Jarvis hears news). ADR 0012 marked superseded in part. ADR 0002/0003 "Where" lines updated.
- Jarvis skill: step 4 and the "Report an idle worker" guidance per harness; a background-mode note; catch-up reads the feed since the last-read seq and reports what the background Jarvis did.
- Runbook: command-line rows for "Wake the coordinator" and "Report an idle worker" describe the daemon's background Jarvis; new "Background Jarvis" section (wake rule, kickoff, failure question, coordinator tier). Copilot and Cursor sections unchanged.
- Mission Console README: new events, `by`, `AI_SDLC_ACTOR`; `wait-any` kept as a command, no longer the Jarvis chat's wake in command-line harnesses.
- The phase-tier table gains `coordinator: 'standard'` in `roles.mjs` and in `skills/ai-sdlc-setup/scripts/preflight.mjs` (kept equal by its test), and preflight's profile validation accepts `phaseTiers.coordinator`; the "every phase with a tier is a real phase" test allows `coordinator` as the one non-phase entry. The `ai-sdlc-setup` text on tiers mentions it.

## Acceptance criteria

1. Codex story: after a worker's clean handoff (`return-to-testing`, or `red` with a valid failing test) and release, the next role is assigned within 60 seconds with no owner input and no Jarvis chat. (e2e, Codex)
2. The same in Claude Code with no Jarvis chat. (e2e, Claude Code)
3. A failed background Jarvis turn posts an `action-jarvis-<seq>` question in plain words with the next step; no further Jarvis turn starts on that story until the owner answers Done. (e2e both harnesses; unit)
4. The owner's chat and the background Jarvis starting a worker at the same time produce exactly one worker; a story never gets two running Jarvis turns. (unit, daemon; model)
5. Plan approval still starts the test author once, without a background Jarvis turn for that approval; decisions still reach assigned workers as before. (existing serve, delivery-model and approval-model tests stay green; new test that an approval with no worker wakes no Jarvis)
6. Events recorded by the background Jarvis never wake it; news recorded during its turn gets exactly one follow-up turn; news already given to a finished turn does not wake it again. (unit)
7. The board shows "Waiting on Jarvis · <age> · <why>", "Jarvis is checking", and the failure question. (unit on `ui/jarvis.js`; before-and-after)
8. The background Jarvis runs on the coordinator tier's model, standard by default. (unit)

## Test levels

Unit and daemon tests with a fake `launch`, as `serve.test.mjs` does; store tests; supervisor tests; a pure UI helper test; the delivery and approval models; the lifecycle model; two new e2e scenarios with real sessions.

## e2e scenarios (fail without the fix)

- `clean-handoff-with-no-jarvis-chat`: a worker releases and hands off; nobody runs `wait-any`; the scenario asserts a background Jarvis turn starts and the next worker is assigned within 60 s, then that worker follows a scripted kickoff and ends. The rig's throwaway worktree carries an `AGENTS.md` that tells any session it is an e2e check and names the scripted next-worker kickoff, so the real background Jarvis staffs a cheap scripted worker rather than a real planner.
- `background-jarvis-turn-fails`: the rig's throwaway profile moves the coordinator tier to `fast` and names a model that does not exist for it, so the real harness program fails at once (a `.cmd` shim cannot stand in for the program on Windows). It asserts the `action-jarvis-*` question with the plain reason, and that no second Jarvis turn starts within 30 s.
- `worker-releases-before-asking` changes with the design: the background Jarvis, not the scenario, now staffs the replacement, and the daemon no longer logs "no worker is assigned". It becomes "an answer with no worker wakes the background Jarvis, which staffs a replacement that handles it". `worker-keeps-assignment` is unchanged.
- The usage-limit and sign-in texts of `explain` are unit-tested against log samples.
- Both run with `node e2e/run.mjs "Claude Code"` and `node e2e/run.mjs Codex`. Codex is over its usage limit until 2026-11-24 02:12; if it still cannot run when reached, that is an action question for you, not a pass.

## Required checks and gates

`node --test`; gitleaks on `origin/main..HEAD`; delivery and approval models; lifecycle model; ADR 0019; both e2e scenarios in both harnesses; runbook and Jarvis skill updated. Mutation is declined in the profile.

## Out of scope

- The Command Center staffing roles itself (rejected).
- Changing the Copilot app's wake or Cursor's lack of workers.
- Restarting the live Command Center: you do that after merge.
- Retrying failed Jarvis turns automatically.

## Risks

- **One-minute window.** A cold Claude Code or Codex session reading `BACKGROUND.md` and the handover, then calling `serve.mjs start`, is expected to take 20-45 s after the 10 s quiet period. If e2e shows it over 60 s, I will report the measured time rather than loosen the check.
- **e2e determinism.** A real model decides whether to staff; the scripted `AGENTS.md` in the throwaway worktree keeps it narrow, but a model may still refuse. A refusal is reported as a failure, not retried until it passes.
- **Plan critique.** Cross-model critique needs a second provider; Codex is over its usage limit, so one independent Claude reviewer critiqued the plan; it is not a cross-model panel. It reported ten defects, all verified against the code and fixed above: a launch that fails at once retried forever; two Jarvis launches racing; the failure question refused on blocked or cleanup stories; "Hold" still waking Jarvis; Jarvis events hiding a silent worker turn; the existing e2e scenario breaking; the coordinator tier rejected by preflight and a test; a Windows script shim that cannot launch; a Jarvis turn deadlocking on its own worker start; the owner's chat racing the background Jarvis after `create`.

## Run decisions

- Before and after: screenshots of one story card and its story window on a throwaway Command Center, three states (tester released after red with no worker; background Jarvis running; background Jarvis failed on a usage limit). Before reference: origin/main as it runs today, captured right after approval.
- Architecture diagram: architecture delta of the wake path, in the PR description.

## Context pack

Story: wake Jarvis whenever a story needs it. Worktree `C:/repos/software-factory-worktrees/story/wake-1-wake-jarvis-when-needed`, branch `story/wake-1-wake-jarvis-when-needed`, base `90f4446` (origin/main).

## Rules that bind the change (AGENTS.md, profile)

- Store and Command Center stay harness-neutral; harness specifics go in `adapters/` (one row per harness in `adapters/harnesses.mjs`).
- No package dependencies; no code comments (`comment-ratchet.mjs`, `comment-ratchet.json`); reasons go in ADRs under `docs/adr/`.
- No owner names or private details in tracked files (`private-details.test.mjs`); no profiles or databases committed.
- Changes to how decisions reach a worker or how worker turns start: run the delivery model (`.claude/skills/verify-decision-delivery/SKILL.md`, `command-center/delivery-model.mjs`). Changes to `store.mjs`, phases in `roles.mjs` or the Jarvis phase table: run the lifecycle model (`.claude/skills/verify-story-lifecycle/SKILL.md`, `mission-console/lifecycle-model.mjs`).
- Changes to how workers start, how decisions reach them, or how Jarvis is woken: `node e2e/run.mjs <harness>` for each harness available. A live-story bug gets a failing e2e scenario first.
- Gates: `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation, lint, typecheck, build declined. Spec at `docs/specs/story/wake-1-wake-jarvis-when-needed.md` as first commit. Required pipeline "Tests". Team rule: reply to every PR comment before resolving it.
- Profile models: only `codex` has tiers (`gpt-6-astra` both). Claude Code has none, so its workers run on the program default.

## How it works today

- `command-center/serve.mjs`: the daemon. `start()` builds the console service, the supervisor and `beginWorker` (one in-flight start per story via `starts`). `onDecision` routes owner decisions: auto-starts Bruce Banner on an approval in `testing` with no worker (ADR 0018), otherwise `deliver()` messages the worker or, with no worker, logs "no worker is assigned" (Claude Code and Codex rows have no `wakeCoordinator`).
- `command-center/console-service.mjs`: HTTP + SSE dashboard, `notify` batches decisions 1.5 s, `hand` claims seqs in `sent`, `deliverPending`.
- `command-center/supervisor.mjs`: `track` records `turn-started`; on exit `finish` records `turn-ended` with `wake` from `turnVerdict` (failed or silent turn wakes Jarvis). Skips stories whose worker was released. `sweep` adopts or ends turns left by an earlier daemon; `idle(story)` waits for running turns.
- `adapters/harnesses.mjs`: rows for Copilot (in-app), Cursor (none), Claude Code and Codex (command-line: `start`, `message`, `model`, `permissions`, `record`, `ran`). `startWorker`/`messageWorker` spawn detached programs, log to `~/.ai-sdlc/workers/<session>.log`, serialize turns per session in `turns`, and fail fast within 10 s (`settled`).
- `mission-console/store.mjs`: event-sourced SQLite. `wakes` set marks which event types are pending for Jarvis; `turn-ended` is pending only when `wake: true`. `turn-started`/`turn-ended` require `story.worker` to match the assignment. `assign-worker` refuses a second worker; every write needs the current `revision` (stale writes 409).
- `mission-console/watcher.mjs`: `waitForAny` returns pending events after a seq, skipping owner decisions on stories that have a worker (ADR 0012, PR #31).
- `skills/jarvis/SKILL.md` and `RUNBOOK.md`: Jarvis in Claude Code keeps one background `wait-any`; in Codex nothing returns to the chat, so it "reads the console at the start of each turn". That is the stall.
- `command-center/ui/app.js`: card status is `Blocked`, `Waiting on you`, `<role> is working`, `Done`, or `Idle · <idleReasons[phase]>` (e.g. "no tester session active"). Nothing says a story waits on Jarvis.
- `e2e/`: `rig.mjs` runs a throwaway daemon on a free port with its own `AI_SDLC_HOME` and DB; scenarios `worker-keeps-assignment`, `worker-releases-before-asking`.

## Similar earlier changes

- PR #31 (`cc4e7b1`): `waitForAny` returns decisions on stories with no worker; added the e2e suite.
- PR #30 (`90f4446`): daemon starts Bruce Banner after approval (ADR 0018): one in-flight start per story, intent activity before launch, blocker on failure, no retry loop. The closest template for a daemon-started session.

## ADRs this touches

- 0012 (Jarvis woken only for news, by a background wait): to be replaced in part.
- 0002 (decisions reach a worker through the daemon), 0003 (daemon watches every worker turn), 0004 (how a worker program is started), 0005 (one row per harness), 0018 (approved plans start a test worker).

## Focused and full test commands

- Focused: `node --test command-center/ mission-console/ adapters/`
- Full: `node --test`
- Models: `node command-center/delivery-model.mjs`, `node mission-console/lifecycle-model.mjs` (as their skills describe)
- e2e: `node e2e/run.mjs "Claude Code"`; `node e2e/run.mjs Codex` (Codex over its usage limit until 2026-11-24 02:12 local)

## Known risks

- Feedback loops: events the background Jarvis records are themselves wake events; it must not wake itself forever.
- Races with the owner's chat Jarvis (both staffing) and with the daemon's own test-author start after approval.
- `create` is a wake event: the owner's chat records it and then starts a worker; a background Jarvis must not race that.
- Turn records in the store are tied to `story.worker`; a coordinator turn needs its own record, which is a store change (lifecycle model).
- Failure text differs by harness (usage limit, sign-in); explaining it belongs in `adapters/`.
- The live Command Center (port 4174) must not be restarted; all runs use a throwaway one.
