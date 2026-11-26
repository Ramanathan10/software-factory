---
name: verify-story-lifecycle
description: Check a change to the story store's lifecycle against every story state the store can reach. Use when a change touches mission-console/store.mjs, the phases in mission-console/roles.mjs, or the phase table in skills/jarvis/SKILL.md, or when an event is refused in a phase where the ai-sdlc skill says to record it.
---

# Verify the story lifecycle

`mission-console/lifecycle-model.mjs` drives the real `openStore` from `store.mjs` through every event, from every story state it can reach, against a shared in-memory SQLite database. It has no hand-written copy of the transitions, so it cannot drift from the store. `mission-console/lifecycle-model.test.mjs` checks these properties over the result:

| Property | Harm when it breaks | Past bug it catches |
|---|---|---|
| Every field a guard in `store.mjs` reads is modeled | The model silently stops seeing a guard | |
| Every reachable phase is in `roles.mjs`, and every phase there is reachable | A story moves to a phase the dashboard cannot show, or a phase is dead | |
| A story not being cleaned up can always still reach `closed` | A story is stuck with no event that moves it | |
| From `ci`, `merge`, `retro` or `pr-review` with a registered PR, `merged` (after `release-worker` if a worker is assigned) closes the story | GitHub merged the PR and the story stays open | 3c60828: a stale `blocked` refused `merged` |
| A worker exists only in a worker phase, and no event changes the phase under it | A worker keeps running on a phase that is no longer its own | |
| A story awaiting cleanup never changes phase | Cleanup races with work on the same story | |
| Every event the Jarvis phase table names is accepted in or into that row's phases | Jarvis is told to record an event the store refuses | d989158: the owner's change request on the comparison had no `return-to-build` |
| `diagram-start` is accepted only in publishing, ci or merge and returns there; it is refused in review and comparison | A story reaches the pull request without a review verdict or the owner's acceptance of the comparison | DIAG-1 #51: `diagram-start` in review or comparison returned to publishing |
| `pr-ready` with a head reaches merge only when the story has an observation of that head with status passed and a clear review; with no head, only when there is no observation | A story shows ready to merge while checks failed, are running or are missing, or after Hawkeye has observed the PR | CHK-1 #52: `pr-ready` was accepted on a failed observation |

## Run it

```
node --test mission-console/lifecycle-model.test.mjs
```

It takes about 12 seconds and explores about 17,600 states and 95,000 accepted events. `node --test` runs it with everything else, so CI runs it on every pull request.

## Read a failure

Each failure lists stories as the shortest event sequence that reaches the bad state, for example `handoff → plan → approve → … → pr-opened → blocked`, followed by what went wrong there. Replay that sequence by hand in a test with the `writer` helper in `mission-console/store.test.mjs` to see the store's own error message.

A failure is a real bug unless one of these explains it:

- **The abstraction dropped something.** `abstract` in `lifecycle-model.mjs` keeps only the fields listed in `guarded`. If a guard in your change reads a new field, or reads more of an existing one, such as a question's `options`, add it to `abstract` and `concrete`. The first test fails when `store.mjs` reads a `story.<field>` listed in neither `guarded` nor `unguarded`. Put a field in `unguarded` only when no `requireThat` or branch reads it.
- **The inputs miss a case.** `eventInputs` sends one or a few fixed inputs per event type. A new event type, or a guard that depends on an input value no listed input has, needs a new entry.
- **The table names a non-event.** `jarvisTable` reads backticked names in the "Events to record" column. Evidence kinds and fields such as `pipeline` are skipped by name in the test. Add a new one there, not to the store.

Never weaken a property to make a change pass. If the change is meant to alter the lifecycle, change the property in the same pull request and say why in its description.

## What it does not cover

- One story at a time. Concurrency between processes recording on the same story is not modeled here; the store serializes each `record` in one `BEGIN IMMEDIATE` transaction and rejects a stale `revision`.
- One question ID, two PR heads, all six observation statuses (`failed`, `passed`, `running`, `no-checks`, `merged`, `closed`), and a `passed` observation with a blocking and with a clear review. Review keys, `prSeen` and `prPosted` are not modeled; `store.test.mjs` covers the review wake. Answers are by option index only.
- `artifact` with one valid evidence file. File validation is covered by `store.test.mjs`.
- The dashboards' lane lists in `command-center/ui/app.js` and `mission-console/console.mjs`.
- Events after `complete-cleanup`: a deleted story refuses everything.

## Coverage record

- `mission-console/store.mjs`: `apply`, `observePr`, and `record` in `openStore`
- `mission-console/roles.mjs`: `phases`
- `skills/jarvis/SKILL.md`: the table under "5. Check handoffs and keep the console current"

Last confirmed to describe these files at commit `7ae3025`. When any of them changes, rerun the model. Move this commit forward only after you have checked that `guarded`, `eventInputs` and the properties still describe the code at the new commit.
