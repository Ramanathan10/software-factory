# 0023. A decision goes to the worker assigned when it is delivered

Status: Accepted
Date: 2026-11-26

## Context
`hand` read the story's worker session before it awaited `onDecision`, and `messageWorker` then waited for the session's running turn before it resumed that session. A worker can release in that turn and Jarvis can staff a replacement before the wait ends. The daemon then resumed the released session: two agent processes ran in one worktree, the replacement never received the answer, and the answer stayed in `sent`, so `deliverPending` handed nothing (issue #47).

## Decision
- `messageWorker` takes an optional per-call `current()`. It is called after the wait and before the program starts, with no `await` between, so no release can fall in the gap. A false answer throws `STALE_ASSIGNMENT` before anything starts, and the session's turns entry is released for the next message. The adapter learns nothing about the store; the caller decides what current means.
- `serve.mjs` passes `current` only for worker deliveries, comparing the assignment id `hand` captured with the one assigned now. The assignment id, not the session string, is compared, so a new assignment that reuses a released session still counts as a change. A Jarvis resume gets no `current`: it has no assignment to match.
- `deliver` returns `stale` for that error. Nothing is logged and Jarvis is not woken.
- `hand` keeps the seqs in `sent` through a stale result, takes a fresh snapshot and hands again, for as long as the result is stale. A second release before the re-hand ends is handled by the next pass. With no worker left, the call carries no session, `onDecision` returns `coordinator`, and the seqs leave `sent` and stay pending.
- A stale re-hand that finds no worker records its seqs as owed to Jarvis in `coordinator.mjs`. Owed seqs count as news even when `jarvis.handled` covers them, because that Jarvis turn saw the answer before the release and could not act on it. A wake that carries them clears them, so they wake Jarvis once.
- The delivery model gains `Release`, `Assign` and `Stale` steps, the `rechecksAssignment` flag, the invariant `ReleasedSessionNeverResumed`, and a check for a decision lost at a terminal state.

## Consequences
- An answer given mid-turn reaches the worker assigned when the wait ends, or Jarvis if none is.
- The delivery model grows from about 2,000 to about 100,000 states and takes a few seconds.
- A worker that keeps its turn long after releasing still delays the wait. Ending the turn promptly is not enforced here.
- A delivered turn that fails after the settle window still leaves its seq in `sent` (issue #49).

## Where
- `adapters/harnesses.mjs` — `messageWorker`
- `command-center/serve.mjs` — `deliver`, `onDecision`
- `command-center/console-service.mjs` — `hand`
- `command-center/coordinator.mjs` — `owe`, `unhandled`
- `command-center/delivery-model.mjs`
