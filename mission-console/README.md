# Jarvis Mission Console

Mission Console is the optional local dashboard for AI SDLC. Jarvis coordinates the existing phases with the host's normal tools. The console stores decisions, worktree references, evidence, and pending handoffs in SQLite so a fresh Jarvis session can resume.

## Run it

Use Node.js 24 or later (Node 22 needs `--experimental-sqlite`). There is no package installation. From the software-factory checkout, run this preview with sample data:

```powershell
node ./mission-console/jarvis.mjs demo
```

Open the printed loopback URL. The demo starts with a reported test-file change and an open Cap question. It accepts local answers in memory. A live Jarvis session writes the follow-up questions, plans, and worker updates in real use.

For real work the database is chosen for you, and every project shares it, so one dashboard shows every story:

1. The file `AI_SDLC_CONSOLE_DB` names, when that variable is set.
2. Otherwise an existing `~/.copilot/ai-sdlc-console/jarvis-missions.sqlite`, kept so stories recorded before the move are not lost.
3. Otherwise `console/jarvis-missions.sqlite` in the AI SDLC home (`AI_SDLC_HOME`, default `~/.ai-sdlc`), the folder that also holds the profile.

The dashboard for real work is the Command Center, which Jarvis starts from the `launcher` path the `ai-sdlc` preflight check prints under `commandCenter`. The examples below use two variables. `$console` is the `console` path from that same output, and `$missionDb` is the database above:

```powershell
$console = '<commandCenter.console from the preflight check>'
$missionDb = Join-Path $HOME '.ai-sdlc/console/jarvis-missions.sqlite'
```

Run every writer with the same database path. Keep the database and its SQLite sidecars local. The loopback server trusts processes on the same machine. It rejects cross-origin browser decisions and is intended for one local operator. Serve it only on its printed address.

## Hawkeye background wakeups

Hawkeye observes GitHub pull requests after Jarvis registers them with `pr-opened`. The Command Center does this itself every 30 seconds while it runs, with an authenticated GitHub CLI. Without the Command Center, start the watcher in a separate terminal with the same database:

```powershell
node $console watch $missionDb
```

The watcher polls registered `github.com` PRs in every open phase, even if the dashboard and agent chat are closed. It records CI failures, changed heads, passing check reports, PR closure or merge, and the PR's review: approvals and change requests on the current head, unresolved threads, earlier-head feedback, up to 10 feedback items labeled bot or human, every current feedback key, and the time of the last review activity. It only reads GitHub (`gh pr view` and one `gh api graphql` query); a failed read records nothing and warns. It stores actionable changes in the durable queue, with one wake for each observed transition. Outside the CI, merge and PR review phases it records only a merged or closed PR; review comments and check results there are left unseen until the story is back in CI. The default delay is 30 seconds between sweeps. Pass a delay in seconds to `watch`, or use `watch-once` for a single sweep. Stop the watcher with Ctrl+C.

In a harness that runs workers, the owner's decisions reach the worker without anyone waiting: the Command Center messages the worker, or wakes Jarvis to forward it. In a harness driven from the command line, the Command Center also wakes a background Jarvis session for a story that needs one (ADR 0019); the Jarvis chat no longer waits there. `wait-any <db> [after-seq] [seconds]` remains, run as a background command, for a harness or a person that wants to watch the store: it ends, printing the new events, as soon as any story has an event for Jarvis recorded after that seq; the owner's own decisions end it only for a story with no worker assigned, where nobody else can receive them. `wait` is the fallback for a harness that cannot run workers, where Jarvis does the story's work in its own chat and nothing else would bring it the owner's answer:

```powershell
node $console wait $missionDb TL-142 30
```

This returns as soon as the story has pending events or returns an empty list on timeout. It does not acknowledge them. Jarvis reads the latest observed head, handles the wake, and acknowledges its sequence. A running agent can wait for this signal. An ended chat needs a new session to drain the queue because the watcher has no harness-specific launch hooks.

Hawkeye supplies GitHub evidence. Jarvis routes the response and applies existing review and approval gates. Record readiness for the exact reviewed head. A different observed head needs a fresh readiness decision even when its checks passed. An observed merge still needs reconciliation in the story. The watcher does not modify GitHub, launch workers, merge PRs, or treat an unavailable GitHub response as a CI failure.

