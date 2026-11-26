# DIAG-1 plan: `diagram-start` must not skip the review verdict or the comparison

Work item: issue #51. Context pack: `context-pack.md` on the story (reproduction, root cause, files, rules, risks).

## Bug

Reproduced on 88b9cce. `diagram-start` (`mission-console/store.mjs:327-331`) is accepted in `review` and `comparison` and returns to `publishing`, so a story reaches the pull request without a review handoff, a comparison choice or the owner's acceptance of the comparison.

## Decisions (owner)

Refuse `diagram-start` in review and comparison. Add a lifecycle-model property. No before-and-after. No architecture diagram.

## Fix

1. `store.mjs` `diagram-start`: accept only in `publishing`, `ci` and `merge`. Set `diagram.returnPhase` to the phase it started from, dropping the review and comparison special case. The refusal message is "Start diagram work from publishing, CI or merge, after the review and the comparison." (409). The diagram handoff guard stays as is, so a live story already in `diagram` with return phase `publishing` still finishes.
2. No phase, transition, `roles.mjs` or wake changes.

## Acceptance criteria

1. `diagram-start` in review or comparison is refused with 409 and the story stays in that phase.
2. `diagram-start` from publishing, ci or merge, then the diagram `handoff`, returns to that same phase.
3. A story reaches publishing from review only through the review handoff and `comparison-choice` (plus the comparison handoff when one runs). This follows from criteria 1 and 4 and needs no separate test.
4. A new lifecycle-model property in `mission-console/lifecycle-model.test.mjs`, over every reachable state: every accepted `diagram-start` starts in publishing, ci or merge and stores that phase as its return phase; every accepted `handoff` out of diagram lands on the phase `diagram-start` came from; `diagram-start` is refused in every reachable review and comparison state. It fails on 88b9cce and passes with the fix; no existing property is weakened.
5. Docs: the `diagram-start` row (line 140) and the phase-order sentence (line 180) of `mission-console/README.md` state the new rule. Row 7 of the Jarvis table in `skills/jarvis/SKILL.md` says "from publishing" before the PR opens. `verify-story-lifecycle` `SKILL.md` gains a row for the new property ("Past bug it catches": DIAG-1 #51) and its coverage commit moves forward after rechecking `guarded`, `eventInputs` and the properties.
6. `node --test` (includes the lifecycle model), `node e2e/run.mjs` and gitleaks pass.

## Tests (written first, unit level)

- `mission-console/store.test.mjs`: replace "Rocket can run straight after review and return to publishing" with a test that `diagram-start` is refused in review and in comparison, plus a publishing round trip. Update the `/after review/` assertion in "Rocket diagram work returns to its original PR phase" to the new message.
- `mission-console/lifecycle-model.test.mjs`: the property in criterion 4.

## Out of scope

Phases, `roles.mjs` lanes, e2e scenarios (none records `diagram-start`), the queued store.mjs issues (#52, #57, #62, #63, #59, #64) and the old PRR-1 spec text. No ADR: the code and README state the rule.

PR closes #51.
