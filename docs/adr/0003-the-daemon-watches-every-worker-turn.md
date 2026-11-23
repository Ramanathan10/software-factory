# 0003. The daemon watches every worker turn and records how it ended

Status: Accepted
Date: 2026-11-23

## Context
A worker can stop without saying anything: its program crashes, the machine sleeps, a sign-in expires. Jarvis only hears about a story through events in the store, so a worker that stops silently would leave its story looking busy forever. Turns also outlive the daemon that started them, because the harness program runs detached (ADR 0004).

## Decision
- The daemon starts each worker (`startStoryWorker`) so it is the parent of the program and hears the turn end. Each turn is recorded as `turn-started` with its process ID and log, and its end as `turn-ended`.
- `pid` and `log` let a restarted daemon find turns it did not start. `sweep` checks those on a timer (every five seconds). A turn is adopted, and left alone, only when this daemon did not start it, its process exists, and it began after the machine last booted: a turn recorded before the boot cannot still be running, whatever process now has its ID.
- A process exists when `process.kill(pid, 0)` succeeds or fails with `EPERM`: a process the daemon may not signal still exists.
- `turnVerdict` decides what a finished turn means. A non-zero exit code is `failed`. With no exit code (an adopted turn whose process is gone), what the worker recorded during the turn is the only evidence it finished: nothing recorded is `lost`, otherwise `ended`. Jarvis is woken only for a failed turn or one in which the worker recorded nothing, because a worker that recorded something already told Jarvis through those events. Events the owner, the PR watcher or the daemon records do not count as the worker's.
- When the turn's end is recorded, a story whose worker was released, or whose current turn has a different process ID, is skipped: that turn is already accounted for.
- Writes from the supervisor retry up to three times on "Story changed" (409), because another process may record on the story between reading its revision and writing.
- Whether a `turn-ended` event wakes Jarvis is the daemon's call, carried on the event as `wake`, not a property of the event type.
- The dashboard treats a worker between turns as not busy where the daemon watches its turns, and shows the turn's state from `worker.turn` and `worker.lastTurn`.

## Consequences
- `turnVerdict` is passed `adopted` but does not use it yet; issue #12 tracks settling that policy.
- A daemon that stops while waits in `idle` are pending rejects those waits, so a message never waits forever on a daemon that is gone.

## Where
- `command-center/supervisor.mjs` — `isAlive`, `turnVerdict`, `notTheWorker`, `record`, `finish`, `adopted`, `sweep`, `idle`, `start`
- `command-center/serve.mjs` — `startStoryWorker`
- `mission-console/store.mjs` — `turn-started`, the `wake` handling of `turn-ended`
- `command-center/ui/app.js` — `isBusy`, `turnOf`
