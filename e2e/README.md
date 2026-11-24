# End-to-end checks

These checks run the factory the way a real story does: a real Command Center, a real story store, and real worker sessions in the harness you name. `node --test` covers the code; this suite covers what only shows up when a model is on the other end.

## Run it

```
node e2e/run.mjs "Claude Code"
node e2e/run.mjs Codex worker-releases-before-asking
node e2e/run.mjs --list
```

| Option | What it does |
|---|---|
| `<harness>` | A harness whose workers start from the command line, spelled as in `adapters/harnesses.mjs`. |
| `[scenario ...]` | Run only these scenarios. Without any, every scenario runs. |
| `--model <name>` | The model every worker turn and subagent runs on. Without it, the harness's cheapest model: `haiku` for Claude Code, `gpt-6-luna` for Codex. These checks test the Command Center's mechanics, not the quality of the code a worker writes. |
| `--unrestricted` | Start workers with the harness's unrestricted permissions. The default is restricted. |
| `--keep` | Keep the throwaway folder and worker logs after a pass. A failure always keeps them. |
| `--turn-seconds <n>` | How long to wait for one worker turn. The default is 300. |

Each scenario gets its own throwaway folder under the system's temporary directory: a git worktree, a profile, a story database and the worker logs. Nothing touches the owner's AI SDLC home. Workers find a `gh` stand-in first on their PATH: it records pull requests in the folder's `github` subfolder and refuses anything else, and the real GitHub CLI is left signed out, so no scenario reaches the owner's GitHub account. The run prints one line per step and exits 0 only when every scenario passed.

It spends the harness's model usage, so `node --test` and CI do not run it. Run it for each harness you can before merging a change to how workers start, how decisions reach them, or how Jarvis is woken.

## Scenarios

| Scenario | What it proves |
|---|---|
| `worker-keeps-assignment` | A worker asks a question and ends its turn. The owner's answer resumes that same session, which acts on it and acknowledges it. |
| `worker-releases-before-asking` | A worker releases, then asks. The owner's answer has nobody to take it, the background `wait-any` ends with it, and a replacement worker receives it after its kickoff turn. |
| `story-to-pull-request` | A feature story in a throwaway repository, whose origin is a local bare repository, runs from scout to an open pull request with the real lifecycle skills from this checkout. The scenario plays the owner, answering each question with its recommended option and approving the plan, and plays Jarvis, starting a worker whenever a decision has none to take it or a phase has nobody staffing it. After plan approval it leaves the test author to the Command Center, which starts one itself. It then checks that every phase ran in order, that the pull request carries the spec and gate results, and that the pushed branch starts with the spec and passes its tests. On `haiku` it takes about ten minutes. Each turn may run for 90 minutes, or `--turn-seconds` if longer. |

After every scenario the runner also checks that each turn started and ended in order, that none failed or was lost, and that no worker process is left running.

The throwaway profile names one model for every tier and does not authorize cross-model sharing, while review needs two reviewer seats of distinct model classes. A reviewer may work around that with a subagent on another model, or it may stop and ask the owner for a profile edit the scenario cannot make, which fails `story-to-pull-request` at its fourth step. A branch run has stopped there while a run of the unchanged default branch passed, so a stop at review alone does not show that a change broke the lifecycle: compare with a run on the unchanged default branch.


## A bug becomes a scenario

When a live story goes wrong, add a scenario that reproduces it before fixing it:

1. Create `e2e/scenarios/<what-went-wrong>.mjs`. Export `title`, one sentence saying what must hold, and `run(rig)`.
2. Drive the story through `rig`: `create` a story, `start` a worker with a kickoff, `decide` as the owner would in the console, `deliver`, and `waitAny` as Jarvis would. Read the result with `snapshot`, `history`, `event`, `turnsEnded` and `acknowledged`.
3. Wrap each thing that must hold in `rig.step(label, body)` and state it with `expect(condition, message)`. Use `rig.worker(story, turns, what, check)` to wait on something a worker must do: it fails at once, with the end of the worker's log, when the turn ends without it.
4. Run it against the unfixed code and confirm it fails at the step that describes the bug. Then fix the bug and confirm it passes.

A kickoff tells the worker exactly which console events to record. `rig.brief(story)` explains the console to it, and `onAnswer(story, question)` tells it what to do when the owner's answer arrives. A scenario that needs the real skills, such as the story from scout to pull request, writes its own kickoff instead.
