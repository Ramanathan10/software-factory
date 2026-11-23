# 0007. One phase table drives the dashboards' lanes and each phase's model tier

Status: Accepted
Date: 2026-11-23

## Context
A story moves through phases. Both dashboards need a lane for every phase, and each phase's work needs a more or less capable model. Lists kept in several places drifted: the Mission Console once had no step for `diagram`, so a story in it fell off the track (70e432b). Model names change often and differ by harness.

## Decision
- `phases` in `mission-console/roles.mjs` gives each phase `[role, label, board column, track step]`. Both dashboards build their lanes from it with `lanes(phases, at)`, where `at` is 2 for the Command Center board's columns and 3 for the Mission Console track's steps, so a new phase always has a lane. `roles.test.mjs` fails when an entry is incomplete.
- `phaseTiers` names how capable a model each phase needs (`deep`, `standard`, `fast`) without naming a model. A worker turn runs at the tier of the phase it starts in, and a subagent a worker hands a phase to runs at that phase's tier. `scout` is `deep` because the turn it starts runs on into planning. A phase left out belongs to the owner or the daemon and needs no model.
- The owner's profile names the model for each tier, per harness id (`models`), and may move a phase to another tier (`phaseTiers`). What a worker may do comes from the profile too: the `workerPermissions` choice, and for a restricted worker `git`, `gh`, `node` and the first word of each repository's gate commands.
- `modelFor` leaves the choice to the harness when no phase is given, the phase has no tier, or the profile names no model for that tier. `modelPlan` gives the dashboard each phase's tier and, per lower-case recorded harness name, the model for each tier.
- The Mission Console shows a plan from plan approval on.

## Consequences
- `preflight.mjs` keeps its own copy of `phaseTiers` because skill scripts stand alone (ADR 0009); a test keeps the two equal.

## Where
- `mission-console/roles.mjs` — `phases`, `lanes`, `tiers`, `phaseTiers`
- `adapters/harnesses.mjs` — `workerSettings`, `modelFor`, `modelPlan`
- `skills/ai-sdlc-setup/scripts/preflight.mjs` — `phaseTiers`
- `mission-console/console.mjs` — `planPhases`
