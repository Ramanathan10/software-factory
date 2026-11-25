# ARC-1: Shipped stories archive themselves and can be cleared

Work item: issue 36. Context pack: below.

## Problem

Merged stories stay on the board forever in the Done lane, the "shipped" count only grows, and each keeps its worktree, branch, notes, attachments and turn logs on disk. Nothing in the Command Center can clear a merged story: the coordinator skips closed stories and they have no worker, so cleanup happens only by asking Jarvis in chat.

## Settled decisions (owner, rounds 1 and 2)

1. Archived means closed, from the moment of merge. No store, lifecycle-model or Jarvis-table change.
2. No restore.
3. The "shipped" counter counts closed stories still kept, drops when they are cleared, and clicking it opens the Archive tab.
4. The archive is a fourth tab, "Archive", beside Lanes, Agents and Track. It follows the repository filter (list and Clear all); the role filter does not apply to it.
5. The Done lane is removed; closed stories are left out of Lanes, Track and Agents.
6. The Command Center clears a story itself, with fixed checks, recording `request-cleanup`, then `complete-cleanup` or `cleanup-blocked`. ADR 0020 records why this departs from the issue's "not directly" wording.
7. A clear refuses, and the story stays archived with the reason, when the worktree has uncommitted or untracked files, or the branch has commits that are not pushed (see refinement A).
8. A clear deletes: the worktree; the local branch when all its commits are pushed; `<AI_SDLC_HOME>/stories/<ID>`; `<AI_SDLC_HOME>/notes/<ID>`; `<db dir>/attachments/<ID>`; the story's worker and Jarvis turn logs. Remote branches and PRs are untouched.
9. The database keeps the `{id, deleted}` marker; history and state go (today's `complete-cleanup`).
10. Only closed stories can be archived or cleared.
11. The archive detail shows the full history through a new read-only route.
12. The legacy Mission Console page is unchanged.
13. Before-and-after: screenshots (below). No architecture diagram.
14. Git-ignored files in the worktree (such as `.env` files and build output) do not block a clear: the confirmation names how many there are and the first few paths, and they are deleted with the worktree (owner answer to `ignored-files`, event 1396).

## Refinements found while planning

A and B were put to the owner as questions `pushed-rule` and `orphan-branch` and accepted as written. C and D are safety mechanics within the decisions above.

A. **Pushed means on a remote branch or in the merged PR head.** GitHub deletes a story's remote branch on merge here (`git ls-remote` shows none for CARD-1, CTX-1, MODELS-1, WAKE-1); only stale local `origin/story/*` refs keep them "pushed", and a `git fetch --prune` would make every merged story uncleareable. Unpushed commits = `git rev-list <branch> --not --remotes <merged head>`, where the merged head is the story's recorded `prObservation.head` with status `merged`, else `readyHead`, when that commit exists locally. A story with neither (ADM-1) falls back to remote refs only.
B. **Worktree already gone.** It counts as removed. Without a worktree the Command Center cannot find the repository, so the local branch is left and the completion evidence says so.
C. **The Command Center records its cleanup events with `"by": "jarvis"`** (`request-cleanup`, `cleanup-blocked`, `complete-cleanup`), so none is pending: no Jarvis catch-up can pick up the request and run a second, different cleanup (the README procedure also closes PRs) while the clear runs, and a blocked clear leaves no pending event behind.
D. **The fallback blocks.** A story with no recorded merged head whose remote branch was pruned is blocked as "commits on no remote branch"; the reason tells the owner to push or delete the branch by hand. ADM-1 is unaffected: its worktree is already gone (refinement B).

## Behaviour

### Board
- `mission-console/roles.mjs`: `closed`'s board column becomes "Archive" (was "Done"), so the phase table still gives every phase a lane (ADR 0007, `roles.test.mjs`). The Command Center shows that lane as the Archive tab, not as a board column: Lanes, Agents and Track leave out `closed` stories and the Archive column. ADR 0007 gains one line saying so. Phase keys are unchanged, so the lifecycle model is unaffected.
- Header "shipped" becomes a button that switches to the Archive tab; its count is the closed stories in the snapshot (deleted ones are already hidden).
- View `archive` is saved in `localStorage` like the others.

### Archive tab
- One row per closed story under the repository filter, newest merge first: ID, title, repository, merged date (time of its `merged` event, else `updatedAt`), PR link, and a "Clear blocked: <reason>" line when `story.cleanup.blocked` is set, or "Clearing…" while a clear runs.
- A row opens the story detail; for a closed story the detail loads the full history from `GET /api/history?story=<ID>`.
- "Clear" on each row and "Clear all (N)" for the listed rows. Both open one confirmation dialog built from `GET /api/clear/preview?story=<ID>` per story: the worktree path, how many git-ignored files it holds and the first five paths (`git ls-files --others --ignored --exclude-standard`; "could not be listed" when git fails), the local branch (or why it stays), each folder and the number of log files that exist, and "its record in the story database". It says "This cannot be undone." and has "Delete permanently" and "Cancel".
- Empty state: "No shipped stories."

### Clear (new module `command-center/clear.mjs`, routes in `console-service.mjs`)
- `POST /api/clear` with `{ stories: [ids] }`, same origin and JSON checks as `/api/decision`. Each story is handled on its own; the response lists each result (`cleared`, or `blocked` with the reason). One story's failure does not stop the others.
- Only a malformed request fails as a whole (400, 403, 415). Each story gets its own result: `refused` (no event written) when it is missing, deleted, not `closed`, has a worker assigned, has a Jarvis turn running, or is already clearing; `blocked`; or `cleared`.
- One clear at a time per story: the service keeps an in-flight set, and a second request for a story already clearing is refused.
- Steps per story: record `request-cleanup` (skipped if `story.cleanup` is already set from an earlier blocked attempt), check, delete, then record `complete-cleanup` or `cleanup-blocked` with the reason, all with `by: "jarvis"`. `complete-cleanup` keeps no evidence (`store.mjs:529`), so the response returns what was deleted, what was already gone, and what was left and why, and the Archive tab shows it in a result note after the clear.
- Checks, all before any deletion:
  - The worktree is listed by `git worktree list --porcelain` of its own repository and is not the main worktree. Paths are compared after `realpath`, with separators normalised, case-insensitively on Windows.
  - The worktree's checked-out branch (from that porcelain entry) is `story.branch`; a detached HEAD or another branch blocks.
  - `git status --porcelain --untracked-files=all` is empty, and refinement A finds no unpushed commits on the worktree's HEAD or on `story.branch`.
  - No other non-deleted story records the same worktree (normalised) or the same branch in the same repository.
  - No other non-deleted story has the same ID ignoring case or the same `folderFor` attachments folder name ignoring case (`S.1` and `S_1` share `attachments/S_1`), and the ID does not end in `.` (Windows folder aliasing).
  - A folder at the worktree path that git no longer lists (left by a partial earlier removal) blocks with "remove <path> by hand"; it is never deleted blindly.
- Deletion order: `git worktree remove <path>` (no `--force`); `git branch -D <branch>` in the repository's main checkout, resolved with `git rev-parse --git-common-dir` before the removal; then folders and logs. A deletion that fails records `cleanup-blocked` with the error. When the branch deletion fails after the worktree is gone, the reason names the repository and branch so the owner can delete it, since a retry can no longer find the repository (refinement B). A retry treats anything already gone as done.
- Path safety: the story ID must match the store's identifier pattern; notes folders are `join(home, 'stories' or 'notes', ID)` and attachments `join(attachmentRoot, folderFor(ID))`, the same `folderFor` that stores them (`console-service.mjs:62`), never a path taken from the record; logs are the worker turn logs and sessions on the story's events, its `jarvis` session, and the log each `jarvis-turn-ended` names on its closing `See <log>.` line (the store keeps no Jarvis log path, and a Codex Jarvis log is named after its launch, not its session), deleted only when they resolve inside `<AI_SDLC_HOME>/workers`.
- The AI SDLC home is an option of `createConsoleService` (default `AI_SDLC_HOME`, else `~/.ai-sdlc`, as `adapters/harnesses.mjs` reads it). Tests and the before-and-after run always pass a temporary home, so they cannot touch the real `~/.ai-sdlc`.

### Docs
- ADR `docs/adr/0020-the-command-center-clears-shipped-stories.md`: why the Command Center runs these deletions itself, the checks, refinement A.
- `mission-console/README.md`: a "Clear shipped stories" paragraph under "Record and recover"; correct the sentence that says the dashboard runs no shell commands.
- `/api/clear` records through `service.recordEvent`, which never calls `notify`/`hand` (only `/api/decision` does, `console-service.mjs:177-180`), and its events carry `by: "jarvis"`, so they are never pending and never delivered.
- No change to `store.mjs`, phase keys, the Jarvis phase table, worker start, decision delivery or Jarvis waking. So no lifecycle-model change, no delivery-model check and no e2e run is required; `node --test` still runs the lifecycle model.

## Acceptance criteria (observable)

1. A story that receives `merged` disappears from Lanes, Agents and Track and appears in the Archive tab, with no owner action.
2. No story in any other phase appears in the Archive tab, and `POST /api/clear` refuses it with a per-story refused result and records nothing.
3. The shipped counter equals the number of closed, not-deleted stories and opens the Archive tab.
4. The Archive tab follows the repository filter for its list and for Clear all.
5. Opening an archived story shows its plan, decisions, evidence and full event history (more than 40 events when it has them).
6. Clear and Clear all show a confirmation naming the worktree, its ignored files (count and first few paths), branch, folders, log count and database record, saying it cannot be undone; Cancel deletes nothing.
7. A clean, pushed (or merged-head) story is cleared: worktree, local branch, both notes folders, attachments and its logs are gone; `snapshot` no longer lists it; the database keeps only the deletion marker and the completion event.
8. A story with uncommitted or untracked files, or unpushed commits, stays in the archive with `cleanup-blocked` and the reason shown on its row; nothing is deleted.
9. A worktree already removed by hand does not block the clear.
10. In Clear all, a blocked or refused story does not stop the others; each result, including anything left behind, is reported.
11. A worktree on another branch or a detached HEAD, a worktree or branch shared with another live story, or a second clear of a story already clearing, is blocked or refused and deletes nothing.
12. No cleanup event from a clear is pending afterwards (`pending` lists none).

## Plan critique

Reviewers: Claude (Anthropic) and Grok 4.5 (xAI, through Cursor). Codex and GPT-5.6 were unavailable (usage limits), so OpenAI is not on the panel.
- Both found, verified, fixed: the attachments path must use `folderFor`; the pending `request-cleanup` invites a parallel Jarvis cleanup (now `by: "jarvis"`); the no-head fallback blocks after a prune (kept and documented as D).
- One reviewer found, verified, fixed: worktree HEAD versus `story.branch`; a worktree or branch shared with another story; concurrent clears; completion evidence lost; tests could delete the real home; Windows ID aliasing; partial worktree removal; per-story results instead of a whole-request 409; branch left after a partial clear; Windows path normalisation.
- None changes a settled decision.

## Test level

Integration: `command-center/clear.test.mjs` with temporary git repositories (a bare origin, a main checkout, story worktrees) and a temporary database and AI SDLC home; contract tests for `/api/clear`, `/api/clear/preview` and `/api/history` in `console-service.test.mjs`; UI behaviour (board filtering, counter, Archive rows) in the existing UI test style (`card.test.mjs`). Written first by a separate test author.

## Out of scope

Remote branches and PRs; stories that never shipped; restore; archive delay; the legacy Mission Console page.

## Run decisions

- Before-and-after: screenshots on a throwaway Command Center with its own port and database seeded with closed and open stories, never port 4174. Before: today's board with the Done lane, captured right after approval. After: the board without closed stories, the Archive tab, the clear confirmation, and a blocked clear with its reason.
- Architecture diagram: none.
- Gates (profile): `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Pipeline "Tests". Spec at `docs/specs/story/arc-1-archive-shipped-stories.md` as the first commit.

## Context pack

Work item: issue 36. Branch `story/arc-1-archive-shipped-stories`, cut from origin/main 28fb5de.

### Rules that apply (AGENTS.md, profile)

- `node --test` before every commit; secrets gate `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Lint, typecheck, build, dependencies, static analysis, mutation declined.
- No package dependencies. No comments in source files (`comment-ratchet.json`); reasons go in an ADR under `docs/adr/` (next free number 0020).
- Store or phase change: update `mission-console/store.mjs` transitions, `mission-console/roles.mjs` phases and the Jarvis phase table (`skills/jarvis/SKILL.md` step 5) together, and run `.claude/skills/verify-story-lifecycle/SKILL.md` (`node --test mission-console/lifecycle-model.test.mjs`).
- Change to how workers start, how decisions reach them, or how Jarvis is woken: `.claude/skills/verify-decision-delivery/SKILL.md` plus `node e2e/run.mjs <harness>` (spends model usage).
- Harness-neutral store and Command Center; harness specifics in `adapters/`.
- No personal names or real work details in tracked files (`private-details.test.mjs`).
- Spec goes to `docs/specs/story/arc-1-archive-shipped-stories.md` as the branch's first commit after approval (earlier specs: `docs/specs/story/*.md`).
- Required pipeline "Tests" (`.github/workflows/test.yml`). No review bot. Team rule: reply to every PR comment before resolving it.

### What exists today

- Shipped = phase `closed` (`roles.mjs:60`, label "Merged", lane "Done"). `merged` from `ci`/`merge`/`retro` sets it (`store.mjs:356`). No archived state exists.
- Board (`command-center/ui/app.js`): lanes come from `meta.columns` = `lanes(phases)`; closed cards render with class `done` and label "Done" (`app.js:256,267`); Track view sorts closed last (`app.js:322`). Stats: `stat-shipped` = stories − open (`app.js:197`); crew skips closed (`app.js:221`).
- Story detail (`openDetail`, `app.js:613`): brief, coordinates, plan, evidence (artifacts via `/api/media`), files, timeline from `story.events`. `snapshot` caps `events` at 40 (`store.mjs:426`); full history exists only as `store.history(id)` (`store.mjs:433`) with no HTTP route in `command-center/console-service.mjs`.
- Cleanup events (`store.mjs:520-535`): `request-cleanup` is allowed in any phase, sets `story.cleanup`, and freezes work events. `cleanup-blocked` records `story.cleanup.blocked`. `complete-cleanup` needs no worker, purges the event history and leaves a tombstone `{id, deleted: true}` that reserves the ID; `snapshot` hides it.
- "Delete story…" exists only in the legacy Mission Console page (`mission-console/index.html:44`, `console.mjs:508`), not in the Command Center UI. The Command Center accepts `request-cleanup` through `POST /api/decision` (`console-service.mjs:16`).
- Nobody acts on a cleanup request for a closed story: `coordinator.needs` returns `[]` for `closed` (`command-center/coordinator.mjs:59`), and closed stories have no worker. The manual path is Jarvis in chat (HOME-2 precedent, which kept merged branches, the worktree and evidence).
- The README cleanup procedure (`mission-console/README.md` "Delete a story") is written for undoing unmerged work: remove worktree and branch, close the story's PR, report merged work.
- README says the dashboard "has no ability to spawn agents or run shell commands"; it now starts workers and Jarvis turns (ADR 0018, 0019) but runs no destructive commands.

### What is on disk per story (this machine)

- Worktree: `story.worktree`.
- Notes: no code or skill defines a folder. Jarvis kickoffs chose `~/.ai-sdlc/stories/<ID>` for some stories and `~/.ai-sdlc/notes/<ID>` for others (both exist today). HOME-2's folder survived its cleanup.
- Attachments: `<db dir>/attachments/<ID>` (`console-service.mjs:62,69`).
- Turn logs: `~/.ai-sdlc/workers/<session>.log` (`adapters/harnesses.mjs:141`), named by session; sessions are on the story's events and worker/jarvis fields. 60 logs, 18 MB today.
- Live DB today: 6 closed stories (ADM-1, CARD-1, CTX-1, MODELS-1, NAV-1, WAKE-1).

### Lifecycle model

`mission-console/lifecycle-model.mjs` explores every store state. `guarded` lists every story field a guard reads; a new guarded field (for example `archived`) must be added to `abstract`/`concrete`, and any new event to `eventInputs`. Properties include "a story awaiting cleanup never changes phase" and "every event the Jarvis table names is accepted".

### Tests

- Focused: `node --test mission-console/store.test.mjs command-center/serve.test.mjs command-center/console-service.test.mjs command-center/card.test.mjs`; UI rules in `command-center/ui-lint.test.mjs`, `no-html.test.mjs`.
- Full: `node --test` (lifecycle model ~12 s).
- e2e: `node e2e/run.mjs <harness>`, scenarios in `e2e/scenarios/`.

### Similar earlier changes

- CARD-1 (`docs/specs/story/card-1-animate-card-glyph.md`): board card UI, before-and-after on a throwaway Command Center with its own port and DB.
- WAKE-1 (`docs/specs/story/wake-1-wake-jarvis-when-needed.md`): changed when the background Jarvis is woken; ran the delivery model and e2e.

### Risks

- Destructive deletion on the owner's disk: worktree paths come from the story record; a wrong path deletes the wrong folder. Paths must be checked before removal.
- Squash merges leave local branch commits that are not on `main`; "unpushed" must be judged against the remote branch, not `main`.
- A worktree already removed by hand (TrojanLab stories) must count as gone, not as a failure.
- Archive-after-delay needs the merge time; `updatedAt` moves on later Jarvis events, so a delay is a store change.
