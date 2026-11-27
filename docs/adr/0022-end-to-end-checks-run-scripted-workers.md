# 0022. End-to-end checks run scripted workers and a scripted Jarvis, with no model

Status: Accepted
Date: 2026-11-24

## Context
`node e2e/run.mjs <harness>` drove every scenario with real `claude` or `codex` sessions. Each run spent model usage and its result depended on the model's choices, so it ran only by hand and never in CI. What the suite exists to check is the factory's own machinery between processes: how the daemon starts and resumes worker turns, how decisions reach them, how a background Jarvis is woken, and how the console records it all.

## Decision
- `e2e/daemon.mjs` replaces `command-center/serve.mjs` in the rig. It calls the same `start()` with the real `startWorker`, `messageWorker` and `loadAdapters`, and changes only the `spawnProcess` they use: it starts `node e2e/scripted.mjs <command> <args...>` with the arguments, working directory, environment, stdin prompt and detached log the real program would get. No production file changes, and no harness row or environment switch exists for tests.
- The daemon passes short clocks: a 2 s settle, a 2 s Jarvis quiet period and a 250 ms poll. Scenario waits scale with the quiet period.
- `e2e/scripted.mjs` plays every worker turn from a playbook the scenario writes under the rig's `AI_SDLC_HOME`. A turn waits for its session's assignment, then runs the first entry matching the worker's role, the phase, whether the turn is first or resumed, and optionally which assignment it is. Steps record and acknowledge through `mission-console/jarvis.mjs`, write files, and run programs such as git and the `gh` stand-in. A record that meets "Story changed" re-reads the story and retries, as a model is told to.
- Jarvis is one fixed policy rather than a playbook, because the daemon can wake it at times no scenario plans: with no worker in a phase that has one and no owner question left unanswered, it starts the next worker with the playbook's kickoff, and delivers when an owner decision for the phase is pending; then it acknowledges the news it was given, except decisions, which belong to the worker. A wake that comes while a question is still open, as the 2 s quiet period allows on a slow runner, therefore staffs no one before the owner answers.
- Every call is appended to `scripted-calls.jsonl`, and the runner checks that the calls match the turns and Jarvis wakes the console recorded, each with its harness's start or resume arguments. The rig removes every folder holding a `claude` or `codex` program from the Command Center's PATH, so a launch that bypasses the scripted program fails instead of spending usage.
- `background-jarvis-turn-fails` still fails Jarvis through the profile's coordinator tier: the scripted program exits non-zero when given the model `no-such-model-e2e`, before it reads any playbook.
- A scripted turn starts every child program with `windowsHide`. Its parent is detached and has no console, so on Windows each child would otherwise open a console window of its own, and a window closed under it ends the child with `0xC000013A` part way through a turn.
- The daemon appends each scripted turn's process ID to `scripted-turns.jsonl` when it spawns the turn (`note(child.pid, 'spawned')` in `e2e/daemon.mjs`), and the turn writes its exit in its own `process.on('exit')` handler in `e2e/scripted.mjs` before the process dies. The rig decides a turn has ended, waits for running turns, and stops leftover turns from that file, not by asking whether the ID is alive. Windows hands a freed process ID to a new process within seconds, so an ID check could wait on an unrelated process until it timed out, or kill it at cleanup. A turn killed hard never writes its exit, so the rig waits on it until it times out; this affects the test rig only.
- The suite runs in the Tests workflow on Windows, macOS and Ubuntu, after `node --test`. It runs no model, needs no secrets, and finishes in about three minutes for both harnesses.

## Consequences
- Nothing checks that an installed `claude` or `codex` still accepts the flags `adapters/harnesses.mjs` passes, that Codex's real `--json` output carries `thread_id` in the shape `sessionFrom` reads, that `explain` recognises real failure text, or that the skills carry a model through a story. Unit tests cover argument construction and `explain` on sample text; a live story is the first place a CLI change shows.
- `story-to-pull-request` checks the store, daemon and lifecycle from scout to an open pull request, with real git and the `gh` stand-in, but not the skills.
- Short clocks can hide a race that shows only at the real 10 s values; the delivery model (ADR 0015) still checks every interleaving.
- `serve.mjs`'s own wiring of `start()` is not exercised by the suite; unit tests cover it.

## Where
- `e2e/daemon.mjs`, `e2e/scripted.mjs`, `e2e/rig.mjs`, `e2e/run.mjs`, `e2e/README.md`
- `.github/workflows/test.yml`
