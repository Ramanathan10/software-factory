---
name: learnings
description: Final coding-session sweep to identify and document durable lessons, repo conventions, setup gotchas, user corrections, architectural decisions, and non-obvious workflow knowledge. Use before commits or PRs, after debugging, after substantial code changes, when the user says "what did we learn", "save this learning", "update docs", "capture this", or when a session revealed reusable knowledge future agents or developers would regret missing.
---

# Learnings

Perform a final pre-commit or post-session sweep: determine whether this work produced knowledge worth writing down for the next developer or agent.

The bar is high. Most sessions produce no durable learning. Do not invent documentation just to make the sweep feel productive.

## Step 1: Gather Context

Inspect what actually happened, not what you remember happening.

Run the relevant local checks in parallel where possible:

```bash
git status --short
git diff
git diff --cached
git log --oneline -20
```

Read project guidance files when they exist:

- `AGENTS.md`
- `CLAUDE.md`
- `.claude/CLAUDE.md`
- `README.md`
- `CONTRIBUTING.md`
- `docs/`
- Existing memory, notes, or learnings files used by the repo

Review the active session:

- What did the user correct?
- What took unexpected effort?
- What failed once before the working approach emerged?
- What did the codebase require that was not obvious from one file?
- What setup, dependency, environment, or command behavior mattered?
- What should a future agent know before touching this area again?

## Step 2: Apply The Bar

Codify a candidate learning only when at least one of these is true:

1. Non-obvious gotcha: something cost real time and will likely cost time again.
2. Hidden convention: a repo pattern, naming rule, ownership boundary, or workflow is not obvious from local code.
3. Reusable user correction: the user corrected an approach in a way that applies beyond the immediate task.
4. Environment requirement: a dependency, secret, local service, version, path, platform detail, or command behavior is required for future success.
5. Architectural decision: a choice looks arbitrary without the reasoning.
6. Tooling lesson: a command, generator, test harness, migration tool, or deployment path has a non-obvious safe usage pattern.
7. Safety rule: a future mistake could cause data loss, external side effects, broken auth, leaked secrets, or destructive writes.

Reject candidates that are:

- Already obvious from nearby code.
- Purely task-specific and unlikely to repeat.
- A transcript of what changed rather than reusable guidance.
- A preference without evidence.
- Too vague to act on.
- Already documented accurately elsewhere.

If nothing clears the bar, say so plainly.

## Step 3: Choose The Right Home

Put each learning where the next person will naturally look.

Use this priority:

1. Existing repo instruction file, such as `AGENTS.md`, `CLAUDE.md`, or equivalent agent guidance.
2. Existing developer documentation, such as `README.md`, `CONTRIBUTING.md`, or a focused file under `docs/`.
3. Existing project-specific memory or learnings file if the repo already uses one.
4. A new minimal guidance section only when no suitable home exists.

Do not create extra documentation files by default. Prefer updating the existing canonical file.

For agent-specific instructions:

- Use `AGENTS.md` for Codex or cross-agent repo guidance.
- Use `CLAUDE.md` only when the repo already uses Claude-specific guidance or the user explicitly wants that target.
- If both exist, avoid duplicating the same learning; put generic guidance in `AGENTS.md` and tool-specific quirks in the tool-specific file.

For user-facing setup or project usage:

- Use `README.md` or `CONTRIBUTING.md`.
- Keep operational details close to the command or workflow they affect.

## Step 4: Write Durable Notes

Write concise, actionable guidance.

Good learning format:

```markdown
- When doing X, use Y because Z. Avoid A because it causes B.
```

Better learning format when context matters:

```markdown
### Workflow Name

- Use `command` for X; it handles Y and avoids Z.
- Do not run `dangerous-command` unless condition is true.
- If failure message contains `...`, check `file/path` first.
```

Include:

- Trigger: when this guidance applies.
- Action: what to do.
- Reason: why it matters.
- Location or command: exact file, script, env var, or command when useful.

Avoid:

- Long session narrative.
- Blame or self-commentary.
- Over-broad rules from one data point.
- Secrets, private tokens, credentials, or sensitive customer data.
- Duplicating code comments or obvious README content.

## Step 5: Edit Safely

Before editing a documentation or guidance file:

1. Read the target file.
2. Match its tone and organization.
3. Insert the learning near related content.
4. Keep the change small.
5. Preserve unrelated user edits.

If the learning involves a mistake or failed command, document the reusable rule, not the embarrassment.

Example:

```markdown
- On Windows, use PowerShell-native file operations for recursive deletes and moves; avoid composing paths in one shell and deleting them in another.
```

Not:

```markdown
- The agent messed up the shell command today.
```

## Step 6: Validate

After updating docs:

- Re-read the changed section to check that it is understandable without session context.
- Check `git diff -- <file>` to ensure the edit is scoped.
- If the file has formatting or docs validation, run the smallest relevant check.

Do not run broad test suites just for a documentation-only learning unless the repo requires it.

## Output Format

If you changed documentation:

```markdown
**Learnings Captured**
- [file] Short description of what was added.

**Why**
- The reusable lesson and why it belongs there.

**Validation**
- Diff/docs checks run.
```

If nothing should be added:

```markdown
**Learnings Captured**
Nothing worth adding.

**Reason**
The session did not reveal reusable repo guidance, undocumented setup requirements, durable user corrections, or non-obvious workflow lessons.
```

## Examples Of Worth Capturing

- "Use `pnpm test:integration -- --runInBand` for auth tests because the local auth fixture mutates shared state."
- "Do not call the billing API from React components; route all billing changes through server actions so audit logging is preserved."
- "The local dev server must be started through `scripts/dev-with-proxy.ps1`; plain `npm run dev` bypasses the API proxy."
- "Migration files must be idempotent because the deployment runner retries the same migration after transient lock failures."
- "When adding a new webhook event, update both the typed event map and the replay fixture; tests only cover replayed fixtures."

## Examples Of Not Worth Capturing

- "Fixed typo in button label."
- "Added tests for the new component."
- "The code uses React."
- "Remember to be careful."
- "The user asked for a dashboard today."
