# 0012. Jarvis is woken only for news, by a background wait that ends

Status: Accepted
Date: 2026-11-23

## Context
Jarvis, the coordinating chat, cannot be pushed a message by the store. It needs to come back when a worker has something for it, and not for events it has no part in.

## Decision
- `jarvis.mjs wait-any` runs as a background command. It resolves with the events recorded for Jarvis after a given seq, across every story, as soon as there is one, or with none once its time is up; without a seq it reports only what is recorded from then on. Its ending is what brings the Jarvis chat back when a worker ends a turn.
- Its default limit is half a day (43,200 seconds, at most a day), which bounds a wait left behind by a chat that went away.
- The owner's own decisions go to the story's worker, so they are not news for Jarvis.
- Whether a finished turn is news is the daemon's call (ADR 0003), recorded on the `turn-ended` event as `wake`.

## Consequences
- A chat that never starts a new wait after one ends hears nothing until it does; the Jarvis skill restarts it after each one.

## Where
- `mission-console/watcher.mjs` — `forWorker`, `waitForAny`
- `mission-console/jarvis.mjs` — `wait-any` arguments
- `mission-console/store.mjs` — the `wake` handling of `turn-ended`
