# 0001. Code carries no comments; the reasons behind it live in ADRs

Status: Accepted
Date: 2026-11-23

## Context
Comments in this repository had drifted into four kinds: ones that restated the code, ones that excused a shortcut, ones that described code that had since changed, and ones that recorded a real decision. Only the last kind was worth keeping, and it was scattered across files where it was easy to miss and easy to leave behind when the code moved. An excuse in a comment also made a shortcut look settled, so the next change copied it.

## Decision
First-party source files carry no comments. A reason the code cannot show goes into an ADR in `docs/adr/`. A shortcut gets a GitHub issue labelled `excuse-comment`. Anything else is said with a better name, a test title or an assertion message, or deleted.

`comment-ratchet.mjs` enforces this. `comment-ratchet.json` lists, per file, how many comments are still allowed; `comment-ratchet.test.mjs` fails `node --test` when a file has more comments than its count, or fewer without the count being lowered. Counts only go down (`node comment-ratchet.mjs --update`). Tool directives such as `eslint-disable` and shebangs are not counted. The third-party skills listed under `exclude` are kept identical to their vetted upstream revisions and are not scanned.

The `/delete-comment` skill (`.claude/skills/delete-comment/SKILL.md`) is how to sweep the comments that remain.

## Consequences
- A reader looking for why the code is the way it is checks `docs/adr/` instead of the file. The `Where` section of each ADR names the code it applies to.
- A new comment fails CI on every platform, so the reason has to be written somewhere it will be found again.
- One comment is still allowed: a safety note in `skills/ai-sdlc-setup/scripts/preflight.test.mjs` about removing a link before the workspace that holds it. It stays until it can be encoded in a helper.
- Revisit if the ratchet starts pushing reasons out of the repository altogether rather than into ADRs.

## Where
- `comment-ratchet.mjs`, `comment-ratchet.test.mjs`, `comment-ratchet.json`
- `.claude/skills/delete-comment/SKILL.md`
