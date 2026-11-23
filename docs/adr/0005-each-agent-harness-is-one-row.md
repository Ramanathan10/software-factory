# 0005. Each agent harness is one row in one table

Status: Accepted
Date: 2026-11-23

## Context
The factory runs in several agent harnesses (the GitHub Copilot app, Claude Code, Codex, Cursor). They differ in where they read skills, whether they can read them in place, how a worker session is started and resumed, and what the owner's permission choice maps to. Spreading those differences across the installer, the daemon and the dashboard would make adding a harness a hunt.

## Decision
`adapters/harnesses.mjs` holds one row per harness, keyed by the name stories record. `install.mjs` reads it to install the skills, and the Command Center imports `messageWorker` from it to hand the owner's decisions to a worker.

A row's fields:
- Installing: `id` is the name `install.mjs` takes; `marker` is the folder in the home directory whose presence shows the harness is installed; `skills` is where it reads skills; `install` is `'link'` when it reads the skills in place or `'copy'` when it needs its own copies; a copy harness may name an `extension` folder that receives the Command Center.
- Workers: `workers` is `'command-line'` when a worker is a session of the harness's own program, `'in-app'` when only the agent inside the harness can start one with the tools named in `start` and `message`, and `'none'` when the harness cannot run workers yet.
- A command-line row gives `command`, and `start` and `message` return its arguments. The prompt always goes in on stdin; Codex reads it from stdin when the prompt argument is `-`, so `promptArgument` puts that marker last. `permissions` holds the arguments for each choice of the profile's `workerPermissions`, and `tools` are the programs a restricted worker may run. A row whose program chooses the session id itself gives `sessionFrom`, which finds the id in the program's output. `model` returns the arguments that run a turn on a named model; the name comes from the profile, never from this table (ADR 0007). `record` and `ran` read the program's own session record (ADR 0006).
- `row` finds a row by the recorded name or the install id, ignoring case.
- `startWorker` is the first step in every harness: for a harness whose workers are not started from the command line it starts nothing and resolves to what Jarvis does instead.

`serve.mjs` builds one adapter for each command-line row, keyed by the lower-case recorded name. An adapter has `messageWorker({ session, worktree, prompt })` and may have `wakeCoordinator({ prompt })`, which sends a prompt to the Jarvis chat. A harness that messages workers from inside its own app delivers decisions there instead.

## Consequences
- Adding a harness is one row, one runbook section, and, only if the harness must load code itself, a folder under `adapters/<harness>/`.
- No adapter built from the table provides `wakeCoordinator` today; `deliver` supports it for an adapter that does.

## Where
- `adapters/harnesses.mjs` — `harnesses`, `row`, `commandFor`, `startWorker`
- `command-center/serve.mjs` — `loadAdapters`, `deliver`
