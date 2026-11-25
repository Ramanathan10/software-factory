# PRR-1 plan: a PR review phase that brings review comments to the owner

## Problem

Hawkeye records a PR's head, its checks, and whether it merged. It never reads reviews or comments. Review feedback from a human or a bot reaches a story only when someone goes to look, and a story can show "PR ready to merge" while comments are still open. The owner wants each incoming comment summarized, with the worker's proposed resolution and its reasoning, and put to them as a decision in the Command Center, as Grill Me does. They pick an option or write their own answer, and the worker carries it out on the PR. Work item: issue #35. Context pack: `context-pack.md` on the story.

## Settled decisions

From the issue and the owner's direction (not re-asked): Hawkeye summarizes feedback for the owner through a new phase. New current-head feedback wakes Jarvis like a failed check, with the comments attached. Feedback on an earlier head is shown as such and does not block a newer head. An unreadable GitHub is not a review failure. The Hawkeye poller (`watcher.mjs`) stays read-only on GitHub.

From planning:
1. **Placement:** a detour phase `pr-review`, in its own "PR review" lane after Ship and before Done. It is entered from `ci` or `merge` and always returns to `ci`.
2. **Entry:** Hawkeye records the feedback and wakes Jarvis. Jarvis records `pr-review-start` and staffs the worker.
3. **Persona:** Hawkeye runs the phase (role `watcher`), with "PR review" added to its skills.
4. **Tier:** `standard`.
5. **Feedback:** every unresolved review thread, every review that requests changes or has a comment, and every conversation comment, from humans and bots alike. Each item is labeled bot or human using GitHub's Bot account type.
6. **Own replies:** the worker records the id of every comment it posts, and Hawkeye skips those ids. The owner's own GitHub comments still count as feedback.
7. **Decision unit:** one question per thread or comment. The options are the proposed fix (recommended), an alternative fix, or a reply without a change. The owner can also answer in their own words. The full summary is registered as a document.
8. **Fixes:** applied on the PR branch within `pr-review`. The worker reruns `node --test` and gitleaks, then pushes. An answer asking for more goes back to build through `return-to-build`.
9. **Team rule:** the worker replies in each thread with what changed or why nothing did, confirms the reply posted, then resolves the thread, for humans and bots alike. Conversation comments get a reply only.
10. **Ready gate:** the store refuses `pr-ready` while the observed current head has changes requested or unresolved threads. The card says why.
11. **Stall:** a card is flagged after 24 hours without review activity. The flag does not wake Jarvis.
12. **During the phase:** Hawkeye keeps watching. Before its handoff the worker asks about any feedback that arrived during the phase. An observed merge closes the story from `pr-review`. A retro starts only from `ci` or `merge`.
13. **Before and after:** yes, screenshots. **Diagram:** yes, an architecture delta of the review path. **E2E:** no new scenario; the existing scenarios run.

Note on the issue's out-of-scope line "Hawkeye modifying GitHub": the poller still never writes to GitHub. The `pr-review` worker, which wears Hawkeye's badge because of decision 3, replies and resolves threads, and only after the owner's decision.

## Design

### Hawkeye reads reviews (`mission-console/watcher.mjs`)
- Each poll keeps the existing `gh pr view` call and adds one `gh api graphql` call for the PR. That call returns:
  - `createdAt`.
  - `latestOpinionatedReviews`: state, `commit.oid`, author, `submittedAt`. A comment-only review never hides a standing change request.
  - Reviews with a body: id, state, author, body, `commit.oid`.
  - The unresolved `reviewThreads`: thread id, `isOutdated`, `path`, `line`, the first comment's author and body, and the last comment's id, author and time.
  - The conversation `comments`.
  
  Authors come with `__typename`, so `Bot` (or a login ending `[bot]`) marks a bot. It fetches the first 100 threads and comments, and the observation says when more exist.
