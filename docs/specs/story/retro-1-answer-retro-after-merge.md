# RETRO-1 spec: a story that merges mid-retro keeps its retro open

Work item: GitHub issue #78. Branch `story/retro-1-answer-retro-after-merge`, cut from origin/main fa90a29. After approval this file is committed as `docs/specs/story/retro-1-answer-retro-after-merge.md`, the branch's first commit.

## Context pack

`C:\Users\trojanmini\.ai-sdlc\stories\RETRO-1\context-pack.md` (registered artifact). Its file list, rules, commands and risks apply unchanged.

## Problem

When the pull request merges while the retro is running, the story closes with the retro's questions still open. The owner's answer is then refused ("The story is closed."), the retro's lessons handoff is refused ("This phase has no handoff."), and the story sits in "Waiting on you" until the owner clears it. Live case: PUB-1, PR 77.

## Reproduction

`C:\Users\trojanmini\.ai-sdlc\stories\RETRO-1\reproduce.mjs` on fa90a29, output in `reproduction-output.txt`:

1. Story reaches `ci`, `retro-start` moves it to `retro`, a retro worker is assigned and asks `retro-1`.
2. `merged` is refused while the worker is assigned, so Jarvis releases the worker first, as its skill says.
3. `release-worker`, then `merged`: the story is `closed` with `retro-1` open.
4. The owner's `answer` is refused: "The story is closed."
5. The retro `handoff` with the lessons is refused: "This phase has no handoff."

## Root cause

- `merged` (store.mjs:420) moves a `retro` story to `closed` unconditionally.
- `question` and `answer` (store.mjs:53, :65) refuse a closed story, and closed has no worker, no retro handoff and no Jarvis wake.
- The Jarvis skill and RUNBOOK tell Jarvis to release the worker before recording a merge.
- The dashboard's `waitingOnYou` counts the stranded question, so the closed story stays in "Waiting on you".

## Settled decisions

1. Design: hold the story in retro until the retro hands off. `merged` in `retro` records the merge on `story.retro` and leaves the phase at `retro`; the retro worker keeps its assignment and gets the owner's answer through the existing delivery path; the retro handoff then closes the story. No daemon change.
2. When: always hold a retro that is running when the PR merges, whether or not a question is open.
3. pr-review: out of this story. Questions open in `pr-review` when the PR merges are stranded the same way; a follow-up issue covers them (see PR-time tasks).
4. Before and after: yes, command output (see Run decisions).
5. Architecture diagram: none.

## Acceptance criteria

1. In `retro` with a worker assigned and a question open, `merged` is accepted without releasing the worker. The phase stays `retro`, the worker stays assigned, and `story.retro` records the merge time and the merge evidence.
2. After that merge, the owner's `answer` to the open retro question is accepted, and a worker may still record `question` in the held retro.
3. The retro `handoff` with the lessons on a merged retro moves the story to `closed` and records the lessons and `completedAt` on `story.retro`.
4. The retro `handoff` on a retro with no merge recorded still returns to `story.retro.returnPhase` (`ci` or `merge`), unchanged.
5. A second `merged` on a retro that already recorded one is refused with 409.
6. `replan` on a retro that recorded a merge is refused with 409; the merged PR cannot reopen planning.
7. A closed story still refuses `question` and `answer`.
8. `merged` from `ci`, `merge` and `pr-review` still closes the story, unchanged.
9. A held retro with its worker released (for example, a worker that crashed) can be restaffed with a retro worker as today, and that worker's handoff closes the story.
10. Lifecycle model: the merge flag is in `guarded`; the property "from retro, merged closes the story" becomes "from retro, merged then the retro handoff closes the story"; the model still shows every reachable story can reach `closed`. The PR says why the property changed.
11. The Jarvis skill phase table (row 9. Retro and the merge handling in section 6) and `skills/jarvis/RUNBOOK.md` say: on a merge during the retro, record `merged` without releasing the retro worker; the retro worker's handoff closes the story. `mission-console/README.md`'s `retro-start` and `merged` rows say the same.
12. Dashboard: a story held in retro after a merge is labelled "Merged · finishing retro". It is in "Waiting on you" only while it has an open question, and it is not in Archive until it closes. A closed story with nothing open is unchanged.
13. e2e scenario `merge-during-retro-keeps-question`: the scripted retro worker asks a question, the scripted Jarvis records `merged` without releasing it, the owner answers, the same worker receives the answer and hands off the lessons, and the story is `closed` with the lessons recorded. The scenario fails on unfixed code.

## Test level

Unit tests in `mission-console/store.test.mjs` for criteria 1–9, updating the existing test "the retro runs while the PR is open and may be followed by the merge" (store.test.mjs:649), which expects `closed` right after `merged`. Lifecycle model property in `mission-console/lifecycle-model.test.mjs` for criterion 10. Dashboard label and grouping in the existing Command Center UI tests for criterion 12. The e2e scenario for criterion 13.

## Out of scope

- #63: a merge before the retro starts.
- CHK-1's (#52) change to `pr-ready` in store.mjs; keep edits away from it and merge main before publishing.
- Reopening closed stories.
- PRs closed without merge.
- Questions open in `pr-review` when the PR merges (follow-up issue below). This story covers the retro half of #78's criterion "a merge never discards a pending owner question without telling the owner"; the PR says so.
- Having Hawkeye's watcher observe merges during `retro`; Jarvis keeps reconciling that merge by hand.

## Run decisions

- Before and after: command output. Method: `node C:\Users\trojanmini\.ai-sdlc\stories\RETRO-1\reproduce.mjs` against a throwaway store. Environment: this machine, Node 22. Before reference: the registered `reproduction-output.txt`, captured on fa90a29 (answer refused, handoff refused). After: the same script run on the branch, with the merge step recorded as the updated Jarvis skill says (no `release-worker` first), showing the answer accepted and the handoff closing the story. Both outputs are registered as `document` artifacts with detail starting BEFORE and AFTER.
- Architecture diagram: none.
- Gates (profile): `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`; also `node e2e/run.mjs` (AGENTS.md, and the Tests pipeline). Store change checked with `.claude/skills/verify-story-lifecycle/SKILL.md`.

## PR-time tasks

- During publishing, file a GitHub issue in this repository: "A merge during pr-review strands Hawkeye's open questions", covering withdrawing open `pr-review` questions with a visible note when the PR merges. Link it in the PR description beside the scope note.
- Merge origin/main before publishing (CHK-1 edits the same file).
