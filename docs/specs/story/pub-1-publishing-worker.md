# PUB-1 plan: a publishing worker opens the pull request

## Problem

Once a story reaches `publishing`, no worker can be started for it. `workerPhases` in `mission-console/store.mjs:8` has no `publishing` entry, so `command-center/serve.mjs:63` refuses to start one ("The publishing phase has no worker to start.") and the store refuses `assign-worker` (`store.mjs:251`). The background Jarvis may not push (`skills/jarvis/BACKGROUND.md:19`), so it asks the owner to open a Jarvis chat. Five finished stories (ARC-1, DIAG-1, DLV-1, HDR-1, OWN-1) stalled for hours this way, and twice the owner answered "Done" when the branch had never been pushed.

The same gap hits a story's second pass: after PR review sends a story back to build, it runs through `publishing` again with its PR open, and today a chat has to push it.

## Settled decisions

From the brief ("What the owner should see"):

- Jarvis, background or foreground, starts the publisher through `serve.mjs start`, as for other phases. The foreground chat stops opening PRs itself.
- The publisher merges `origin/main`, never rebases or force-pushes, reruns the profile's required gates, pushes, and opens the PR with `gh pr create`. The body comes from the spec and the review and gate handoffs, and closes the work item's issue when there is one.
- No action question offers "Done" for publishing. The owner is never asked to open a PR in a chat.
- The background Jarvis stays read-only.

From the interview:

1. **Persona (r1-persona):** Hawkeye (role `watcher`) runs publishing. `publishing: ['watcher', 'Open pull request', 'Ship', 'PR']`; Hawkeye's skills gain 'Open pull request'. No new badge.
2. **Failure path (r1-failure):** on a merge conflict the publisher runs `git merge --abort`, records `release-worker`, then `return-to-build` naming the conflicting files. On a gate failure after the merge it reruns that gate on unchanged `origin/main`: if it passes there, the failure is the story's, so `release-worker` then `return-to-build` with the output; if it fails there too, a `question` with both results, then `blocked` (ai-sdlc phase 4); the store refuses a `question` once a story is blocked (`store.mjs:154`), so the order is fixed. The store accepts `return-to-build` from `publishing`.
3. **Existing PR (r1-existing-pr):** before creating, the publisher reads `story.pr` and `gh pr list --head <branch> --state open`. When a PR exists it pushes to it and records `pr-opened` with that same URL, leaving the description unchanged.
4. **Screenshots (r1-screens):** the PR body gets an Evidence section listing each registered before and after file's caption and local path, with the comparison in words and a note that the Command Center shows them. No question to the owner. ai-sdlc phase 8's no-browser text changes from "tell the owner which files to drop" to this section.
5. **Diagram (r1-diagram, r2-diagram-step, r2-diagram-once):** as its first step, before the merge and gates, the publisher checks whether a diagram is due: the profile's `architectureDiagram` is `always`, or the spec asks for one, and `story.diagram.completedAt` is not set. If so it records `release-worker`, then `diagram-start` with the spec's scope, and ends its turn. Jarvis staffs Rocket; Rocket's `handoff` returns the story to `publishing` and wakes Jarvis, which starts a new publisher. A diagram is drawn once per story: `replan` already clears `story.diagram`, a second pass after PR review does not redraw.
6. **Idle text (r1-idle):** `command-center/ui/app.js:155` publishing becomes 'no publisher session active'.
7. **E2E (r1-e2e):** change `e2e/scenarios/story-to-pull-request.mjs` so a publishing turn opens the PR, not the reviewer. No second scenario.
8. **Docs (r1-docs):** a `### Publishing` subsection in ai-sdlc phase 8; Jarvis phase-table rows 7 and 8; Hawkeye's line in the Roles table; ADR 0023. No edits to `BACKGROUND.md` or the RUNBOOK kickoff template.
9. **Stories already in publishing (r1-stuck):** no special handling. Answering their open question wakes Jarvis, which can then start the publisher.
10. **Architecture diagram (r1-arch, r2-arch-form):** this PR carries a small Mermaid state diagram of publishing's exits in its body.
11. **Leftover comparison choice (r3-choice):** starting the publisher is what handles the `comparison-choice` that sent the story to publishing. Whoever starts the publisher, Jarvis or the scripted Jarvis, acks that event before delivering pending decisions, so the publisher never gets a second turn after it has released. The rule lives in the ai-sdlc Publishing subsection; `e2e/scripted.mjs` follows it. No store or delivery code changes.
12. **Conflict loop (r3-conflict):** the publisher's `return-to-build` detail names the conflicting files and says "merge origin/main and resolve these". ai-sdlc phase 3 gains one sentence: a story returned from publishing with a merge conflict starts by merging the remote default branch and resolving it.

