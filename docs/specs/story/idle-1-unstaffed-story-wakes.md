# IDLE-1 plan: a story with nobody working on it is never left silently idle

Work item: https://github.com/Ramanathan10/software-factory/issues/66. The pull request closes it with "Closes #66".
Branch `story/idle-1-unstaffed-story-wakes`, worktree `C:/repos/software-factory-worktrees/story/idle-1-unstaffed-story-wakes`, base origin/main 88b9cce.
Context pack: `~/.ai-sdlc/stories/IDLE-1/context-pack.md`.

## Problem

On 2026-11-26 DIAG-1 sat in planning for over an hour with no worker, every question answered and nothing pending. The scout released, handed off, then kept planning while unassigned. The background Jarvis twice acked the news without staffing: first because questions on the story looked like a planner, then because `serve.mjs deliver` answered it `told: "coordinator"`. Nothing was left to wake anyone, and the card showed no sign.

Root causes, confirmed in the code:
1. `coordinator.needs` and `check` (`command-center/coordinator.mjs:58-68`, `:208-223`) look only at pending news, so an unstaffed story with no news is never looked at again.
2. `deliverPending` (`command-center/console-service.mjs:107-111`) passes on `onDecision`'s `'coordinator'` (`command-center/serve.mjs:193-194`) to the caller, who is Jarvis itself.
3. `skills/jarvis/BACKGROUND.md` never says how to tell a story has no worker and lets Jarvis ack any handled news.
4. The RUNBOOK kickoff template does not tell a released worker to stop, says the worker "records the scout summary in `draft-plan`" (impossible without a release: every phase change needs one, `store.mjs:619`), and the models paragraph says "the scout may continue planning".

## Settled decisions (owner's answers, round 1)

1. Safety net: the coordinator wakes Jarvis itself. No new event type, no change to `mission-console/store.mjs`.
2. One wake per idle spell, then an action question on the card; Hold stops, Done gives one more turn.
3. Stories already stuck when this ships each get their one wake on the first start.
4. `deliver` with no worker replies `told: "nobody"` with a reason, changed in `deliverPending` only.
5. Root cause 4: skill text only, no store guard.
6. Per-turn scripted Jarvis in the e2e rig, a DIAG-1 scenario that fails on main, and an ADR.
7. No before-and-after, no architecture diagram.

## Changed since round 1 (from the cross-model plan critique; approve or send back)

The plan critique (Codex gpt-6-sol and a separate Claude reviewer) found defects in how round 1's answers were to be built. The behavior you chose stays; three mechanisms change:
1. **The "already woken" mark.** Round 1 said the wake would be recorded as `jarvis-woken` with `handled` set to the story's latest seq. Both reviewers showed this can give two wakes in one spell (when the spell's first event is the story's latest, for example a story with only `create`). Now: `jarvis-woken` keeps `handled` as it is, and the daemon writes a fixed marker phrase into the `jarvis-turn-ended` detail of a no-news turn. A spell counts as woken once such a turn ended after its start. Still no store change and no new event type.
2. **No "released process still running" check.** Round 1's stuck definition waited for a released worker's process to exit. The supervisor keeps that private, and a hung released process would then block the wake forever, which is the silent idle this story fixes. A released process that is still writing keeps resetting the quiet period anyway, so the check is dropped.
3. **`deliver`'s reply** says `nobody` only when no worker is assigned (`onDecision` also says `coordinator` for an answer to an `action-jarvis-` question on a staffed story), and its reason no longer claims nobody was told, because the background Jarvis is nudged on that path.

## Design

### Stuck

A story is stuck when all of these hold:
- its harness runs command-line workers;
- its phase is a worker phase (`workerPhases`, `store.mjs:8`) other than `ci`;
- it has no worker, is not blocked and has no cleanup;
- no Jarvis turn is running or waking, and no worker start is in flight (`busy`);
- every question on it is answered (an open `action-jarvis-` question counts);
- it has no news newer than `jarvis.handled` (news as `needs` computes it today);
- it has had no event for the quiet period (`quietMs`, 10 s).

### Idle spell, the one wake, and the action

