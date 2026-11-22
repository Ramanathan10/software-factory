# Factory runbook

How Jarvis runs stories with workers, in any harness. It applies the [Jarvis skill](SKILL.md): Jarvis directs, each story runs in its own worktree from the latest remote default branch, and Hawkeye keeps the factory moving. The phases themselves are the `ai-sdlc` skill's.

The steps are the same everywhere. Four of them are done with calls that differ by harness, and the harness sections below name those calls:

| Step | What the harness section names |
|---|---|
| Start a worker | How to open a worker session in its own worktree with a kickoff prompt |
| Message a worker | How to send a prompt to a worker session that already exists |
| Wake the coordinator | How the Jarvis chat learns that the owner decided something |
| Report an idle worker | How Jarvis learns that a worker ended its turn |

The files Jarvis and the workers run are named here by their key in the preflight check's `commandCenter` output: `<console>`, `<launcher>`, `<harnesses>`, and `<readiness>` each stand for the full path printed there. Run the check before anything else; if `commandCenter` is `null`, fix the problem it reports first.

Every harness is a row in one table, the `<harnesses>` file, and the first step is the same in all of them: run `node <harnesses> start "<harness>" <worktree path>` with the kickoff prompt on stdin, and do what it prints.

| It prints | Meaning |
|---|---|
| `session` and `log` | The worker is running. Continue with "Harnesses driven from the command line". |
| `inApp` with `start` and `message` | Nothing was started. Start the worker with the named tool, as the harness's own section describes. |
| `noWorkers` | The harness cannot run workers yet. Tell the owner before doing a story's work in the Jarvis chat. |

## Harnesses driven from the command line

Claude Code and Codex run a worker as a session of their own command-line program; the table holds the program and its arguments. Record stories with the harness name exactly as the table spells it: "Claude Code" or "Codex".

| Step | Call |
|---|---|
| Start a worker | Create the story's worktree with `git worktree add <worktreeRoot>/<branch> -b <branch> origin/<default branch>`, where `worktreeRoot` is `repo.worktreeRoot` in the preflight check. Write the kickoff prompt to a file, then run `node <harnesses> start "<harness>" <worktree path> < <kickoff file>`. It prints `{"session": "...", "log": "..."}` and returns while the worker keeps running. Record `assign-worker` with that `session`. |
| Message a worker | The Command Center does this itself: when the owner decides in the console, it resumes the story's worker session in the story's worktree with the event message. Jarvis does not forward anything. |
| Wake the coordinator | Not available. A decision that could not reach its worker stays pending, and Jarvis finds it by reading `pending` at the start of each turn. |
| Report an idle worker | Not available. A worker's turn ends when its program exits; the console then shows the story waiting on the owner or on the next phase. Jarvis reads the console at the start of each turn. |

What a worker may do without asking comes from `workerPermissions` in the AI SDLC profile. A `restricted` worker edits files in its worktree and runs git, `gh`, node, and the programs the profile's gates use; anything else it needs is refused, and it records the refusal as a console `action-` question. Each worker's output is written to the `log` file the start call printed, under `workers` in the AI SDLC home; read it when a worker stops without recording anything.

The Command Center only queues messages behind turns it started itself. Tell each worker in its kickoff to end its turn as soon as it has posted its questions or plan, so a decision never arrives while the first turn is still running.

## GitHub Copilot app

The owner's Jarvis chat coordinates and each story runs in its own coding session. The app's sessions are started and messaged with tools only the agent inside the app can call, so its row in the table names those tools and the start call prints them without starting anything. Its Command Center runs as the `ai-sdlc-console` extension, which `node install.mjs copilot` installs. Record stories with the harness "GitHub Copilot app".

