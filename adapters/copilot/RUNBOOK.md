# Running AI SDLC in the GitHub Copilot app

Concrete runbook for the "GitHub Copilot app" harness, where the owner's Jarvis chat coordinates and each story runs in its own coding session. It applies the [Jarvis skill](../../skills/jarvis/SKILL.md): Jarvis directs, each story runs in its own worktree from the latest remote default branch, and Hawkeye keeps the factory moving. The phases themselves are the `ai-sdlc` skill's.

## Intake (Jarvis)

Jarvis does only these steps. Everything else belongs to the story worker.

1. Read the work item (title, description, AC, tags, parent, children, comments) to name the story. Do not scout the repository.
2. Record `create` in the console (`create_story` canvas action or the CLI) with branch `pbi/<id>-<slug>` and the harness "GitHub Copilot app". The worktree is a placeholder until the worker records `assign-worktree`.
3. Map the repository to its configured app project with `list_repositories`, using the `repoAliases` in the Copilot adapter profile (see [setup](setup.md)). Never work in the project's primary checkout.
4. Start the story worker with `create_session`:
   - `project_id`: the configured repository.
   - `workspace_type: "worktree"`.
   - `base_branch`: the remote default branch, for example `origin/main`. Run `git fetch` in a read-only way first so the ref is current.
   - `kickoff.mode: "autopilot"`, `notify_on_idle: "always"`, and a short `name` such as `PCS-<id> <topic>`.
   - The kickoff prompt follows the template below.
5. Record `assign-worker` with `session` set to the new worker session id, so console decisions route to it. Do not pass a `schedule`; the factory is event-driven (below).
6. Tell the owner which sessions started and which decisions are waiting on him. Then stop.

Independent stories each get their own session and worktree, so they run in parallel.

## Story worker kickoff template

Give complete, standalone context:

- Identity: dedicated worker for console story `<STORY>`, with the ADO link and the verbatim title, description, AC and child tasks. Jarvis directs; the worker does every phase through the `ai-sdlc` persona skills.
- Worktree first: `git fetch origin`. If HEAD is not the remote default branch and the branch has no changes, reset it there. Use branch `pbi/<id>-<slug>`. Record `assign-worker` (session = its own session id), then `assign-worktree` with the branch, absolute path and base commit.
- Console access on Node 22: `node --experimental-sqlite <jarvis.mjs> snapshot|record <db>`. The console is `~\.copilot\extensions\ai-sdlc-console\mission-console\jarvis.mjs`. The database is the one the Command Center opened: `AI_SDLC_CONSOLE_DB` when set, else an existing `~\.copilot\ai-sdlc-console\jarvis-missions.sqlite`, else `console\jarvis-missions.sqlite` in the AI SDLC home (`AI_SDLC_HOME`, default `~\.ai-sdlc`). Use the current story `revision` and a fresh `key` for every write.
- The worker scouts the repository itself (Black Widow) and records the scout summary in `draft-plan`.
- Ask the owner only through console `question` events, never in chat. After posting questions or a `plan`, end the turn; the idle notification reaches Jarvis. Jarvis forwards the owner's console decisions as an immediate message, which wakes the worker to act on them.
- `ack` only this story's console events, and only after handling them.
- Carry over any decisions the owner already recorded, quoted verbatim, including shared decisions from other stories.
- Gates: no tests or code before plan approval; test-first by a separate subagent; no PR, ADO write or Done-Done unless the phase and the owner allow it.

## Hawkeye event chain (no schedules)

The factory is event-driven. Nothing polls; each step finishing notifies the next.

1. **the owner decides in the console.** The `ai-sdlc-console` extension runs inside the Jarvis chat. When the console POSTs an `answer`, `approve`, `plan-feedback`, `comparison-choice` or `request-cleanup`, it waits 1.5 s to batch a burst, then sends Jarvis a `[Mission Console event]` message naming the story, event seqs and worker session.
2. **Jarvis forwards immediately.** On that message, Jarvis calls `send_session_message` with `delivery_mode: "immediate"` to the named worker session, asking it to act on and `ack` those seqs. If the story has no worker, Jarvis starts or resumes one. Jarvis does not do the work.
3. **The worker acts**, acks the events and continues through the next phases in the same session.
4. **The worker ends its turn** at a question or gate. `notify_on_idle: "always"` wakes Jarvis, which checks the console and reports to the owner.

