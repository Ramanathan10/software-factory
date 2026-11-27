# PLAN-1: Every story plan and spec follows one of two fixed templates

Work item: none (owner's request in the Jarvis chat). Branch `story/plan-1-plan-template`, base `cb0ffc5`. Spec: `docs/specs/story/plan-1-plan-template.md`, first commit.

## Problem

`skills/ai-sdlc/SKILL.md` lists what a spec holds but gives no headings, no order and no design section, and no template file exists. Six approved plans use three shapes, from headingless labelled paragraphs to full `##`-headed specs. The 24 committed specs share nine sections in spirit under up to eight names each, in no common order, with the context pack first in 8, last in 14 and missing in 2, and planning history ("Feedback round 1", "Changed since round 1") left in. A plan without headings also gives the owner fewer comment anchors in the plan reader. The comparison is registered on the story.

## Settled decisions

1. One template serves both the approved plan and the committed spec. The context pack is not in the plan; the committed spec appends it as its last section (q1).
2. Bugs and features get separate templates (q2).
3. The templates live at `skills/ai-sdlc/references/plan-template.md` (q3).
4. Nothing checks a plan against the template; the skill text alone names it (q4).
5. The 24 committed specs stay as they are (q5).
6. Grill Me stays unchanged; AI SDLC names the template (q6).
7. Before and after: none (q7).
8. Architecture diagram: none (q8).
9. This story gets one red test on its own output, and the template's `## Test level` says a story that changes only text still gets a red test on the text it adds (q9, q10). The test reads the template and SKILL.md, never a story's plan, so q4 stands.
10. Planner's reading of 2 and 3 together, not asked: the one file holds two complete, standalone templates, "Feature plan" and "Bug plan", each with its full section list, so a planner copies one whole and never merges a variant into a base. If you want two files instead, say so in plan feedback.

## Design

### The template file

New file `skills/ai-sdlc/references/plan-template.md`. The installer links or copies the whole skill folder for every harness, so it reaches all of them with no installer change.

Layout: `# Plan template`, then `## Rules`, then `## Feature plan`, `## Bug plan` and `## Context pack`. Each of the last three holds a short note and one fenced Markdown block with the copyable skeleton: its headings in order, each followed by a one-line description of what goes there. The two templates share heading names, so the skeletons live inside fences and never collide with the file's own headings. It holds:

1. A short preamble of rules for both templates:
   - Use the template for the lane: Feature plan for the feature lane, Bug plan for the bug lane.
   - Keep every section, in order, with its exact heading. A section with nothing to say holds one line saying why (for example "None: no parallel story touches these files").
   - Use only `#`, `##` and `###` headings, Markdown lists, pipe tables, fenced code, bold, italic, inline code and links. No HTML, images or footnotes: the Command Center renderer does not show them.
   - Number decisions and acceptance criteria so each gets its own comment anchor.
   - Keep the plan under 16000 characters, the store's cap.
   - The plan holds the current state only. Answers, feedback rounds and revisions live in the story's events, not in "Round 1" or "Changed since" sections.
   - The committed spec is the approved plan with `## Context pack` appended as its last section, using the context pack's fixed `###` subsections.
2. **Feature plan**, in this order:
   - `# <ID>: <the outcome in one sentence>`, then one line: work item, branch, base commit, spec location.
   - `## Problem`: what is missing or wrong today and who it affects.
   - `## Settled decisions`: numbered, each the owner's answer, with the question id; decisions the planner settled without asking say so.
   - `## Design`: one `###` per file or area changed.
   - `## Acceptance criteria`: numbered and observable; docs that restate changed behaviour are named with their new wording.
   - `## Test level`: the level chosen and why, the tests to write first, the focused and full commands. A story that changes only text, such as skills or docs, still gets a red test on the text it adds.
   - `## Run decisions`: before and after (method, screen, environment, before reference) and architecture diagram (scope), or none.
   - `## Out of scope`: including what parallel stories own.
   - `## Plan critique`: reviewers and providers, findings, and what changed; or the limitation when no second provider ran.
3. **Bug plan**, in this order:
   - `# <ID>: <the broken behaviour, fixed, in one sentence>`, then the same one line.
   - `## Problem`: observed against expected behaviour, and who it affects.
   - `## Reproduction`: the smallest steps, input or command, and what it shows.
   - `## Root cause`: the code that causes it, with file and line.
   - `## Settled decisions`.
   - `## Fix`: one `###` per file or area changed.
   - `## Acceptance criteria`: the first says the reproduction no longer fails.
   - `## Test level`: the failing test that reproduces the bug, and the commands. A bug fixed only in text still gets a red test on the text it adds.
   - `## Run decisions`, `## Out of scope`, `## Plan critique`, as in the feature plan.
4. **Context pack** section for the committed spec, with these `###` subsections in order: Files and entry points, Rules that apply, Commands, Similar earlier changes, Risks.

### skills/ai-sdlc/SKILL.md, phase 1 only

1. Scout, before: "The context pack opens the draft plan, goes into the spec, and is given to every later subagent." After: "The context pack opens the draft plan, is appended to the committed spec, and is given to every later subagent; the approved plan leaves it out."
2. Feature lane, add: "Write the plan with the Feature plan in `references/plan-template.md`."
3. Bug lane, add: "Write the plan with the Bug plan in `references/plan-template.md`."
4. "Write and approve the spec", before: "The spec holds the context pack, the problem (or bug reproduction and root cause), acceptance criteria, test level, out-of-scope items, settled decisions, and the run decisions above." After: "The spec is the approved plan, in its template's shape, with the context pack appended as its last section, as `references/plan-template.md` says."

### skills/ai-sdlc/SKILL.md, phase 2

5. "2. Test-first handoff", add: "When the spec is not committed yet, commit the approved plan with the story's registered context pack appended as `## Context pack`, as `references/plan-template.md` says." The test author reads only this section and Gates, and the approved plan no longer carries the context pack, so it must be told where the pack comes from.

The Publishing section, which DOCS-1 edits, is untouched.

### plan-template.test.mjs

New test at the repository root, beside `install.test.mjs`, so the installer does not copy it into the skill folder. It reads `skills/ai-sdlc/references/plan-template.md` and `skills/ai-sdlc/SKILL.md` and asserts:

1. The fenced skeleton under `## Feature plan` and the one under `## Bug plan` each hold their `#`, `##` and `###` lines in the order above.
2. The fenced skeleton under `## Context pack` holds `## Context pack` and its five `###` subsections in order.
3. The `## Test level` description in both skeletons contains the phrase "still gets a red test on the text it adds".
4. SKILL.md names `references/plan-template.md` in the Feature lane, Bug lane, "Write and approve the spec" and "2. Test-first handoff" sections.

No comments, no package dependencies.

### Lines that stay true, unchanged

- `skills/jarvis/RUNBOOK.md:118`: the planner's `draft-plan` opens with the scout summary. Draft plans keep their free shape (scout summary, questions, facts relied on); the template governs the `plan` event and the committed spec.
- `command-center/serve.mjs` test-author kickoff: "the spec contains the context pack" and "commit the approved spec with its context pack" stay true once phase 2 says where the pack comes from (Design item 5).
- `skills/grill-me/SKILL.md`, `skills/ai-sdlc-setup/`, the store and the renderer.

## Acceptance criteria

1. `skills/ai-sdlc/references/plan-template.md` exists and holds the preamble rules, a Feature plan and a Bug plan with exactly the sections above in that order, and the Context pack section with its five `###` subsections.
2. The template file, inside and outside its fences, uses no heading deeper than `###` and no HTML.
3. SKILL.md's Scout, Feature lane, Bug lane, "Write and approve the spec" and "2. Test-first handoff" paragraphs carry the new wording in the Design section; no other SKILL.md section changes.
4. `skills/grill-me/SKILL.md`, `skills/ai-sdlc-setup/` and every file under `docs/specs/story/` other than this story's spec are unchanged against `origin/main`.
5. This story's committed spec follows the Feature plan with the context pack appended.
6. `plan-template.test.mjs` fails on the base commit (the template file is missing) and passes after the change.
7. `node --test` passes, including `private-details.test.mjs` and the comment ratchet; `node e2e/run.mjs` passes; gitleaks finds nothing.

## Test level

Unit level, file-content assertions (q10). The test author writes `plan-template.test.mjs` first and records it red against the base: the template file is missing. Focused: `node --test plan-template.test.mjs`. Full: `node --test`, `node e2e/run.mjs`, `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation testing has no production code to mutate; the test's own assertions are the check.

## Run decisions

- Before and after: none (q7); the next story's plan shows the change.
- Architecture diagram: none (q8); no component or flow changes.

## Out of scope

- A check, test or store rule that reads a story's plan or refuses one missing headings (q4).
- Rewriting the 24 committed specs (q5).
- Grill Me (q6), the draft-plan shape, and the renderer.
- SETUP-1 owns `skills/ai-sdlc-setup`; DOCS-1 owns SKILL.md's Publishing section. This story merges main before publishing.

## Plan critique

Reviewer: Grok 4.7 High through Cursor, given the requirements, constraints and this plan. Codex (GPT) and Cursor's GPT models were out of usage, so this is one cross-provider reviewer, not a panel. Two findings, both verified against the code:

1. The approved plan no longer carries the context pack, but the test author commits the spec from it and reads only SKILL.md's "2. Test-first handoff" and Gates (`command-center/serve.mjs:15,85-103`). Fixed: Design item 5.
2. "No test, no red" cannot pass phase 2: `skills/jarvis/BACKGROUND.md:9` checks the test author's handoff for a valid failing test, and the store moves `testing` to `red` on that handoff. q4 ruled out a check on plans, which left this open. Asked as q9 and q10; settled by decision 9.

## Context pack

### Files and entry points

- `skills/ai-sdlc/SKILL.md`: "1. Plan" (Scout, Feature lane, Bug lane, "Write and approve the spec") and "2. Test-first handoff". No template file exists today.
- `skills/grill-me/SKILL.md`: "Finish when the frontier is empty. Summarize the proposed plan and wait for the owner to confirm." No shape. Used outside AI SDLC too.
- `skills/jarvis/RUNBOOK.md:118` (planner's `draft-plan` opens with the scout summary) and `:166` (the plan reader lets the owner comment on any heading, bullet, paragraph or table row).
- `command-center/serve.mjs:85-103`: the test author's kickoff reads only `testAuthorSections` of SKILL.md and the committed spec; the approved `story.plan` is its fallback.
- `command-center/ui/markdown.js`: the plan renders here. ATX headings shown two levels down (`#` as `h3`), paragraphs, lists with nesting and task boxes, pipe tables, fenced code, block quotes, rules, inline code, bold, italic, http/mailto links. No HTML, images, setext headings or footnotes.
- `install.mjs` links (Claude Code, Codex, Cursor) or copies (Copilot) each whole skill folder, so a file beside `skills/ai-sdlc/SKILL.md` reaches every harness. Precedent: `skills/jarvis/RUNBOOK.md`, `skills/before-and-after/references/`.
- `mission-console/store.mjs:171,180`: `plan` and `draft-plan` detail capped at 16000 characters.

### Rules that apply

- Keep the repository free of personal or work details; skills say "the owner". `private-details.test.mjs` checks tracked files.
- Keep skills harness-neutral; harness-specific matter goes under `adapters/`.
- Source files carry no comments (`comment-ratchet.mjs`).
- Profile: required gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; spec location `docs/specs/story/<branch-name>.md`, first commit; before-and-after and architecture diagram recommended none.
- SETUP-1 edits `skills/ai-sdlc-setup`; DOCS-1 edits SKILL.md's Publishing section. Stay out of both; merge main before publishing.

### Commands

- Focused: `node --test plan-template.test.mjs`.
- Full: `node --test`; `node e2e/run.mjs`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`.

### Similar earlier changes

- `80628bd` (RETRO-1 lessons) and `eb2b50a` (CTX-1) changed SKILL.md planning and test-author text.
- MD-1 (`docs/specs/story/md-1-indented-heading-freeze.md`) fixed the renderer for indented headings.

### Risks

- A template only in skill text may still drift; a check that refuses a plan would couple the store to Markdown headings (declined, q4).
- The test author reads only named SKILL.md sections, so phase 2 must say where the context pack comes from.
- A long template makes small bug plans heavy; the rule is one line saying why a section is empty.
- Committed specs are history; rewriting them is churn with no reader.
