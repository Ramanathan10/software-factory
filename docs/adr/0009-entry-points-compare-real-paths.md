# 0009. Entry points compare real paths, and skill scripts stand alone

Status: Accepted
Date: 2026-11-23

## Context
Skills are installed as links (ADR 0008). Node names the main module by its real path while `process.argv[1]` keeps the linked one, so the usual `process.argv[1] === fileURLToPath(import.meta.url)` check is false through a link, and the CLI exits 0 having done nothing. `preflight.mjs` did exactly that (95db86b). A skill can also be copied into a harness on its own, without the rest of the checkout.

## Decision
- Every CLI decides whether it is the main module with `isMain(import.meta.url)` from `mission-console/is-main.mjs`, which compares `realpathSync` of both sides.
- A skill script that is copied on its own cannot import from outside its skill, so it compares real paths itself. `preflight.mjs` also keeps its own copy of `phaseTiers`, kept equal to `roles.mjs` by a test, and finds the Command Center from its own real location: the checkout when the skills are linked from it, or the `extensions/ai-sdlc-console` folder beside the skills when a harness was given copies. The files Jarvis runs are named by where each sits inside that folder. Its CLI loads the harness rows from that folder at run time, and only when a harness is named.
- `cli-entry.test.mjs` finds every module with an entry-point check and runs it through a linked checkout with an argument it rejects; each must print its usage and fail.

## Consequences
- A new CLI is covered without being listed, and must reject an unknown argument with a `Usage: node ...` message.
- `comment-ratchet.mjs` follows the same rule.

## Where
- `mission-console/is-main.mjs`
- `skills/ai-sdlc-setup/scripts/preflight.mjs` — `phaseTiers`, `commandCenterFiles`, `findCommandCenter`, the entry-point check
- `cli-entry.test.mjs`
