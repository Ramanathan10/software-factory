# MRG-1: a ready pull request that starts conflicting with main is seen, refused as ready, and sent back to build

Work item: none. Context pack: at the end. Branch `story/mrg-1-watch-pr-mergeability`, base `87becfc`. Spec: `docs/specs/story/mrg-1-watch-pr-mergeability.md`.

## Problem

Hawkeye's watcher reads a PR's checks and review but never whether it still merges. QFMT-1 sat in merge as "PR ready to merge" while GitHub reported its PR #93 CONFLICTING (mergeStateStatus DIRTY): BAA-1 merged into main a minute after background Jarvis recorded `pr-ready`. Nothing woke Jarvis, the store accepted readiness, and both dashboards kept saying ready. The owner and Jarvis lose the time it takes to notice by hand, and the Jarvis skill already claims Hawkeye observes merge status.

## Reproduction

On 97d775b, against live PR #93 (read only) and a throwaway store (evidence: `repro-output.txt` beside the context pack):

1. `gh pr view 93 --json mergeable,mergeStateStatus,headRefOid,state` answers OPEN, head 10a7552, CONFLICTING, DIRTY.
2. The real `watchOnce` with the real `readGitHubPr` on a story in ci observes `status: passed` with no mergeability field.
3. `pr-ready` with that head is accepted; the story moves to merge.
4. A second `watchOnce` returns `[]`: no event, no wake. The cards show "PR ready to merge".

## Root cause

- `mission-console/watcher.mjs:119` asks `gh pr view` for `url,state,headRefOid,statusCheckRollup` only, and `summarizePr` (19-45) returns head, status and failures.
- `observePr` in `mission-console/store.mjs` (108-144) stores and compares only those fields, so a conflict cannot change the observation, wake Jarvis or reach a card. `pr-ready` (407-420) never asks about mergeability.
- `return-to-build` (348) is refused from ci and merge, so even a Jarvis that noticed has no route back to the implementer.
- `command-center/coordinator.mjs:70` lets a `pr-observed` reach Jarvis past an assigned CI worker only for review feedback, merged or closed.

## Settled decisions

1. **mrg1-route:** "Building, through return-to-build from ci and merge". Jarvis releases any CI worker and records `return-to-build` naming the conflict; the implementer merges origin/main and resolves it, then gates, mutation, review and publishing run again, as for a conflict found while publishing.
2. **mrg1-ready-gate:** "Yes, refuse pr-ready on a conflicting head".
3. **mrg1-unknown:** "Never wakes, never blocks pr-ready, never replaces the last known answer". Planner's reading, for the owner to overrule at approval: the last known answer is kept only while the head is unchanged. A new head that reads unknown is unknown. Reason: carrying "conflicting" onto the head that resolves the conflict would refuse `pr-ready` on it and send the story back to build again in a loop.
4. **mrg1-behind:** "Show "Behind main" on the card; no wake, no block".
5. **mrg1-azure:** "Also map Azure mergeStatus conflicts after PRURL-1 lands".
6. **mrg1-card:** "Red tag "Merge conflict with main"; not shown as ready".
7. **mrg1-baa:** "Yes, screenshots of the card, throwaway Command Center".
8. **mrg1-diagram:** "No diagram".
9. Planner-settled: a conflict wake reaches Jarvis even while a CI worker is assigned, as review feedback does; a conflict seen during `pr-review` is stored but does not wake, and Jarvis's `pr-ready` after the PR review handoff is refused and routed to build (decision 1). Reason: the PR review worker owns the story then, and `return-to-build` from pr-review already exists.
10. Planner-settled: the observation field is `merge`, one of `conflicting`, `behind`, `clean`, or absent for unknown. Stored observations, other hosts and a missing or null answer read as unknown. A merged or closed observation drops `merge`.
11. Planner-settled, from the brief's "stay out of those lines": line 119's `--json` list is PRURL-1's line, so it changes only after PRURL-1 merges, and the story does not publish before then. If PRURL-1 is still open when everything else is green, the implementer records `blocked` naming PRURL-1 and a console `question` "PRURL-1 has merged: resume MRG-1?"; the owner's answer wakes the story through the normal decision path. The alternative is to change it now and resolve a one-line conflict when merging main; say so at approval to take it.
12. Planner-settled, the actor walk. Background Jarvis: the watcher records a conflicting `pr-observed` with `conflict: true` and `wake`; `needs` in coordinator.mjs passes it past an idle CI worker; the Jarvis turn reads the handover, releases the CI worker, records `return-to-build` (now allowed from ci and merge, `readyHead` cleared) and staffs the implementer, who merges origin/main, resolves, and runs testing through publishing; the publisher re-records `pr-opened` with the same URL (accepted today) and the story returns to ci on a new head, whose unknown `merge` does not block `pr-ready`. Chat Jarvis: the same wake arrives as news and it takes the same route. A `pr-ready` refused for the conflict takes the same route from ci.
13. Planner-settled: GitHub reports BEHIND only when the base requires branches to be up to date. This repository's main does (strict); elsewhere a behind PR reads clean and "Behind main" does not show.