## Design

### Store (`mission-console/store.mjs`)

- Add `'publishing'` to `workerPhases`.
- `return-to-build` accepts `publishing`. Its refusal reads "Return to build from review, the deterministic gates, the comparison, publishing, or PR review."
- Nothing else changes. `pr-opened` stays `samePhase(story, 'publishing')` and keeps refusing a different URL; a phase change still needs the worker released first (`store.mjs:619`), so every publisher exit is `release-worker` then the phase event.

### Phases and roles (`mission-console/roles.mjs`)

- `publishing: ['watcher', 'Open pull request', 'Ship', 'PR']`.
- `watcher.skills` gains `'Open pull request'`.

### Board (`command-center/ui/app.js`)

- `idleReasons.publishing = 'no publisher session active'`.

### Harness (`adapters/harnesses.mjs`)

No change. `AI_SDLC_ACTOR=jarvis` is set only for the literal phase `coordinator` (`harnesses.mjs:228-231`), so the publisher's events wake Jarvis. Restricted workers already have git, gh, node and the gate tools.

### Skills and docs

- `skills/ai-sdlc/SKILL.md` phase 3 gains the decision-12 sentence.
- `skills/ai-sdlc/SKILL.md` phase 8 gains `### Publishing`, run by Hawkeye's worker under the Command Center. It opens by saying this phase authorizes the push and `gh pr create` (the RUNBOOK kickoff template's "no PR unless the phase allows it" is met), and that whoever starts the publisher acks the pending `comparison-choice` before delivering decisions (decision 11). Steps:
  1. Diagram due (decision 5): `release-worker`, `diagram-start` with the spec's scope, end the turn.
  2. Find an existing PR: `story.pr`, then `gh pr list --head <branch> --state open`.
  3. `git fetch origin`, `git merge origin/<default branch>`. On conflict: `git merge --abort`, `release-worker`, `return-to-build` naming the files and saying "merge origin/main and resolve these"; end the turn.
  4. Rerun the profile's required gates. On failure, decision 2. The worker stays assigned while blocked so the owner's answer reaches it.
  5. `git push -u origin <branch>`; never force.
  6. With no PR: `gh pr create` with the body from phase 8 (spec, gate results, review verdict, diagram, Evidence section, `Closes #<n>` when the work item is an issue). With a PR: no create, description unchanged.
  7. `release-worker`, then `pr-opened` with the URL; end the turn.
- Phase 8's no-browser sentence: give the comparison in words and list each file's caption and path in an Evidence section of the description; do not ask the owner to attach them.
- `skills/jarvis/SKILL.md`:
  - Row 7: the publisher records `diagram-start` with the scope as its first step, before the pull request opens; Jarvis then staffs Rocket, and restaffs the publisher after Rocket's handoff.
  - Row 8: starts with Hawkeye's publisher (kickoff: run "Publishing" in phase 8 of `ai-sdlc`), which records `return-to-build` on a merge conflict or a story-caused gate failure, `blocked` and a `question` when the gate fails on the default branch too, and `pr-opened` with the URL; the rest of the row is unchanged.
  - Roles table, Hawkeye: "Opens the pull request; routes the owner's console decisions ...".
