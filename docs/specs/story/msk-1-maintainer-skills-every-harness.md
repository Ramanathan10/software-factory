# MSK-1 plan: let every harness find the factory's maintainer skills

## Context
The three maintainer skills (delete-comment, verify-decision-delivery and verify-story-lifecycle) live only in `.claude/skills/`. Each harness reads different project skill folders:

| Harness | Project skill folders | Source |
|---|---|---|
| Claude Code | `.claude/skills` only | code.claude.com/docs/en/skills.md |
| Codex | `.agents/skills`, from the working directory up to the project root | learn.chatgpt.com/docs/build-skills; openai/codex@18c09f2 `codex-rs/ext/skills/src/host_roots.rs` |
| GitHub Copilot (app, CLI, cloud agent) | `.github/skills`, `.claude/skills` or `.agents/skills` | docs.github.com/en/copilot/concepts/agents/about-agent-skills |

Today only Codex misses the skills. No folder serves both Claude Code and Codex. Symlinks are out because this machine's git has `core.symlinks=false`. `install()` reads only `skills/`.

## Settled decisions (owner, console Q1-Q6)
1. Location: `.agents/skills/<name>/`. Codex, Copilot and Cursor discover the skills natively. Claude Code falls back to a list in AGENTS.md, which it reads when no CLAUDE.md exists. It loses `/delete-comment` as a slash command and automatic use of the skills by description.
2. Self-references: path-only edits to delete-comment line 33 and verify-decision-delivery line 104. Rerun the delivery model tests at the move commit, so line 104's "last confirmed" marker stays honest.
3. Past specs under `docs/specs/story/` stay as history.
4. Add one small guard test.
5. No before-and-after. Test output and the ADR's discovery table are the evidence.
6. No architecture diagram.

## Changes
1. `git mv .claude/skills/<name> .agents/skills/<name>` for each of the three skills, so git keeps their history. `.claude/` ends up empty and leaves the tree.
2. Two path-only edits inside the skills:
   - `.agents/skills/delete-comment/SKILL.md:33` names `.agents/skills/verify-decision-delivery/SKILL.md` and `.agents/skills/verify-story-lifecycle/SKILL.md`.
   - `.agents/skills/verify-decision-delivery/SKILL.md:104` runs `git log -1 --format=%h -- .agents/skills/verify-decision-delivery/SKILL.md`.
   - Nothing else in any skill changes. The frontmatter description of delete-comment keeps "/delete-comment".
3. `command-center/delivery-model.test.mjs:7` reads `../.agents/skills/verify-decision-delivery/SKILL.md`. Its assertions read only the skill's text, so none changes.
4. AGENTS.md:
   - Lines 23, 28 and 29 name `.agents/skills/...` instead of `.claude/skills/...`.
   - Line 33 ends "sweep the remaining comments with the delete-comment skill (`.agents/skills/delete-comment/SKILL.md`)" instead of "with `/delete-comment`".
   - A new short "Maintainer skills" section under "Changing the factory" lists the three skills, each with its path and when to use it. It says the skills live in `.agents/skills/`, where Codex and Copilot discover them, and that a harness that does not discover them, such as Claude Code, reads the named file when the task matches.
5. ADRs, path-only edits:
   - 0001, lines 14 and 24: line 14 reads "The delete-comment skill (`.agents/skills/delete-comment/SKILL.md`)".
   - 0002, line 22.
   - 0015, lines 10 and 11.
6. New ADR `docs/adr/00NN-maintainer-skills-live-in-agents-skills.md`, numbered at publish after merging main (0029 today). It covers:
   - The decision and its reasons.
   - The per-harness discovery table with sources and the date checked.
   - The fallback: the AGENTS.md list, and Claude Code's loss of the slash command and automatic use.
   - The rejected options: keeping `.claude/skills` (Codex stays on the fallback), `.github/skills` (two harnesses fall back), symlinks (`core.symlinks=false`), and a second copy (breaks the single-copy rule).
   - Why the maintainer skills stay outside `skills/`: they name files that exist only in this repository, so `install.mjs` must never install them globally.
