# SETUP-1: Rerun setup to change answers the profile already holds

Branch `story/setup-1-rerun-setup-changes-answers`, cut from origin/main cb0ffc5. Committed after approval as `docs/specs/story/setup-1-rerun-setup-changes-answers.md`, the branch's first commit.

## Problem

Rerunning `ai-sdlc-setup` on a machine and repository whose profile is complete asks nothing: the check reports `unanswered: []` and `SKILL.md` (1. Detect) asks only unanswered questions. To change an answer already filled in, the owner either says "redo AI SDLC setup", which walks every question again and recommends the stock answers rather than the owner's own, or edits `profile.json` by hand, which skips the validation a first answer gets and leaves dependent answers stale. A tracker changed to `none` keeps its checklist, target branch and Azure DevOps fields, and the schema accepts them.

Owner's scope: a rerun of setup lets the owner change answers already filled in, and the profile takes the new answers. Setup stays outside Jarvis and is not a numbered lifecycle phase.

## Context pack

`C:/Users/trojanmini/.ai-sdlc/stories/SETUP-1/context-pack.md` (registered on the story). Key facts:

- `skills/ai-sdlc-setup/scripts/preflight.mjs`: `questions` (machine 1-10, repository 1, 3-6, 8-11 with their profile fields), `answered`, `unanswered`, `check`, `detect`; CLI modes `detect` and `check` only.
- `SKILL.md` 1. Detect (the "ask only the questions it has no answer for" paragraph), 2. Interview, 4. Verify, 5. Hand off ("edit the profile file directly or say 'redo AI SDLC setup'"), Later changes.
- `README.md:84`: "later runs ask only for an answer the profile lacks".
- `model-choice.test.mjs:236` asserts machine question 10's wording in `SKILL.md`.
- `readiness-sync/engine.mjs` uses `targetBranch`, `checklist`, `closedTaskStates`, `unestimatedValue`, `handoffTaskTitle`, `handoffAssignee` and `phases` for every tracker; `readiness-sync/trackers.mjs` uses `organization`, `project` and `effortField` only for `azure-devops`; GitHub issues carry no effort.

## Settled decisions

Round 1 (owner, all as recommended):

1. **pick**: when the check finds nothing unanswered, setup shows every current answer in a numbered table by section (machine, then this repository) and the owner names what to change: one or more question numbers, a whole section, or "all". Setup asks only those, each recommending the current answer.
2. **redo-defaults**: "redo AI SDLC setup" also recommends the current answer for each question and names the stock recommendation when the two differ.
3. **validate**: a changed answer is asked with its question's own wording and fixed choices; model names come only from `node <harnesses> models <harness> [repository]`; after saving, the check runs; a changed gate runs once on the unchanged remote default branch (`mutation` excepted), and a changed `secrets` gate also gets the full-history scan as information.
4. **on-failure**: the old answer stays in force until the new one passes. Setup shows the output and asks whether to correct the new answer, keep the old one, or (for a gate) save it as `null`.
5. **dependents**: setup re-asks only the dependents a change makes stale, recommending their current answers, removes sub-answers that no longer apply, and tells the owner what it removed.
6. **open-stories**: the hand-off report says in one sentence that open stories pick up the change at their next worker turn or check. No console event, no Jarvis involvement.
7. **before-after**: captured as command output (below).
8. **diagram**: none.

Round 2 (owner, all as recommended):

9. **answers-script**: `preflight.mjs` gains an `answers` mode that prints the current-answers table, built from the same question list `check` uses, with tests.
10. **stale-warning**: `check` warns (not a problem) about each work-tracker sub-answer the tracker no longer uses, naming the field.
11. **trigger**: "set up AI SDLC" on a complete profile shows the table; the skill description adds "change AI SDLC setup" as a trigger. "redo AI SDLC setup" keeps meaning the whole interview.

## Acceptance criteria

### Script (`skills/ai-sdlc-setup/scripts/preflight.mjs`)

1. `node preflight.mjs answers <repository>` prints JSON `{ profile: <path>, slug: "owner/name", machine: [rows], repository: [rows] }`, where each row is `{ question, name, field, answered, value }` taken from the `questions` list, plus rows for the questions that list leaves out because they have no required field: machine 11 Missing components (`declinedComponents`), repository 2 Missing tools (no field; value `null`), repository 7 Sharing limit (`crossModelReviewAuthorized`). A field from the `questions` list that the profile lacks has `answered: false` and `value: null`; every other row has `answered: true`, including a `null` answer. The rows outside that list (missing components, missing tools, sharing limit, `phaseTiers`) are always `answered: true`, because leaving their field out is itself an answer; their `value` is the saved field or, when it is left out, `[]` for `declinedComponents`, `{}` for `phaseTiers`, and `null` otherwise. So a profile whose `check` reports `unanswered: []` has no row with `answered: false`. Machine 10 Models shows the whole `models` object; `phaseTiers` appears as its own row under question 10.
2. With no profile, `answers` prints the same shape with empty sections and exits 1 with a message naming the missing profile; with no repository section, the repository list is empty.
3. The usage line names the new mode: `node preflight.mjs detect [repoDir] | check [repoDir] [harness] | answers [repoDir]`.
4. `check` adds one warning per stale tracker sub-answer in this repository's section, worded `repos.<slug>.readiness.<field> is not used when the tracker is <tracker>. Remove it, or change the Work tracker answer (ai-sdlc-setup repository question 11).`:
   - tracker `none`: every field other than `tracker`;
   - tracker `github` or `linear`: `organization`, `project`, `effortField`;
   - tracker `github`: `effortSet` in `checklist` (worded for the checklist entry).
   The warnings keep `ok: true`. `nextSteps` counts them apart from component warnings: it tells the owner to remove each field a stale warning names or change the Work tracker answer, and gives the install step only when a component warning remains. Today's `warnings.length > asks.length` split changes accordingly.
