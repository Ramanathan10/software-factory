# 0020. The Command Center clears shipped stories itself

Status: Accepted
Date: 2026-11-24

## Context
A merged story stayed on the board in the Done lane, and its worktree, branch, notes, attachments and turn logs stayed on disk. Cleanup ran only when the owner asked Jarvis in chat: the daemon wakes no Jarvis for a closed story (ADR 0019) and a closed story has no worker. The work item asked for clearing to reuse verified cleanup "rather than delete folders directly". Waking a Jarvis turn per story would follow that wording, but it changes how Jarvis is woken, costs one model turn per story on Clear all, and verifies with a model what fixed code can check. The owner chose to have the Command Center clear a story itself.

## Decision
- Closed means archived. The Command Center leaves `closed` stories out of Lanes, Agents and Track and lists them in an Archive tab. The phase table keeps a column for `closed`, named Archive, so every phase still has a lane (ADR 0007).
- `POST /api/clear` takes `{ stories: [ids] }` from the console's own origin and clears each story on its own, so one blocked story does not stop the others. An error partway through a story becomes that story's `cleanup-blocked` result, with whatever it had already deleted, and the batch goes on. A story that is missing, not `closed`, has a worker, has a Jarvis turn running, or is already being cleared is refused and nothing is recorded.
- A clear records the existing `request-cleanup`, then `complete-cleanup` or `cleanup-blocked`, all with `by: "jarvis"`. None is pending, so no Jarvis turn starts a second, different cleanup (the README procedure also closes PRs) while the clear runs, and a blocked clear leaves no pending event behind. `complete-cleanup` keeps only the deletion marker, so the response carries what was deleted, what was already gone and what was left.
- Every check runs before anything is deleted, and any failure records `cleanup-blocked` with the reason:
  - The worktree is listed by `git worktree list --porcelain` of its own repository, is not the main checkout, and has `story.branch` checked out. Paths are compared after `realpath`, with forward slashes and, on Windows, case folded.
  - `git status --porcelain --untracked-files=all` is empty. Git-ignored files do not block: `git worktree remove` deletes them, so the confirmation names their count and first five paths first (the owner's choice over refusing or saying nothing).
  - No commit on the worktree's HEAD or `story.branch` is outside the remotes and the merged PR head: `git rev-list HEAD refs/heads/<branch> --not --remotes <head> --`, so a branch named like a folder in the worktree is still read as a branch. The head is the recorded `prObservation.head` when its status is `merged`, else `readyHead`, when that commit exists locally. GitHub deletes a story branch on merge and squash-merged commits are not on `main`, so without the head one `git fetch --prune` would block every merged story. A story with neither head falls back to remote branches only and is blocked after a prune; the reason says to push or delete the branch by hand.
  - No other live story records the same worktree, or the same branch in the same repository, or an ID equal ignoring case, or an attachments folder name equal ignoring case (`S.1` and `S_1` share `attachments/S_1`); and the ID does not end in `.`. Windows folds these into one folder name.
  - A folder at the worktree path that git does not list is never deleted; the reason says to remove it by hand.
- Deletion runs `git worktree remove` without `--force`, then `git branch -D` in the main checkout found from that listing, then the folders and logs. A worktree that is already gone counts as removed. The repository cannot be found without it, so the local branch is left and named in the result.
- Paths come from the ID, never from the record: `<home>/stories/<ID>`, `<home>/notes/<ID>`, and the attachments folder the console itself writes. Turn logs come from the story's worker events, its Jarvis session, and the `See <log>.` line that closes each `jarvis-turn-ended` detail (the store keeps no Jarvis log path, and a Codex Jarvis log is named after its launch), and are deleted only inside `<home>/workers` and only when no other live story uses them. `home` is an option of `createConsoleService`, so tests pass a temporary one.

## Consequences
- The Command Center now runs destructive git commands and deletions. They are fixed, run only for closed stories after the owner confirms a dialog that lists each path, and refuse anything they cannot verify.
- Remote branches and PRs are untouched. A story that never shipped is still cleaned up through Jarvis.
- No store, lifecycle, delivery or wake change: the cleanup events and the deletion marker already existed.

## Where
- `command-center/clear.mjs` — `createClearer`, `preview`, `clear`
- `command-center/console-service.mjs` — `/api/clear`, `/api/clear/preview`, `/api/history`
- `command-center/ui/app.js` — `renderArchive`, `confirmClear`, `runClear`
- `mission-console/roles.mjs` — `phases.closed`
