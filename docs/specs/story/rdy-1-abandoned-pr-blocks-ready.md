RDY-1 plan: one abandoned pull request keeps a story from ever being ready (issue #58)

Problem: readiness-sync/engine.mjs judges abandoned PRs as unmerged work. A story with one abandoned PR and one PR completed into main shows prMergedToTarget unmet, and the owner is never asked for effort or handoff. Reproduced on 88b9cce (repro.mjs, repro-before.txt).

Fix, in readiness-sync/engine.mjs only:
1. checklist: judge prMergedToTarget (line 25) and prLinked (line 26) on the PRs whose status is not 'abandoned'. When that set is empty, both checks stay unmet unless noPrConfirmed is true.
2. evaluate: the merged gate for the effort and handoff questions (line 45) uses the same non-abandoned set.
3. docs/adr/0013: reword "Once every one is merged" to say abandoned pull requests are ignored, so the questions come once every PR that is not abandoned is merged. No new ADR. No source comments.

Acceptance criteria (each a unit test):
1. Abandoned + completed into main: prMergedToTarget met; the owner gets doneDone, or effort when effort is unset.
2. Abandoned only: prMergedToTarget unmet; no question.
3. Abandoned only with noPrConfirmed: prMergedToTarget and prLinked met.
4. Active + completed into main: unchanged; prMergedToTarget unmet; no question.
5. Abandoned + completed into another branch: prMergedToTarget unmet.
6. Abandoned PR with linked: false + completed, linked PR into main: prLinked met.
7. Abandoned only: prLinked unmet.
8. Existing engine tests pass unchanged.

Test level: unit, in readiness-sync/engine.test.mjs. Criteria 1, 2 (no question), 5, 6 fail before the fix; 2 (checklist), 3, 4, 7, 8 guard behaviour that must not change.

Gates: node --test (includes the comment ratchet and private-details checks), gitleaks. Not triggered: e2e scenarios, lifecycle model, delivery model (store.mjs, roles.mjs, harnesses.mjs and the Jarvis phase table are untouched).

Evidence: no before-and-after capture; rerun repro.mjs after the fix and attach its text output (owner, rdy1-before-after). No architecture diagram (owner, rdy1-diagram).

Owner decisions: prLinked ignores abandoned PRs too (rdy1-prlinked); no capture beyond the repro rerun; no diagram.

Out of scope: making the question gate check the target branch; tracker readers in trackers.mjs (AZ-1 works there); issue #28.

## Context pack

### RDY-1 context pack

Story: One abandoned pull request keeps a story from ever being ready (GitHub issue #58).
Branch `story/rdy-1-abandoned-pr-blocks-ready`, cut from origin/main 88b9cce. Node 24.18.0.

### Reproduction (unchanged code, 88b9cce)

Script: `~/.ai-sdlc/stories/RDY-1/repro.mjs`, output in `repro-before.txt` beside it. It runs `evaluate` from `readiness-sync/engine.mjs` on the test suite's base snapshot (owner assigned, effort 3, tasks closed, tests passing) with only `prs` varied, full checklist, handoff to "Your Manager".

| prs | unmet | questions |
|---|---|---|
| completed into main | userConfirm | doneDone |
| abandoned + completed into main | prMergedToTarget, userConfirm | none (bug) |
| abandoned only | prMergedToTarget, userConfirm | none |
| abandoned + completed into dev | prMergedToTarget, userConfirm | none |
| active + completed into main | prMergedToTarget, userConfirm | none |

Bug confirmed: one abandoned PR beside a merged one leaves `prMergedToTarget` unmet and suppresses the owner's question forever.

### Root cause

`readiness-sync/engine.mjs`:
- Line 25, `prMergedToTarget`: `prs.every(pr => pr.status === 'completed' && pr.target === target)`. An abandoned PR fails `every`.
- Line 45, `merged` (gates the effort and doneDone questions): `snapshot.prs.every(pr => pr.status === 'completed')`. Same failure, so no question is asked.
- Line 26, `prLinked`: `prs.every(pr => pr.linked)` also counts abandoned PRs (no current reader sets `linked: false`, so it has no live effect today).

Where abandoned PRs come from (`readiness-sync/trackers.mjs`): Azure DevOps keeps `pr.status` as-is (`active | completed | abandoned`, line 46); GitHub maps `CLOSED` to `abandoned` (line 65); Linear snapshots are built by the agent per `supply` (line 76).

### Files and entry points

- `readiness-sync/engine.mjs`: pure rule engine, `evaluate(snapshot, settings)`. Imports nothing (a test enforces this).
- `readiness-sync/engine.test.mjs`: unit tests; `base()` snapshot and `unmet()` helper. Lowest useful level for this fix: unit.
- `readiness-sync/trackers.mjs`, `readiness-sync/check-story.mjs`: readers and CLI; unchanged by this fix.
- `docs/adr/0013-readiness-checks-only-read.md`: defines the snapshot shape and says "Once every one is merged, the owner is asked". Its wording needs to say abandoned PRs are ignored.
- `skills/jarvis/RUNBOOK.md` "Readiness check": describes the CLI; no change needed.

### Rules that apply (AGENTS.md)

- `node --test` before committing; no package dependencies.
- No source comments (`comment-ratchet.mjs`); reasons go in an ADR. Next ADR number is decided at publish (currently 0023 would be next); none expected for this fix.
- Keep the repo free of owner names and work details; `private-details.test.mjs` enforces it.
- Lifecycle model and delivery model checks: not triggered (no change to store, roles, Jarvis table, or decision delivery). e2e: not triggered (no change to worker start, decision delivery, or Jarvis wake).

### Commands

- Focused: `node --test readiness-sync/engine.test.mjs`
- Full: `node --test`
- Secrets gate: `gitleaks git --no-banner --log-opts=origin/main..HEAD`

### Related

- Issue #28 (real Azure DevOps and Linear reads) is the broader tracker story; this fix stays in the engine.
- Parallel stories: AZ-1 (#15) touches the Azure reader in `trackers.mjs`; stay out of that file.

### Risks

- Line 45 ignores the target branch; changing that is outside this bug and would alter when the effort question is asked.
- An "abandoned only" story must stay unmet: it has no merged work.
