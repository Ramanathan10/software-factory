# E2E-1: Run the end-to-end tests with scripted workers and no models

## Problem

`node e2e/run.mjs <harness>` drives every scenario with real model sessions: real `claude` or `codex` worker turns and real background Jarvis turns. Each run spends model usage, results vary with the model's choices, and so the suite runs only by hand. The owner wants scripts to play the workers and Jarvis, moving stories and submitting them, so the suite uses no model and gives the same answer every time.

## Settled decisions

1. Seam: an e2e-only launcher starts the Command Center in-process with `serve.start()`, using the real `startWorker` and `messageWorker` from `adapters/harnesses.mjs`, but with a `spawnProcess` that starts a scripted Node program in place of `claude` or `codex`, with the same arguments, working directory, environment, stdin prompt and detached log. No production file changes.
2. No real-model run remains: no `--real`, `--model` or `--unrestricted`, and no check that `claude` or `codex` is installed.
3. `story-to-pull-request` is scripted end to end with real git, the local bare origin and the `gh` stand-in; its checks on phases, the pull request and the pushed branch stay.
4. The scripted suite runs as its own step in the Tests workflow on Windows, macOS and Ubuntu.
5. Every scenario runs once as a Claude Code story and once as a Codex story by default; `node e2e/run.mjs <harness>` narrows to one.
6. Short clocks: 2 s settle, 2 s Jarvis quiet period, 250 ms supervisor and coordinator poll. Fixed waits in scenarios scale to the quiet period. The 60 s handoff limit stays.
7. AGENTS.md: line 24 replaced; line 25 kept, plus a model-behavior carve-out (text below).
8. No before-and-after; the PR shows the scripted run output. No architecture diagram.

## Design

- `e2e/daemon.mjs <port>`: run by the rig in place of `command-center/serve.mjs <port>`. Calls `start({ port, dbPath, adapters, launch, quietMs: 2000, turnPollMs: 250, watchSeconds: 30, ran: () => undefined })` with `launch = (input, options) => startWorker(input, { ...options, spawnProcess, settleMs: 2000 })` and `adapters = loadAdapters(harnesses, (message, options) => messageWorker(message, { ...options, spawnProcess, settleMs: 2000 }))`. Prints `Command Center: <url>` as `serve.mjs` does. Workers and Jarvis still start through `node serve.mjs start|deliver <story> <port>` over HTTP.
- `spawnProcess(command, args, options)` = `spawn(process.execPath, [e2e/scripted.mjs, command, ...args], options)`.
- `e2e/scripted.mjs`: the program every worker and Jarvis turn runs. It reads the prompt on stdin and its arguments (`-p --session-id <id>` / `-p --resume <id>` for Claude Code; `exec --json` / `exec resume <id>` for Codex). A fresh Codex start prints its `{"thread_id": ...}` line before anything else, because `startWorker` waits for it before the daemon records `assign-worker`; only then does the turn wait for its assignment. A worker turn reads a per-story playbook the scenario wrote under the rig's home and performs that turn's steps: console writes through `mission-console/jarvis.mjs record|ack|handover` (so `AI_SDLC_ACTOR=jarvis` still stamps `by: "jarvis"`), `serve.mjs start|deliver`, git, and the `gh` stand-in called as `node e2e/gh-stand-in.mjs <github> ...` (Windows cannot start the rig's `gh.cmd` from Node without a shell). Every record re-reads the story and retries on "Story changed", as a model is told to. It appends every invocation (argv, cwd, session, `AI_SDLC_ACTOR`) to a calls file in the rig's folder. It exits non-zero when given the model `no-such-model-e2e`, which is how `background-jarvis-turn-fails` makes Jarvis fail, still through the profile's coordinator tier and `--model`.
- Worker turn selection: a worker turn reads the story with `handover` and runs the playbook entry for its role in the current phase and whether it is a first or a resumed turn. No matching on prompt wording beyond the story id.
- Jarvis is one fixed policy, not a playbook, so a wake no scenario planned for (the coordinator also wakes on any worker `turn-ended`) is handled the same way every time. It acts on the story's state, not on which turn it is: with an owner decision pending and no worker, it starts the next worker (the scenario's `next` kickoff) and delivers; with no worker in a phase that has one, it starts the next worker; otherwise it does nothing. `serve.mjs start` refused because a worker or a start already exists, or because the phase has no worker, counts as done. It then acknowledges the news it was given and exits 0. So a wake that arrives early, inside the 2 s quiet period, cannot staff a replacement before the owner's answer exists.
- `e2e/rig.mjs`: spawns `e2e/daemon.mjs`; drops `rig.script()`'s AGENTS.md/CLAUDE.md instructions in favour of playbook entries; keeps the `gh` stand-in, token removal, throwaway folder and assertions helpers. `model` and `unrestricted` options go.
- `e2e/run.mjs`: harness argument optional (default: every `workers: 'command-line'` row); `--model`, `--unrestricted`, the cheapest-model map, `CLAUDE_CODE_SUBAGENT_MODEL` and `launchProblem` removed; `--keep`, `--list`, `--turn-seconds` (default lowered to 60) and the closing turn check stay. `story-to-pull-request` drops its 90-minute floor and waits `--turn-seconds` per turn like the others. The rig removes from its PATH every folder that holds a `claude` or `codex` program, so a launch that bypasses the scripted program fails instead of spending tokens on a developer machine. A new closing check reads the calls file: the number of scripted calls equals the number of `turn-started` plus `jarvis-turn-started` events, and each call carries its harness's start or resume arguments.
- `.github/workflows/test.yml`: a step `node e2e/run.mjs` after `node --test`.
- Docs: `e2e/README.md` rewritten for scripted runs and how to write a playbook; ADR 0021 records the seam and what it does not cover; AGENTS.md line 24 becomes: "A change to how workers start, how decisions reach them, or how Jarvis is woken is also tried end to end: `node e2e/run.mjs` runs each scenario under `e2e/scenarios/` against a throwaway Command Center with scripted workers and a scripted Jarvis. It uses no model, and the Tests workflow runs it on every pull request." Line 25 gains: "A bug that only a model's choices show is fixed in the skill that misled it; it gets no scenario."

