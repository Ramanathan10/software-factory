# 0024. A sent decision is released when its turn ends

Status: Accepted
Date: 2026-11-26

## Context
`hand` kept a decision's seq in `sent` once `onDecision` returned `worker`, which happens when the turn settles, and nothing removed it. A resumed turn that carried an answer and failed after the settle window left the answer pending but in `sent`. `deliverPending` and `hand` then skipped it until the daemon restarted, so Jarvis's `deliver` handed nothing (issue #49). The approval kickoff turn of the test author had the same flaw. ADR 0023 recorded it as a consequence.

## Decision
- `sent` means a decision is in flight: an unresolved `hand`, or a running turn that carries it. It is a map from seq to the reservation of the `hand` call that holds it.
- `hand` passes `onDecision` a function `carriedBy(ended)`. `serve.mjs` calls it with the `ended` promise of each turn it starts for the decision: the resumed worker turn, and the test author's kickoff turn on approval.
- `hand` releases its seqs once `onDecision` returned `worker` and every promise given to `carriedBy` settled, in either order, because a turn that exits within the settle window ends before `hand` returns. A release removes only seqs still holding its own reservation, so a later `hand` keeps its own. A result other than `worker` releases at once, as before. If `carriedBy` is never called, the seqs stay reserved.
- A turn that ends, whatever the exit code, without acknowledging makes the decision deliverable on the next `serve.mjs deliver`. The daemon never hands it again by itself, and a clean exit wakes nobody new.
- A decision stays reserved until the carrying turn of a released worker ends, so a replacement is handed it after that turn, not before.
- The delivery model gains `releasesAtTurnEnd` and the invariant `NeverBlocked`. `NoDuplicateDelivery` is checked when a hand reserves, and `NoReserveAfterAck` fails if a hand reserves a decision already acknowledged.

## Consequences
- A failed or unacknowledged turn no longer blocks redelivery.
- An acknowledged decision is never handed again by the same daemon: `hand` keeps only the seqs still pending, so the dashboard batch and `deliver` share the filter.

## Where
- `command-center/console-service.mjs` — `hand`
- `command-center/serve.mjs` — `onDecision`, `startStoryWorker`
- `command-center/delivery-model.mjs`
