# CTX-1 plan: a lean kickoff and handover for the test author

## Problem
The independent test author (Bruce Banner) starts from `testingKickoff` (command-center/serve.mjs:82). It tells the worker to read all of skills/ai-sdlc/SKILL.md, to read the registered context pack although the spec contains it, and to read the handover and the current snapshot, then inlines the brief, the plan and every registered artifact. The handover repeats the last 40 events. Every start and resume pays for this.

## Scout summary (context pack registered on the story)
- `testingKickoff` is the only kickoff written by code; it runs for the daemon's start after approval and for Jarvis's explicit `serve.mjs start` in testing.
- `handover` and the dashboard `snapshot` share `withHistory`'s 40-event query; `store.history` is separate and full.
- The supervisor's silent-turn check, the dashboard, console.mjs and the e2e rig read `snapshot`, so capping `handover` leaves them unchanged. `handover` callers (CLI, console service, Copilot extension, store tests) need no more than 10 events.
- `handover` keeps the full story state: questions and answers, plan, brief, artifacts (including before captures), worker, PR, and uncapped `pending`.
- `snapshot <db>` on the CLI returns every story with 40 events each.

## Design
1. Kickoff reads only the "2. Test-first handoff" and "Gates" sections of the daemon's ai-sdlc/SKILL.md, named from one exported constant.
2. Kickoff: "Read the repository instructions, current preflight, saved profile and the approved spec at its saved location; the spec contains the context pack." The JSON dump of registered artifacts goes; the handover carries the artifact list.
3. Kickoff: "Read this story's handover" replaces "Read this story handover and current snapshot". (From the plan critique: the snapshot returns every story with 40 events and would undo the cap.)
4. Kickoff: the inline plan stays, labeled "Approved plan (use only if the spec file is missing):"; the create-and-commit-spec-if-missing instruction stays. Brief, harness, repository, worktree, branch, before-capture and tests-only boundary lines stay.
5. Store: `handover` returns the 10 most recent events; `snapshot` keeps 40; `history` unchanged.

## Acceptance criteria (owner's, plus the critique fix)
1. The kickoff tells the worker to read only the "2. Test-first handoff" and "Gates" sections of ai-sdlc/SKILL.md, not the whole file.
2. The kickoff says the approved spec contains the context pack and no longer lists the registered context pack (or the artifact list) as a separate thing to read.
3. The inline plan stays, labeled as the source to use only when the spec file is missing; the create-spec-when-missing instruction stays.
4. A test fails if either heading is renamed or removed from ai-sdlc/SKILL.md. It matches whole heading lines (`## 2. Test-first handoff`, `## Gates`), because the checklist at line 12 repeats "2. Test-first handoff" and a substring check would pass after a rename.
5. `handover` returns at most the 10 most recent events, newest first; `snapshot` returns 40; `store.history` unchanged.
6. The kickoff does not tell the worker to read the snapshot.
7. Tests cover the new wording and the cap; existing serve.test.mjs assertions on Bruce Banner, the plan text and the tests-only boundary still pass.
8. `node --test` passes, including delivery-model and approval-model tests.

## Test level
Unit: serve.test.mjs (kickoff text through the fake `launch`), a heading test over skills/ai-sdlc/SKILL.md, store.test.mjs (handover 10, snapshot 40, history all).

## Settled run decisions
- Handover cap: 10 (owner, after evidence).
- e2e: `node e2e/run.mjs "Claude Code" story-to-pull-request` on a throwaway Command Center.
- Before and after: command output on a throwaway Command Center and database: the kickoff text and its size, and the handover event count and bytes for one story with more than 40 events, from origin/main (captured right after approval) and from the branch.
- Architecture diagram: a small before-and-after flow of where the test author's context comes from (kickoff, skill sections, spec, handover, snapshot), in the PR description.

## Overlap with WAKE-1
WAKE-1 adds a background Jarvis kickoff beside `testingKickoff` and new store events. Edits here stay in `testingKickoff`'s body and the `handover` return. WAKE-1's background Jarvis reads the handover each wake, so it will see 10 events plus all pending news. Whichever merges second rebases.

## Out of scope
Artifact registration and the dashboard's document reader; kickoffs for later phases; the structure of the spec and context pack.