Do not attach `schedule` to workers, and never call `save_session_automation` on the Jarvis chat if the Copilot adapter profile lists `protectedAutomations` (recurring jobs the owner keeps on that chat). Worker-recorded events and canvas `record_event` calls do not trigger step 1, so there is no loop. If the canvas has not been opened in the Jarvis chat since the extension loaded, open it so the server (and the wake-up) is running.

## Decision handling

- **Shared decisions**, such as the verification environment or authorization to use other model providers, are asked once on the first story. Jarvis routes the answer to every story it covers. Workers do not re-ask.
- **A custom answer that is itself a question or pushback** is not a decision. The worker answers it with evidence in `draft-plan`, then posts a revised question. Never treat it as approval of an option.
- **Feasibility check:** before accepting an environment choice, check that it can actually run, using the `sharedResources` in the AI SDLC machine profile (installed services, databases, hosts). If it cannot run, ask a follow-up question naming concrete machines or alternatives.
- **Reconcile before asking:** read the console for an existing answer before posting a new question.
- **Shared machine:** parallel stories may run on the same machine. Workers must not compete for local resources such as installed services, ports, databases listed in the machine profile's `sharedResources`, or heavy build and test runs. Before stopping or replacing a shared service, a worker asks Jarvis for an exclusive window and reports "swap released" once the service is restored. Jarvis grants one window at a time. Agent shells are not elevated, so if the swap needs an admin step, Jarvis posts an `action-` question (below) when granting the window. Test databases get story-specific names, and a worker never deletes another story's databases.
- **Required pipeline:** if the AI SDLC repository profile lists `requiredPipelines`, a PR needs a successful run of each (its `name`, `url`, and `triggersOnlyOnDefaultBranch` flag). Hawkeye watches the run for the PR and reports the result and link to Jarvis. The story stays in `ci` until the run succeeds. When `triggersOnlyOnDefaultBranch` is true, the worker queues the pipeline on its own story branch without asking; the owner's gate already authorizes that. Open the PR only after the run succeeds. Report the run with an `activity` event that includes `pipeline: <run URL>` so the story card links to it. The card phase must always match the work actually happening. If that pipeline is the only place the live tests can run, finish the test, build and review work, record each handoff, and wait for the run in `ci`, not `testing`. A failing run sends the story back through `return-to-build` when the store allows it (from `review`). Before the PR (`publishing`), a test-only fix is recorded as an `activity` with the fix commit and the new `pipeline:` link, and the story stays in `publishing`.
- **Decisions for the owner:** any decision the owner must make, in any phase and whether raised by a worker or Jarvis, is recorded as a console `question` first so it appears in the "You · human approver" queue. Never ask the owner in chat only. Answers wake the worker as usual. Before asking, check whether an existing instruction already authorizes the action.
- **Actions for the owner:** anything only the owner can physically do (an elevated command such as stopping a service, an install, a sign-in, a restart) is also a console `question`, never a chat request alone. Its id starts with `action-`, its prompt starts "Action for you:", names the exact command and target (service name, display name, process), and its options are `Done - <state reached>` (recommended), a fallback that needs no action, and `Hold - not now`. The story then shows as waiting on the owner, not on the worker. Whoever discovers the need posts it: the worker for its own steps, Jarvis when granting a shared-service window that requires the owner. Answering wakes the worker. When the worker finishes and needs the owner to undo the step (for example `Start-Service`), it posts another `action-` question.
- **Plan feedback:** in the plan reader the owner can click any heading, bullet, paragraph or table row, comment on it, and choose "Request changes". The `plan-feedback` event returns the story to `planning`, moves the plan to `draftPlan` and stores the comments in `story.feedback`; its event detail lists each quoted element and comment. The worker addresses every comment (or answers it with evidence in `draft-plan`), then posts a revised `plan` for approval.

## Reset

When the owner asks to reset the console:

1. Archive the story worker sessions Jarvis created. This removes their worktrees and any leftover schedules. Leave the Jarvis chat's own automations (the Copilot adapter profile's `protectedAutomations`) untouched.
2. Back up the store with `VACUUM INTO` to a `backup-<timestamp>` folder beside the database.
3. Delete rows from `events` and `stories`. The extension host holds the file open, so do not replace the file.
4. Confirm `get_snapshot` is empty.