7. New guard test, `maintainer-skills.test.mjs` at the repository root, with no comments:
   - From `git ls-files`, each of the three names has exactly one tracked `SKILL.md` whose frontmatter `name:` is that name, at `.agents/skills/<name>/SKILL.md`.
   - `install({ write: false })`, with a temporary home holding every harness's marker, reports no result for any of the three names.
   - No tracked file outside `docs/specs/` names `.claude/skills/<maintainer-skill>`. The test builds that pattern from the names, so it never matches itself, and the new ADR names the old folder only as `.claude/skills`, never with a skill name.
8. Unchanged: `adapters/harnesses.mjs`, `install.mjs`, `docs/specs/story/*` (history), and `skills/diagram-design/references/onboarding.md`, which describes user installs.
9. Spec committed first as `docs/specs/story/msk-1-maintainer-skills-every-harness.md`.

## Acceptance criteria
1. Each of the three skills exists exactly once, at `.agents/skills/<name>/SKILL.md`, with history kept through the rename (`git log --follow` reaches its earlier commits). The new ADR records the location and the reasons.
2. Codex and Copilot discover the skills from the repository with no per-machine setup. The ADR names Claude Code's fallback, which is the AGENTS.md "Maintainer skills" list, and its cost.
3. AGENTS.md, ADRs 0001, 0002 and 0015, the two skill self-references, and `delivery-model.test.mjs` name `.agents/skills/...`. No tracked file outside `docs/specs/` names `.claude/skills/<maintainer-skill>`.
4. `install()` installs none of the three; the guard test pins this.
5. `node --test` passes, including the comment ratchet, private-details.test.mjs and the new guard test. The delivery model tests pass at the move commit. `gitleaks` passes. `node e2e/run.mjs` is not required, because no worker start, decision delivery or Jarvis wake changes.

## Test level
Unit, in the guard test. Everything else is a path change, covered by `node --test`; the delivery model test reading the moved file proves its path.

## Out of scope
- What the skills say, except the two path lines.
- How the shipped skills under `skills/` are installed.
- `harnesses.mjs`, which leaves this story clear of LAUNCH-1.
- Past specs.
- Claude Code native discovery of `.agents/skills`.

## Run decisions
- Plan critique: not run. The profile authorizes cross-model review, but the only other provider, Codex, hit its usage limit until 2026-11-30. The planner checked the plan against the repository alone. The adversarial code review still runs before the PR.
- Gates: `node --test` and gitleaks. Mutation is skipped by the profile.
- Before-and-after: none. Diagram: none.
- Merge main before publishing, because PLAN-1, DOCS-1, SETUP-1 and LAUNCH-1 are in flight, and number the ADR then.


## Context pack · Let every harness find the factory's maintainer skills

Scouted read-only on 2026-11-27, branch story/msk-1-maintainer-skills-every-harness at cb0ffc5 (= origin/main). Harness evidence and sources: `discovery.md` beside this file.

### Summary

- The three maintainer skills (delete-comment, verify-decision-delivery, verify-story-lifecycle) are only in `.claude/skills/`.
- Claude Code and GitHub Copilot both discover them there today. Copilot's docs list `.claude/skills` as a project location, and the Copilot app inherits repository skills. The brief's premise that only Claude Code loads `.claude/skills` is wrong for Copilot.
- **Codex is the only one of the three harnesses that misses them.** It scans `.agents/skills` only, from the working directory up to the repository root.
- No folder is read by all three:
  - Claude Code reads only `.claude/skills`.
  - Codex reads only `.agents/skills`.
  - Copilot reads `.github/skills`, `.claude/skills` and `.agents/skills`.
- With one copy, exactly one harness needs a fallback, whichever folder is chosen.
- Symlinks would give all three, but they are ruled out. The owner's `.git/config` sets `core.symlinks=false`, so a committed link would check out as a text file.
- All three harnesses read `AGENTS.md`. That makes it the shared fallback: Claude Code reads it from v2.1.277 when there is no `CLAUDE.md`, and this repository has none.

