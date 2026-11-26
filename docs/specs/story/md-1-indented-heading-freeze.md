# MD-1: A plan with an indented heading freezes the Command Center tab

Work item: issue 50. Base: origin/main 88b9cce. Context pack: the section at the end of this spec.

## Problem

`renderMarkdown` in `command-center/ui/markdown.js` loops forever on a line with whitespace before `#`. The heading rule (line 64) needs `#` in the first column. The paragraph loop (line 84) stops before any line matching `^\s*#{1,6}\s`. Neither branch consumes the line, so the paragraph branch pushes an empty `<p>` and `i` never advances. Every plan, draft plan, question and document goes through this renderer, and the story is re-sent on every reload, so the tab freezes again on reload.

## Reproduction (unchanged code, 88b9cce, Node 24.18.0)

Each case below passed 100,000 nodes without ending (`repro.mjs`, `repro-before.txt`, plus a second run this phase):

1. Three spaces before `###` after a paragraph line.
2. Two spaces before `###` after a list item and a blank line.
3. A tab before `#`.
4. An indented heading alone.
5. NBSP before `##`.
6. A BOM before `#` (text pasted from a Windows file starting with a heading).
7. Four spaces before `##`.
8. A heading behind a blockquote with two spaces after `>`, and behind a nested `> >`.

A heading in the first column renders (p, h5). A 200,000-input fuzz that left indented headings out found no other hang.

## The fix

1. One heading pattern, `^\s*(#{1,6})\s+(.*?)\s*#*$`, held in a single constant. The heading branch matches it, and the paragraph loop uses the same constant as its heading stop. No line can then match one and not the other. JavaScript `\s` covers spaces, tab, NBSP and BOM, and `trim()` treats them the same way. Blockquote recursion needs no extra code: the stripped line meets the same pattern.
2. The paragraph branch always takes its first line, then applies its stop tests to the lines after it. Every pass of the block loop then consumes at least one line, whatever a future rule says. With the shared pattern no current input reaches this path, so no test can show it on its own; it is a guard against the next mismatch.
3. An indented heading renders as a heading at any indent, the same as in the first column (owner answer to `md1-indented-heading`, event 1917). Fences, lists, quotes and rules already ignore indentation, and this renderer has no indented code blocks.

## Acceptance criteria

1. Every input in the reproduction renders and returns, with fewer than 1,000 nodes.
2. An indented heading renders as a heading with its text trimmed, at any indent; `###` gives h5, as in the first column.
3. Lines before and after an indented heading still render as their own paragraphs.
4. Headings in the first column, lists, tables, fences, quotes and the existing test's output are unchanged.
5. A deterministic termination check over every short sequence of lines drawn from a fragment set (whitespace variants before `#`, list items, quotes, fences, rules, table rows, plain text, blank lines) finishes under the node bound.

## Tests to write first (separate subagent)

Level: unit, in `command-center/markdown.test.mjs`. The bug is a synchronous infinite loop, which `node:test` timeouts cannot interrupt, so every new case renders through a counting `el` that throws after a bound (for example 10,000 nodes). Red then fails fast instead of hanging `node --test` and CI.

1. One test per reproduction case above, asserting the heading tag (h5 for `###`, h4 for `##`, h3 for `#`) and trimmed text.
2. A mixed case: a paragraph, an indented heading, then a paragraph, giving p, heading, p.
3. A first-column heading control.
4. The termination check from acceptance criterion 5, with a fixed fragment list and no randomness.

All of these must fail on 88b9cce by the bound, except the control, which passes.

## Gates

1. `node --test` (includes the comment ratchet, `no-html.test.mjs`, `ui-lint.test.mjs` and `private-details.test.mjs`).
2. `gitleaks git --no-banner --log-opts=origin/main..HEAD`.
3. Mutation testing: none configured for this repository.
4. No e2e scenario: the change touches no worker start, decision delivery or Jarvis wake, and the bug came from an audit, not a live story.
5. Required pipeline: Tests (test.yml) on the pull request.

## Out of scope

1. An indented `###` line directly under a list item, with no blank line between, is absorbed into that item as literal text. It does not hang and stays as it is.
2. Any wider move toward CommonMark (indented code blocks, setext headings).

## Plan critique

Cross-model sharing is authorized. Codex (OpenAI, `gpt-6-sol`) reviewed a neutral packet and found no defects: the shared pattern closes the mismatch, the first-line guard gives the loop a fallback, `list()` always advances, and each blockquote recursion removes one `>`. Only one other provider was reachable, so this is a single-reviewer critique. The profile's Codex models (`gpt-6.2-sol`, and the config default `gpt-6.1-sol`) were refused by the Codex account; `gpt-6-sol` worked.