## Acceptance criteria

1. `node e2e/run.mjs` with no arguments runs all five scenarios as Claude Code stories and as Codex stories and exits 0, printing `PASSED`.
2. It passes with no `claude` or `codex` program on PATH, and the calls file shows every worker and Jarvis turn started through `e2e/scripted.mjs` with that harness's start or resume arguments.
3. `node e2e/run.mjs Codex` runs only Codex stories; `--list` lists the scenarios; `--model` and `--unrestricted` are refused as unknown options with exit 2.
4. Each scenario keeps today's assertions; only clocks change. `worker-keeps-assignment` resumes the same session; `worker-releases-before-asking` and `clean-handoff-with-no-jarvis-chat` are staffed by a scripted background Jarvis woken by the daemon; `background-jarvis-turn-fails` posts the `action-jarvis-` question and wakes Jarvis no more after Hold; `story-to-pull-request` visits every lifecycle phase in order, opens one PR through the stand-in, and the pushed branch starts with the spec and passes its tests.
5. The full run (both harnesses) finishes in under 3 minutes on a local Windows machine, and passes three runs in a row.
6. A broken production path fails the suite: with `deliver` in `command-center/serve.mjs` changed to skip `messageWorker`, `worker-keeps-assignment` fails (checked by hand mutation, then restored).
7. The Tests workflow runs `node e2e/run.mjs` on Windows, macOS and Ubuntu, and it passes on the PR.
8. `git diff origin/main` touches no file under `command-center/`, `adapters/`, `mission-console/` or `skills/`.
9. `node --test` passes, including the comment ratchet and private-details checks; no package dependencies added.

## Test level