- `docs/adr/0026-hawkeye-opens-the-pull-request.md`: why publishing is a worker phase run by Hawkeye and not by Jarvis (Jarvis stays read-only; Hawkeye already owns the ship lane and pushes in PR review); why the publisher, not Jarvis, records `diagram-start`.

### Lifecycle model (`mission-console/lifecycle-model.mjs` and its test)

The model already explores every input from every reachable state, so `publishing` in `workerPhases` widens it without new inputs. Add properties: `return-to-build` is accepted from `publishing` and lands in `building`; a publishing worker can `release-worker` then `diagram-start`, and the diagram `handoff` returns to `publishing` where `assign-worker` is accepted again; `pr-opened` is refused while a publisher is assigned.

### E2E (`e2e/scenarios/story-to-pull-request.mjs`, `e2e/scripted.mjs`)

The scripted Jarvis, when it starts a worker in `publishing`, first acks the pending `comparison-choice` (decision 11), so it does not deliver it to the publisher.


The reviewer's turn ends at its `handoff` and `comparison-choice`. A new turn `{ role: 'watcher', phase: 'publishing', turn: 'first' }` runs `git fetch`, `git merge origin/main`, `node --test`, `git push -u origin <branch>`, `gh pr create`, then `release-worker` and `pr-opened`. On `main` the scripted Jarvis does not start a publishing worker, because it checks `workerPhases` first (`e2e/scripted.mjs:86`), and the driver throws "The worker ended its turn in publishing with nothing for the owner or Jarvis to do", so the scenario fails red.

## Acceptance criteria

1. `serve.mjs start` on a command-line story in `publishing` starts a worker; the store records `assign-worker` with role `watcher` ("PR watcher assigned.").
2. In `publishing`, the assigned worker's `activity`, `artifact` and `release-worker` are accepted.
3. `return-to-build` from `publishing` moves the story to `building`; it is still refused from `ci`, `merge` and `building`.
4. `pr-opened` is refused while a publisher is assigned and accepted after `release-worker`; on a story with `pr` set, the same URL is accepted and a different one refused.
5. A publisher can `release-worker` then `diagram-start`; the diagram `handoff` returns to `publishing`, and `assign-worker` is accepted there again.
6. `phases.publishing[0]` is `'watcher'` and `roles.watcher.skills` includes `'Open pull request'`; the roles tests pass.
7. The dashboard shows 'no publisher session active' for an unstaffed publishing story.
8. The lifecycle-model tests pass, including the phase-table check with rows 7 and 8 rewritten, and the new properties above.
9. `node e2e/run.mjs`: `story-to-pull-request` passes with exactly one publisher turn (no resumed turn after it releases), with the PR opened by the publishing turn and no push in the reviewer's turn; the changed scenario fails on unchanged `main`.
10. The delivery model (`.claude/skills/verify-decision-delivery/SKILL.md`) passes unchanged.
11. Docs: ai-sdlc has the `### Publishing` subsection (with the authorization and ack rules), the new no-browser sentence and the phase 3 conflict sentence; the Jarvis phase table and Roles table match decisions 5 and 8; ADR 0023 exists; `BACKGROUND.md` and the RUNBOOK kickoff template are untouched.
12. `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD` pass; no comments added to source (`comment-ratchet.json` unchanged or lower).

## Test level

Unit for the store, roles and board text (`mission-console/store.test.mjs`, `roles.test.mjs`, `command-center/card.test.mjs` for the idle text); the lifecycle model for the phase rules; `command-center/serve.test.mjs` for the start; the e2e scenario for the end-to-end path. Red is written first by a separate test author.

## Run decisions