- `summarizeReview` (pure) reduces this to `review`, defined once and used for wake, display and the ready gate alike:
  - `approvals`: reviewers whose latest opinionated review approves the current head.
  - `changesRequested`: reviewers whose latest opinionated review requests changes on the current head.
  - `unresolved`: unresolved threads that are not outdated. "Current" for a thread means `isOutdated` is false, whatever commit it started on.
  - `earlier`: unresolved outdated threads and change requests made on an earlier head. These are shown on the card ("Changes requested on an earlier head · re-review needed") and do not block `pr-ready`, per the owner's ready-gate decision.
  - `items`: at most 10 feedback items `{ key, kind: thread|review|comment, author, bot, path?, line?, excerpt (≤200 chars), url }`, newest first. This is only the evidence attached to the wake. The worker reads every item from GitHub itself, so the cap never drops a decision.
  - `lastActivityAt`.
  
  An item's `key` changes whenever it gains a comment: a thread is keyed by thread id plus its last comment id, and a review or conversation comment by its own id. A reviewer's reply in an existing thread is therefore new feedback. Conversation comments have no head and always count as current.
- Ids the worker posted are skipped. A thread whose last comment the worker posted is not new feedback.
- If either call fails, or the observation would exceed the store's event size, the poll records nothing and warns, as today. A failed read never counts as a review failure. Items are trimmed so an observation stays well under 32 KiB.

### Store (`mission-console/store.mjs`)
- `observePr` accepts `ci`, `merge` and `pr-review`, and validates and stores `observation.review`. The wake rule splits in two:
  - The check part (head, status, failures) wakes exactly as today.
  - The review part wakes only when the full set of current feedback keys gains a key never seen before. A resolved thread, a lower count or a newer `lastActivityAt` alone records the observation without waking.
  
  The full key set lives on the story (`story.prSeen`), not in the capped `items`, so a hidden item surfacing never looks new. In `pr-review` the observation is recorded but never wakes: the worker re-reads GitHub before its handoff, and its own fresh replies cannot wake Jarvis. Dedupe stays as today: an identical observation records nothing.
- `story.prPosted`: comment ids the worker posted, capped at 500. They are recorded with `activity` carrying a `posted` array. `watchOnce` passes them to the summarizer. Both new fields are classified in the lifecycle model (`prPosted` and `prSeen` as unguarded).
- `command-center/coordinator.mjs` `needs`: a review wake (`pr-observed` that woke on new feedback) counts as news for Jarvis even while a `ci` or `merge` worker is assigned and between turns. Without this, Jarvis would never hear it. Because this touches the wake path, `node e2e/run.mjs` runs as AGENTS.md requires.
- New event `pr-review-start` (from `ci` or `merge`, PR registered, `detail` naming the feedback). It sets `story.prReview = { returnPhase: 'ci', startedAt, detail }`, clears `readyHead`, and moves the story to `pr-review`. It is in `wakes`.
- `pr-review` is a worker phase. Its `handoff` returns to `ci` and records the detail on `story.prReview`. `return-to-build` and `merged` are accepted from `pr-review`. `retro-start` is not.
- `pr-ready` is refused (409) while `prObservation.review` shows `changesRequested` or `unresolved` on the observed head, with a message naming the count.
- `watchTargets` includes `pr-review`.

### Phases and lanes (`mission-console/roles.mjs`)
- `'pr-review': ['watcher', 'PR review', 'PR review', 'PR']` goes after `retro` and before `closed`, so the board reads Ship, PR review, Done. The Mission Console track step stays `PR`: that track's `PR` run covers publishing through closed, and a new step there would split the run.
- Hawkeye's skills gain "PR review".
- `phaseTiers['pr-review'] = 'standard'`, with the same entry in `skills/ai-sdlc-setup/scripts/preflight.mjs`.

### Board (`command-center/ui/app.js`, `mission-console/console.mjs`)
- In `ci` or `merge`, review state shows ahead of the check label:
  - "Changes requested · 1 reviewer"
  - "3 unresolved threads"
  - "Earlier-head feedback · 2" (muted, not blocking)
  - "No review activity for 1d 2h" once `lastActivityAt` is more than 24 hours old
- `idleReasons['pr-review']` reads "waiting for the PR review worker". The event `pr-review-start` belongs to the watcher.
- The PR review questions use the existing question cards unchanged.