The idle spell starts at the story's latest event that is not Jarvis's own (`by: "jarvis"` or a `jarvis-` type) and is not an answer to an `action-jarvis-` question.

- **Quiet after Hold.** If any `action-jarvis-` question asked since the spell start was answered Hold, nothing happens: no wake, no question. This covers Hold on today's failure question too (`coordinator.test.mjs:245`, `e2e/scenarios/background-jarvis-turn-fails.mjs`).
- **The one wake.** If the story is stuck and no no-news turn has ended since the spell start, the coordinator wakes Jarvis: it records `jarvis-woken` with `handled` unchanged (`story.jarvis.handled ?? 0`), and the kickoff replaces the news line with "No news: nobody is working on <story> in <phase>: no worker, nothing pending, no open question. Staff it, or record blocked or a question." When that turn ends, its `jarvis-turn-ended` detail starts with a fixed phrase ("No-news turn"), whatever the outcome. A failed or lost no-news turn posts today's failure question as now.
- **The action.** If the story is still stuck, a no-news turn has ended since the spell start, and no question is open, the coordinator posts an `action-jarvis-<seq>` question: "Action for you: nobody is working on <story> in <phase>, and Jarvis's turn did not staff it. Start a worker or tell Jarvis what to do, then choose Done." The options are the existing Done and Hold. `ask()` takes the prompt as a parameter; the failure prompt stays as it is.
- **Done** is news, so Jarvis gets one turn as today; if the story is still stuck after it, the action is posted again. **Hold** is acked as today and nothing more happens until a new event starts a new spell.
- **Restart.** The mark is a stored event, so a restart neither repeats nor loses the wake. One edge: if the daemon restarts while a no-news turn is running, the adopted turn ends with the generic detail, so a second no-news wake follows; that is bounded and never a loop. Stories stuck at the first start after merge (such as DIAG-1) get their one wake.

### deliver's reply

`deliverPending` returns `{ story, seqs, told: "nobody", reason }` when the story has no worker and `hand` reports `'coordinator'`. The reason: "No worker is assigned to <story>, so no worker was told; the decisions stay pending. Staff the phase, then deliver." With a worker assigned, the reply is unchanged. `onDecision`, `hand` and the dashboard batch path keep `'coordinator'`, so the delivery model's states do not change.

### Skill text

- `skills/jarvis/BACKGROUND.md`: read `worker` in the handover; questions or a draft plan never mean a worker is assigned; never ack a release, handoff or decision while the phase has no worker unless this turn started one or recorded `blocked` or a question; a `deliver` reply of `nobody` means nothing was delivered; a no-news wake means staff the phase or record why not.
- `skills/jarvis/RUNBOOK.md`: kickoff template gains "Release only to change phase: record `release-worker`, then the one event that changes the phase (`handoff`, or `plan` for the planner, since the store refuses a phase change while a worker is assigned: `store.mjs:619`), then end the turn and record nothing more"; "The worker scouts the repository itself and records the scout summary in `draft-plan`" becomes "the scout records its summary in its handoff and ends its turn; Jarvis starts the planner, whose `draft-plan` opens with it"; "the scout may continue planning" is reworded; "Background Jarvis" describes the no-news wake and its action question; "Message a worker" documents the `nobody` reply with its reason.
- `skills/ai-sdlc/SKILL.md` phase 1 Scout: under the Command Center, the scout's handoff carries the context pack summary and ends its turn; the planner opens the draft plan.
- `.claude/skills/verify-decision-delivery/SKILL.md`: update the "does not cover" note on the `coordinator` reply.
- ADR (next free number at publish) amending 0012 and 0019: a story with no news may wake Jarvis once per idle spell, why the exclusions are what they are, and why the mark lives in `jarvis.handled`. ADR 0002's reply list notes the `/api/deliver` wording.

## Acceptance criteria

