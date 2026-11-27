# 0029. Maintainer skills live in .agents/skills

Status: Accepted
Date: 2026-11-27

## Context
The three skills for working on the factory itself (delete-comment, verify-decision-delivery, verify-story-lifecycle) lived in `.claude/skills`, which only Claude Code reads. Codex and GitHub Copilot work on this repository too, and AGENTS.md asks that the factory stay harness-neutral. The skills name files that exist only here, so they are not shipped under `skills/`.

## Decision
- Each skill exists once, at `.agents/skills/<name>/SKILL.md`, moved with `git mv` so history follows.
- AGENTS.md carries a "Maintainer skills" list naming each file and when to use it. A harness that does not discover the folder reads the file from that list.
- `install.mjs` reads only `skills/`, so it never installs the maintainer skills. `maintainer-skills.test.mjs` pins this, the single copy, and that no live file names the old paths.
- Past specs under `docs/specs/story/` keep their old paths as history.

## Discovery (checked 2026-11-27)
| Harness | Project skill folders | Finds the maintainer skills |
|---|---|---|
| Claude Code | `.claude/skills` | No: falls back to the AGENTS.md list. It loses `/delete-comment` as a slash command and automatic use by description. (code.claude.com/docs/en/skills) |
| Codex | `.agents/skills`, from the working directory up to the project root | Yes (learn.chatgpt.com/docs/build-skills) |
| GitHub Copilot | `.github/skills`, `.claude/skills`, `.agents/skills` | Yes (docs.github.com/en/copilot/concepts/agents/about-agent-skills) |
| Cursor | `.agents/skills` | Yes, not checked against Cursor's docs |

## Rejected
- Keeping them in `.claude/skills`: Codex would stay on the fallback.
- `.github/skills`: only Copilot would find them; Claude Code and Codex would both fall back.
- Symlinks from one folder to the other: `core.symlinks=false` on some machines.
- A second copy: breaks the single-copy rule.

## Where
- `.agents/skills/`
- `AGENTS.md`
- `maintainer-skills.test.mjs`