- Before and after (r2-ba): no capture. The PR shows the red run, the green run and `node e2e/run.mjs` output as text.
- Architecture diagram: yes, a Mermaid state diagram of publishing's exits in the PR body: `publishing` to `ci` on `pr-opened`, to `building` on `return-to-build`, to `diagram` and back on `diagram-start`/`handoff`, plus `blocked` and `replan`. Registered as a `diagram` artifact.
- PUB-1's own PR opens under the factory on `main` today, so its publishing step still needs a Jarvis chat (the installed skills and Command Center run from the primary checkout). The new publisher applies to stories after this merges.

## Out of scope

- A new persona or badge for publishing.
- Daemon auto-start of the publisher; Jarvis staffs it.
- Any sweep for stories already waiting in publishing.
- Uploading images to GitHub without a browser, or any other file host.
- Edits to `BACKGROUND.md`, the RUNBOOK kickoff template, `command-center/coordinator.mjs`, and decision delivery (IDLE-1, DLV-1, CHK-1 own those).

## Overlap

IDLE-1 (BACKGROUND.md, RUNBOOK kickoff, `coordinator.mjs`), DLV-1 (decision delivery) and CHK-1 (`pr-ready` in `store.mjs`) run in parallel and are not yet on GitHub. This story touches `store.mjs` only in `workerPhases` and the `return-to-build` guard. Merge `origin/main` before publishing.

## Context pack

The scout's full context pack is registered on the story: `C:/Users/trojanmini/.ai-sdlc/stories/PUB-1/context-pack.md` (scouted at `origin/main` 17bdf35). It holds the evidence table, the facts above with file and line, the commands and the risks. It is copied into this spec when the spec is committed as `docs/specs/story/pub-1-publishing-worker.md`.

Commands: focused `node --test mission-console/store.test.mjs mission-console/lifecycle-model.test.mjs mission-console/roles.test.mjs command-center/serve.test.mjs`; full `node --test`, then `node e2e/run.mjs`; secrets `gitleaks git --no-banner --log-opts=origin/main..HEAD`.

## Plan critique

Codex refused the run (usage limit until 30 November 2026) and no other provider is installed, so this is a single-provider review by one independent Claude reviewer, not a cross-model panel. Findings checked against the code: (1) the leftover `comparison-choice` is delivered to the publisher after it releases (`console-service.mjs:107`), settled by decision 11; (2) `question` must precede `blocked` (`store.mjs:154`), fixed in decision 2; (3) a merge conflict can loop, settled by decision 12; (4) the RUNBOOK kickoff template says no PR unless the phase allows it (`RUNBOOK.md:123`), so the Publishing subsection states that this phase authorizes push and `gh pr create`; (5) the e2e red mechanism is corrected above.


---

# Context pack

# PUB-1 context pack: a publishing worker opens the pull request

Scouted by Black Widow on 2026-11-26 at origin/main 17bdf35, read-only. The brief is C:/Users/trojanmini/.ai-sdlc/stories/PUB-1/brief.md.

## Summary

One set gates all of it. `workerPhases` in `mission-console/store.mjs:8` has no `publishing` entry. That one omission makes `serve.mjs start` refuse a publishing worker (`command-center/serve.mjs:63`, "The publishing phase has no worker to start.") and makes the store refuse `assign-worker` there (`store.mjs:251`). Adding `publishing` to that set is the core fix. The rest is: who the worker is on the card, how it hands back on failure, and the skill text that tells Jarvis to staff it and tells the worker what to do.

## Claims in the brief, checked against the code

