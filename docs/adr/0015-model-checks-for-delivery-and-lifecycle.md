# 0015. Exhaustive model checks guard decision delivery and the story lifecycle

Status: Accepted
Date: 2026-11-23

## Context
Two parts of the factory failed in ways ordinary tests missed. Decision delivery is concurrent: a batch timer, `deliver` calls from Jarvis, worker acknowledgements, turn ends and a daemon restart can interleave at every `await`. The story store's lifecycle has many reachable states: a story blocked on a review that never came could not record the merge GitHub had already reported (3c60828), and the ai-sdlc skill had the owner send a comparison back to build, which the store refused (d989158).

## Decision
- `command-center/delivery-model.mjs` models one story's session and two decisions. Each step is code that runs without an `await` in between, so the model interleaves exactly where the real code can. `check` searches breadth-first, so each trace it returns is a shortest one, and returns the first violated invariant, a state where a call of `hand` can never finish (`stuck`), or the number of states. `current` names the behaviours that differ between versions of the code, so the tests can replay past versions and show they failed. The step-to-code table and the tests that pin each behaviour are in `.agents/skills/verify-decision-delivery/SKILL.md`.
- `mission-console/lifecycle-model.mjs` drives the real `openStore` through every event from every story state it can reach, so there is no hand-written copy of the transitions to drift. States are reduced to the fields some guard in `store.mjs` reads (`guarded`); every other field never changes which event is accepted, and `lifecycle-model.test.mjs` fails when `store.mjs` reads a field listed in neither `guarded` nor `unguarded`. The store and the explorer share an in-memory SQLite database, each with its own connection, so nothing waits on a disk. How to read its failures is in `.agents/skills/verify-story-lifecycle/SKILL.md`.
- Both run under `node --test`, so CI runs them on every pull request.

## Consequences
- A change to the code a step stands for has to change the model in the same pull request; the skills say how.
- The bounds (one story, two decisions, one restart) are small; larger ones have not been run.

## Where
- `command-center/delivery-model.mjs`, `command-center/delivery-model.test.mjs`
- `mission-console/lifecycle-model.mjs`, `mission-console/lifecycle-model.test.mjs`
- Regression tests named after the failures they caught in `adapters/harnesses.test.mjs`, `command-center/console-service.test.mjs`, `command-center/supervisor.test.mjs` and `mission-console/roles.test.mjs`