The e2e scenarios themselves (integration across real processes). Red: the test author converts the scenarios, the rig's PATH filtering and the runner's checks to the scripted contract (playbooks, no `--model`, calls-file count), while the rig still runs today's `serve.mjs` daemon. `node e2e/run.mjs` then fails behaviourally: every worker start is refused with "Claude Code's program \"claude\" was not found on PATH" (and the Codex equivalent), which shows the daemon still needs a model program. A missing-module error does not count as red.

## Out of scope

Any real-model run; changes to the Command Center, store, phases, adapters or skills; testing whether the skills carry a model through a story; the Copilot and Cursor harnesses (they do not start workers from the command line).

## Risks

- Lost coverage (owner accepted): a `claude` or `codex` release that renames a flag we pass, Codex's real `--json` shape, `explain` on real failure text, and the skills' effect on a model are no longer tested anywhere.
- Short clocks can hide a race that shows only at 10 s; the delivery model (`verify-decision-delivery`) still checks interleavings.
- CI runners are slower than local; `--turn-seconds` gives headroom without changing the clocks.
- Not exercised: the `serve.mjs` command line's own wiring of `start()` (`loadAdapters()` defaults); unit tests cover it.

## Plan critique

Codex was over its usage limit (until 3:55 PM today), so one Claude reviewer critiqued the plan; it is not a cross-model panel. It reported eight defects, each checked against the code and fixed above: the `gh` stand-in unreachable from Node on Windows; a Codex start deadlocking if the script waits for its assignment before printing `thread_id`; stale-revision writes failing a turn; a 2 s quiet period letting Jarvis staff early; unplanned Jarvis wakes with no playbook entry; a missing-module red; a calls-file check true by construction and real programs still reachable on PATH; and the 90-minute floor in `story-to-pull-request`. A minor note (the PR watcher not running) is fixed by passing `watchSeconds: 30`.

## Checks before the PR

`node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`; the delivery model per `.claude/skills/verify-decision-delivery/SKILL.md`; `node e2e/run.mjs` three times locally; the Tests workflow on all three OSes.

## Context pack

Scout: Black Widow. Base: origin/main 28fb5de. Worktree: C:/repos/software-factory-worktrees/story/e2e-1-scripted-workers.

### The ask

Every end-to-end scenario today drives real model sessions (worker turns and background Jarvis turns). The owner wants scripts to play both roles, moving and submitting stories deterministically, with no model and no token spend.

### How it works today

- `e2e/run.mjs <harness>`: picks the harness row (must be `workers: 'command-line'`, so Claude Code or Codex), checks `launchProblem` (the real `claude.exe` / `codex.exe` must be on PATH), and runs each scenario with `--model` defaulting to the cheapest model (`haiku`, `gpt-6-luna`).
- `e2e/rig.mjs`: throwaway temp folder with a git worktree, `AI_SDLC_HOME`, its own SQLite DB, a `gh` stand-in first on PATH, the real GitHub tokens removed. It spawns `node command-center/serve.mjs <freePort>` as a separate process, so the daemon uses the real `startWorker`, `messageWorker` and `loadAdapters()`. Workers are started through `serve.mjs start <story> <port>` (HTTP to the daemon). Owner decisions go through `POST /api/decision`. Assertions read the store directly.
- Worker prompts are English kickoffs ("Record {...} with key and revision filled in"). `rig.script({ next, deliver })` writes `AGENTS.md`/`CLAUDE.md` into the worktree telling the background Jarvis model to run `serve.mjs start` (and `deliver`).
- Launch path (`adapters/harnesses.mjs`): `commandFor` builds `claude -p --session-id <uuid>` / `-p --resume <id>` or `codex exec --json` / `exec resume <id>` with permissions and `--model`; `run` spawns detached with the prompt on stdin and output to `<home>/workers/<session>.log`; `settled` watches 10 s (`SETTLE_MS`, overridable via `options.settleMs`); `messageWorker` serializes turns per session; Codex's session id is parsed from the log (`sessionFrom`). `run` takes `options.spawnProcess`, which unit tests already use to fake the program.
- Background Jarvis (`command-center/coordinator.mjs`, ADR 0019): the daemon wakes it through the same `launch` (startWorker) or the adapter's `messageWorker`, phase `coordinator`, env `AI_SDLC_ACTOR=jarvis` (so `jarvis.mjs record` stamps `by: "jarvis"`). Woken after news plus `quietMs` (10 s), polled every `turnPollMs` (5 s). A failed or lost Jarvis turn posts an `action-jarvis-<seq>` question, worded from the harness row's `explain` on the log's last line.
- Supervisor (`command-center/supervisor.mjs`): records `turn-started`/`turn-ended` from real PIDs; a silent turn (recorded nothing) is marked to wake Jarvis.
- `serve.start()` and `createCoordinator()` already accept `launch`, `adapters`, `quietMs` and `turnPollMs`; `serve.test.mjs` and `coordinator.test.mjs` fake them in-process. The `serve.mjs` command line exposes none of these, so the e2e rig cannot inject anything today.