| Brief claim | Verdict | Evidence |
|---|---|---|
| `serve.mjs start` refuses a publishing worker | True | `serve.mjs:63`, through `workerPhases` |
| The background Jarvis may not push | True | `skills/jarvis/BACKGROUND.md:19` |
| Five stories stalled in publishing | Seen live | IDLE-1 is in `publishing` now with "Action for you: ... no background worker can start there", answered "Ask the main Jarvis chat to open a PR" (events 2898, 2903) |
| Restricted workers get `git`, `gh`, `node` and gate tools | True | `adapters/harnesses.mjs:153-161` (`workerSettings`). This repository's profile has `workerPermissions: unrestricted` anyway |
| `roles.mjs` holds the phase roles and lanes | True | `roles.mjs:43-62`; publishing is `['coordinator', 'Open pull request', 'Ship', 'PR']` |
| `store.mjs` controls who records in publishing | True, with details below | |
| IDLE-1 #66, DLV-1 #47, CHK-1 #52 are open | Not on GitHub | `gh pr list` shows no open PRs and their branches are not pushed. Plan on merging main at publish time |

## Facts the plan rests on

1. **Role.** Publishing maps to `coordinator` (`roles.mjs:56`). `assign-worker` stores `phases[phase][0]` as the worker role (`store.mjs:256`), so a staffed publisher would show Jarvis's badge and "Coordinator assigned." `red` and `retro` already have coordinator-role workers, so this works, but it reads as "Jarvis is pushing", against the settled rule that Jarvis stays read-only. A new role needs a full badge (`roles.test.mjs:31-40`: fill, accent, ink with 3:1 contrast, glyph and move paths, motion, distinct from the others). Hawkeye (`watcher`) already pushes branch fixes in `pr-review`.
2. **Exit.** Publishing has no `handoff`: `transitions` has no entry for it (`store.mjs:9-18`). The exit is `pr-opened` (`store.mjs:390`), which moves the story to `ci`. Any phase change refuses while a worker is assigned (`store.mjs:619`), so the publisher must record `release-worker`, then `pr-opened`. `pr-opened` wakes Jarvis (`wakes`, `store.mjs:22`), which staffs Hawkeye for `ci`.
3. **Failure path.** `return-to-build` is accepted only from review, gates, comparison and pr-review (`store.mjs:343`). The brief's "hand back to build" from publishing needs a store change. `replan`, `blocked` and `question` already work in publishing. After `return-to-build` the story runs building, gates, mutation, review, comparison-choice and publishing again; the reviewer records `comparison-choice` from the spec, so the owner is not asked twice.
4. **Activity.** `activity` is already accepted in publishing (`store.mjs:204`), and `artifact` needs the current assignment.
5. **Diagram.** `diagram-start` is accepted from publishing, ci or merge (`store.mjs:328`) and returns to the phase it left. It changes the phase, so it is refused while a publisher is assigned. The order of diagram and publisher must be settled.
6. **Worker start and models.** `startWorker` passes the phase; `AI_SDLC_ACTOR=jarvis` is set only when the phase argument is the literal `'coordinator'` (`harnesses.mjs:228-231`), not by role, so a publishing worker's events are not marked as Jarvis's and do wake Jarvis. The publishing model tier already exists (`roles.mjs:85`, `skills/ai-sdlc-setup/scripts/preflight.mjs:13`). `adapters/harnesses.mjs` likely needs no change.
7. **Dashboard text.** `command-center/ui/app.js:155` says publishing is "waiting on release pipeline before the PR opens". That is stale once a worker exists.
8. **Skills.** `skills/jarvis/SKILL.md:77` (phase table row 8) lists `pr-opened` but no worker. `BACKGROUND.md` rules forbid Jarvis to commit or push, which stays. `RUNBOOK.md:110-124` is the kickoff template; `RUNBOOK.md:30` says "Other unassigned phases still require Jarvis to staff the next role". `skills/ai-sdlc/SKILL.md` section 8 already says how to update the branch, write the description, and handle screenshots without a signed-in browser: "give the comparison in words, open the pull request, and tell the owner which files to drop into the description and where they are." It has a "### PR review" subsection that a "### Publishing" subsection could mirror. The installed copy at ~/.claude/skills/ai-sdlc links to the primary checkout C:/repos/software-factory, so skill edits reach workers only after merge.
9. **E2E.** `e2e/scenarios/story-to-pull-request.mjs` today has the reviewer's turn push the branch, run `gh pr create` and record `pr-opened` after `comparison-choice` (lines 121-127): the very workaround this story removes. Both drivers, the scripted Jarvis (`e2e/scripted.mjs:86`) and the scenario's `drive()` (line 167), staff any phase in `workerPhases`. Without the fix `serve start` is refused, `scripted.mjs:61` swallows that refusal, and `drive()` throws "The worker ended its turn in publishing with nothing for the owner or Jarvis to do". So moving the PR steps into a publishing turn fails without the fix and passes with it.
10. **Models.** The lifecycle model (`mission-console/lifecycle-model.mjs`) drives the real store; its test asserts a worker exists only in a `workerPhases` phase (`lifecycle-model.test.mjs:39`) and that every event in the Jarvis phase table is accepted in that row's phases. The delivery model (`command-center/delivery-model.mjs`) has no phase list; it should pass unchanged but is run because worker starts change.

