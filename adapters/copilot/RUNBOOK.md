# Running AI SDLC in the GitHub Copilot app

The calls for the "GitHub Copilot app" harness, where the owner's Jarvis chat coordinates and each story runs in its own coding session. The [factory runbook](../../skills/jarvis/RUNBOOK.md) gives the steps: intake, the worker kickoff, the event chain, undelivered decisions, decision handling and reset. This file names only what the Copilot app does for each.

Record stories with the harness "GitHub Copilot app".

## Start a worker

1. Map the repository to its configured app project with `list_repositories`, using the `repoAliases` in the Copilot adapter profile (see [setup](setup.md)). Never work in the project's primary checkout.
2. Start the story worker with `create_session`:
   - `project_id`: the configured repository.
   - `workspace_type: "worktree"`.
   - `base_branch`: the remote default branch, for example `origin/main`. Run `git fetch` in a read-only way first so the ref is current.
   - `kickoff.mode: "autopilot"`, `notify_on_idle: "always"`, and a short `name` such as `PCS-<id> <topic>`.
   - The kickoff prompt follows the factory runbook's template.

Do not pass a `schedule`.

## Message a worker

`send_session_message` with `delivery_mode: "immediate"` to the worker session.

## Wake the coordinator

The `ai-sdlc-console` extension runs inside the Jarvis chat and hosts the Command Center. When the owner decides in the console, it sends Jarvis a `[Mission Console event]` message naming the story, event seqs and worker session, and Jarvis forwards it with `send_session_message`. If the story has no worker, the message says so and Jarvis starts or resumes one.

The extension only runs while its canvas is open. If the canvas has not been opened in the Jarvis chat since the extension loaded, open it so the server (and the wake-up) is running. Canvas `record_event` calls do not trigger the wake-up, so there is no loop.

## Report an idle worker

`notify_on_idle: "always"` on the worker session wakes Jarvis when the worker ends its turn.

## Console access

- Jarvis records through the canvas actions (`create_story`, `record_event`, `pending`, `ack`, `handover`) or the CLI.
- Workers use the CLI. The installed console is `~\.copilot\extensions\ai-sdlc-console\mission-console\jarvis.mjs`.

## Protected automations

Never call `save_session_automation` on the Jarvis chat if the Copilot adapter profile lists `protectedAutomations` (recurring jobs the owner keeps on that chat).

## Reset

Archive the story worker sessions Jarvis created. This removes their worktrees and any leftover schedules. Leave the Jarvis chat's own automations (the Copilot adapter profile's `protectedAutomations`) untouched. The extension host holds the database file open. Confirm with `get_snapshot` that it is empty.
