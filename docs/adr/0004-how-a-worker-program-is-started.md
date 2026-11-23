# 0004. A worker's program runs detached, is watched for ten seconds, and is never started through a shell

Status: Accepted
Date: 2026-11-23

## Context
A worker turn is a run of the harness's own program (`claude -p`, `codex exec`) in the story's worktree. Turns take minutes to hours and must outlive the command that started them. Many failures (a sign-in problem, an unknown model, a bad argument) end the program within seconds, and a worker reported as running when it never began is worse than an error.

## Decision
- `run` spawns the program detached, with the prompt on stdin and stdout and stderr appended to a per-session log in the AI SDLC home. The parent closes its own handle on the log once the child has one. `node harnesses.mjs start` prints the result and exits without waiting for the turn.
- `settled` watches a new turn for `SETTLE_MS` (ten seconds) before calling it running. A turn that ends with an error in that time is rejected with the last lines of its log. Ten seconds covers the observed failures: a Codex turn refused for its model took a little over five.
- On Windows only an `.exe` or `.com` is started directly. A `.cmd` or `.bat` shim, as an npm install leaves, is refused by `launchProblem` instead of being run through a shell that would reinterpret the arguments. `install.mjs` reports this when it installs the skills, so the owner hears it before a story needs a worker; the skills still install.
- A failure to start is explained in terms the owner can act on (`explained`), and the daemon returns it as a 502 with the message exposed, because it is for the owner to read, not an internal fault.

## Consequences
- A turn that fails after ten seconds is reported by the supervisor when it ends (ADR 0003), not by the start call.
- The readiness check's Azure DevOps reader does run `az` through a shell on Windows; issue #15 tracks bringing it in line with this decision.

## Where
- `adapters/harnesses.mjs` — `launchProblem`, `explained`, `run`, `SETTLE_MS`, `settled`, the CLI block
- `command-center/serve.mjs` — the catch in `startStoryWorker`
- `install.mjs` — the "Story sessions will not start" report