| Step | Call |
|---|---|
| Start a worker | Map the repository to its configured app project with `list_repositories`, using `repoAliases` under `adapters.copilot` in the AI SDLC profile. Then `create_session` with `project_id` set to that repository, `workspace_type: "worktree"` (the app chooses where the worktree goes, so `worktreeRoot` does not apply), `base_branch` set to the remote default branch (run `git fetch` in a read-only way first), `kickoff.mode: "autopilot"`, `notify_on_idle: "always"`, a short `name` such as `<id> <topic>`, and the kickoff prompt. Do not pass a `schedule`. |
| Message a worker | `send_session_message` with `delivery_mode: "immediate"` to the worker session. |
| Wake the coordinator | The extension runs inside the Jarvis chat and hosts the Command Center. When the owner decides in the console, it sends Jarvis a `[Mission Console event]` message naming the story, event seqs and worker session, and Jarvis forwards it with `send_session_message`. If the story has no worker, the message says so and Jarvis starts or resumes one. |
| Report an idle worker | `notify_on_idle: "always"` on the worker session wakes Jarvis when the worker ends its turn. |

- **Canvas.** The extension only runs while its canvas is open. If the canvas has not been opened in the Jarvis chat since the extension loaded, open it so the server and the wake-up are running. Canvas `record_event` calls do not trigger the wake-up, so there is no loop.
- **Console access.** Jarvis records through the canvas actions (`create_story`, `record_event`, `pending`, `ack`, `handover`) or the CLI. Workers use the CLI; the check's `<console>` path is the installed one, under `~\.copilot\extensions\ai-sdlc-console`.
- **Protected automations.** Never call `save_session_automation` on the Jarvis chat if `adapters.copilot` in the profile lists `protectedAutomations`, the recurring jobs the owner keeps on that chat.
- **Reset.** Archive the story worker sessions Jarvis created; this removes their worktrees and any leftover schedules. Leave the Jarvis chat's protected automations untouched. The extension host holds the database file open. Confirm with `get_snapshot` that it is empty.

### Copilot setup questions

Ask these once per machine, after `ai-sdlc-setup` has saved the profile and when the profile has no `adapters.copilot` section. If an older `copilot.json` sits beside the profile, move its contents into that section instead of asking again, then delete it. Ask one question at a time with `ask_user`. Every question may be skipped; record a skipped answer as empty. Do not infer answers from another person's habits.

1. **Repositories.** "Which repositories will you run stories in, and what nicknames do you use for them?" Match each to a configured app project (`list_repositories`); offer to add missing ones. Save as `repoAliases`: `{ "<nickname>": "<owner/repo>" }`.
2. **Protected automations.** "Does this chat already hold recurring jobs Jarvis must never replace?" Save as `protectedAutomations`, a list of names.

Add the answers to the profile under `adapters.copilot`, leaving the rest of the file as it is:

```json
"adapters": {
  "copilot": {
    "repoAliases": {},
    "protectedAutomations": []
  }
}
```

Show the saved section and tell the owner they can edit it directly. If a later story needs an answer it lacks, such as a new repository nickname, ask that single question and update that section. Names and settings only; never write a credential into it.

## Intake (Jarvis)

Jarvis does only these steps. Everything else belongs to the story worker.

1. Read the work item (title, description, acceptance criteria, tags, parent, children, comments) to name the story. Do not scout the repository.
2. Record `create` in the console with a branch named from the profile's branch pattern for that repository (`repo.branchPattern` in the preflight check), and the harness's name as its section above gives it. The worktree is a placeholder until the worker records `assign-worktree`.
3. **Start a worker** for the story, in a new worktree from the remote default branch, for example `origin/main`. Fetch first so the ref is current. Never work in the repository's primary checkout. Give the worker a short name such as `<id> <topic>` and the kickoff prompt below.
4. Record `assign-worker` with `session` set to the new worker's session id, so console decisions route to it. Do not attach a schedule; the factory is event-driven (below).
5. Tell the owner which workers started and which decisions are waiting on them. Then stop.

Independent stories each get their own worker and worktree, so they run in parallel.

## Story worker kickoff template

Give complete, standalone context:

