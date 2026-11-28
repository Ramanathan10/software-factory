# HNOTE-1: Each harness row carries its own notes, and every worker the daemon starts on that harness is told them

Work item: none (the owner's words in the Jarvis chat). Branch `story/hnote-1-harness-notes-in-kickoffs`, base `377e20a`. Spec: `docs/specs/story/hnote-1-harness-notes-in-kickoffs.md`.

## Problem

Workers need a few switches that only one harness has, such as Claude Code's `run_in_background: false` when starting a subagent. The FEED-1 retro first put that switch into `skills/ai-sdlc/SKILL.md`, which must stay harness-neutral; PR #105 now carries the neutral rule ("use its foreground setting"). Nothing tells a Claude Code worker what that setting is, so three headless workers (E2E-1, RETRO-2, FEED-1) started a background subagent, ended the turn, and lost it. The owner wants skills harness-neutral and harness-specific instructions kept with the harness.

## Settled decisions

1. `reach`: notes reach every first turn the daemon starts on a command-line harness (the test author, a manual `serve.mjs start` with Jarvis's kickoff, every background Jarvis turn that starts a new session (its first wake, and a relaunch after a failed or lost Jarvis turn, since `coordinator.mjs` `wake` resumes only a session whose last turn ended), and the CLI `node adapters/harnesses.mjs start`), added in one place, `startWorker` in `adapters/harnesses.mjs`. Not resumed turns (`messageWorker`), not the GitHub Copilot app, not Cursor, not the owner's Jarvis chat. No kickoff writer and no skill changes.
2. `shape`: a row carries `notes`, a list of plain sentences. `startWorker` appends them to the prompt as its last paragraph: a blank line, the heading `Notes for <row name>:`, then one line per note, each starting `- `. The prompt's first line and its first "story <ID>" stay where they are.
3. `note-text`: Claude Code's first note reads: "When you start a subagent with the Agent tool, pass run_in_background: false, so the call returns only with the subagent's result. This turn runs headless, and Claude Code stops a background subagent when the turn ends."
4. `no-note`: a row with no `notes` (today Codex, Cursor and the GitHub Copilot app) gets nothing; its prompt stays byte for byte what the kickoff writer produced.
5. `existing-lines`: the harness-specific lines already in `skills/` are listed in Out of scope with why each stays; none moves.
6. `test-proof`: a unit test in `adapters/harnesses.test.mjs` and a runner-wide e2e check after every scenario, under both harnesses; no new scenario.
7. `docs`: the factory runbook's "Harnesses driven from the command line" gains one paragraph, and `e2e/README.md` gains one line. No other doc changes.
8. `before-and-after`: skipped.
9. `architecture-diagram`: skipped.
10. Settled by the planner, from AGENTS.md: `startWorker` is in the delivery model's coverage record, so the implementer reruns the model and moves the record forward in `.agents/skills/verify-decision-delivery/SKILL.md` after checking that its steps still match. That file is a maintainer skill, not a doc that restates worker behaviour, so decision 7 still holds.

## Design

### adapters/harnesses.mjs

The `Claude Code` row gains `notes: ['<the note in decision 3>']`. In `startWorker`, after the `in-app` and `none` returns and before `run(...)`, the prompt handed to `run` becomes the kickoff prompt followed by `\n\nNotes for <entry.name>:\n- <note>` per note, when `entry.notes?.length`; otherwise the prompt is passed unchanged. It is one expression with no new `await`, so the delivery model's steps do not change. `messageWorker` is untouched. The kickoff prompt is not trimmed or otherwise altered. LAUNCH-1's lines in this file are left alone; the change touches only the row and the prompt argument of the `run` call.

### e2e/scripted.mjs

Reads stdin before it appends to `scripted-calls.jsonl`, and adds the prompt to that line as `prompt`. The `no-such-model-e2e` failure still exits 1 before any playbook is read. Its story-id parse still reads the first "story <ID>" in the same prompt.

### e2e/rig.mjs

`checkCalls` adds, for each call: when its arguments have the row's start shape and the row has `notes`, the prompt ends with the notes paragraph built from `entry.notes`; otherwise (a start on a row with no notes, or any resume) the prompt does not end with the notes paragraph of any row that has `notes`. Checking the paragraph, not a bare phrase, keeps a brief or event detail that mentions "Notes for" from failing a scenario. The failure names the call's actor and session. Because every scenario runs under Claude Code and Codex, this covers the test author, background Jarvis (including the relaunch in `background-jarvis-turn-fails`) and manual starts in the existing scenarios.

### skills/jarvis/RUNBOOK.md

"Harnesses driven from the command line" gains one paragraph, after the opening paragraph: "A row's `notes` are added to the end of every first turn the daemon starts in that harness, under `Notes for <harness>:`, after the kickoff's own text; resumed turns do not carry them. Claude Code's note tells the worker to pass `run_in_background: false` when it starts a subagent, because a headless turn that ends stops a background subagent. Codex has no notes, so its prompt is the kickoff alone."

### e2e/README.md

The paragraph at line 24 that describes `scripted-calls.jsonl` says each line also carries the prompt, and the paragraph at line 45 that lists what the runner checks after every scenario gains: "and that every start in a harness whose row has `notes` ends with them, while resumed turns and starts in other harnesses carry none".

## Acceptance criteria

1. A Claude Code worker the daemon starts in a new session, whether test author, manual start, or a background Jarvis first wake or relaunch, receives a prompt that is the kickoff followed by `\n\nNotes for Claude Code:\n- ` and the note in decision 3.
2. A Codex worker's first-turn prompt is byte for byte what the kickoff writer produced.
3. A resumed turn's prompt (`messageWorker`, including a resumed Jarvis session), in either harness, carries no notes.
4. The GitHub Copilot app and Cursor returns from `startWorker` are unchanged.
5. No file under `skills/` gains a harness-specific instruction; the only `skills/` change is the runbook paragraph in the Design section, with that wording.
6. `e2e/README.md` carries the line in the Design section.
7. `node --test` and `node e2e/run.mjs` pass under both harnesses; the delivery model passes unchanged and its coverage record moves forward.
8. The comment ratchet does not rise; no package dependency is added.

## Test level

Unit and end to end. Write first:

- Red, in `adapters/harnesses.test.mjs` with the existing `spawnProcess` stub that captures `call.prompt`: a Claude Code start with prompt `kickoff for story T-1` captures exactly `kickoff for story T-1\n\nNotes for Claude Code:\n- <note>`.
- The unit test asserts the notes paragraph as a string literal, not through a helper shared with `startWorker` or the rig, so a wrong format in the code cannot pass by matching itself.
- Two existing tests in the same file pin today's Claude Code start prompt and change with the contract, written by the test author: "starting a worker returns the id it chose, or the id the program reports" (`harnesses.test.mjs:329`, Claude Code's prompt becomes the notes-bearing one; Codex's stays `kickoff`) and "a message to a new session waits for the kickoff turn startWorker began" (`harnesses.test.mjs:159`, the first prompt becomes the notes-bearing one, the message stays exact). Both are red against the unchanged code once updated.
- Regression guards in the same file, green today and kept green: a Codex start captures `kickoff for story T-1` exactly; a Claude Code `messageWorker` captures its message exactly (the existing test at `harnesses.test.mjs:131` already asserts this).
- Red, end to end: `e2e/scripted.mjs` and `e2e/rig.mjs` as in the Design section; the Claude Code run fails because no start carries the notes yet, and the Codex run stays green. The scripted logging change is test fixture, written by the test author.

Focused: `node --test adapters/harnesses.test.mjs`. End to end: `node e2e/run.mjs` (both harnesses). Full: `node --test`, then the delivery model `node --test command-center/delivery-model.test.mjs command-center/approval-model.test.mjs`.

## Run decisions

Before and after: none (decision 8). Architecture diagram: none (decision 9).

## Out of scope

- PR #105 (the neutral skill wording); not edited.
- ADRs. `docs/adr/0004-how-a-worker-program-is-started.md` stays true (the prompt still goes on stdin). `docs/adr/0022-end-to-end-checks-run-scripted-workers.md` records what the runner checked when it was decided; ADRs are not rewritten as behaviour grows, and `e2e/README.md` carries the current list.
- LAUNCH-1's changes to the spawn path in `startWorker` and `startStoryWorker`, and its lines in `command-center/serve.mjs` and `adapters/harnesses.mjs`. Main is merged before publishing.
- Kickoff writers (`testingKickoff`, `jarvisKickoff`, the runbook's "Story worker kickoff template") and the GitHub Copilot app's `create_session` kickoff.
- Harness-specific lines already in `skills/`, which stay (decision 5):
  - `skills/ai-sdlc/SKILL.md:31` and `skills/ai-sdlc-setup/SKILL.md:59`: harness names as examples of an argument, not instructions.
  - `skills/jarvis/SKILL.md:42`: names harnesses as examples of keeping the owner's harness.
  - `skills/jarvis/SKILL.md:28`: the Copilot canvas step, read by the Jarvis chat, which no row reaches.
  - `skills/before-and-after/SKILL.md:35`: the Cursor computer-use step, read in sessions the daemon never starts, so a row note would lose it.
  - `skills/jarvis/RUNBOOK.md`: the factory runbook, where AGENTS.md says each harness is described.
  - `skills/learnings/SKILL.md:82`: about instruction files, not a switch.
  - Imported third-party skills (`diagram-design`, `self-improvement`, `ponytail`, `explainer`), kept self-contained.

## Plan critique

Two seats from different providers, given the same neutral brief (requirement, constraints, the spec, the code to read; concrete defects only). Codex (OpenAI) could not take a seat: its usage limit resets on 30 November.

- Claude Sonnet (Anthropic) found five issues, each checked against the code and folded in. Two existing Claude Code prompt assertions (`harnesses.test.mjs:159` and `:329`) would break unnamed; they are now in Test level. A Jarvis relaunch after a failed turn is a new session through `startWorker` and gets the notes; decision 1 and criteria 1 and 3 now say so. A bare `Notes for ` absence check could trip on a brief or event detail; the rig now checks for the notes paragraph. The unit test must use a string literal, not a shared helper; stated. `e2e/README.md:24` describes the calls file; it now gains the prompt, and ADRs 0004 and 0022 are named in Out of scope with why they stay.
- Grok (xAI) reviewed the revised spec and found no defects: every first-turn path goes through `startWorker`, start and resume argument shapes stay distinct with `--model`, and no existing scenario breaks.

## Not asked (overrule any line and it becomes a question)

Facts relied on:

- Every daemon-started first turn goes through `startWorker`: `serve.mjs` `startStoryWorker` and `coordinator.mjs` `wake` both call the `launch` that `start()` sets to `startWorker`; `e2e/daemon.mjs` wraps the same function with only `spawnProcess` and `settleMs` swapped.
- Resumed turns go through `messageWorker`; the Copilot app returns `inApp` and Cursor `noWorkers` before any spawn.
- `e2e/scripted.mjs` logs argv, cwd, session and actor, not the prompt, and takes the story id from the first "story X" in the prompt; `e2e/rig.mjs` `checkCalls` already checks each call's start or resume shape against the row under test.
- No other file states what a started worker's prompt contains beyond the kickoff writers: `skills/jarvis/BACKGROUND.md` and `e2e/README.md` describe kickoffs by their source, not their full text, and stay true with notes appended.
- PR #105 is open on `retro/feed-1-foreground-subagents` and touches only `skills/ai-sdlc/SKILL.md`.
- LAUNCH-1 is in planning and plans to rewrite the spawn path in `startWorker` and `startStoryWorker`.

Decisions reused: from the owner in the Jarvis chat, skills stay harness-neutral, harness-specific instructions live with the harness, and the first note is Claude Code's `run_in_background: false`. From the profile: gates, spec location, pipeline, cross-model review authorized, review round limit 3.

## Context pack

### Files and entry points

- `adapters/harnesses.mjs`: the harness table. Rows: `GitHub Copilot app` (`workers: 'in-app'`), `Cursor` (`workers: 'none'`), `Claude Code` and `Codex` (`workers: 'command-line'`). No row carries any text for the worker today.
- `startWorker` in `adapters/harnesses.mjs` is the one place every daemon-started first turn passes through, with `prompt` in hand before `run()` writes it to the program's stdin:
  - the test author (Bruce Banner): `serve.mjs` `beginWorker` → `startStoryWorker` → `prepare` writes `testingKickoff` → `launch` (= `startWorker`);
  - a manual start by Jarvis (`node serve.mjs start <story>` with the kickoff Jarvis wrote, per the runbook's "Story worker kickoff template"): same path, `prepare` leaves the prompt as Jarvis wrote it outside `testing`;
  - the background Jarvis's first wake: `coordinator.mjs` `wake` → `launch` (the same `startWorker`) with `jarvisKickoff`;
  - the CLI `node adapters/harnesses.mjs start <harness> <worktree>`;
  - the e2e daemon (`e2e/daemon.mjs`) wraps the real `startWorker` with only `spawnProcess` and `settleMs` swapped, so a note added there reaches the scripted workers' stdin.
- Paths that do not go through `startWorker`'s spawn:
  - resumed turns: `messageWorker` (owner decisions via `deliver`, later background Jarvis wakes). The session already holds its first-turn prompt.
  - GitHub Copilot app: `startWorker` returns `{ inApp, start, message, next }`; Jarvis calls `create_session` with its own kickoff.
  - Cursor: `startWorker` returns `{ noWorkers }`.
  - The owner's Jarvis chat: the daemon never starts it; it reads `skills/jarvis/SKILL.md`.
- Kickoff writers: `testingKickoff` and `jarvisKickoff` in `command-center/serve.mjs`; the manual kickoff template in `skills/jarvis/RUNBOOK.md` ("Story worker kickoff template").
- Saved kickoffs today (outside Git): `C:\Users\trojanmini\.ai-sdlc\stories\HNOTE-1\kickoff-today-test-author.txt` (MRG-1's Bruce Banner kickoff) and `kickoff-today-background-jarvis.txt` (PRURL-1's background Jarvis kickoff). Neither says anything about the harness's subagent switches.
- Factory runbook: `skills/jarvis/RUNBOOK.md`, "Harnesses driven from the command line" describes the Claude Code and Codex rows once.
- PR #105 (open, branch `retro/feed-1-foreground-subagents`, touches only `skills/ai-sdlc/SKILL.md` phase 2) adds the neutral rule: "Start it so the call returns only with its result: if the harness runs subagents in the background by default, use its foreground setting." Not to be edited.
- The Claude Code switch: the Agent tool's `run_in_background` parameter. Claude Code runs subagents in the background by default and notifies on completion; a headless `claude -p` turn that ends while one runs stops it (E2E-1, RETRO-2, FEED-1).

### Harness-specific lines already in `skills/`

| Line | Kind |
|---|---|
| `skills/ai-sdlc/SKILL.md:31` | Names harnesses as examples of the preflight argument. Not an instruction. |
| `skills/ai-sdlc-setup/SKILL.md:59` | Names install ids as examples. Not an instruction. |
| `skills/jarvis/SKILL.md:28` | "In the GitHub Copilot app, open the extension's canvas instead." A Copilot-only step in the Jarvis chat. |
| `skills/jarvis/SKILL.md:42` | Keep the harness the owner started in; names harnesses as examples. |
| `skills/jarvis/RUNBOOK.md` | The factory runbook: AGENTS.md names it as where each harness is described once. Allowed. |
| `skills/before-and-after/SKILL.md:35` | "In Cursor, delegate that capture to the computer-use subagent." A Cursor-only instruction in a local adaptation. Cursor has no daemon-started worker, so a row note would never reach it. |
| `skills/diagram-design`, `self-improvement`, `ponytail`, `explainer` | Imported or adapted third-party skills; AGENTS.md keeps them self-contained. |
| `skills/learnings/SKILL.md:82` | "Use AGENTS.md for Codex or cross-agent repo guidance": about instruction files, not a switch. |

### Rules that apply

- AGENTS.md: anything specific to one harness belongs under `adapters/`; every harness is one row in `adapters/harnesses.mjs`, described once in the factory runbook. Skills say "the owner", never a person. No profile or database committed. No source comments (`comment-ratchet.mjs`). No package dependencies. `node --test` before committing.
- A change to how worker turns start is checked by the delivery model (`.agents/skills/verify-decision-delivery/SKILL.md`; `startWorker` is in its coverage record) and tried end to end (`node e2e/run.mjs`).
- No `CLAUDE.md`, `.cursor/rules` or `.github/copilot-instructions.md` in the repository.
- Profile: gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; spec at `docs/specs/story/hnote-1-harness-notes-in-kickoffs.md`, first commit; pipeline "Tests" (also runs `node e2e/run.mjs`); no review bot; reply to every PR comment before resolving it.

### Commands

- Focused: `node --test adapters/harnesses.test.mjs command-center/serve.test.mjs`
- Delivery model: `node --test command-center/delivery-model.test.mjs command-center/approval-model.test.mjs`
- End to end: `node e2e/run.mjs` (both harnesses), or `node e2e/run.mjs "Claude Code" <scenario>`
- Full: `node --test`

### Similar earlier changes

- MODELS-1 (#37) added `model` and `models` to the rows and passed them through `commandFor`: the pattern for a per-row value reaching every start.
- WAKE-1 (#41) added the background Jarvis and `jarvisKickoff`, launched through the same `startWorker`.
- `adapters/harnesses.test.mjs` already captures the prompt a start writes (`call.prompt` in its `spawnProcess` stub).
- `e2e/scripted.mjs` logs argv, cwd, session and actor to `scripted-calls.jsonl`, but not the prompt.

### Risks

- LAUNCH-1 (planning, blocked behind PRURL-1) rewrites the spawn path in `startWorker` and `startStoryWorker` (record a Claude Code assignment before spawning, stop the process tree on a refused start). Keep HNOTE-1 to one prompt expression in `startWorker` and the row, with no new `await`, and merge main before publishing.
- The note must not change the first line of a prompt or add a "story <ID>" phrase before the real one: `e2e/scripted.mjs` takes the story id from the first `story X` in the prompt.
- A note on resumed turns would repeat on every decision; a note on the Jarvis chat would need a skill line, which defeats the goal.
- Moving `before-and-after:35` into Cursor's row loses it: nothing carries a row's text to a Cursor session.