## Conventions that apply

- AGENTS.md: `node --test` before committing; no package dependencies; no comments in source files (`comment-ratchet.json`); no personal names or real work details in skills ("the owner"); harness-specific code only under `adapters/`; phase changes update store transitions, `roles.mjs` and the Jarvis phase table together; worker-start changes get an e2e scenario that fails without the fix.
- Profile: gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; spec at `docs/specs/story/pub-1-publishing-worker.md` as the first commit; pipeline "Tests" runs `node e2e/run.mjs`; team rule: reply to every PR comment before resolving it.
- ADR: next free number at publish time (0026: 0023 to 0025 were taken first), only if the change needs a reason the code cannot show.

## Commands

- Focused: `node --test mission-console/store.test.mjs mission-console/lifecycle-model.test.mjs mission-console/roles.test.mjs command-center/serve.test.mjs`
- Full: `node --test`, then `node e2e/run.mjs`
- Secrets: `gitleaks git --no-banner --log-opts=origin/main..HEAD`

## Similar earlier changes

- PRR-1 (#43) added the `pr-review` phase with a Hawkeye worker, a "### PR review" section in ai-sdlc, a phase-table row and lifecycle-model properties.
- DIAG-1 (#68) narrowed `diagram-start` to publishing, ci and merge.
- E2E-1 (#45) added the scripted-worker scenarios.

## Risks

- IDLE-1, DLV-1 and CHK-1 edit BACKGROUND.md, the RUNBOOK kickoff template, `coordinator.mjs` and `store.mjs` in parallel. Keep those edits small and merge main before publishing.
- Stories already sitting in publishing (IDLE-1 now) get no new wake when this ships; IDLE-1's own change may cover unstaffed stories.
- A replacement publisher after a crash could open a second PR unless it first checks for an existing one on the branch (`gh pr list --head <branch>`).
- Codex restricted workers run in a workspace-write sandbox; whether `git push` works there is untested. This repository's profile is unrestricted.

## Proposed round-1 frontier for the planner

1. Persona: Hawkeye (`watcher`) staffs publishing, or a new role with its own badge, or keep `coordinator`.
2. Who starts it: Jarvis through BACKGROUND.md and RUNBOOK (as the brief says), or a daemon auto-start like the test author's.
3. Merge conflict or a story-caused gate failure: allow `return-to-build` from publishing; a gate that also fails on main becomes `blocked` with a question.
4. Screenshots: the section 8 fallback (comparison in words, local paths listed in the PR body, Command Center already shows the artifacts), without a "Done" action question.
5. Diagram order: Jarvis records `diagram-start` before staffing the publisher when the spec asks for a diagram.
6. Retries: the publisher checks for an existing PR on the branch before creating one.
7. The foreground Jarvis chat also starts the publisher instead of opening PRs itself.
8. E2E: change the existing scenario so a publishing turn opens the PR, rather than adding a second scenario.
9. Run decisions: architecture diagram none (the phase flow does not change); before-and-after depends on question 1.