### Scenarios and what each needs from a script

| Scenario | Model role today | What a script must do |
|---|---|---|
| `worker-keeps-assignment` | worker asks a question, ends; resumed turn records the answer and acks | keep state per session id so the resumed turn is the same session |
| `worker-releases-before-asking` | worker releases then asks; background Jarvis starts a replacement and delivers | scripted Jarvis turn runs `serve.mjs start` + `deliver`; replacement reports ready, then handles the answer |
| `clean-handoff-with-no-jarvis-chat` | scout releases + hands off; Jarvis staffs planner within 60 s | same scripted Jarvis |
| `background-jarvis-turn-fails` | a bad `--model` name makes the real CLI exit non-zero within the settle window; `explain` reads the log | the script needs its own failure trigger (for example, exit 1 when given that model name) |
| `story-to-pull-request` | real `ai-sdlc` skills drive scout to PR on haiku (~10 min); the scenario plays the owner and Jarvis; the daemon starts the test author after approval | a script records every phase event in order (handoff, question, draft-plan, plan, red, build, gates, mutation, review, comparison-choice, publishing, pr-opened), does the git work (spec as first commit, test, `farewell`, push to the bare origin) and opens the PR through the `gh` stand-in |

The runner's closing check (turns started/ended in order, none failed or lost, no process left) works unchanged with scripts.

### Seams for replacing the model (owner decision)

1. **E2E-only daemon launcher, faked program.** A new `e2e/` entry starts the daemon in-process with `start({ launch, adapters, quietMs, turnPollMs })`, where `launch`/`messageWorker` are the real `startWorker`/`messageWorker` given a `spawnProcess` that runs `node e2e/scripted-…mjs` instead of `claude`/`codex`, with the same arguments. Keeps `commandFor`, detached spawn, settle, logs, turn serialization, Codex session parsing, `AI_SDLC_ACTOR`, supervisor and coordinator real. No production code changes. Does not exercise the `serve.mjs` CLI's own `start()` wiring (`loadAdapters()` defaults); unit tests cover that.
2. **A scripted harness row** in `adapters/harnesses.mjs` with `command: node`. Costs: `install.mjs`, `modelPlan` (dashboard), harness pickers and `launchProblem` (joins `command` onto PATH entries) all treat it as a real harness; AGENTS.md says every row is described in the runbook.
3. **A switch in `serve.mjs`** (env var) that replaces `launch`. Simplest, but a test hook in production and it bypasses `harnesses.mjs`.
4. **A fake `claude`/`codex` first on PATH.** Rejected: on Windows only `.exe`/`.com` is started (ADR 0004), so a script shim cannot launch.

Recommendation: 1.

### Coverage lost by dropping models

Already covered by unit tests (stays covered): argument construction per harness and permission level, `explain` against sample error text, `spawnProcess`-faked start/resume/settle, coordinator and supervisor logic with fake launch.

