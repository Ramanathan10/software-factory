# 0006. The model a worker ran on is read from the harness's own record, not stored

Status: Accepted
Date: 2026-11-23

## Context
The dashboard shows which model and effort each worker session is running on. The profile only says which model a turn was asked for (ADR 0007), and a harness can fall back to another. The harness program keeps its own record of each session, one JSON object per line, which says what actually ran.

## Decision
- `sessionRan` reads the end of the harness's record of the session and returns the latest `{ model, effort }` a line shows. It reads the last megabyte first and a longer end (eight times as much each round) only when the shorter one did not say, because the newest lines usually say and the record of a long session is large. The path of each record is cached once found.
- For Claude Code, a subagent's lines (`isSidechain`) and lines the program wrote itself (whose model starts with `<`, such as `<synthetic>`) are not the session's model.
- When the record cannot be read, nothing is shown. A harness that keeps no readable record, or a session that has not run far enough, shows nothing too.
- The value is not stored in the story database: the console service is given a `workerRan` function, the dashboard receives its result as `worker.ran`, and the daemon reads a record again at most every five seconds, and only while the session's turn is running or nothing has been read from it yet.
- Before the worker has run, the dashboard shows the model the profile names for the story's harness and phase, or that the harness chooses. `modelPlan` is read on each request, so a saved profile change shows on reload.

## Consequences
- The dashboard depends on each harness's record format; a harness that changes it shows no model until its `ran` function is updated.
- Errors from reading are swallowed in `serve.mjs` more broadly than this decision needs; issue #16 tracks narrowing that.

## Where
- `adapters/harnesses.mjs` — `record` and `ran` in each row, `sessionRan`
- `command-center/serve.mjs` — `lastRan`, `workerRan`
- `command-center/console-service.mjs` — `modelPlan` and `workerRan` options
- `command-center/ui/app.js` — `modelOf`
