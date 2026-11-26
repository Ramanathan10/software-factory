# CHK-1: `pr-ready` needs a passing observation of the head

Work item: issue 52. Context pack: below.

## Problem

`pr-ready` moves a story from `ci` to `merge` ("ready to merge" on the board) whatever Hawkeye last observed about the pull request's checks. The guard in `mission-console/store.mjs`, `case 'pr-ready'`, checks that the head matches the observation and that the review is clear, but never reads `prObservation.status`.

Reproduced on `main` at 17bdf35 (Node 24.18.0, temporary in-memory database): with a registered PR in `ci`, `pr-observed` on head H with each status, then `pr-ready` with head H, is accepted for `failed`, `closed`, `running`, `no-checks`, `merged` and `passed`. A `pr-ready` that names a head is also accepted when Hawkeye has recorded no observation at all.

## Settled decisions (owner, rounds 1 and 2)

1. `no-checks` is refused like every status other than `passed` (question `chk1-no-checks`). A repository with no CI never shows "ready to merge"; its stories still close through `merged`.
2. `pr-ready` that names a head is refused until Hawkeye has recorded an observation (question `chk1-no-observation`).
3. `pr-ready` with no head and no observation stays accepted, unchanged (question `chk1-no-head`). It is the path for a PR Hawkeye cannot watch: one not on github.com, or a run with the watcher off. Once an observation exists, `pr-ready` already needs a head, so this path cannot pass over a failed observation.
4. Before-and-after: none (question `chk1-before-after`). The reproduction output is the before; the store tests are the after.
5. Architecture diagram: none (question `chk1-diagram`).
6. Docs: the README `pr-ready` row, `verify-story-lifecycle`, and Jarvis SKILL row 8 (question `chk1-docs`).

## Behaviour

`case 'pr-ready'` in `mission-console/store.mjs`, still from `ci` only. When `input.head` is given or an observation exists, in this order:

1. The head must be a valid head (unchanged).
2. New: an observation must exist. Otherwise 409, `Hawkeye has not observed this pull request yet.`
3. The head must match the observed head (unchanged, 409 `Readiness evidence does not cover the observed head.`).
4. New: the observed status must be `passed`. Otherwise 409, naming the status with the labels `observePr` already uses, moved to module scope so both share them: `<label> on the observed head.`, for example `CI failed on the observed head.`, `No checks reported on the observed head.`, `PR closed without merge on the observed head.`
5. The review must not request changes or leave threads unresolved (unchanged).

Then `readyHead` is set and the phase becomes `merge` (unchanged). With no head and no observation, the story moves to `merge` as today.

`observePr`, the watcher, `pr-recheck`, `merged`, phases and transitions do not change. `observePr` keeps its `story.readyHead` fallback for stories already stored with a head-only readiness.

### Lifecycle model

- `mission-console/lifecycle-model.mjs` `eventInputs`: `pr-observed` on each head with every status the store accepts: add `running`, `no-checks` and `closed` to `failed`, `passed`, `merged`.
- `mission-console/lifecycle-model.test.mjs`: a property beside the review one. From any reachable `ci` state, `pr-ready` with a head reaches `merge` only when the state has an observation of that head with status `passed`; and some `ci` state with a passed, clear observation does reach `merge` by it. `pr-ready` with no head reaches `merge` only from a state with no observation.
- Rerun the model and move the confirmed commit in `.claude/skills/verify-story-lifecycle/SKILL.md` forward after checking `guarded`, `eventInputs` and the properties still describe the code.

### Docs

- `mission-console/README.md`, `pr-ready` row: `pr-ready` with a head is refused until Hawkeye has observed the PR, and unless the observed status of that head is passed (the message names it); with no head it is accepted only before any observation.
- `.claude/skills/verify-story-lifecycle/SKILL.md`: the new property where the properties are listed; the modeled observation statuses (line 44) now all six; the confirmed commit.
- `skills/jarvis/SKILL.md` row 8 (events cell): supply the head once Hawkeye has observed the PR. Omit it only when Hawkeye cannot observe it: the PR is not on github.com, or the watcher is not running. When `pr-ready` is refused for checks or a missing observation, the story stays in CI and Jarvis waits for the next observation. Phase names in this cell stay out of backticks: `jarvisTable` in `lifecycle-model.mjs` reads every backticked word there as an event, so a backticked `ci` would fail "the store accepts every event the Jarvis phase table records". The phases column does not change.