5. Unit tests in `skills/ai-sdlc-setup/scripts/preflight.test.mjs` cover 1-4 against temporary profiles under a temporary `AI_SDLC_HOME`.

### Skill text (`skills/ai-sdlc-setup/SKILL.md`)

6. The description adds "change AI SDLC setup" to the phrases that start the skill.
7. 1. Detect: the paragraph that runs `check` keeps asking every unanswered question first; when nothing is unanswered, or after those, setup runs `node <this skill>/scripts/preflight.mjs answers <repository>`, shows the table by section, and asks which to change (question numbers, a section, or all; nothing ends setup with the report). On "redo AI SDLC setup", every question is asked.
8. 2. Interview: when the profile already holds an answer (a change or a redo), the recommendation is the current answer, and the question names the stock recommendation when it differs.
9. A new section "Change an answer" says:
   - each changed answer is asked with its question's wording and choices, and verified as in 4. Verify for what changed;
   - before writing, setup keeps a copy of the current `profile.json`; when the check reports a new problem or a changed gate fails on the default branch, setup shows the output and asks: correct the new answer, keep the old one (restore the copy), or for a gate save `null`;
   - a dependents table: Gates -> Missing tools for that gate's tool and the default-branch run; Mutation testing -> the Stryker install question; Work tracker changed to `none` -> nothing is asked; every sub-answer is removed. Changed to `github` or `linear` -> checklist and target branch are re-asked. Changed to `azure-devops` -> checklist, target branch, organization and project are asked, and the effort field, unestimated value, closed task states and handoff task are offered, as on a first answer. In every case setup removes the sub-answers the new tracker does not use, as the check's warnings name them, and tells the owner what it removed; Cross-model sharing turned off on the machine -> each repository's Sharing limit becomes moot and is left as saved; turned on -> this repository's Sharing limit is asked; Models -> `phaseTiers` only if the owner wants a phase moved; Required pipelines -> each new pipeline's `triggersOnlyOnDefaultBranch`; Missing components -> `declinedComponents`;
   - only dependents the change makes stale are re-asked, each recommending its current answer;
   - setup writes only the changed fields and their dependents; every other answer stays as saved.
10. 5. Hand off: names the answers changed and any removed, says in one sentence that open stories pick up the change at their next worker turn or check, and replaces "edit the profile file directly or say 'redo AI SDLC setup'" with: run setup again ("change AI SDLC setup") to change any answer, or "redo AI SDLC setup" for the whole interview.
11. Later changes: adds that a stale tracker sub-answer warning is answered by offering to remove the field it names.
12. Machine question 10's wording that `model-choice.test.mjs:236` asserts is unchanged. No person is named; the text stays harness-neutral.

### Other files

13. `README.md:84` reads: "The first run asks the `ai-sdlc-setup` questions once and saves the profile; later runs ask any answer the profile lacks, then show the saved answers so the owner can change any of them."
14. `node --test` passes; the comment ratchet does not rise; nothing under `command-center/` or `mission-console/` changes.

## Test level

Unit (`node --test skills/ai-sdlc-setup/scripts/`) for the script. The skill text is checked by reading it against criteria 6-12; the existing wording test stays green.

## Before and after

Command output. Before reference: origin/main cb0ffc5, captured right after approval. With `AI_SDLC_HOME` pointed at a temporary folder holding a copy of a complete profile (tracker `none` with a leftover `checklist` added):

- Before: `preflight.mjs check` reports `unanswered: []` and no warning; `preflight.mjs answers` is refused with the usage line.
- After: `answers` prints the current-answers table; `check` warns about the leftover `checklist`; a change of one answer (for example `reviewRoundLimit` 3 -> 2) shown as a profile diff, and the check passing after it.

## Out of scope

- A numbered lifecycle phase for setup; any Jarvis or console involvement in setup.
- `command-center/`, `mission-console/` (LAUNCH-1 and PRURL-1 run there).
- A setup e2e scenario; schema changes; adapter questions (`adapters.*`).

## Run decisions (from the profile)

Gates `node --test` and `gitleaks git --no-banner --log-opts={base}..HEAD`; pipeline Tests; no review bot; cross-model review authorized; implementation level full; review round limit 3; spec under `docs/specs`; team rule: reply to every pull request comment before resolving it. No architecture diagram.

## Plan critique

One reviewer from a second provider (Grok 4.5 through Cursor); Codex was unavailable (usage limit until Nov 30). Its five findings were checked against the code and all accepted: tracker `none` asks nothing and removes every sub-answer; a change to `azure-devops` offers closed task states and the handoff task as a first answer does; rows whose omission is an answer are never `answered: false`; turning machine sharing on asks this repository's Sharing limit; `nextSteps` separates stale-field warnings from component warnings.
