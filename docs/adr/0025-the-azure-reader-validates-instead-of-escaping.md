# 0025. The Azure DevOps reader validates what it sends to `az` instead of escaping it

Status: Accepted
Date: 2026-11-26

## Context
On Windows `az` is a batch file, so the reader had to start it through a shell. It wrapped each argument in double quotes, but `cmd.exe` does not treat double quotes as quoting: an embedded quote ends the span and `%` still expands. A pull request id, a task id, the organization and the story id all reach the command line, and the first two come from tracker data. Escaping for `cmd.exe` did not hold either, because `az.cmd` forwards `%*` and so parses its arguments a second time, inside a parenthesized block where more characters matter than any escaping list names.

## Decision
- `read()` checks every value it puts on the command line, on every platform. A story id must be all digits and the organization must follow Azure DevOps naming rules. Either failure throws before `az` starts.
- `runJson` on Windows refuses any `az` argument outside letters, digits and `. _ : / -`, before it starts the shell. A positive list is used because a list of known bad characters is always one character short. No argument can then hold a space, so `runJson` passes one command string to the shell, which also ends Node's DEP0190 warning.
- A task or pull request relation whose id is not all digits is skipped, not fatal. The reader returns each skipped relation with the snapshot, and `check-story` prints them as `skippedRelations` without changing how any check is judged. The checks only see the relations that were read, so Jarvis reports the skipped ones to the owner.
- An organization that breaks the naming rules is a `problem` from `check-story`, naming `readiness.organization`, so the runbook sends the owner to `ai-sdlc-setup`. A thrown error would print "The story could not be read", which has no fix path.

## Alternatives
- Start `az` without a shell: Node refuses to start a batch file that way. The worker launcher faces the same limit and refuses `.cmd` programs (0004).
- Call the Python behind `az` directly: this works only for the MSI install layout.
- Refuse `az.cmd` on Windows: this disables the Azure reader there.

## Consequences
- Every argument the reader sends today fits the safe set. A new `az` argument with another character fails on Windows until the set is widened deliberately.
- A skipped relation can let `tasksClosed`, `prLinked` or `prMergedToTarget` pass on missing data. Reporting it is what keeps that visible.

## Where
- `readiness-sync/trackers.mjs`, `readiness-sync/check-story.mjs`, `skills/jarvis/RUNBOOK.md`
