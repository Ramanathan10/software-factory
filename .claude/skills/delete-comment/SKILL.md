---
name: delete-comment
description: Sweep code comments out of this repository. Classifies each comment as a tautology, an excuse, stale, or a decision record, then deletes it, files an issue for the hack it excused, or moves it into an ADR, and lowers the comment ratchet. Use when asked to /delete-comment, to clean up or remove comments, or when the comment ratchet fails because a file gained a comment.
---

# Delete comments

Comments are banned in this repository's source (`docs/adr/0001-code-carries-no-comments.md`). `comment-ratchet.json` holds a per-file count of the comments that are still allowed, and `node --test` fails if any file goes above its count or below it without the baseline being lowered. The count only goes down.

Pass a path to sweep part of the repository: `/delete-comment command-center`. With no path, sweep every file in the baseline.

## 1. List the comments

```bash
node comment-ratchet.mjs --list command-center
```

Each line is `file:start-end<TAB>text`, with adjacent line comments joined by `⏎`. Tool directives (`eslint-disable`, `@ts-expect-error`, `noqa`, `shellcheck`, shebangs, `#Requires` and the rest in `DIRECTIVE`) are not listed and are not banned. Everything under `exclude` in `comment-ratchet.json` is third-party code kept identical to its vetted upstream; leave it alone.

## 2. Classify each comment

Open the file and read the comment with the code around it. Then pick one category.

| Category | Test | Action |
|---|---|---|
| Tautology | The code, its names or its test title already say it. Section markers such as `// Arrange`, `// Helpers` and `/* Buttons */` belong here. | Delete. |
| Stale | It names code, behaviour, a file or a ticket that no longer exists or no longer works that way. Check with `git log -S` or a search before deciding. | Delete. |
| Excuse | It admits a shortcut: a TODO, a workaround, "temporary", "hack", "for now", a swallowed error, a magic number, a known race, "should be X but". | Delete, and file an issue (step 3). |
| Decision record | It explains a non-obvious choice the code cannot show: why this approach over the obvious one, an external constraint (an API quirk, a platform limit, a security rule), or a trap that a reasonable edit would fall into. | Move to an ADR (step 4), then delete. |

When a comment is both, an excuse beats a decision record: file the issue, and add an ADR only if the reason will still hold after the fix.

A comment that carries real meaning but fits none of these, such as what a test's fixture represents, should become a better name: rename the test, the variable or the helper so the comment is redundant, then delete it. Keep that change behaviour-preserving. Before renaming anything in a file that `.claude/skills/verify-decision-delivery/SKILL.md` or `.claude/skills/verify-story-lifecycle/SKILL.md` names, read that skill: its model refers to the code by name.

If removing a comment would lose a warning that nothing else enforces and you cannot encode it in a name, a test or an ADR in this change, leave it. The baseline keeps it, and the next sweep picks it up.

## 3. File an issue for each excuse

Search first so you don't file a duplicate: `gh api -X GET search/issues -f q="repo:$(gh repo view --json nameWithOwner -q .nameWithOwner) is:issue is:open <words from the comment>"`, or the GitHub MCP tools. The repository's name is left out of this skill on purpose: it names the owner, and this repository is shared. File one issue per distinct hack, even when the same hack appears in several files. Give it:

- a title that names the hack, not the comment ("Session retry swallows network errors", not "Remove TODO")
- a permalink to the code at the current commit, and the deleted comment quoted in full
- what is wrong with the current code and what a fix would look like
- the `excuse-comment` label
- a body that follows the privacy rules in AGENTS.md: say "the owner", and name no person, organization or private repository. ADRs follow the same rules

## 4. Write an ADR for each decision record

ADRs live in `docs/adr/`, numbered in order: `docs/adr/NNNN-short-title.md`. Add each new one to the index in `docs/adr/README.md`. Several comments about the same decision go into one ADR; check the existing ADRs first and extend one if it already covers the decision.

```markdown
# NNNN. <The decision, stated as a sentence>

Status: Accepted
Date: YYYY-MM-DD

## Context
The constraint or problem, with enough detail that someone who never saw the comment understands it.

## Decision
What the code does about it.

## Consequences
What this costs, what it rules out, and what would have to change for the decision to be revisited.

## Where
- `path/to/file.ext` — the function or block it applies to
```

Write the ADR in plain, specific prose. Don't copy the comment verbatim when a full sentence would be clearer.

## 5. Delete, verify and lower the baseline

Delete the comments. Remove any blank line the deletion leaves doubled. Then:

```bash
node comment-ratchet.mjs --verify origin/main
```

This lists every changed source file whose code changed as well as its comments. Each file it lists must be one you meant to change, such as a rename from step 2. Then lower the baseline and run the checks. `node --test` runs `comment-ratchet.test.mjs`, which fails while a file is above or below its count, on every platform CI runs:

```bash
node comment-ratchet.mjs --update
```

```bash
node --test
```

`--update` only lowers counts. If it reports a file that gained comments, remove those comments; never raise a count by hand. `--init` exists only for creating the baseline the first time and refuses to run once one exists.

## 6. Report

In the pull request, give the count per category, the issues filed, the ADRs added or extended, any comments left in the baseline and why, and the comment-only lines removed (`node comment-ratchet.mjs --stats` before and after).