### Relevant files

Skills to move (git mv):
- `.claude/skills/delete-comment/SKILL.md`
- `.claude/skills/verify-decision-delivery/SKILL.md`
- `.claude/skills/verify-story-lifecycle/SKILL.md`

Live references to the old paths:
- `AGENTS.md:23`, `:28`, `:29` (paths). `:33` says `/delete-comment`, which is a Claude Code and Copilot spelling; Codex uses `$delete-comment`.
- `command-center/delivery-model.test.mjs:7` reads the skill file through a relative URL. This is the only code dependency.
- `docs/adr/0001-code-carries-no-comments.md:14`, `:24`
- `docs/adr/0002-decisions-reach-a-worker-through-the-daemon.md:22`
- `docs/adr/0015-model-checks-for-delivery-and-lifecycle.md:10`, `:11`
- Inside the skills themselves:
  - `delete-comment/SKILL.md:33` names both verify skills' paths.
  - `verify-decision-delivery/SKILL.md:104` uses `git log -1 -- .claude/skills/verify-decision-delivery/SKILL.md` as its "last confirmed" marker. After a move, the old path still resolves in history but freezes. A new path would point at the move commit, which claims a confirmation nobody ran. Editing either line conflicts with the brief's out-of-scope "changing what the three skills say".

History references:
- 12 specs under `docs/specs/story/` (about 26 mentions)

Not to touch:
- `skills/diagram-design/references/onboarding.md`. It is an imported third-party skill (AGENTS.md: keep imported skills self-contained), and its Codex line is outdated.
- `adapters/harnesses.mjs` and `install.mjs`. They need no change, and LAUNCH-1 edits `harnesses.mjs`.

Install path:
- `install.mjs:49-50` installs only folders under `skills/` that hold a SKILL.md, so a maintainer skill outside `skills/` is never installed globally (AC4 holds by construction).
- `install.test.mjs` covers install; no test asserts AC4 today.

### Rules that apply

From AGENTS.md:
- Harness-neutral store and Command Center; harness-specific material goes under `adapters/`.
- No owner names or private words in tracked files (`private-details.test.mjs`).
- No source comments; the comment ratchet covers .js/.mjs only, and `comment-ratchet.json` has no `.claude` keys.
- Add an ADR for a reason the code cannot show; take the next free number at publish (0029 at cb0ffc5).
- Run `node --test` before committing.

From the profile:
- Gates are `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`.
- Spec goes in `docs/specs/story/<branch>.md` as the first commit.
- The Tests pipeline runs on Windows, macOS and Linux, plus `node e2e/run.mjs`.
- Team rule: reply to every PR comment before resolving it.

### Test commands

- Focused: `node --test command-center/delivery-model.test.mjs install.test.mjs private-details.test.mjs comment-ratchet.test.mjs`
- Full: `node --test`, then `node e2e/run.mjs` (CI)

### Similar earlier changes

- INST-1 (`docs/specs/story/inst-1-installer-backup-skills.md`) and ADR 0008: how `install.mjs` chooses and links skills.
- ADR 0015 introduced the verify-* skills and their paths.

### Risks

1. The Claude Code or Codex fallback loses the slash or `$` call and description-based auto-pick in that harness.
2. Parallel stories touch nearby files:
   - LAUNCH-1 edits `adapters/harnesses.mjs`.
   - PLAN-1 and DOCS-1 edit `skills/ai-sdlc/SKILL.md`.
   - SETUP-1 edits `skills/ai-sdlc-setup`.
   - This story stays out of all of these. AGENTS.md may still conflict on merge.
3. Windows: `git mv` of a dot-folder is fine. The CI matrix covers all three OSes.
4. Copilot would list a skill twice if a copy ever sat in both `.claude/skills` and `.agents/skills`. A single copy avoids this.
