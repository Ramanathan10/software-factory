# 0008. Skills are linked where a harness allows, copied where it does not, and nothing is deleted

Status: Accepted
Date: 2026-11-23

## Context
`install.mjs` puts this repository's skills into every agent harness on the machine. The owner may already have skills of the same names, from another repository or customised by hand, and those must never be lost. Some harnesses read skills in place; the Copilot app needs its own copies and runs the Command Center from an extension folder.

## Decision
- For a harness that reads skills in place, each skill is its own link, so skills from other repositories can sit beside them. Each result is `{ harness, skill, path, state }`, where `state` is `created`, `linked`, `blocked` (something else has that name, described in `existing`, so this repository's skill is not in use) or `folder-is-link` (the whole skills folder points elsewhere). With `--replace`, what blocks a skill is moved into the harness's backup folder and the skill is linked: `replaced`, with `movedTo` naming the new path.
- For a harness that needs copies, a skill or extension whose installed folder equals the source byte for byte, in both directions, is left alone and is `current`. A first install is `copied`. A different copy, the owner's own or an older installer copy (they cannot be told apart), is moved into the backup folder and replaced: `updated`, with `movedTo`. Under `--check` a different copy is `outdated`, which is not a failure. A skill in `keptCopies` (`diagram-design`) is `kept` when it is already there, because a copy harness keeps its own customised version of it.
- The extension folder is assembled from `command-center`, `mission-console`, `readiness-sync` and `adapters/harnesses.mjs`, so the harness runs the Command Center without this checkout. The Copilot extension loads the Command Center from beside itself when installed, and from two folders up in the checkout.
- Everything moved aside goes to `ai-sdlc-backups/<time>/<skills|extensions>/<name>` beside the harness's skills folder (`~/.agents` for Codex), outside every folder a harness scans, and one run shares one `<time>` folder, the first free of `<time>`, `<time>-2`, and so on. Nothing is deleted. If `ai-sdlc-backups` or the run's `<time>` folder is a link, nothing is moved for that harness, nothing that needs a move is installed, and the result is `backup-is-link`, a failure, and on a copy harness each item that needed a move shows as `not-moved` (`old-backup` for a stale `.bak-` folder). On a link harness the skill that blocks stays `blocked`. If `ai-sdlc-backups` is a regular file the result is `backup-is-file`, treated the same way.
- A write run also moves each `<shipped skill>.bak-<digits>` folder, and `ai-sdlc-console.bak-<digits>` in the extensions folder, that earlier versions left in a scanned folder, keeping its name. Other `.bak-` names are left alone. `--check` counts them as `old-backup` and moves none.
- A skill the harness will not actually use (`blocked`, `folder-is-link`, or `missing` under `--check`) is reported as a failure, not a success. `--check` changes nothing and reports anything not yet there as `missing`.

## Consequences
- Backups accumulate in `ai-sdlc-backups`, where nothing loads them; the owner removes them by hand.
- A skill that needs copies sees changes only after `install.mjs` runs again.

## Where
- `install.mjs` — `keptCopies`, `extensionParts`, `install`, the summary in the CLI block
- `adapters/copilot/extension.mjs` — the import of `console-service.mjs`
