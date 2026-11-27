# Plan template

Every story plan and committed spec follows one of two templates below, copied whole.

## Rules

- Use the Feature plan for the feature lane and the Bug plan for the bug lane.
- Keep every section, in order, with its exact heading. A section with nothing to say holds one line saying why, for example "None: no parallel story touches these files".
- Use only `#`, `##` and `###` headings, Markdown lists, pipe tables, fenced code, bold, italic, inline code and links. Use no HTML, images or footnotes: the Command Center renderer does not show them.
- Number decisions and acceptance criteria so each gets its own comment anchor.
- Keep the plan under 16000 characters, the store's cap.
- The plan holds the current state only. Answers, feedback rounds and revisions live in the story's events, not in "Round 1" or "Changed since" sections.
- The committed spec is the approved plan with `## Context pack` appended as its last section, using the fixed `###` subsections below.

## Feature plan

Copy this skeleton for a feature, enhancement or any change that is not a bug fix.

```markdown
# <ID>: <the outcome in one sentence>

Work item: <ID or none>. Branch `<branch>`, base `<commit>`. Spec: `<spec location>`.

## Problem

What is missing or wrong today, and who it affects.

## Settled decisions

Numbered. Each is the owner's answer with its question id; a decision the planner settled without asking says so.

## Design

### <file or area changed>

One `###` per file or area changed: what changes and why.

## Acceptance criteria

Numbered and observable. Name any doc that restates changed behaviour, with its new wording.

## Test level

The level chosen and why, the tests to write first, and the focused and full commands. A story that changes only text, such as skills or docs, still gets a red test on the text it adds.

## Run decisions

Before and after (method, screen, environment, before reference) and architecture diagram (scope), or none.

## Out of scope

What this story leaves alone, including what parallel stories own.

## Plan critique

Reviewers and providers, findings, and what changed; or the limitation when no second provider ran.
```

## Bug plan

Copy this skeleton when the owner reports broken existing behaviour.

```markdown
# <ID>: <the broken behaviour, fixed, in one sentence>

Work item: <ID or none>. Branch `<branch>`, base `<commit>`. Spec: `<spec location>`.

## Problem

Observed against expected behaviour, and who it affects.

## Reproduction

The smallest steps, input or command, and what it shows.

## Root cause

The code that causes it, with file and line.

## Settled decisions

Numbered. Each is the owner's answer with its question id; a decision the planner settled without asking says so.

## Fix

### <file or area changed>

One `###` per file or area changed: what changes and why.

## Acceptance criteria

Numbered and observable. The first says the reproduction no longer fails.

## Test level

The failing test that reproduces the bug, and the focused and full commands. A bug fixed only in text still gets a red test on the text it adds.

## Run decisions

Before and after (method, screen, environment, before reference) and architecture diagram (scope), or none.

## Out of scope

What this story leaves alone, including what parallel stories own.

## Plan critique

Reviewers and providers, findings, and what changed; or the limitation when no second provider ran.
```

## Context pack

Append this section last when committing the spec. The story's registered context pack fills it; the approved plan leaves it out.

```markdown
## Context pack

### Files and entry points

The relevant files and entry points.

### Rules that apply

Conventions, agent instruction files, team rules and gates.

### Commands

The focused and full test commands.

### Similar earlier changes

Earlier changes that touched the same area.

### Risks

Known risks.
```
