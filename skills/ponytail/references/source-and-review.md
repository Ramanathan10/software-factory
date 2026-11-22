# Source and vetting review

## Identity

- Skill: ponytail (local implementation adaptation)
- Publisher: Dietrich Gebert
- Source: https://github.com/DietrichGebert/ponytail
- Version: 5.3.2
- Commit: `16352ac229eb08a9598dcae48fe9f2b342567d86` (2026-10-16, `chore: release v5.3.2`)
- License: MIT. The permission notice is in [LICENSE](../LICENSE).
- Reviewed files: `skills/ponytail/SKILL.md` at that commit (3,496 bytes, SHA-256 `9BADD22A32E19CB884E46DFA8D3AAE82BB81DFA5484105B8B4F0262DF823A509`), plus `AGENTS.md`, `commands/ponytail.toml`, `hooks/ponytail-instructions.js`, and `skills/ponytail-review/SKILL.md` to see what not to import. The hook and review files were not copied.

## Provenance

- Original package by DietrichGebert. Not a fork.
- The implementation skill folder contains only `SKILL.md`. Host plugins, hooks, the session band, benchmarks, and the review, audit, debt, and gain skills are separate.
- `hooks/ponytail-instructions.js` injects that same `SKILL.md`. It does not add implementation rules.

## Capabilities of the reviewed prompt

- Files read: the task and the code it touches.
- Files written: the target repository, and one small test when the new logic is non-trivial.
- Commands: local search such as grep over callers. No networked install.
- Credentials: none.
- External changes: none beyond the code change the user asked for.
- Background or update behavior: none in `SKILL.md`.

The static scanner reported one medium `telemetry-update` hit on upstream `SKILL.md`. The match is the word "upgrade" in the `shortcut:` comment format. The file has no telemetry.

The same scanner flags the local adaptation for "install", the attribution URL, and the words "upgrade" and "telemetry". Those are the MIT notice, the GitHub source link, the shortcut comment, and this review's statement that the prompt has no telemetry. None of them send data or install software.

The rest of the upstream repository includes host hooks and a Claude Code band that write under `~/.config/ponytail`. Those files were not imported, and this skill tells the agent not to install them.

## Adaptations

- Keep the ladder, the never-cut list, the shortcut comment, and the short closer.
- Use it for implementation. Planning stays with Grill Me. Review stays with `adversarial-code-review`.
- Drop always-on session mode, level persistence, and the instruction to install hooks.
- A later `main` commit is a different revision. Review it before replacing this adaptation.

## Risk and verdict

**Grade: Medium.** The prompt directs edits in the target repository. It does not need credentials, hooks, or network installs.

**APPROVE WITH CHANGES**, satisfied by this adaptation. Approval covers the local `skills/ponytail` files written from commit `16352ac229eb08a9598dcae48fe9f2b342567d86`. It does not cover the upstream hooks, band, or future commits.