[GitHub CLI PR fields](https://cli.github.com/manual/gh_pr_view)

## Pick a harness for the story

Choose one harness before planning and use it for the whole story. For example, tell Jarvis “Run AI SDLC for this story in Cursor.” Jarvis records the exact harness name on creation and uses it for worker assignment. If you move from Codex to Cursor later, use the same database for new stories. Older stories keep their recorded harness. The dashboard's **Harness** filter applies to stories, pending decisions, and crew assignments. Jarvis can also query a harness directly with `snapshot <db> <harness>`.

Run independent reviews through the selected harness. An optional cross-model panel still needs distinct providers and permission to share the material. If it would require another harness, report that limitation under the existing AI SDLC rules.

The dashboard, story database, event CLI, and phase rules are shared. The chosen harness supplies the shell, repository access, agent delegation, and permissions. Launch an agent in the target repo and give it the `ai-sdlc` skill, the `jarvis` skill, this reference, the database path, and the story ID. Use the harness's skill picker if it discovers the canonical skill. A direct path works for a harness that can read local files.

| Harness | Using the shared console |
|---|---|
| Claude Code and Codex | Each story runs in its own worker session, started and resumed through the harness's own command-line program. The Command Center messages the worker directly when the owner decides. |
| GitHub Copilot app | Each story runs in its own coding session, started with the app's tools. The Command Center runs inside the app as an extension and wakes Jarvis, who forwards the decision. |
| Cursor | The skills are installed, but it cannot run workers yet. Jarvis tells the owner, does the story's work in its own chat, and uses `wait` for the owner's answers. |
| Other harnesses | Use the same CLI and file contract wherever the agent can access Node, the database, and the relevant checkout. The AI SDLC gate for unavailable delegation still applies. |

The calls each harness uses are in the Jarvis skill's factory runbook, and the harnesses themselves are the rows of `adapters/harnesses.mjs`.

When resuming a story in a fresh session of its chosen harness, read the one-story packet locally:

```powershell
node $console handover $missionDb TL-142
```

The packet includes the story's selected harness, current state, evidence, recorded worker assignment, and pending wakes. Check the actual session and worktree before replacing a worker or advancing its phase. If a worker is still writing, let it finish or stop it through that harness. Once verified idle or stopped, record `release-worker`. Then advance the phase or assign the next worker. Use the unique `worker.id` from the snapshot to attribute reports and release the assignment. The session reference grants no access and does not prove liveness.

[Claude Code skills](https://code.claude.com/docs/en/skills) · [Cursor skills](https://cursor.com/docs/skills)

## Personas, roles, and skills

The dashboard always shows the persona and its role. Crew lists the skills each persona is responsible for, and the story detail shows the skills for its current role. The persona map is in the `jarvis` skill and `roles.mjs`; the `ai-sdlc` skill itself has no personas. A request such as “Run Grill Me” still resolves to Captain America’s job. Skill names and entrypoints are shared across harnesses and each skill defines its own procedure.

## Jarvis coordination

1. Set up a stable story ID and record the brief and intended branch and worktree. Use a separate worktree for each active story and verify its identity before delegating writes. A story advances in AI SDLC order. Independent stories can run concurrently, including two Bruce Banner test assignments, subject to available host worker slots and shared resources.
2. Cap runs Grill Me. Record the current working plan using `draft-plan` before asking the first frontier and refresh it after each round of answers. Keep goals, scope, decisions, and open questions in the draft. The dashboard shows saved answers immediately and flags a draft that predates them. After recording a question, end the turn; the owner's answer comes back as a message. Only in a harness without workers, keep the session available with a story-scoped `wait`, acknowledging earlier handled events so the wait can return the next one. If the session ends, the console shows a resume message the owner can paste into Jarvis. Close the frontier before posting the proposed plan. Fury's approval is a separate transition.
3. Jarvis dispatches workers through the chosen harness. Record its assignment when a session reference is available. Record meaningful progress and changed files using observations from the worker or worktree. The dashboard shows the harness label and the age of the latest report. A recent report is evidence of activity at that time. Verify live runtime status using the host before claiming a worker is still running. Keep secrets and sensitive diffs out of reports.
4. Record handoffs after the actual AI SDLC gate passes. Attach the exact red or green verification command and what it demonstrated. On review findings, return the story to build. On an unresolved scope decision, return it to Cap and ask for a new approval. If a PR already exists, update and register the same PR after the new review. Apply the existing AI SDLC gates for cross-model sharing, optional before-and-after, and PR creation.
5. On resume, read the current story snapshots and pending wakes. Reconcile the reported phase with the host, worktree and forge before dispatching or retrying. For example, check whether the branch already has a PR before opening another. Acknowledge the particular wake once it has been handled or superseded by verified state. Acknowledgement retains history. Run one Jarvis coordinator per database. SQLite serializes writes, while coordinating and claiming agent executions stays with the host.

For every human decision in a console-managed story, write its prerequisite evidence and decision state before pointing the owner to the dashboard. Planning uses question records, approval uses the submitted plan, and before-and-after uses the `comparison-choice` phase. The dashboard tells the owner a decision is waiting: its tab title carries the count, and it shows a desktop notification once the owner has pressed "Notify me". A chat question or native picker is not a console event. If the owner answers through chat, record that explicit response against the still-open decision once. Reconcile the latest revision to avoid overwriting a concurrent dashboard answer. Report a disagreement between two answers to the owner.

## Record and recover

### Delete a story

Use **Delete story…** on the story page to authorize cleanup of that story's work. The console queues `request-cleanup`, stops accepting ordinary work updates, and keeps the story and references visible. Jarvis prioritizes the cleanup over earlier handoffs. If its session is idle, use the resume message on the story page.

Before cleanup, verify the story's repository, branch, worktree, recorded worker, and forge state independently. End and release the story's worker. Confirm that assets are dedicated to the story. Undo story-owned work by removing its dedicated worktree and branch, and close any open PR that this story created. Include the story's dedicated remote branch when it exists. Preserve unrelated changes and pre-existing tickets. If work was merged, report it and agree on a revert separately. Do not rewrite shared history. If ownership, scope, or cleanup cannot be verified, record `cleanup-blocked` with the concrete reason. Reconcile already finished steps before retrying.

### Clear shipped stories

A merged story whose retro is running stays in the Ship lane. A merged story whose retro has finished leaves the Command Center board and appears in the Archive tab, which the "shipped" counter also opens. **Clear** on a row, or **Clear all** for the rows the repository filter shows, lists what will be deleted, including how many git-ignored files the worktree holds and the first few, and asks for confirmation. The Command Center then clears each story itself (ADR 0021): it refuses unless the worktree is clean, on the story branch, and every commit is on a remote branch or in the merged PR head, and records `cleanup-blocked` with the reason when a check fails. A clear removes the worktree, the local branch, `stories/<ID>` and `notes/<ID>` under the AI SDLC home, the story's attachments, and its worker and Jarvis turn logs, then records `complete-cleanup`. Remote branches and PRs stay. Its cleanup events carry `by: "jarvis"`, so none wakes Jarvis.

### Complete a cleanup

Record `complete-cleanup` with verification evidence only after the story-owned cleanup is complete. This removes the story, event history, and queued wakes from the console. A minimal deletion marker reserves the old story ID and prevents a stale worker from writing to a new story with that ID. Use a new ID for the next story.

Send one JSON event to `record` on stdin. Use a fresh globally unique `key` for new events. Retrying an uncertain write with the same serialized request and key returns the original receipt. For events after creation, use the current story `revision` from `snapshot`. A stale revision is rejected. Reread the story before deciding whether the original action still applies.

Any event may carry `"by": "jarvis"`, and no other value. Such an event is kept on the story but is not pending, so it never wakes the background Jarvis. `record` adds it to every event when its environment has `AI_SDLC_ACTOR=jarvis`, as the background Jarvis's program does; the Jarvis chat adds it itself.

```powershell
@{
  story = 'TL-142'
  key = [guid]::NewGuid().ToString()
  type = 'create'
  title = 'Stabilize orders pagination'
  detail = 'Keep order and cardinality stable when two timestamps tie.'
  branch = 'codex/tl-142'
  worktree = 'C:/worktrees/tl-142'
  harness = 'Codex'
} | ConvertTo-Json -Compress | node $console record $missionDb

node $console snapshot $missionDb
node $console snapshot $missionDb 'Cursor'
node $console pending $missionDb
node $console ack $missionDb 1
```

The `ack` argument is the exact sequence number reported by `pending`. Use it only after handling the matching event.

| Event | Additional fields and effect |
|---|---|
| `create` | `title`, `detail` (brief), `branch`, `worktree`, and `harness` (for the full story), plus `repo`, the story's repository as `owner/name`, which the Command Center shows and filters by. Starts planning. |
| `select-harness` | One-time migration for an older open story with no recorded harness and no active assignment. Set `harness` only after verifying the story used that harness. |
| `question` | `question` (unique within the story), `prompt`, `options`, `recommended` (zero-based option index). |
| `answer` | `question` and `answer` (option index or custom text). Use the dashboard or record Fury's explicit response. |
| `draft-plan` | `detail` contains the latest working plan while planning. Include the current `assignment` when a planner is assigned. Updating a draft does not request approval. |
| `diagram-start` | `detail` gives Rocket's architecture diagram scope. Start from publishing, CI, or merge-ready, after the review and the comparison, and after releasing any existing worker; review and comparison refuse it. Assign Rocket in the diagram phase. Release him and record a `handoff` with the evidence. It returns to the phase it started from. |
| `artifact` | `kind` is `before`, `after`, `diagram`, `recording`, or `document`. `path` is an existing absolute PNG, JPEG, WebP, MP4, or WebM file (for `document`: a .md, .json, or .txt file up to 1 MiB, such as the context pack, approved design, gate results, or retro), and `detail` describes the capture. Include the current `assignment` when a worker is assigned. The dashboard renders images and videos from registered paths. Keep the files available until cleanup and register again if a capture changes. |
| `plan` | `detail` contains Cap’s proposed plan. All questions must be answered. |
| `approve` | Record Fury’s explicit plan approval. Starts test authoring. |
| `assign-worker`, `release-worker` | Assignment takes `session` (non-secret reference in the selected harness). Release takes `assignment` (the current `worker.id`) and `detail` confirming the worker is idle or stopped. Release before changing phases or assigning a replacement. A worker that asks a question keeps its assignment and ends its turn, so the answer resumes its session; released first, the answer reaches no worker and Jarvis has to staff the story again. |
| `turn-started`, `turn-ended` | Recorded by the Command Center for a worker whose program it started. Start takes the current `assignment`, the program's `pid`, and its `log` file. End takes `outcome` (`ended`, `failed`, or `lost`), the exit `code` when known, `detail`, and `wake`: true makes it a pending event for Jarvis. The story shows the running turn as `worker.turn` and the last one as `worker.lastTurn`. |
| `jarvis-woken`, `jarvis-turn-started`, `jarvis-turn-ended` | Recorded by the Command Center for the story's background Jarvis session. Woken takes `handled`, the highest news seq handed to the turn; start takes `session`, `pid` and `log`; end takes `outcome` (`ended`, `failed`, or `lost`), the exit `code` when known, and `detail`. The story shows them as `jarvis` (`session`, `handled`, `turn`, `lastTurn`). They change no phase, are never pending, and are accepted on a blocked story or one awaiting cleanup. A failed or lost turn is followed by an `action-jarvis-<seq>` question, which is accepted there too. |
| `activity` | `detail` reports an observation. Include the matching `assignment` when a worker is assigned. With no worker assignment, Jarvis can record an untagged observation. Optional `file`, `change`, and `diff` add a changed-file entry. Optional `posted` lists the GitHub node IDs of comments the worker posted on the PR; the story keeps the newest 500 as `prPosted`, and Hawkeye never counts them, or a thread whose last comment is one of them, as feedback. |
| `handoff` | `detail` provides evidence for the current phase. Provide `command` for verified red, build, gate, or mutation checks. From `pr-review`, optional `seen` lists the review keys the worker read (at most 1000); they join `prSeen`. |
| `return-to-build`, `return-to-testing`, `replan` | `detail` identifies a verified review or gate finding, or the change the owner asked for on seeing the comparison (`return-to-build`, from review, gates, comparison, or PR review, where it takes the same optional `seen` as `handoff`; each review return counts a round, shown as Review round N; the limit is the profile's `reviewRoundLimit`), surviving mutants (`return-to-testing`, from mutation), or a reopened scope decision. |
| `retro-start` | `detail` gives the retro scope. Allowed while the PR is open (CI or merge-ready), so the retro runs before the story closes. A `handoff` with the lessons returns to the prior phase, or closes the story when a merge has set the return phase to `closed`. The retro worker keeps its assignment through a `merged`. |
| `pr-review-start` | `detail` names the new feedback. Allowed from CI or merge-ready while the PR is open; clears readiness and moves the story to `pr-review`, where Hawkeye's worker summarizes each comment as a question for the owner, applies the chosen fixes, replies and resolves threads. A `handoff` returns to CI; `return-to-build` and `merged` are also accepted there, `retro-start` is not. |
| `blocked`, `resume` | `detail` gives the blocker or its resolution. |
| `assign-worktree` | `branch` and `worktree` record verified coordinates after assignment or recovery. Keep the branch of any existing PR. |
| `comparison-choice` | `run` is Fury’s explicit before-and-after choice. |
| `pr-opened` | `url` is the observed HTTPS PR URL. |
| `pr-ready`, `pr-recheck`, `merged` | `detail` records current-head checks and review, a new head or regression, or an observed merge. `merged` is accepted in every open phase with a registered PR: once the retro has finished it closes the story, and otherwise it moves the story to the retro (or keeps it there) with return phase `closed`, shown as "Merged · retro in progress" in the Ship lane, and the lessons `handoff` closes it. Release any worker outside the retro first. Supply the reviewed `head` for `pr-ready` when Hawkeye has recorded a PR observation. `pr-ready` is refused while that observation shows changes requested or unresolved threads on the observed head; earlier-head feedback does not block it. |
| `pr-observed` | Hawkeye records the head, check status, any failures and the `review` for the registered PR. This evidence does not advance the workflow phase and is accepted in every open phase. A review key the story has not seen before (`prSeen`) wakes Jarvis, with `feedback: true` on the event, even while a CI worker is assigned; a resolved thread or a newer activity time does not. During `pr-review` nothing in the review wakes and `prSeen` is left alone; the first observation afterwards wakes for any key the worker's `handoff` did not list in `seen`. A merged or closed observation is news for Jarvis even while a worker is assigned. |
| `request-cleanup`, `cleanup-blocked`, `complete-cleanup` | Request from the dashboard or record the user's explicit instruction. Jarvis uses `detail` for the blocker or verified completion. Completion requires the worker to be released. |

## Firstmate decisions

Firstmate is the architecture reference. This implementation uses original code and the existing AI SDLC skills.

| Adopted idea | Local implementation |
|---|---|
| Single coordinator with specialized workers and a scout | Jarvis routes the roles in the AI SDLC persona map. Hawkeye records forge observations. Fury decides. |
| Worktree isolation and per-task brief | Stable story ID, brief, branch and worktree references. The agent host manages worktrees using Git. |
| Durable status and explicit handoff evidence | SQLite story snapshots and event history. CLI reports drive the dashboard and changed-file views. |
| Durable wake queue and acknowledgement | Actionable events are committed with the story transition and remain pending until acknowledged by sequence. |
| Background PR observation | Hawkeye polls registered GitHub PRs with the GitHub CLI and queues actionable changes. Jarvis can wait for a story wake through the same local CLI. |
| Resume by reconciling state | Jarvis checks the actual host session, Git worktree, and forge before retrying a side effect. |
| PR registration and merge observation | Record the PR URL, current-head evidence, any recheck, and a distinct observed-merge event. |

Out of scope for this PR are the upstream repository and scripts, Treehouse, Orca, tmux or other Firstmate session adapters, `no-mistakes` and its delivery modes, persistent or SSH secondmates, automatic worktree allocation or cleanup, waking closed agent chats, agent recovery or relaunch, Relay, fleet/backlog sync, self-updates, and automatic merges. GitHub and the current agent host remain external systems for their existing jobs. The Mission Console page polls explicit records and has no ability to spawn agents or run shell commands. The Command Center starts workers and, to clear a shipped story, runs fixed git commands and deletions (ADR 0021).

[Firstmate architecture](https://github.com/kunchenguid/firstmate/blob/main/docs/architecture.md) · [Watcher continuity](https://github.com/kunchenguid/firstmate/blob/main/docs/watcher-continuity.md)

## Phases and the Plan view

New stories start in `scout` (`handoff` to planning with the context pack registered as a `document`). The order is scout, planning, approval, testing, red, building, gates, mutation, review, comparison, diagram, publishing, ci, merge, closed, with diagram entered from publishing, ci or merge (not from review or comparison) and returning to the phase it started from, retro entered from ci or merge, and pr-review entered from ci or merge and returning to ci. Gates and mutation handoffs require the `command` run; gate results are recorded as ordinary `activity` events. A review cap escalation is a normal `question` event with the round counter in `detail`.

Once a plan exists, the story page shows a **Plan** tab beside **Overview**. It renders the latest registered `document` whose file name contains `design` (for example `docs/design.md`), falling back to the plan stored in the story. Register the updated design file again after each new approval.