Lost without any real run:
- That the installed `claude` and `codex` still accept today's flags (`--session-id`, `--resume`, `--permission-mode`, `--allowedTools`, `exec --json`, `exec resume`, `--model`, `-c sandbox…`). A CLI release that renames one breaks every story, unnoticed until a live one fails.
- Codex's real `--json` output carrying `thread_id` in the shape `sessionFrom` reads.
- `explain` against the real text of a real failure, and `sessionRan` reading real transcripts.
- Whether the skills and kickoff wording actually carry a model from scout to PR (only `story-to-pull-request` tests this today, and it is also the least deterministic: README notes the reviewer may stop for a profile edit).

### Timing

With no model, the scenarios still wait on fixed clocks: `SETTLE_MS` 10 s per turn start, coordinator quiet 10 s and poll 5 s, and in `background-jarvis-turn-fails` fixed 30 s and 15 s sleeps. Seam 1 can pass shorter `settleMs`/`quietMs`/`turnPollMs`; the fixed sleeps become proportional to `quietMs`. Rough total with defaults: 3 to 5 minutes; with short knobs, well under a minute.

### Where it could run

CI is `.github/workflows/test.yml` ("Tests"): `node --test` on windows, macos, ubuntu. `node --test` picks up `*.test.mjs`; `e2e/run.mjs` is not a test file, so it is not run. With no model and no secrets, scripted e2e could run in CI.

### Files likely to change

- `e2e/rig.mjs`, `e2e/run.mjs`, every file in `e2e/scenarios/`, `e2e/README.md` (premise, `--model`, `--unrestricted`, `--turn-seconds`, `cheapest`, `CLAUDE_CODE_SUBAGENT_MODEL`, the review-seat caveat).
- New: scripted worker/Jarvis program and an e2e daemon launcher under `e2e/`.
- `AGENTS.md` lines 24-25 ("tried with real workers ... spends that harness's model usage").
- New ADR under `docs/adr/` (reasons cannot go in comments).
- Possibly `.github/workflows/test.yml` or a `*.test.mjs` wrapper if scripted e2e joins CI.
- Not expected: `mission-console/store.mjs`, `roles.mjs`, the Jarvis phase table, `serve.mjs`, `coordinator.mjs`, `supervisor.mjs`, `harnesses.mjs`.

### Rules that apply

- AGENTS.md: `node --test` before committing; no package dependencies; no comments in source (comment ratchet, `comment-ratchet.json`); no personal names or real work details in tracked files (`private-details.test.mjs`); keep store and Command Center harness-neutral, harness specifics under `adapters/`.
- A change to how workers start, how decisions reach them, or how Jarvis is woken: `.claude/skills/verify-decision-delivery/SKILL.md` and the e2e run. With seam 1 the production launch path is unchanged, but the e2e harness itself is the change, so the delivery model should still be run and the new scripted suite run on every OS available.
- Lifecycle model (`verify-story-lifecycle`) applies only if the store, phases or Jarvis phase table change; not expected.
- Profile gates: `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Spec at `docs/specs/story/e2e-1-scripted-workers.md` as the branch's first commit. Pipeline "Tests". Cross-model review authorized; implementation level full; review round limit 3; reply to every PR comment before resolving it.

### Earlier related changes

- #31 `cc4e7b1`: added the e2e suite.
- #32 `0972889`: `story-to-pull-request`.
- #41 `28fb5de` (WAKE-1): background Jarvis, `clean-handoff-with-no-jarvis-chat`, `background-jarvis-turn-fails`; its spec at `docs/specs/story/wake-1-wake-jarvis-when-needed.md` records e2e determinism as a known risk.

### Risks

- A scripted suite that only replays what unit tests already fake adds run time without catching new bugs. Its value is real processes, real CLI calls between them (`serve.mjs start/deliver`, `jarvis.mjs record/ack`), real PIDs and timing.
- Scripted `story-to-pull-request` tests the store and daemon across the whole lifecycle, not the skills. A skill change that confuses a model would no longer be caught by any test.
- Shortened timing knobs could hide a race that only appears at the real 10 s values.