## Acceptance criteria (observable)

1. With a registered PR in `ci` and an observation of head H with status `failed`, `running`, `no-checks`, `merged` or `closed`, `pr-ready` with head H is refused with 409, the message names the status, and the story stays in `ci` with no `readyHead`.
2. With an observation of head H with status `passed` and a clear review, `pr-ready` with head H moves the story to `merge` and sets `readyHead` to H.
3. With a registered PR in `ci` and no observation, `pr-ready` with a head is refused with 409 and the story stays in `ci`.
4. With no observation, `pr-ready` with no head moves the story to `merge` (unchanged).
5. The existing refusals stay: head mismatch, changes requested, unresolved threads.
6. The lifecycle model explores all six observation statuses and its new property passes; `node --test` and `node e2e/run.mjs` pass.
7. The three docs say what criteria 1 to 4 say.

## Test level

Unit: `mission-console/store.test.mjs`, written first by a separate subagent; the lifecycle model as the second check. The test at about line 433 records `pr-ready` with a head before any observation to set `readyHead` and then checks the "New head" wake; its setup records a `passed` observation of head A first. That is an intended contract change; the assertions about head B stay. `command-center/clear.test.mjs` mode `ready` (about line 105) records `pr-ready` with a head and no observation, to cover `clear.mjs`'s `readyHead` fallback when no merge was observed; its setup records a `passed` observation of the head first, so the fallback is still the path under test. No lifecycle-model property depends on a head-only readiness.

## Out of scope

Phases, transitions, `roles.mjs`, the watcher, `observePr`, `pr-recheck`, a check regression after `merge`, and the queued stories in the same file (#57, #59, #62, #63, #64).

## Run decisions

No before-and-after. No architecture diagram. Required gates from the profile: `node --test`, gitleaks on the branch; `node e2e/run.mjs` runs in the Tests workflow.

## Plan critique

Codex (profile model) had hit its usage limit, and GPT models through the Cursor CLI were outside the weekly allowance, so the one cross-model reviewer was Grok 4.7 (low) through the Cursor CLI, read-only, given this spec without its critique section. It found two defects, both verified against the code and fixed above:

1. Row 8 wording "stays in `ci`" would add `ci` as an event to the Jarvis table check and fail the lifecycle-model test. Fixed: phase names in that cell stay unformatted.
2. Row 8 sent Jarvis to supply the head for a github.com PR with the watcher off, which the new guard refuses forever. Fixed: omit the head when the watcher is not running.

It raised no objection to the store guard or the acceptance criteria. One reviewer from one other provider is a narrower check than the skill asks for.

## Context pack

### Rules that apply (AGENTS.md)

- `node --test` before committing; no package dependencies; no source comments (comment ratchet).
- A store change is checked by the lifecycle model (`.claude/skills/verify-story-lifecycle/SKILL.md`).
- No phase change, so transitions, `roles.mjs` and the Jarvis phase table's phases stay.
- No names or real work details in tracked files.

### Files

- `mission-console/store.mjs`: `case 'pr-ready'` (lines 402-414, the fix); `observePr` (lines 103-139) holds the statuses and their labels.
- `mission-console/watcher.mjs` `summarizePr`: `no-checks` means GitHub reported zero checks for the head; it also appears right after a push, before workflows register. Only `https://github.com` PRs are watched.
- `mission-console/lifecycle-model.mjs` (`abstract` keeps `prObservation.status`; `eventInputs` sends `failed`, `passed`, `merged` only) and `lifecycle-model.test.mjs` (review property at about line 107).
- `mission-console/store.test.mjs`: `pr-ready` at about 204 and 207 (no head, no observation), 433 and 442 (head before observation; head mismatch), 791 and 923-929 (passed with review).
- `e2e/`: no scenario records `pr-ready` or `pr-observed`.

### Commands

- Focused: `node --test mission-console/store.test.mjs mission-console/lifecycle-model.test.mjs`
- Full: `node --test`; `node e2e/run.mjs`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`

### Risks

- Model size: six more `pr-observed` inputs grow the explored states; the model took about 12 s before.
- A story in CI with the watcher off must omit the head; with the watcher running it must wait for the first observation. Row 8 says which. The store cannot tell the two apart; the no-head path is trusted to Jarvis.