1. A command-line story that is stuck (definition above) gets exactly one Jarvis wake per idle spell, whose kickoff says nobody is working on it. A daemon restart between turns does not repeat it.
2. If that turn ends with the story still stuck, an `action-jarvis-` question with the stuck wording appears on the story. Hold (on this question or on a failure question): no further wake or question until a new event. Done: one more turn, then the question again if still stuck.
3. No no-news wake for a story in `ci`, in a non-worker phase, with a worker, blocked, awaiting cleanup, with an open question, with a start in flight, with unhandled news, or within the quiet period.
4. `serve.mjs deliver <story>` with no worker prints `told: "nobody"` and the reason; the decisions stay pending. With a worker assigned the reply is unchanged.
5. BACKGROUND.md, RUNBOOK.md and ai-sdlc phase 1 carry the rules above.
6. `e2e/scenarios/released-scout-keeps-planning.mjs` replays DIAG-1 (scripted scout releases, hands off, records a draft plan and questions with no assignment, as DIAG-1's scout did, which the store accepts because `undefined === undefined` at `store.mjs:168`; scripted Jarvis acks without staffing; owner answers; scripted Jarvis acks again) and passes only if the story ends with a worker or an open `action-jarvis-` question, with no further wakes after Hold. It fails on main.

## Tests and checks

- Test level: unit tests in `command-center/coordinator.test.mjs` (its fake launch and adapters) for each criterion 1-3, including restart (a new coordinator over the same database), Hold, Done, each exclusion, and the two-wake edge; `command-center/console-service.test.mjs` and `serve.test.mjs` for criterion 4. Assertions that change: `coordinator.test.mjs:186`, `serve.test.mjs:122` and `:263` (`told: "coordinator"` through `requestDelivery` becomes the new reply). Coordinator tests that end a Jarvis turn and leave a worker phase unstaffed now also get the no-news wake, which is the intended behavior: `:122-132` (news given to a finished turn is not repeated), `:176-190` once its answer is handled, the adopted-turn test near `:396`, and any other the test author finds. Each keeps its own point by staffing or asking in the scripted turn, or by counting the extra wake explicitly.
- e2e: `e2e/scripted.mjs` gains per-turn scripted Jarvis steps from the scenario's playbook, falling back to today's policy; the new scenario as in criterion 6.
- Red: the test author (a separate subagent) writes the unit tests and the scenario first; they fail on the unchanged code.
- Checks: `node --test`; `node e2e/run.mjs`; the delivery model per `.claude/skills/verify-decision-delivery/SKILL.md` (`node --test command-center/delivery-model.test.mjs command-center/approval-model.test.mjs`), since `deliver` and how Jarvis is woken change; gitleaks per the profile. No store or phase change, so the lifecycle model is not required; run it anyway if the diff touches `store.mjs`.

## Files

`command-center/coordinator.mjs` (stuck, spell, wake with a reason, stuck question), `command-center/serve.mjs` (kickoff reason line for a no-news wake), `command-center/console-service.mjs` (`deliverPending` reply), their tests, `e2e/scripted.mjs`, the new scenario, `skills/jarvis/BACKGROUND.md`, `skills/jarvis/RUNBOOK.md`, `skills/ai-sdlc/SKILL.md`, `.claude/skills/verify-decision-delivery/SKILL.md`, `docs/adr/`, and the spec at `docs/specs/story/idle-1-unstaffed-story-wakes.md` as the first commit.

DLV-1 (#47) changes `coordinator.mjs`, `serve.mjs`, `console-service.mjs` and `e2e/scripted.mjs` in parallel: edits there stay small, and main is merged before publishing.

## Out of scope

#49, #54, #55; waiting for a released worker's process to exit; a store guard on events from released sessions; a new card badge; any change to `mission-console/store.mjs` or the phases.

## Run decisions

Before-and-after: none. Architecture diagram: none. Implementation level full; 3 review rounds; cross-model review authorized; gates `node --test` and gitleaks; pipeline Tests runs `node --test` and `node e2e/run.mjs`; no review bot.

## Plan critique

Codex (gpt-6-sol; the profile's gpt-6.1-sol and gpt-6.2 are refused for this account) and a separate Claude reviewer each read the brief and this plan's first draft. Findings and what changed: two wakes per spell from the `handled` mark (both; marker moved to the turn-ended detail); Hold did not stop the no-news wake (Claude; Hold rule added); `nobody` was wrong when a worker is assigned, and "nobody was told" was untrue (both; reply decided on no worker, reason reworded); the released-process check was private to the supervisor and a hung process would block the wake (Claude; dropped); three more coordinator tests change (Claude; listed); the scripted draft plan after release would be refused if it carried an assignment (Codex; scenario omits it, as DIAG-1 did).


## Context pack

### IDLE-1 context pack (Black Widow, scout)

Story: a story with nobody working on it is never left silently idle. Brief: `~/.ai-sdlc/stories/IDLE-1/brief.md`.
Worktree `C:/repos/software-factory-worktrees/story/idle-1-unstaffed-story-wakes`, branch `story/idle-1-unstaffed-story-wakes`, base origin/main 88b9cce. Clean.

## Rules that apply

- AGENTS.md: no source comments (comment ratchet), no package dependencies, store and Command Center harness-neutral, harness-specific code under `adapters/`, no personal names or real work details in tracked files, `node --test` before committing.
- A change to how decisions reach a worker or how Jarvis is woken: run `.claude/skills/verify-decision-delivery/SKILL.md` (`node --test command-center/delivery-model.test.mjs command-center/approval-model.test.mjs`) and `node e2e/run.mjs`. A live bug gets an e2e scenario that fails without the fix (`e2e/README.md` "A bug becomes a scenario"). A bug only a model's choices show is fixed in the skill that misled it.
- A change to `mission-console/store.mjs`, the phases in `roles.mjs` or the Jarvis phase table also runs `.claude/skills/verify-story-lifecycle/SKILL.md`. The recommended design below avoids the store.
- ADRs: next free number at publish time (0024: DLV-1 took 0023). Only if the change needs a reason the code cannot show. ADR 0012 (Jarvis woken only for news) and ADR 0019 (background Jarvis woken for news) are the decisions this story amends: a story with no news can now wake Jarvis once.
- Profile: gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; spec at `docs/specs/story/idle-1-unstaffed-story-wakes.md` (as DLV-1 did) as the first commit; pipeline "Tests" runs `node --test` and `node e2e/run.mjs`; no review bot; before-and-after and diagram: ask, recommend none; cross-model review authorized; implementation level full; 3 review rounds; reply to every PR comment before resolving.

## Root causes, confirmed against the code

1. **No safety net (confirmed).** `command-center/coordinator.mjs:58-68` `needs(story, pending)` builds its result only from `pending` events. `check()` (`:208-223`) wakes only when `unhandled(story, news)` is non-empty. Once Jarvis acks the last pending event, a story in a worker phase with no worker produces no news and is never looked at again. `waiting()` (`:199-207`), which drives the board's "Waiting on Jarvis", is built from the same news, so the card shows nothing either.
2. **`deliver` says "coordinator" to the coordinator (confirmed).** `serve.mjs deliver` → `requestDelivery` → `/api/deliver` → `console-service.mjs:107-111` `deliverPending` → `hand` (`:87-99`) → `onDecision` (`serve.mjs:179-200`). For a command-line story with no worker, `serve.mjs:193-194` nudges the coordinator and returns `'coordinator'`; `deliverPending` returns `{ story, seqs, told: 'coordinator' }` and the CLI prints it. That answer is right for the dashboard's batch path (the decision goes to the background Jarvis) but wrong when the caller is the background Jarvis itself: it reads "coordinator" as handled. `hand` already releases the seqs from `sent` when `told !== 'worker'`, so the decisions stay pending; the defect is only the reply's wording. RUNBOOK "Message a worker" documents only `worker` or `nobody` as replies.
3. **BACKGROUND.md lets Jarvis infer staffing (confirmed).** `skills/jarvis/BACKGROUND.md` step 2 says "a decision with no worker: ... start a replacement", but nothing says how to tell there is no worker, and step 5 allows acking any handled news. Nothing forbids acking a release, handoff or decision while the phase is unstaffed.
4. **Kickoff does not tell a released worker to stop (confirmed).** RUNBOOK "Story worker kickoff template" (`skills/jarvis/RUNBOOK.md:110-121`) says "After posting questions or a plan, end the turn" but not "after releasing, end the turn". The RUNBOOK "Background Jarvis" paragraph on models says "the scout may continue planning", which a scout reads as licence to keep going after its handoff. The store makes this unavoidable to get wrong: a phase-changing `handoff` requires `release-worker` first (`store.mjs:612-614`), and `draft-plan`, `question`, `activity` with no `assignment` pass the `input.assignment === story.worker?.id` check when there is no worker (`undefined === undefined`), so a released session can keep writing. This very story's own kickoff ("Record a handoff with the context pack, then interview with question events, then a draft-plan") prescribes the DIAG-1 sequence; this scout therefore stops after its handoff.

## DIAG-1 timeline, read from the live store

1751 artifact (scout) · 1752 release-worker · 1753 handoff → planning · 1757 draft-plan (no worker) · 1759-1762 four questions (no worker) · 1764 jarvis-woken (handled 1762) · 1769 turn ended, no `start` · 1896-1899 four answers · 1900 jarvis-woken (handled 1899) · 1902 turn ended, no `start`. Nothing after: no worker, no plan, nothing pending.

Observed at scout time (about 15:05), not confirmed stuck: RDY-1 was in `review` with no worker, and its Jarvis turn (1976-2058) had ended at 15:03:44 with no `assign-worker` after it. Not this story's to touch.

## Relevant files and entry points

- `command-center/coordinator.mjs`: `needs`, `unhandled`, `waiting`, `check`, `wake`, `ask`/`notice` (`action-jarvis-<seq>` question, "Done" gives one more turn, "Hold" none; an open notice blocks every wake), `worked`, `settle`.
- `command-center/serve.mjs`: `deliver`, `onDecision` (`:179-200`), `jarvisKickoff` (`:106-117`, lists news seqs), `startStoryWorker`.
- `command-center/console-service.mjs`: `hand`, `deliverPending`, `/api/deliver`.
- `mission-console/store.mjs`: `workerPhases` (`:8`), jarvis turn events, `release-worker`, phase-change guard (`:612`).
- `mission-console/roles.mjs`: `phases` (role per phase; `red` is the coordinator's).
- `skills/jarvis/BACKGROUND.md`, `skills/jarvis/RUNBOOK.md` ("Story worker kickoff template", "Background Jarvis", "Undelivered decisions", "Message a worker"), `skills/jarvis/SKILL.md` step 4.
- `skills/ai-sdlc/SKILL.md` phase 1 "Scout": the text a scout reads; it says the context pack "opens the draft plan" but not who writes the draft plan.
- `e2e/scripted.mjs`: the scripted Jarvis follows one fixed policy (`coordinate`, `:79-91`): with no worker in a worker phase and every question answered, it starts the next worker. That policy cannot replay DIAG-1, where Jarvis acked without staffing; the scenario needs a way to script Jarvis turns.
- `e2e/scenarios/clean-handoff-with-no-jarvis-chat.mjs` and `worker-releases-before-asking.mjs`: closest existing scenarios.
- Tests: `command-center/coordinator.test.mjs` (fake launch/adapters, `requestDelivery` asserts `told: 'coordinator'` at `:186`), `command-center/serve.test.mjs` (`:122`, `:263` assert `told: 'coordinator'`), `command-center/console-service.test.mjs`.

## Which unstaffed phases are normal

`ci` with no worker is a normal waiting state: Hawkeye observes the PR and `pr-observed` brings news (ARC-1 sat in `ci` with no worker, correctly). `approval`, `comparison-choice`, `publishing`, `merge` and `closed` are not in `workerPhases`. `testing` with a pending `approve` is started by the daemon itself. Every other worker phase (`scout`, `planning`, `testing`, `red`, `building`, `gates`, `mutation`, `review`, `comparison`, `diagram`, `retro`, `pr-review`) with no worker, no running start, no Jarvis turn, no open owner question, not blocked, not awaiting cleanup and nothing pending is stuck.

## Similar earlier changes

- WAKE-1 (#41, ADR 0019): the background Jarvis and the `action-jarvis-` notice.
- E2E-1 (#45, ADR 0022): the e2e rig and scripted workers.
- DLV-1 (#47, in flight on `story/dlv-1-resume-after-release`): changes `hand`, `deliver`, `onDecision`, `messageWorker` and adds an in-memory set of seqs owed to Jarvis in `coordinator.mjs` `check`. Overlaps this story in `coordinator.mjs` (`needs`/`check`) and lightly in `serve.mjs`/`console-service.mjs`. Keep this story's edits there small and merge main before publishing.

## Commands

- Focused: `node --test command-center/coordinator.test.mjs command-center/serve.test.mjs command-center/console-service.test.mjs`
- Delivery model: `node --test command-center/delivery-model.test.mjs command-center/approval-model.test.mjs`
- Full: `node --test`; `node e2e/run.mjs` (both harnesses, about three minutes); `node e2e/run.mjs Codex <scenario>` for one.

## Risks

- A wake for a story with no news must not loop: it needs a durable "already woken for this idle spell" mark that survives a daemon restart, or it re-wakes every poll.
- A false positive wakes Jarvis on a story that is legitimately waiting (ci, a start in flight, an approval being auto-started, a worker turn just ended and its `turn-ended` not yet recorded). The quiet period (`quietMs`) and the exclusions above cover these.
- DLV-1 lands first and changes the same functions; expect a merge.
- The scripted-Jarvis extension in `e2e/scripted.mjs` touches a file DLV-1 also changes.

## Constraints from the IDLE-1 kickoff the planner will not see

- The plan names `.claude/skills/verify-decision-delivery/SKILL.md` and `node e2e/run.mjs`; the e2e scenario replaying DIAG-1 must fail without the fix.
- DLV-1 changes `serve.mjs`, `console-service.mjs` and `coordinator.mjs` in parallel: keep this story's edits there small; merge main before publishing.
- No GitHub issue exists; do not file one. The pull request describes the change.
- The profile's printed worktreeRoot is wrong; the real root is `C:/repos/software-factory-worktrees`.
- The live database (`~/.ai-sdlc/console/jarvis-missions.sqlite`) takes IDLE-1 writes only. A test or demo Command Center uses its own port and database. Never stop the Command Center on port 4174.
- Stay inside the area: coordinator.mjs, serve.mjs, console-service.mjs, BACKGROUND.md, RUNBOOK.md, e2e/scenarios (plus the e2e scripted Jarvis the scenario needs). Other stories run in parallel (DLV-1, MD-1, DIAG-1, AZ-1, PRIV-1, RDY-1, INST-1, HDR-1).
- Ask the owner only through console `question` events, while assigned. After questions or the plan, end the turn.

## Design traps

- `wake()` sets `handled` to `Math.max(...news.map(event => event.seq))`. With no news that is `-Infinity`, and the store refuses `jarvis-woken` unless `handled` is an integer >= 0. `jarvisKickoff` lists news seqs; a wake with no news needs a stated reason in the prompt instead.
- The `action-jarvis-` notice's "Hold" only acks the answer. Once the notice is answered, a stuck-story check would fire again on the next poll: a wake loop. "Hold" must durably suppress the stuck wake for that idle spell, and the "once" mark must survive a daemon restart.
- DIAG-1's first wake fired while the released scout's process was still running and writing. `supervisor.idle(id)` already waits for released turns. Decide whether the stuck check waits for a released worker's process to exit.
- Tests that encode root cause 2 and will change: `coordinator.test.mjs:186` and `serve.test.mjs:122`, `:263` assert `told: 'coordinator'` through `requestDelivery`; the verify-decision-delivery SKILL's "does not cover" bullet describes the same reply.

## Open decisions for the planner

1. Shape of the safety net: wake directly from the coordinator with no new event type (recommended), or have the daemon record a new pending event (store and lifecycle-model change).
2. What the owner sees when Jarvis's extra turn still leaves the story unstaffed: reuse the `action-jarvis-<seq>` question ("Done" gives one more turn, "Hold" none) (recommended), or a new card badge.
3. Wording and shape of `deliver`'s reply with no worker: `told: 'nobody'` plus a `reason` field, changed only on the `/api/deliver` path so the dashboard batch path and the delivery model stay as they are (recommended).
4. Root cause 4: skill text only (recommended), or also make the store refuse planning events from a session with no assignment (brief: out of scope unless smaller).
5. Run decisions: before-and-after (recommend none; the owner-visible action is an existing question type) and architecture diagram (recommend none).
