# 0008. Skills are linked where a harness allows, copied where it does not, and nothing is deleted

Status: Accepted
Date: 2026-11-23

## Context
`install.mjs` puts this repository's skills into every agent harness on the machine. The owner may already have skills of the same names, from another repository or customised by hand, and those must never be lost. Some harnesses read skills in place; the Copilot app needs its own copies and runs the Command Center from an extension folder.

## Decision
- For a harness that reads skills in place, each skill is its own link, so skills from other repositories can sit beside them. Each result is `{ harness, skill, path, state }`, where `state` is `created`, `linked`, `blocked` (something else has that name, described in `existing`, so this repository's skill is not in use) or `folder-is-link` (the whole skills folder points elsewhere). With `--replace`, what blocks a skill is moved to a `.bak-<time>` folder beside it and the skill is linked: `replaced`.
- For a harness that needs copies, each skill is `copied`, replacing the previous copy, which is moved aside to `.bak-<time>`. A skill in `keptCopies` (`diagram-design`) is `kept` when it is already there, because a copy harness keeps its own customised version of it.
- The extension folder is assembled from `command-center`, `mission-console`, `readiness-sync` and `adapters/harnesses.mjs`, so the harness runs the Command Center without this checkout. The Copilot extension loads the Command Center from beside itself when installed, and from two folders up in the checkout.
- `replace` always moves what is there aside before copying; nothing is deleted.
- A skill the harness will not actually use (`blocked`, `folder-is-link`, or `missing` under `--check`) is reported as a failure, not a success. `--check` changes nothing and reports anything not yet there as `missing`.

## Consequences
- Old `.bak-<time>` folders accumulate; the owner removes them by hand.
- A skill that needs copies sees changes only after `install.mjs` runs again.

## Where
- `install.mjs` — `keptCopies`, `extensionParts`, `replace`, `install`, the summary in the CLI block
- `adapters/copilot/extension.mjs` — the import of `console-service.mjs`