- Identity: dedicated worker for console story `<STORY>`, with the work item link and the verbatim title, description, acceptance criteria and child tasks. Jarvis directs; the worker does every phase through the `ai-sdlc` persona skills.
- Worktree first: `git fetch origin`. If HEAD is not the remote default branch and the branch has no changes, reset it there. Use the story's branch. Record `assign-worker` (session = its own session id), then `assign-worktree` with the branch, absolute path and base commit.
- Console access: `node <console> snapshot|record <db>`, with `--experimental-sqlite` on Node 22. Write the full `<console>` path into the kickoff so the worker does not have to find it. The database is the one the Command Center opened: `AI_SDLC_CONSOLE_DB` when set, else an existing `~\.copilot\ai-sdlc-console\jarvis-missions.sqlite`, else `console\jarvis-missions.sqlite` in the AI SDLC home (`AI_SDLC_HOME`, default `~\.ai-sdlc`). Use the current story `revision` and a fresh `key` for every write.
- The worker scouts the repository itself (Black Widow) and records the scout summary in `draft-plan`.
- Ask the owner only through console `question` events, never in chat. After posting questions or a `plan`, end the turn; that reports the worker idle to Jarvis. The owner's console decisions come back as a message, which wakes the worker to act on them.
- `ack` only this story's console events, and only after handling them.
- Carry over any decisions the owner already recorded, quoted verbatim, including shared decisions from other stories.
- Gates: no tests or code before plan approval; test-first by a separate subagent; no PR, work-tracker write or handoff unless the phase and the owner allow it.

## Hawkeye event chain (no schedules)

The factory is event-driven. Nothing polls; each step finishing notifies the next.

1. **The owner decides in the console.** When the console POSTs an `answer`, `approve`, `plan-feedback`, `comparison-choice` or `request-cleanup`, the Command Center waits 1.5 s to batch a burst, then sends a `[Mission Console event]` message naming the story and event seqs.
2. **The message reaches the story's worker.** Where the adapter can message a worker directly, the Command Center sends it straight there. Otherwise it **wakes the coordinator**, and Jarvis forwards it at once with **message a worker**, asking the worker to act on and `ack` those seqs. Jarvis does not do the work.
3. **The worker acts**, acks the events and continues through the next phases in the same session.
4. **The worker ends its turn** at a question or gate. **Report an idle worker** wakes Jarvis, which checks the console and reports to the owner.

Do not attach schedules to workers. Worker-recorded events do not trigger step 1, so there is no loop. The chain only runs while the Command Center is running. Outside the GitHub Copilot app, start it with `node <launcher>` as a background command; it prints the dashboard's address, and says so if one is already running.

## Undelivered decisions

A decision the Command Center cannot hand to a worker stays pending in the store; nothing is lost. The Command Center tells Jarvis why when the adapter can wake the coordinator, and otherwise prints the reason where it was started. Jarvis also reads `pending` at the start of each turn, so a decision nobody announced is still found.

Jarvis does not act on the decision itself. It tells the owner what happened and what to do next:

| Reason | What Jarvis does and tells the owner |
|---|---|
| No worker is assigned | Start or resume the story's worker with the handover record, forward the decision to it, and tell the owner the worker is running again. |
| The worker could not be messaged | Record `release-worker` for the lost session, start a replacement with the handover record, forward the decision, and tell the owner the worker was replaced and why. If the replacement cannot be started either, say so and name what the owner must do, such as signing in or freeing the worktree. |
| The story's harness has no adapter | Tell the owner that decisions for this harness are not delivered automatically: after deciding in the console, they say "resume story `<STORY>`" in the Jarvis chat. Offer the harnesses that do have an adapter for the next story. |

Acknowledge a pending decision only after its worker has handled it.

## Decision handling