## Gates
`node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation and other gates declined in the profile.

## Plan critique
Codex is over its usage limit, so one independent Claude reviewer critiqued the plan; this is not a cross-model panel. Two findings, both verified and folded in: the heading test must match whole lines (criterion 4), and the kickoff's "current snapshot" instruction undoes the cap (criterion 6). It checked every `handover`, `snapshot` and `story.events` caller and found none that needs more than 10 handover events.

## Context pack

Story: Stop sending the test author the same context several times.
Worktree: C:/repos/software-factory-worktrees/story/ctx-1-lean-test-author-context, branch `story/ctx-1-lean-test-author-context`, base `30b49b7` (origin/main).

### Relevant files and entry points

- `command-center/serve.mjs:82` `testingKickoff(story, seqs, dbPath)`: builds the independent test author's (Bruce Banner's) first prompt. Today it says "Read completely: <daemon checkout>/skills/ai-sdlc/SKILL.md", asks for "approved spec and registered context pack", inlines `story.brief`, `story.plan` ("Approved plan:") and `JSON.stringify(story.artifacts)`. Called only from `beginWorker`'s `prepare` hook (`serve.mjs:132`) when a story starts a worker in `testing`, both for the daemon's automatic start after approval and for Jarvis's explicit `serve.mjs start` (which appends its own text).
- `mission-console/store.mjs:361` `recent` statement: `ORDER BY seq DESC LIMIT 40`, used by `withHistory(story)`, which both `snapshot()` (dashboard, supervisor) and `handover(id)` (`store.mjs:436`) call. `handover` also returns `story.plan`, `story.brief` and `pending` (all unacknowledged events, uncapped).
- `store.history(id)` (`store.mjs:410`): full history, read by `interruptedTestStart`/`stopsDeliveredApproval` and the start guards in `serve.mjs`, and by `supervisor.mjs`. Must stay unchanged.
- `command-center/supervisor.mjs:21` `recordedSince(story)` walks `story.events` back to the last `turn-started`; it reads `service.snapshot()`, not `handover`, so the handover cap does not affect silent-turn detection.
- Other `handover` callers: `jarvis.mjs handover` CLI (workers and Jarvis), `console-service.mjs:102` and the Copilot extension's `handover` tool ("Return the full handover record"), `e2e/rig.mjs` worker brief. None reads `events` beyond the most recent few; unacknowledged news is in `pending`.
- `skills/ai-sdlc/SKILL.md`: headings `## 2. Test-first handoff` (line 84) and `## Gates` (line 149). The kickoff's file path resolves to the daemon's own checkout.

### Tests

- Focused: `node --test command-center/serve.test.mjs mission-console/store.test.mjs`.
- Full gate: `node --test` (includes `delivery-model.test.mjs`, `approval-model.test.mjs`, `private-details.test.mjs`, comment ratchet).
- Existing kickoff assertions: `serve.test.mjs:162` checks `/Bruce Banner/`, the plan text `/Export selected rows; keep unselected rows private/` and `/tests and necessary fixtures only/`.
- Handover tests: `store.test.mjs:267` (CLI handover across processes).
- e2e: `story-to-pull-request` is the one scenario whose test author comes from `testingKickoff` (the daemon starts it after approval); about ten minutes on haiku.

### Rules that apply (AGENTS.md, profile)

- No comments in source files (comment ratchet); reasons go in an ADR.
- No owner name, nickname or private repository names in tracked files (`private-details.test.mjs`).
- Changes to how worker turns start: `AGENTS.md` asks for `node e2e/run.mjs <harness>` per harness you can run; spends model usage.
- Store/Command Center stay harness-neutral; no new dependencies.
- Spec committed to `docs/specs/story/ctx-1-lean-test-author-context.md` as the branch's first commit (folder does not exist yet).
- Team rule: reply to every pull request comment before resolving it.
- Gates: `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation and others declined.

### Evidence for the event cap (live database, read-only)

Across 7 stories and 406 events, counting events between consecutive worker starts (`assign-worker` or `turn-started`): 74 gaps, median 4, p75 6, p90 9, max 23; 67 of 74 (91%) are 10 or fewer. Unacknowledged events reach the worker through `pending` regardless of the cap.

### Overlap with parallel stories

- WAKE-1 (building) edits `serve.mjs` (adds a background Jarvis kickoff next to `testingKickoff`, delivery changes) and `store.mjs` (new `jarvis-*` events, `by` field, story fields). Our edits: the body of `testingKickoff` and the `handover` return in `store.mjs`; textual conflict is unlikely but possible near `testingKickoff`. WAKE-1's background Jarvis reads the handover on each wake, so it will see 10 events plus all pending news, and its kickoff names the `ai-sdlc` skill; it is not affected by the test author's kickoff change.
- MODELS-1 (planning): setup skill, preflight, `adapters/harnesses.mjs`. No overlap.

### Known risks

- A test author started while the spec file is missing loses the context pack it used to get from the registered artifact list; mitigated because the kickoff keeps the inline plan and the instruction to create the spec, and the plan carries the scout summary.
- Jarvis's explicit-start text is appended after the kickoff; unchanged.