### Skills and docs
- `skills/ai-sdlc/SKILL.md` phase 8 gains a "PR review" subsection, run when Jarvis starts it:
  1. Re-read the team rules.
  2. Read all current-head feedback through `gh api graphql`, skipping posted ids.
  3. Write the summary document and register it.
  4. Post one question per item. The id is `pr-<pass>-<n>`, a pass counter plus an item number, so asking about the same thread again never reuses an id. The summary document maps each id to its GitHub item. The prompt holds the author with a bot or human label, the file and line, a quote, a summary, the full proposed resolution and its reasoning. The options are short labels under 300 characters: the proposed fix (recommended), the alternative, and reply without a change. Then end the turn.
  5. On the answers, apply the fixes, run the required gates, commit and push.
  6. Reply in each thread, confirm the reply posted, record the posted ids, then resolve the thread. Conversation comments get a reply only.
  7. A custom answer that is a question gets a reply in `activity` and a new question.
  8. An answer asking for more releases the worker, then records `return-to-build`.
  9. Before the handoff, re-read the feedback and ask about anything new. Then release the worker and hand off to `ci`.
- The Jarvis skill phase table gains a `pr-review` row: `pr-review-start`, `question`, `answer`, `activity` (with the posted comment ids, written without backticks so the lifecycle test does not read them as an event), `handoff`, `return-to-build`. Hawkeye's row in the roles table gains "runs PR review".
- The runbook "Hawkeye event chain" gains this: on a review wake, release any `ci` worker, record `pr-review-start`, and start a Hawkeye worker with the PR review kickoff.
- `mission-console/README.md` covers the new event, the `posted` field, the review observation, and the PR review phase in the phase order.
- A new ADR records that PR review is a detour phase run by Hawkeye: why a detour, why the poller stays read-only, how own replies are skipped, and why outdated feedback does not block. It takes the next free number at rebase; ARC-1 plans 0020.

### Lifecycle model (`mission-console/lifecycle-model.mjs`)
- `guarded` gains `prReview` and the blocking part of `prObservation.review` (`blocking: true|false`).
- `eventInputs` gains `pr-review-start` and `pr-observed` with blocking and non-blocking review states.
- The test asserts that `merged` closes a story from `pr-review`, and that `pr-ready` is refused while review is blocking.

## Acceptance criteria

1. Hawkeye's observation of a registered PR records approvals, changes requested, unresolved threads, earlier-head feedback, feedback items labeled bot or human, and the time of the last review activity.
2. A new feedback item on the current head wakes Jarvis once, with the items in the event, even while a `ci` or `merge` worker is assigned. A reviewer's reply in an existing thread counts as new. None of these wake: an identical observation, a resolved thread, an earlier-head item, a comment the worker posted, or any observation while the story is in `pr-review`.
3. `pr-review-start` moves a story from `ci` or `merge` to `pr-review`. Its `handoff` returns to `ci` and clears readiness. `return-to-build` and `merged` work from `pr-review`. `retro-start` is refused there.
4. `pr-ready` is refused while the observed head has changes requested or unresolved threads. Earlier-head feedback does not block.
5. The board shows a "PR review" lane between Ship and Done. A story in `ci` or `merge` shows its review state, and shows the 24-hour stall flag when no review activity has happened in that time.
6. A GitHub read failure records nothing and only warns.
7. The `ai-sdlc` skill, the Jarvis phase table and runbook, the README and an ADR describe the phase. The lifecycle model passes with the new phase.
8. `node --test` passes. The existing e2e scenarios pass in Claude Code, and in Codex if it is available.

## Test level

- Unit tests:
  - `watcher.test.mjs` (new): `summarizeReview` on GraphQL fixtures covering bots, outdated threads, earlier-head change requests, posted ids, the 20-item cap and the read-failure path.
  - `store.test.mjs`: the new event, phase, wake and ready gate.
  - `lifecycle-model.test.mjs`.
  - `roles.test.mjs`.
  - Status-label tests in `command-center/card.test.mjs`.
  - The preflight `phaseTiers` equality test.
- Integration: a throwaway Command Center check with a seeded review observation. No new e2e scenario.

## Run decisions

- **Before and after:** screenshots from a throwaway Command Center on its own port and database, never 4174. A seeded story has an open PR, two review comments and one change request.
  - Before: origin/main shows "PR ready to merge" or "Checks passed" despite the comments, captured right after approval.
  - After: the card in `ci` shows the review state and stall flag. A second story sits in the PR review lane with its comment questions open.