- **Shared decisions**, such as the verification environment or authorization to use other model providers, are asked once on the first story. Jarvis routes the answer to every story it covers. Workers do not re-ask.
- **A custom answer that is itself a question or pushback** is not a decision. The worker answers it with evidence in `draft-plan`, then posts a revised question. Never treat it as approval of an option.
- **Feasibility check:** before accepting an environment choice, check that it can actually run, using the `sharedResources` in the AI SDLC profile (installed services, databases, hosts). If it cannot run, ask a follow-up question naming concrete machines or alternatives.
- **Reconcile before asking:** read the console for an existing answer before posting a new question.
- **Shared machine:** parallel stories may run on the same machine. Workers must not compete for local resources such as installed services, ports, databases listed in the profile's `sharedResources`, or heavy build and test runs. Before stopping or replacing a shared service, a worker asks Jarvis for an exclusive window and reports "swap released" once the service is restored. Jarvis grants one window at a time. Agent shells are not elevated, so if the swap needs an admin step, Jarvis posts an `action-` question (below) when granting the window. Test databases get story-specific names, and a worker never deletes another story's databases.
- **Required pipeline:** if the AI SDLC profile lists `requiredPipelines` for the repository, a PR needs a successful run of each (its `name`, `url`, and `triggersOnlyOnDefaultBranch` flag). Hawkeye watches the run for the PR and reports the result and link to Jarvis. The story stays in `ci` until the run succeeds. When `triggersOnlyOnDefaultBranch` is true, the worker queues the pipeline on its own story branch without asking; the owner's gate already authorizes that. Open the PR only after the run succeeds. Report the run with an `activity` event that includes `pipeline: <run URL>` so the story card links to it. The card phase must always match the work actually happening. If that pipeline is the only place the live tests can run, finish the test, build and review work, record each handoff, and wait for the run in `ci`, not `testing`. A failing run sends the story back through `return-to-build` when the store allows it (from `review`). Before the PR (`publishing`), a test-only fix is recorded as an `activity` with the fix commit and the new `pipeline:` link, and the story stays in `publishing`.
- **Decisions for the owner:** any decision the owner must make, in any phase and whether raised by a worker or Jarvis, is recorded as a console `question` first so it appears in the "You · human approver" queue. Never ask the owner in chat only. Answers wake the worker as usual. Before asking, check whether an existing instruction already authorizes the action.
- **Actions for the owner:** anything only the owner can physically do (an elevated command such as stopping a service, an install, a sign-in, a restart) is also a console `question`, never a chat request alone. Its id starts with `action-`, its prompt starts "Action for you:", names the exact command and target (service name, display name, process), and its options are `Done - <state reached>` (recommended), a fallback that needs no action, and `Hold - not now`. The story then shows as waiting on the owner, not on the worker. Whoever discovers the need posts it: the worker for its own steps, Jarvis when granting a shared-service window that requires the owner. Answering wakes the worker. When the worker finishes and needs the owner to undo the step (for example `Start-Service`), it posts another `action-` question.
- **Plan feedback:** in the plan reader the owner can click any heading, bullet, paragraph or table row, comment on it, and choose "Request changes". The `plan-feedback` event returns the story to `planning`, moves the plan to `draftPlan` and stores the comments in `story.feedback`; its event detail lists each quoted element and comment. The worker addresses every comment (or answers it with evidence in `draft-plan`), then posts a revised `plan` for approval.

## Readiness check

Read-only, and the same in every harness. When a story enters a console phase listed in `repo.readiness.phases` of the preflight check (by default `ci`, `merge`, and `closed`), and `repo.readiness.tracker` is not `none`, Jarvis runs:

```
node <readiness> <story id> --repo <owner/name>
```

`<readiness>` is the `readiness` path in the check's `commandCenter` output, and `<owner/name>` is `repo.slug`. Add `--tests-pass` when the story's gates have passed. Do what it prints:

| It prints | Meaning |
|---|---|
| `checklist` and `questions` | The story was read. Record each question as a console `question` for the owner; report unmet checklist items with the story's status. |
| `inApp` with `next` | Only the agent's own tools can read this tracker (Linear). Read the story with them, build the snapshot `next` describes, and run the same command again with `--snapshot` and that JSON on stdin. |
| `skipped` | The repository has no tracker, or the story is assigned to someone else. Nothing to do. |
| `problem` | A setting is missing. Fix it through `ai-sdlc-setup`. |

The trackers are the rows of `readiness-sync/trackers.mjs`, beside the `<readiness>` file. Nothing in the check writes to a tracker; changing a work item stays the owner's decision.

## Reset

When the owner asks to reset the console:

1. Close the story worker sessions Jarvis created and remove their worktrees, as the harness section describes. Leave anything else on the Jarvis chat untouched.
2. Back up the store with `VACUUM INTO` to a `backup-<timestamp>` folder beside the database.
3. Delete rows from `events` and `stories`. The Command Center holds the file open, so do not replace the file.
4. Confirm the snapshot is empty.