## Fix

### mission-console/watcher.mjs

- `summarizePr` maps GitHub's answer to `merge`: `mergeable` CONFLICTING (or `mergeStateStatus` DIRTY) is `conflicting`; MERGEABLE with BEHIND is `behind`; MERGEABLE otherwise is `clean`; UNKNOWN, missing or null leaves `merge` out. Merged or closed PRs carry no `merge`. This is outside PRURL-1's lines.
- Line 119's `--json` list gains `mergeable,mergeStateStatus`, and the Azure DevOps reader maps `mergeStatus` `conflicts` to `conflicting`, `succeeded` to `clean`, anything else to unknown. Both touch PRURL-1's code, so they are done after PRURL-1 (#57) merges, with origin/main merged into the branch first. If PRURL-1 is still open then, decision 11 applies; the GitHub part is not published alone.

### mission-console/store.mjs

- `observePr` validates an optional `merge`. It keeps the previous `merge` when the new observation has none, the head is unchanged and the status is not merged or closed; a merged or closed observation stores no `merge`.
- `merge` gets its own comparison, outside the checks comparison, so behind, clean or unknown flips are stored for the cards but never trip the checks wake. The early `return null` also requires `merge` unchanged.
- New wake: in ci or merge, the stored `merge` becomes `conflicting` (from anything else, or on a new head). `observePr` returns `conflict`, and `record` writes `conflict: true` on the event beside `feedback` (store.mjs:627 and 647). The detail says "Merge conflict with main"; a behind observation's detail says "Behind main".
- `pr-ready` with a head is refused 409 "Merge conflict with main on the observed head." while the observation shows `conflicting`. Unknown and behind never refuse.
- `return-to-build` is accepted from ci and merge too, and clears `readyHead` as `pr-review-start` does. The tests that assert today's refusal change with it: `store.test.mjs:1205-1216` and the "return-to-build was accepted in ci or merge" check in `lifecycle-model.test.mjs:245-246`.

### command-center/coordinator.mjs

`forJarvis` also passes a `pr-observed` with `conflict: true`, so the wake reaches Jarvis while a CI worker is assigned.

### Cards: mission-console/console.mjs and command-center/ui/app.js

- `status()` in console.mjs checks for a conflict in ci or merge before the ready branch: the label is "Merge conflict with main", with `alert`, never "PR ready to merge"; "Behind main" is appended to the label as review labels are.
- app.js `phaseLabel` reads "Merge conflict with main" for a merge story with a conflict, so the avatar title and aria-label, the timeline and the detail header never say "PR ready to merge"; the idle reason no longer says it waits on approval and merge.
- app.js shows a red blocking tag "Merge conflict with main" and a neutral tag "Behind main" in ci or merge, whether or not review evidence exists (today `reviewState` returns null without a review). A merge card with a conflict does not read as ready.
- `command-center/clear.mjs:57` treats `readyHead` as the head to look for after a merge; a conflicting PR cannot merge, so it is left alone. The implementer confirms no other reader treats `readyHead` as "can merge".

### Skills and docs that restate the PR phase (changed together)

- `skills/jarvis/SKILL.md` row 8: after the `pr-ready` refusals, add: when it is refused for "Merge conflict with main", or a `pr-observed` arrives with `conflict: true`, release any CI worker, record `return-to-build` saying "merge origin/main and resolve the conflict", and staff the implementer. Line 61 and the Hawkeye row stay true.
- `skills/jarvis/RUNBOOK.md` Hawkeye wakes paragraph (134): a conflict wake reaches Jarvis while a CI worker is assigned, and its route.
- `skills/jarvis/BACKGROUND.md` step 2 gains a bullet: "A `pr-observed` with `conflict: true`, or a `pr-ready` refused for "Merge conflict with main": release any CI worker, record `return-to-build` saying "merge origin/main and resolve the conflict", and staff the implementer."
- `skills/ai-sdlc/SKILL.md:102`: "A story returned from publishing, ci or merge with a merge conflict starts by merging the remote default branch ...".
- `mission-console/README.md`: `return-to-build` row allows ci and merge; `pr-ready` row names the conflict refusal; `pr-observed` row describes `merge`, unknown, behind and the conflict wake.
- `e2e/README.md`: the stand-in's per-PR checks and mergeability, if it lists stand-in features.
- `.agents/skills/verify-story-lifecycle/SKILL.md`: new property rows, new state numbers, coverage commit moved forward.

## Acceptance criteria

1. The reproduction no longer fails, shown with the gh stand-in, not live #93: a story in merge whose PR reports CONFLICTING gets a `pr-observed` with `conflict: true` that reaches Jarvis, and its card shows "Merge conflict with main", not "PR ready to merge".
2. `summarizePr` maps CONFLICTING or DIRTY to `conflicting`, MERGEABLE with BEHIND to `behind`, other MERGEABLE to `clean`, and UNKNOWN, missing or null to no `merge`.
3. An observation with no `merge` on an unchanged head keeps the stored `merge`; on a new head it stores none.
4. In ci or merge, becoming `conflicting` wakes, with `conflict: true`, even with a CI worker assigned. Becoming behind, clean or unknown never wakes, including on a passed PR whose previous status was passed.
5. In pr-review a conflict is stored and does not wake.
6. `pr-ready` with the observed head is refused with "Merge conflict with main on the observed head." while `merge` is `conflicting`, and accepted when it is behind, clean or absent and every other gate holds.
7. `return-to-build` is accepted from ci and merge (after `release-worker` when a worker is assigned) and clears `readyHead`.
8. Both dashboards show the red "Merge conflict with main" tag and no text, title or aria-label says "PR ready to merge" while the conflict shows; "Behind main" shows without alert.
9. After PRURL-1 merges, line 119 asks for `mergeable,mergeStateStatus` (a watcher test checks the `gh pr view` arguments), and the Azure reader maps `conflicts` to `conflicting` and `succeeded` to `clean`.
10. The docs listed under Fix carry the new wording, and row 8 names the refusal text and its route.
11. The lifecycle model passes with the new properties: `pr-ready` with a head reaches merge only when the observed head is passed, clear in review and not conflicting; `return-to-build` from ci or merge lands in building with no `readyHead`.

## Test level

Unit first, then the lifecycle model and one e2e scenario.

- `mission-console/watcher.test.mjs`: the mapping in AC2, red on today's `summarizePr`; after PRURL-1, the `gh pr view` field list, through whatever runner seam PRURL-1 leaves.
- `command-center/coordinator.test.mjs`: a conflict `pr-observed` reaches Jarvis with a CI worker assigned between turns.
- `mission-console/store.test.mjs`: AC3 to AC7 with the `writer` helper, red today.
- `command-center/card.test.mjs` and the console status tests: AC8.
- Lifecycle model: `abstract` and `concrete` gain `prObservation.conflicting` as one boolean; `eventInputs` gains one passed, conflicting observation per head (two inputs). The state count is measured against the 240,000 limit; if it goes over, the skill's rule applies (drop an unread field first, raise the limit only with the numbers updated).
- E2E `e2e/scenarios/conflict-on-ready-pr.mjs`: a story seeded in ci with a passed, clean observation and a scripted CI worker assigned between turns, so the coordinator path is exercised. The gh stand-in learns per-PR checks (so the watcher reads passed, not no-checks) and per-PR `mergeable` and `mergeStateStatus`, with defaults that leave existing scenarios unchanged. The PR turns CONFLICTING; `watchOnce` must report the change and Jarvis must wake; a scripted background Jarvis records `release-worker` and `return-to-build`, and the story reaches building with no `readyHead`. On today's code it fails because `watchOnce` reports no change for the conflicting PR. A store unit test covers the QFMT-1 shape: merge, no worker, `readyHead` set.
- The delivery model covers coordinator.mjs `owe` and `unhandled` only, not `needs`; it runs inside `node --test` and must stay green, and its coverage record is unchanged.
- Commands: focused `node --test mission-console/store.test.mjs mission-console/watcher.test.mjs command-center/card.test.mjs`; model `node --test mission-console/lifecycle-model.test.mjs`; full `node --test` and `node e2e/run.mjs`; gitleaks per the profile.

## Run decisions

- Before and after: screenshots of one Command Center card, in a throwaway Command Center on its own port and database, seeded with a story in merge whose PR is ready and conflicting. Before on base `87becfc` (the card says "PR ready to merge"), after on the story head (red "Merge conflict with main"). Screenshots are not committed.
- Architecture diagram: none.

## Out of scope

- PRURL-1's URL matcher in watcher.mjs and `pr-opened` in store.mjs, except line 119's field list after it merges.
- Resolving conflicts automatically, or Hawkeye updating a branch that is behind.
- QFMT-1 and PR #93: read only, never touched.
- `mergeStateStatus` values other than DIRTY and BEHIND (BLOCKED, UNSTABLE, HAS_HOOKS, DRAFT): read as clean.

## Plan critique

Limitation: one reviewer, not two providers. Codex (OpenAI) refused both runs: its default model is not in the account's catalog, and the profile's deep model hit the usage limit until 2026-11-30. One fresh Claude reviewer read the plan against the code. Its findings, and what changed:

1. `phaseLabel` in app.js still says "PR ready to merge" in the avatar, timeline and detail header. Added to Cards and AC8.
2. `record` only copies `feedback` onto the event, so `conflict` would be dropped. Named in the store section.
3. Nothing tests line 119's field list. Added to AC9 and Test level.
4. An e2e story in merge has no worker, so the coordinator change never runs. The scenario now has a CI worker assigned; a coordinator unit test added.
5. Existing tests assert `return-to-build` is refused from ci and merge. Named in the store section.
6. A merged observation could keep a stale conflict. A merged or closed observation now drops `merge` (decision 10).
7. BEHIND needs strict branch protection. Stated as decision 13.
8. Holding line 119 until PRURL-1 merges blocks the GitHub fix. Kept, as the brief says to stay out of those lines; the alternative is decision 11 for the owner.
9. Low: the model has no same-head clean input after a conflict. Not added, to protect the state limit; `store.test.mjs` covers it.

## Context pack

Scouted on story/mrg-1-watch-pr-mergeability at 97d775b (origin/main), 2026-11-27.

### Reproduction (unchanged code)

Evidence: `C:\Users\trojanmini\.ai-sdlc\stories\MRG-1\repro-output.txt`, script `repro.mjs` beside it.

1. `gh pr view 93 --json mergeable,mergeStateStatus,headRefOid,state` (read only): OPEN, head 10a7552, `mergeable: CONFLICTING`, `mergeStateStatus: DIRTY`.
2. A throwaway store (temp folder, not the live database) registers #93 on a story in `ci` and runs the real `watchOnce` with the real `readGitHubPr`. The observation is `status: passed`, fields `head,status,failedCount,failures,review`: nothing about mergeability.
3. `pr-ready` with that head is accepted; the story moves to `merge`.
4. A second `watchOnce` returns `[]` (unchanged, no wake). The story stays in `merge` with `readyHead` 10a7552, and the cards say "PR ready to merge".

### Root cause

- `mission-console/watcher.mjs:119` asks `gh pr view` for `url,state,headRefOid,statusCheckRollup` only. `summarizePr` (lines 19-45) returns `head, status, failedCount, failures`. Mergeability is never read.
- `mission-console/store.mjs` `observePr` (108-144) compares and stores only those fields, so nothing about a conflict can change the observation, wake Jarvis, or reach the card. `pr-ready` (407-420) checks status passed and the review, never mergeability. `pr-recheck` (421-425) is merge to ci, "new head or check regression".
- `skills/jarvis/SKILL.md:61` and `:108` already say Hawkeye observes "merge status". Today it does not.

### Relevant files and entry points

- `mission-console/watcher.mjs`: `summarizePr`, `readGitHubPr`, `watchOnce`.
- `mission-console/store.mjs`: `observePr` (wake rule: `checks || feedback`), `labels`, `pr-ready`, `pr-recheck`, `return-to-build` (allowed from review, gates, comparison, publishing, pr-review only), `pr-review-start` (ci/merge, clears `readyHead`).
- `mission-console/console.mjs:64-89` `status()`: label per observation status; merge with `readyHead === head` and passed shows "PR ready to merge".
- `command-center/ui/app.js:161` `phaseLabel` (phase name only) and `:257-268` `reviewState` (blocking spans on the card). `command-center/clear.mjs:57` reads `readyHead`.
- `mission-console/lifecycle-model.mjs` (`eventInputs` lines ~85-95 send `pr-observed` with 6 statuses x 2 heads, `pr-ready`, `pr-recheck`) and `lifecycle-model.test.mjs`. Runs ~4-5 min, ~208,600 states against a 240,000 limit: a new observation dimension multiplies states.
- `e2e/gh-stand-in.mjs`: `pr view --json` already answers `mergeable: 'MERGEABLE'`, hard-coded; no `mergeStateStatus`. `e2e/scenarios/merge-during-diagram.mjs` is the pattern for a watcher-driven wake (calls `watchOnce` with a `readPr` built on the stand-in, then a scripted background Jarvis acts).
- Docs restating the PR phases (AGENTS.md: change together when a phase end changes): `skills/ai-sdlc/SKILL.md`, `skills/jarvis/SKILL.md` (row 8, line 61), `skills/jarvis/RUNBOOK.md:134` (Hawkeye wakes), `skills/jarvis/BACKGROUND.md`, `mission-console/README.md` (rows `return-to-build` 149, `pr-ready` 156, `pr-observed` 157, phase order 180), `e2e/README.md`, `.agents/skills/verify-story-lifecycle/SKILL.md` (property table, coverage commit 61d3587).

### GitHub facts

- `mergeable`: MERGEABLE, CONFLICTING, UNKNOWN. GitHub computes it lazily after a push to the PR or its base; the first read often returns UNKNOWN and starts the computation; a later read gets the answer. The watcher polls every 30 s.
- `mergeStateStatus`: CLEAN, DIRTY (conflicts), BEHIND, BLOCKED, UNSTABLE, HAS_HOOKS, DRAFT, UNKNOWN.
- This repository's `main` protection has `required_status_checks.strict: true`: GitHub refuses to merge a PR that is BEHIND main until the branch is updated (the "Update branch" button merges main in and reruns CI). It also requires linear history and conversation resolution. Every merge to main makes every other open PR behind.

### Conventions and rules

- AGENTS.md: no comments in source (`comment-ratchet.mjs`); no package dependencies; `node --test` before committing; lifecycle model for store/phase-table changes; an e2e scenario that fails without the fix for a change to how Jarvis is woken (`e2e/README.md`); every file restating a phase end changes together; harness-neutral store; no personal names.
- Profile gates: `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Pipeline "Tests" runs `node --test` and `node e2e/run.mjs` on 3 OSes.
- Focused tests: `node --test mission-console/store.test.mjs mission-console/watcher.test.mjs`; model: `node --test mission-console/lifecycle-model.test.mjs`; e2e: `node e2e/run.mjs`.

### Similar earlier changes

- CHK-1 (#89, spec `docs/specs/story/chk-1-pr-ready-needs-passing-checks.md`): `pr-ready` refused unless the observed status is passed; Jarvis row 8 lists each refusal and what Jarvis does.
- PRR-1 (`docs/specs/story/prr-1-pr-review-phase.md`, ADR 0020): review evidence on the observation, `pr-review` detour, `pr-ready` refused on blocking review.
- RETRO-2 (#87): a merged observation wakes in every open phase; e2e `merge-during-diagram`.

### Parallel work and risks

- PRURL-1 (#57, in building) rewrites `readGitHubPr` including line 119 (the `--json` field list this fix must extend), `watchOnce`, and adds `readAzurePr` / `summarizeAzureChecks` (Azure DevOps exposes `mergeStatus`: conflicts, succeeded, queued, ...). It also changes `pr-opened` in store.mjs. A textual conflict on line 119 is certain if both land; merge main before publishing.
- QFMT-1 (#93) is the live example; read only, never touched.
- Existing stored observations lack any mergeability field: the store must accept them.
- The lifecycle model's state limit.
- Wake noise: every merge to main flips other PRs' mergeability to UNKNOWN and BEHIND; waking on those would wake Jarvis for every open PR on every merge.
