# 0002. The owner's decisions reach a worker only through the daemon, one turn per session at a time

Status: Accepted
Date: 2026-11-23

## Context
The owner answers questions, approves plans and asks for changes in the Command Center. Each answer has to reach the story's worker session, a conversation in an agent harness that can run only one turn at a time: two harness programs resuming the same conversation race on one worktree. Decisions arrive in bursts ("Send answers" posts one decision per question), Jarvis can also ask for delivery when a decision was recorded outside the dashboard, and the daemon can restart while turns are still running.

## Decision
- Every hand-off to a worker goes through the one daemon process (`serve.mjs`). Jarvis does not message workers itself: `node serve.mjs start` and `node serve.mjs deliver` ask the running daemon over HTTP (`requestStart`, `requestDelivery`), so the daemon is the parent of every worker turn and the only process that keeps a session to one turn.
- The dashboard batches a burst of decisions on one story into one hand-off after `decisionDelayMs` (1.5 seconds), so a burst wakes the worker once.
- `hand` claims the decision seqs in `sent` before its first `await`, and releases them unless the worker was told. A delivery that overlaps this one (the batch timer and a `deliver` request) therefore cannot carry the same decision. A decision the worker was handed is not handed again: the worker acknowledges it only after acting on it, so it is still pending while that turn runs.
- `deliverPending` exists for decisions recorded outside the dashboard, or ones that did not arrive.
- `messageWorker` keeps, per session, a promise for the turn this process started (`turns`), and waits for it and for `options.after` before starting a new turn. `startWorker` registers the kickoff turn there too. The daemon passes `supervisor.idle(story)` as `after`, which waits for a turn an earlier daemon left running (ADR 0003).
- `onTurn` reports a turn as soon as its process exists, before the turn has settled, so a daemon that restarts in between finds it in the store.
- A decision that cannot reach a worker stays pending in the store and goes to Jarvis, who tells the owner what to do next (`deliver` resolves to `'worker'`, `'coordinator'`, `'acknowledged'` (every carried decision was already acknowledged; nothing was spawned) or `'nobody'`, and logs the reason; `/api/deliver` answers `nobody` with a `reason` when the story has no worker, see [0024](0024-a-story-with-nobody-working-on-it-wakes-jarvis-once.md)).
- The dashboard polls the store every second because the CLI, Jarvis and workers write to it from other processes.
- In the Copilot app the extension's `onDecision` wakes the Jarvis chat directly, since workers there are started in-app.

## Consequences
- After a restart the new daemon cannot know what the old one handed, so a decision may be handed once more. That is allowed because the worker acknowledges only after acting.
- These rules are checked over every interleaving by `command-center/delivery-model.mjs` (ADR 0015). Past failures it found: `serve.mjs deliver` handed every pending decision again (fixed in 05c45f7); 05c45f7 filtered on `sent` but marked it only once the turn was running, so an overlapping batch still handed one answer twice; a decision handed while the kickoff turn ran started a second turn; after a restart a message started a second turn beside the one the earlier daemon left; a daemon that restarted while a new turn settled found no turn in the store to wait for. Each has a test named in `.agents/skills/verify-decision-delivery/SKILL.md`.
- Running a second daemon would break the one-turn rule; `serve.mjs` does not start a second one on a port the first already holds.

## Where
- `command-center/console-service.mjs` — `notify`, `sent`, `hand`, `deliverPending`, the store poll in `startServer`
- `command-center/serve.mjs` — `deliver`, `requestStart`, `requestDelivery`, `onDecision` in `start` (a story with no worker goes to the background Jarvis, ADR 0019)
- `adapters/harnesses.mjs` — `turns`, `messageWorker`, `startWorker`
- `command-center/supervisor.mjs` — `idle`
- `adapters/copilot/extension.mjs` — `onDecision`