## Settled decisions (owner, events 1917 to 1919)

1. Indented heading: a heading at any indent, the same as in the first column.
2. Before and after: yes, as command output. Before is the reproduction script on 88b9cce (`repro-before.txt`, every case passes 100,000 nodes without ending). After is the same script, extended with the NBSP, BOM, four-space and blockquote cases, on the fixed branch. Both go into the PR description as text. The before reference already exists, so nothing needs capturing before implementation.
3. Architecture diagram: yes, a small diagram of the renderer's block loop and its rules (blank, fence, heading, rule, table, list, quote, paragraph), showing that every rule consumes at least one line and that the heading rule and the paragraph stop share one pattern. Drawn with `diagram-design` in a form the PR description renders; the image is not committed.

## After approval

Commit this spec as `docs/specs/story/md-1-indented-heading-freeze.md`, the branch's first commit.

---

## Context pack

Story: A plan with an indented heading freezes the Command Center tab. Work item: GitHub issue #50. Base: origin/main 88b9cce. Worktree: C:/repos/software-factory-worktrees/story/md-1-indented-heading-freeze.

### Files and entry points

- `command-center/ui/markdown.js`: `renderMarkdown(text, el)`. It is the only file the fix touches. It is a block loop over lines, plus `list()` and `inline()`.
- `command-center/ui/app.js:38`: `md()` renders every plan, draft plan, question prompt and document through `renderMarkdown`. The story is re-sent on every reload, so the freeze comes back on every reload.
- `command-center/markdown.test.mjs`: the existing unit test, which uses a plain-object `el`. New tests go here.
- `command-center/no-html.test.mjs` and `command-center/ui-lint.test.mjs`: these lint `markdown.js` (no HTML strings, UI rules), and they must stay green.

### Root cause

Every branch of the block loop must advance `i`. The heading rule at line 64 matches only `#` in the first column: `^(#{1,6})\s+`. The paragraph loop at line 84 stops before any line that matches `^\s*(#{1,6}\s|...)`. So a line with whitespace (spaces, tab or NBSP) before `#` matches neither rule. The paragraph loop then pushes an empty `<p>` without consuming the line, and the outer loop spins forever. A blockquote reaches the same line through recursion, because `>  ## x` becomes ` ## x` once the `>` and one space are stripped.

### Reproduction (unchanged code, Node 24.18.0, 88b9cce)

`repro.mjs` calls `renderMarkdown` with an `el` that throws after 100,000 nodes. Its output is saved in `repro-before.txt`:

- three spaces before `###`: HANG
- an indented heading after a list item and a blank line: HANG
- a tab before `#`: HANG
- an indented heading alone: HANG
- control, a heading in the first column: ok (p, h5)

`fuzz.mjs` rendered 200,000 random inputs built from markdown fragments, leaving out any input with an indented heading, including headings behind a blockquote prefix. It found no other hang. The fragments did not include NBSP. Its output is saved in `fuzz-before.txt`.

### Conventions and rules (AGENTS.md)

- Source files carry no comments. `comment-ratchet.mjs` and `comment-ratchet.json` enforce this through `node --test`.
- The repository has no package dependencies. Run `node --test` before committing.
- An e2e scenario is required only for changes to worker starts, decision delivery or Jarvis waking. This change touches none of them. AGENTS.md also asks for a scenario when a bug is found in a live story. This bug came from an audit, not a live story, and the defect sits in a pure UI function, so a unit test is the right level.
- No names of people or organizations in tracked files.
- ADRs: take the next free number at publish time, and only when a reason cannot be shown in code. None is expected.

### Test commands

- Focused: `node --test command-center/markdown.test.mjs`
- Full: `node --test`. The required gates are test and secrets (`gitleaks git --no-banner --log-opts=origin/main..HEAD`).

### Test-author warning

The bug is a synchronous infinite loop. The `node:test` `timeout` cannot interrupt it, so a naive red test hangs `node --test` and CI. The test must use a counting `el` that throws after a bound, as `repro.mjs` does, so that red fails fast.

### Similar earlier changes

`git log -- command-center/ui/markdown.js` shows only #1, #9 and #17, which were setup and comment sweeps. No earlier fix to this renderer exists.

### Risks

- If the heading rule and the paragraph stop use different predicates, any gap between them hangs again. Examples: a CommonMark heading rule that allows at most 3 spaces next to a stop at `\s*`, or NBSP.
- Changing the heading rule changes how indented `#` lines that are not headings render. Today such lines hang, so no working output can regress.
