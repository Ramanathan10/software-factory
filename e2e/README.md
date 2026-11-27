# End-to-end checks

These checks run the factory the way a real story does, with no model: a real Command Center, a real story store, real worker processes started and resumed through `adapters/harnesses.mjs`, and a real background Jarvis woken by the daemon. Scripts play the workers and Jarvis, so every run gives the same answer and spends no model usage. `node --test` covers the code; this suite covers what only shows up between processes. [ADR 0022](../docs/adr/0022-end-to-end-checks-run-scripted-workers.md) records the design and what it does not cover.

## Run it

```
node e2e/run.mjs
node e2e/run.mjs Codex worker-releases-before-asking
node e2e/run.mjs --list
```

| Option | What it does |
|---|---|
| `[harness]` | Run only as stories in this harness, spelled as in `adapters/harnesses.mjs`. Without it, every scenario runs once as a Claude Code story and once as a Codex story. |
| `[scenario ...]` | Run only these scenarios. Without any, every scenario runs. |
| `--keep` | Keep the throwaway folder and worker logs after a pass. A failure always keeps them. |
| `--turn-seconds <n>` | How long to wait for one worker turn, and how long a scripted Jarvis or worker waits on another turn. The default is 60. |

Each scenario gets its own throwaway folder under the system's temporary directory: a git worktree, a profile, a story database, the playbooks and the worker logs. Nothing touches the owner's AI SDLC home. The rig removes every folder holding a `claude` or `codex` program from the Command Center's PATH and refuses to open if one is still reachable, so nothing can spend model usage. If that leaves no folder holding `node`, it links the running node into a folder of its own. Workers find a `gh` stand-in that records pull requests in the folder's `github` subfolder, and the real GitHub CLI is left signed out. The run prints one line per step and exits 0 only when every scenario passed. Both harnesses take about three minutes; the Tests workflow runs it on Windows, macOS and Ubuntu after `node --test`.

## How the scripts stand in for the model

The rig starts `e2e/daemon.mjs` instead of `command-center/serve.mjs`. It runs the same Command Center with a 2 s settle, a 2 s Jarvis quiet period and a 250 ms poll, and starts `e2e/scripted.mjs` wherever the real code would start `claude` or `codex`, with the same arguments, working directory, environment and prompt. A Codex start prints a `thread_id` line first, as `codex exec --json` does. Every start appends a line to `scripted-calls.jsonl` in the rig's home, and after each scenario the runner checks those calls against the turns and Jarvis wakes the console recorded.

A worker turn waits until the daemon assigns its session, then runs the first playbook entry that matches it. A turn run as Jarvis (`AI_SDLC_ACTOR=jarvis`) follows one fixed policy instead: with no worker in a phase that has one and no owner question left unanswered, it starts the next worker with the playbook's `next` kickoff, and delivers when an owner decision for the phase is pending; then it acknowledges the news it was given, except decisions. Given the model `no-such-model-e2e`, either kind of turn exits 1 before it reads a playbook.

## Scenarios

