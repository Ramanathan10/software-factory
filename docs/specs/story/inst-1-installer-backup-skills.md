# INST-1: Re-running the installer leaves backup skills where the harness loads them

Work item: https://github.com/Ramanathan10/software-factory/issues/61
Branch `story/inst-1-installer-backup-skills`, worktree `C:/repos/software-factory-worktrees/story/inst-1-installer-backup-skills`, base origin/main `88b9cce`.
Spec location after approval: `docs/specs/story/inst-1-installer-backup-skills.md`, the branch's first commit.

## Context pack

See `context-pack.md` beside this file (registered on the story). In short:

- Entry points: `install.mjs` (`replace`, `install`, CLI summary in `main`), `adapters/harnesses.mjs` rows (`skills`, `extension`, `install`), `install.test.mjs` with the temp-home `fixture`.
- Rules: SECURITY.md:13 keeps the installer inside each harness's own folders and forbids deleting; AGENTS.md (no comments, no dependencies, `node --test` before committing, harness detail in `adapters/harnesses.mjs`, ADRs amended in place); no personal details in the repo.
- Gates: `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. The Tests pipeline also runs `node e2e/run.mjs`.
- Manual checks only with `HOME`/`USERPROFILE` pointed at a temporary folder, never the real `~/.claude`, `~/.cursor`, `~/.agents` or `~/.copilot`.

## Bug

Reproduced on 88b9cce, Windows 11, Node 24.18.0, in a temp home (`reproduction.txt`):

1. A plain Copilot run moves the owner's own `grill-me` to `~/.copilot/skills/grill-me.bak-<time>` and prints only "13 copied".
2. A second run with nothing changed leaves 12 `*.bak-*` folders in `~/.copilot/skills`, each with `SKILL.md`, and `ai-sdlc-console.bak-<time>` with `extension.mjs` in `~/.copilot/extensions`.
3. `--replace claude-code` over an owner's `jarvis` leaves `~/.claude/skills/jarvis.bak-<time>` with `SKILL.md` and prints the literal `.bak-<time>`.

Root cause: `install.mjs:17-21` `replace()` renames the target whenever it exists, without comparing it to the source, to a sibling inside the scanned folder. Line 35 does this for the extension folder, line 66 for link `--replace`. Line 45 always reports `copied`. Lines 105 and 113 print `.bak-<time>` literally.

Inferred, not observed: harnesses load the backups as duplicate skills.

## Settled decisions

| Id | Decision |
|---|---|
| backup-home | Everything moved aside goes to `<harness folder>/ai-sdlc-backups/<time>/<skills\|extensions>/<name>`, where `<harness folder>` is the parent of `harness.skills` (and of `extensions` for the Copilot extension): `~/.copilot`, `~/.claude`, `~/.cursor`, and `~/.agents` for Codex. One `<time>` per run. The folder is created only when something moves. Nothing is deleted. |
| skip-equal | A copy-harness skill or extension whose installed folder equals the source, byte for byte, in both directions (an extra file in the installed copy is a difference), is left untouched and reported `current`. The extension's source is `adapters/copilot/extension.mjs` plus every `extensionParts` entry. `--check` also reports `current`. |
| copy-differs | A differing Copilot copy (owner's own or an older installer copy; they are indistinguishable) is moved to the backup folder and the new one copied. Backups still accumulate in `ai-sdlc-backups` after updates, outside any scanned folder. |
| report | Each result that moved something carries `movedTo`, the real absolute backup path. A differing copy is `updated`; a first copy where nothing was there stays `copied`. One output line per move names the real path. The `--replace` line prints the real path; the hint at install.mjs:113 says blocking skills move to the harness's `ai-sdlc-backups` folder and nothing is deleted. |
| old-backups | On a write run, each folder in a scanned folder whose name is exactly a shipped skill name, or `ai-sdlc-console` in the extensions folder, followed by `.bak-` and digits only, is moved (keeping its name) into `ai-sdlc-backups/<time>/<skills\|extensions>/` and named in the output. Anything else (`my-skill.bak-1`, `grill-me.bak-old`) is left alone. `--check` moves nothing and reports how many a write run would move. |
| check-differs | Under `--check`, an existing Copilot copy that differs is `outdated`, not a failure (exit 0). |
| backup-link | If a harness's `ai-sdlc-backups` folder, or the run's `<time>` folder under it, is a link or junction, nothing is moved for that harness and nothing that would need a move is installed; the CLI prints a failure line naming the link and exits 1, like `folder-is-link`. Items that need no move (`current`, a first `copied`) still proceed. Proposed row: `{ harness, path: <the link>, state: 'backup-is-link' }`. |
| backup-collision | Before the first move, the run picks the first free folder among `<time>`, `<time>-2`, `<time>-3` ... per harness and uses it for every move in that run; nothing already there is touched. `movedTo` names the folder actually used. |
| docs | ADR 0008 amended in place; README.md lines 81-82; AGENTS.md line 12; the hint at install.mjs:113. |
| before-after | None. |
| diagram | None. |

Proposed details for the plan review (comment on the plan to change them):

- Old-backup moves are result rows `{ harness, skill: '<old folder name>', path, state: 'moved', movedTo }`, counted as "N moved" in the summary. Under `--check` they are `old-backup` rows, counted as "N old backups" with a line saying a plain run moves them; exit code unchanged.
- The summary state order becomes `created, linked, replaced, copied, updated, current, moved, installed, outdated, missing, blocked, kept, old-backup, backup-is-link`.

## Acceptance criteria

1. A second Copilot install with nothing changed reports every skill and the extension `current`, creates no folder anywhere under the home, and leaves no `*.bak-*` entry in `~/.copilot/skills` or `~/.copilot/extensions`.
2. A plain Copilot install over an owner's own `grill-me` reports it `updated` with `movedTo` = `<home>/.copilot/ai-sdlc-backups/<time>/skills/grill-me`, which holds the owner's `SKILL.md`; the CLI prints that real path.
3. An installed copy with an extra file the source lacks is `updated`, and the extra file survives in the backup, not in the new copy.
4. A change to any `extensionParts` file, or to `extension.mjs`, makes the extension `updated`; its backup is `<home>/.copilot/ai-sdlc-backups/<time>/extensions/ai-sdlc-console`.
5. `--replace` on a link harness moves the blocking `jarvis` to `<home>/.claude/ai-sdlc-backups/<time>/skills/jarvis`, links this repository's skill, reports `movedTo`, and the CLI line names the real path. For Codex the backup is under `<home>/.agents/ai-sdlc-backups/`.
6. A write run moves `jarvis.bak-123` from a scanned skills folder and `ai-sdlc-console.bak-123` from `~/.copilot/extensions` into the run's backup folder and names each; `my-skill.bak-1`, `jarvis.bak-old` and `jarvis.bak-` are left in place.
7. `--check` changes nothing: it reports equal copies `current`, differing ones `outdated` (exit 0), and counts old backups without moving them.
8. `diagram-design` already present on Copilot is still `kept`.
9. With `<home>/.copilot/ai-sdlc-backups` a junction to a folder outside the home, a plain run over a differing `jarvis` writes nothing through the junction, leaves the old `jarvis` in place, reports the link and exits 1; an equal skill in the same run is still `current`.
10. With `<home>/.copilot/ai-sdlc-backups/7/skills/jarvis` already present and `stamp: 7`, a run over a differing `jarvis` moves it to `<home>/.copilot/ai-sdlc-backups/7-2/skills/jarvis`, leaves the existing `7` folder untouched, and reports that path in `movedTo`.
11. No `.bak-<time>` text remains in install.mjs output, README, AGENTS.md or ADR 0008 except where describing the old-backup cleanup.

## Test level

Unit, in `install.test.mjs`, with the existing `fixture`. The assertions at lines 62-72, 89 and 117-125 encode the old contract and are rewritten. No e2e scenario and no lifecycle or delivery model check: workers, decisions, Jarvis wakes, the store and roles are untouched.

## Plan critique

Codex (gpt-6-sol), read-only, given the requirements, constraints and draft plan. Two findings, both confirmed against `install.mjs` and settled by the owner as backup-link and backup-collision. A single extra provider ran; no further panel.

## Out of scope

- A manifest or hashes that would tell an owner-edited copy from the installer's own (copy-differs chose A).
- Deleting or pruning anything in `ai-sdlc-backups`; the owner removes those by hand.
- Any change to link-harness behaviour other than where `--replace` puts what it moves.