- **Diagram:** an architecture delta of the review path (GitHub to the Hawkeye poller, the store and its wake, background Jarvis, the Hawkeye worker, the owner's questions, then back to GitHub with fixes, replies and resolved threads), in the PR description.

## Out of scope

- The poller writing to GitHub.
- A stall flag that wakes Jarvis.
- A profile setting for the stall time.
- A new e2e scenario and gh stand-in reviews (later, with E2E-1's rig).
- Changes to `greploop`.
- Pagination past 100 threads or comments: the observation says when more exist.

## Overlap

- ARC-1 changes the lanes (it removes Done), `app.js` and ADR numbering.
- E2E-1 reworks the e2e rig.
- This story rebases onto whichever merges first. If Done is gone, PR review becomes the last lane.

## Plan critique

Codex (gpt-6-sol) and a Claude reviewer critiqued the plan from the same neutral packet. Thirteen verified findings are folded into the design above; the full list is in the registered design document (design.md).

One finding is left for you to weigh. Under your ready-gate decision, a change request on an earlier head does not block `pr-ready`. GitHub itself keeps "changes requested" in force until that reviewer re-reviews, and branch protection may refuse the merge. With this plan, the card shows "Changes requested on an earlier head · re-review needed" next to "PR ready to merge". If you would rather that block readiness until the reviewer re-reviews, say so in plan feedback.

Tests added for the critique: `coordinator.test.mjs` for a review wake while a `ci` worker is idle; `watcher.test.mjs` for a thread reply, the full-key-set comparison, `latestOpinionatedReviews`, and the size cap.

## Context pack

Story: a PR review phase that summarizes incoming PR comments with the worker's proposed resolution and puts each to the owner as a Grill Me style decision. Work item: GitHub issue #35, "Hawkeye watches PR reviews, not only checks". Worktree `C:/repos/software-factory-worktrees/story/prr-1-pr-review-phase`, branch `story/prr-1-pr-review-phase`, base origin/main 28fb5de.

### Issue #35 (summary)

Acceptance criteria: Hawkeye records review state (approvals, requested changes, unresolved threads on the current head); new feedback on the current head wakes Jarvis with the comments as evidence; a story is not shown ready to merge while the current head has requested changes or unresolved threads; feedback on an earlier head is shown as such and does not block a newer head; a PR with no review activity for a set time is flagged on the card; an unreadable GitHub is not a review failure. Out of scope: Hawkeye modifying GitHub; Hawkeye deciding responses. Open questions: does Hawkeye summarize feedback (owner: yes, through a new phase); which bots count and how are they told apart.

### Relevant files and entry points

- `mission-console/watcher.mjs`: `readGitHubPr` runs `gh pr view <url> --json url,state,headRefOid,statusCheckRollup`; `summarizePr` reduces it to `{ head, status, failedCount, failures }`; `watchOnce` records `pr-observed` for each `store.watchTargets()` story (phase `ci` or `merge`, PR registered, no cleanup) and swallows read errors with a warning. The Command Center runs `watchOnce` every 30 s (`command-center/serve.mjs:223`).
- `mission-console/store.mjs`: `transitions`, `wakes`, `workerPhases`, `apply`, `observePr`. `observePr` accepts only `ci`/`merge`, dedupes identical observations, and wakes on a new head, failed/passed/merged/closed, or recovery. `pr-ready` (from `ci`) pins `readyHead` to the observed head; `pr-recheck` (merge to ci); `merged` from ci/merge/retro. `retro-start` and `diagram-start` are detour phases with a stored `returnPhase` and a `handoff` that returns. A phase change is refused while a worker is assigned. `question`: 2 or 3 options, a recommended index; `answer` takes an option index or custom text; accepted in any phase but `closed`.
- `mission-console/roles.mjs`: `phases` = `[role, label, board column, track step]`; lanes are runs of consecutive phases (`roles.test.mjs` fails on a split lane); Ship lane = publishing, ci, merge, retro; Done = closed. `phaseTiers` (ADR 0007, copied in `skills/ai-sdlc-setup/scripts/preflight.mjs`, a test keeps them equal). Every role needs a distinct badge.
- `mission-console/lifecycle-model.mjs` + test: explores every reachable state; `guarded` fields, `eventInputs`, and the Jarvis phase table (`skills/jarvis/SKILL.md` section 5) must match. `.claude/skills/verify-story-lifecycle/SKILL.md` says how to read failures.
- `command-center/coordinator.mjs`: background Jarvis is woken for pending news (ADR 0019). `command-center/supervisor.mjs`: `notTheWorker` includes `pr-observed`.
- `command-center/ui/app.js`: board columns from `lanes`; `idleReasons` per phase (`merge`: "waiting on reviewer approval and merge"); question cards already offer the options, "Or answer in your own words", pasted screenshots, and "Use recommended for the rest". `mission-console/console.mjs` `status()` shows CI labels for ci/merge.
- `skills/jarvis/SKILL.md` phase table, `skills/jarvis/RUNBOOK.md` (event chain, decision handling, required pipeline), `skills/ai-sdlc/SKILL.md` phase 8 (team rules re-read before any PR comment), `skills/greploop/SKILL.md` (reads Greptile threads, replies in thread, then resolves).
- `mission-console/README.md` "Hawkeye background wakeups" and the event table.
- `e2e/gh-stand-in.mjs` returns `reviews: []`, `reviewDecision: ''`, `comments` only; it has no review threads.

### Facts that shape the design

- `gh pr view --json` offers `reviews`, `latestReviews`, `reviewDecision`, `reviewRequests`, `comments`, but not review threads. Unresolved threads (`isResolved`, `isOutdated`, path, line, comments) need `gh api graphql` on `pullRequest.reviewThreads`.
- GitHub marks bot authors: GraphQL `author.__typename == "Bot"`, REST `user.type == "Bot"`, logins ending `[bot]`.
- The factory opens PRs and would post replies with the owner's own `gh` account, so the PR author and the factory's replies share one login.
- The profile for this repository names no review bot and one team rule: reply to every pull request comment before resolving it.
- Phase `ci` is a worker phase (role watcher); `merge` and `publishing` are not.

### Rules that apply (AGENTS.md and profile)

- `node --test` before committing; no package dependencies; no comments in source (comment ratchet); reasons go in an ADR under `docs/adr/` (next is 0020, which ARC-1 also plans to use).
- A store or phase change updates store transitions, `roles.mjs` (lanes) and the Jarvis phase table together, checked with the lifecycle model.
- A change to how Jarvis is woken needs `verify-decision-delivery` when it touches the listed functions, and `node e2e/run.mjs <harness>` for each harness available.
- Keep store and Command Center harness-neutral; no personal names or real work details in tracked files.
- Gates: `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Pipeline "Tests". Spec at `docs/specs/story/<branch-leaf>.md` (earlier stories: `docs/specs/story/wake-1-wake-jarvis-when-needed.md`), first commit.

### Test commands

- Focused: `node --test mission-console/store.test.mjs mission-console/lifecycle-model.test.mjs mission-console/roles.test.mjs command-center/card.test.mjs`
- Full: `node --test`

### Similar earlier changes

- `retro-start` / `diagram-start`: detour phases with `returnPhase`.
- WAKE-1 (ADR 0019): background Jarvis woken for news; spec format in `docs/specs/story/`.

### Parallel work and overlap

- ARC-1 (planning): closed stories leave the board; Done lane removed; Archive tab; plans ADR 0020. Overlap: `roles.mjs` lanes, `command-center/ui/app.js`, ADR numbering.
- E2E-1 (planning): scripted e2e workers replace real models; reworks `e2e/rig.mjs` and scenarios. Overlap: any new e2e scenario and the gh stand-in.
- Rebase onto whichever merges first.

### Risks

- Loops: the factory's own replies must not count as new feedback.
- Lifecycle: a new phase must keep "can always reach closed" and "merged closes from a PR phase".
- `requested changes` persists on GitHub until the reviewer re-reviews; a store guard on it could hold a story in `ci` indefinitely (merge observed still closes it).
- GraphQL cost and pagination per 30 s poll.