| Scenario | What it proves |
|---|---|
| `worker-keeps-assignment` | A worker asks a question and ends its turn. The owner's answer resumes that same session, which acts on it and acknowledges it. |
| `worker-releases-before-asking` | A worker releases, then asks. The owner's answer has nobody to take it, so the daemon wakes a background Jarvis, which staffs a replacement that receives the answer after its kickoff turn. |
| `answer-before-release` | A worker asks and keeps its turn. The owner answers, and the worker releases in that same turn. The replacement receives the answer after its kickoff turn, the released session is never resumed, and the daemon reports no turn it could not record. |
| `clean-handoff-with-no-jarvis-chat` | A worker releases and hands off while nobody waits on the console. A background Jarvis turn starts and the next worker is assigned within 60 seconds of the handoff. |
| `background-jarvis-turn-fails` | The coordinator tier names the model `no-such-model-e2e`, so the background Jarvis fails at once. The owner gets an `action-jarvis-` question in plain words, and Jarvis is not run again until they answer. |
| `failed-turn-answer-redelivered` | A worker's resumed turn carries the owner's answer, runs past the settle window and exits 1 without acknowledging it. The background Jarvis is woken, and `deliver` hands the pending answer to the same worker, which acknowledges it, and never again once it is acknowledged. In a second story the worker releases during that turn; once the turn ends, a replacement is assigned, its kickoff acknowledges nothing, and only the resumed turn `deliver` hands it acknowledges the answer. A scenario names the failed turns it expects with `rig.expectFailedTurns(story, count)`; any other failed turn still fails the run. |
| `restart-answer-queued-behind-turn` | A worker's first turn asks a question and keeps running. The owner answers, and the daemon restarts, once after the answer's batch fired and once inside the batch window. The scripted worker processes keep running through the restart. When the adopted turn ends, the new daemon resumes the same session once, which acknowledges the answer; the history shows the adopted turn ending before the resumed turn starts, and Jarvis is never woken. |
| `restart-answer-to-idle-worker` | A worker asks and ends its turn, and the owner answers. The daemon restarts inside the batch window. The new daemon resumes the idle worker's session soon after it starts, without waking Jarvis. |
| `restart-answer-already-acknowledged` | A resumed turn carries the owner's answer, the daemon restarts while that turn runs, and the worker acknowledges the answer before the turn ends. The new daemon does not resume the worker again. |
| `story-to-pull-request` | A feature story in a throwaway repository, whose origin is a local bare repository, runs from scout to an open pull request. Scripted workers record every phase and do the git work: the spec as the first commit, the test, the code, the push, and the pull request through the `gh` stand-in. The scenario plays the owner, answering each question with its recommended option and approving the plan, and plays Jarvis alongside the background one. It checks that every phase ran in order, that the pull request carries the spec and gate results, and that the pushed branch starts with the spec and passes its tests. It checks the store and daemon across the lifecycle, not the skills. |
| `merge-during-diagram` | A pull request merges while Rocket draws a diagram started from ci. The watcher sees the merge in diagram and wakes Jarvis, which releases Rocket and records `merged`. The story goes to the retro with return phase `closed`, and the retro worker's handoff closes it. |

After every scenario the runner also checks that each turn started and ended in order, that none failed or was lost, that no worker process is left running, and that every turn ran the scripted program with the harness's start or resume arguments.

## A bug becomes a scenario

When a live story goes wrong in the Command Center, the store or the daemon, add a scenario that reproduces it before fixing it. A bug that only a model's choices show is fixed in the skill that misled it, and gets no scenario.

1. Create `e2e/scenarios/<what-went-wrong>.mjs`. Export `title`, one sentence saying what must hold, and `run(rig)`. A scenario that exports `profile(entry)` adds those settings to the throwaway profile.
2. Write what each worker turn does with `rig.playbook(story, { next, turns })`. `next` is the kickoff a background Jarvis gives the next worker it starts. Each entry in `turns` matches on `role` (the assigned worker's role), `phase` (the story's phase when the turn starts), `turn` (`"first"` or `"resumed"`) and, optionally, `worker` (1 for the story's first assignment, 2 for the next, and so on), and lists its `steps`. A scripted Jarvis follows the fixed policy unless the playbook has `jarvis: [{ "wake": <n>, "steps": [...] }]`: on its nth `jarvis-woken` it performs those steps instead, and nothing else.
   - `{ "record": { "type": "question", ... } }` records an event. The script fills in the story, a fresh key, the current revision, and the assignment while the story has a worker.
   - `{ "ack": ["answer"] }` acknowledges every pending event of those types on the story.
   - `{ "write": "path/in/worktree", "text": "..." }` writes a file.
   - `{ "run": ["git", "commit", "-q", "-m", "..."], "save": "name" }` runs a program in the worktree and fails the turn if it exits non-zero; `"node"` means the running Node. `save` keeps its trimmed output. Call the `gh` stand-in as `rig.gh(...args)`.
   - In any string, `{{answer:<question id>}}` is the owner's answer to that question, and `{{<name>}}` is a saved output.
   A turn with no matching entry prints what it looked for and fails.
3. Drive the story through `rig`: `create` a story (`{ scouted: false }` leaves it in scout), `start` a worker with a kickoff, `decide` as the owner would in the console, `deliver`, `restart` (stops the daemon and starts it again on the same port and database while the worker processes keep running), and `waitAny` as a Jarvis chat would. Read the result with `snapshot`, `history`, `event`, `turnsEnded` and `acknowledged`.
4. Wrap each thing that must hold in `rig.step(label, body)` and state it with `expect(condition, message)`. Use `rig.worker(story, turns, what, check)` to wait on something a worker must do: it fails at once, with the end of the worker's log, when the turn ends without it. Scale any fixed wait to `rig.quietMs`.
5. Run it against the unfixed code and confirm it fails at the step that describes the bug. Then fix the bug and confirm it passes.
