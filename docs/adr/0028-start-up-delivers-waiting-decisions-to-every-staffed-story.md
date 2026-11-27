# 0028. Start-up delivers waiting decisions to every staffed story

Status: Accepted
Date: 2026-11-26

## Context
A decision recorded while the daemon was down, or lost in a restart, stayed pending on a story with an assigned worker until someone ran `deliver` (issue #48). Start-up reconciled only approvals in testing (ADR 0018).

## Decision
- At start-up the daemon calls `deliverPending` for every story that has an assigned worker and whose harness runs command-line workers, in any phase, blocked and cleanup stories included. The owner decided this in answers on events 3812 and 3868: a blocked story or a cleanup request still has a worker waiting for its answer.
- A harness the store does not know counts as not command-line, so one story with a retired harness does not stop the Command Center starting. Nothing is delivered to it.
- A story of an in-app harness, or one with no worker, is left alone. The testing-phase approval start of ADR 0018 is unchanged.
- `deliver` may answer `acknowledged`: every carried decision was already acknowledged, so nothing was spawned.

## Consequences
- A restart no longer strands a decision on an assigned worker.
- A failed start-up delivery is logged and leaves the decision pending.

## Where
- `command-center/serve.mjs` — `start`
- `command-center/coordinator.mjs` — `commandLine`
