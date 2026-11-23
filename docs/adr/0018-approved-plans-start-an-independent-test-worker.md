# 0018. Approved plans start an independent test worker

Status: Accepted
Date: 2026-11-23

## Context

The planner must release its assignment before submitting a plan. Approval moves the story to testing, but messaging the current assignment cannot work when that assignment has been released. Command-line adapters cannot wake the coordinating chat, so a valid approval could remain pending with no test author.

## Decision

For command-line stories, an approval in testing without an assignment starts an independent test-author session in the story's existing harness and worktree. The generated kickoff carries the approved contract, context/evidence references and test-only boundary. Other unanswered decisions do not authorize starting tests.

The daemon shares one in-flight start per story across manual and automatic requests. It waits for both owned and adopted released turns before launching, then rechecks phase, blocker and cleanup state. Pending approvals are reconciled once at startup. A durable activity records the automatic start intent before launching; if a restart finds that intent without a subsequent assignment, it blocks for process/log reconciliation rather than risking a duplicate writer. Failed launches leave the decision pending and record a visible blocker; there is no automatic retry loop. Launching a session never acknowledges the decision on the agent's behalf.

Every testing-phase start, including a manual one, receives the current approved test contract after waiting for earlier turns. Recovery reads full store history rather than the dashboard's 40-event window, and does not automatically launch an approval already handed to a prior test session. A diagnosed failure can be resumed explicitly. The database path passed to workers is absolute.

Intake uses the owner's originating harness unless they explicitly request a change. Review model diversity does not authorize moving the story to another harness.

## Consequences

Approval can start the next independent role without a coordinator-chat wake. Missing credentials, model support or capacity remain explicit blockers. This does not make other unassigned phases automatic or change lifecycle gates. The existing delivery model covers assigned-session delivery; the approval-start model covers the separate launch and released-turn boundary.
