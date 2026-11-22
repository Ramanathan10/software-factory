---
name: adversarial-code-review
description: Review code changes, diffs, pull requests, patches, or pending commits with independent reviewers from distinct model classes and unanimous sign-off. Use when the user asks for code review, PR review, "review my changes", "tear this apart", "find bugs", "any risks?", "before I merge", or after substantial implementation work before commit or PR.
---

# Adversarial Code Review

Review the change as the engineer who will be paged if it breaks. The goal is to find issues the author would actually fix, not to perform thoroughness.

A good review with one proven bug is better than a long review full of style preferences.

Act as the review orchestrator. Delegate independent reviews to at least two subagents using distinct model classes explicitly selected through the host's model controls. Use the model assignments confirmed by the host. Different reviewer roles, reasoning settings, or instances of the same model class do not satisfy this requirement. If the host cannot run and confirm two distinct classes, report that the review is incomplete.

## Review Contract

Treat a finding as reportable only when all of these are true:

1. It affects correctness, security, reliability, performance, data integrity, user experience, operability, or maintainability.
2. It is discrete and actionable.
3. It is introduced or materially worsened by the reviewed change.
4. It is provable from the diff and surrounding code, or from a documented contract.
5. A reasonable maintainer for this codebase would likely fix it.
6. It respects the rigor level of the surrounding project.

Do not report pure style preferences, broad unease, speculative "might be bad" claims, or pre-existing issues unless the change makes them materially worse.

If no issue clears the bar, say there are no findings. A clean review is a valid result.

## Step 1: Recover Intent

Understand what the change claims to do before inspecting implementation details.

Prefer these sources, in order:

1. User request or PR description
2. Linked issue or design doc
3. Commit messages
4. Test names and changed file names
5. The diff itself

Write down the expected behavior in one sentence. Keep checking whether the implementation actually matches that intent.

If intent cannot be recovered, state that limitation in the final review and focus on structural risks visible from code.

## Step 2: Establish The Review Surface

Inspect both committed and uncommitted changes when available.

Keep the review read-only unless the user explicitly asks for fixes. Do not mutate the working tree, index, HEAD, or branch while reviewing. Prefer `git show`, `git diff`, `git log`, searches, and non-mutating verification commands. If another revision needs a working copy, use a separate temporary worktree rather than moving the reviewed checkout.

Use Git when reviewing a local repository:

```bash
git status --short
git branch --show-current
git remote show origin
git diff --stat
git diff
git diff --cached
```

If reviewing a branch against a target branch, find the merge base instead of assuming the whole branch diff:

```bash
TARGET_BRANCH=${TARGET_BRANCH:-main}
MERGE_BASE=$(git merge-base "origin/$TARGET_BRANCH" HEAD)
git diff --stat "$MERGE_BASE"...HEAD
git diff "$MERGE_BASE"...HEAD
```

If the default branch is unclear, inspect the remote default branch before choosing `main` or `master`.

For hosted PRs, read the PR title/body, changed files, CI failures, review comments, and linked issues before judging the code.

Give every reviewer the same base and head revisions and, when applicable, the same captured staged and unstaged changes. Include the recovered intent and how to access the surrounding code. Confirm that all reviewers assessed the same change before consolidating their findings. If the review surface changes, restart on the new snapshot.

## Step 3: Read In Layers

Review from highest-risk to lowest-risk:

1. Public contracts: API routes, exported functions, database schema, migrations, CLI flags, events, queue payloads, file formats.
2. State transitions: authentication, authorization, billing, permissions, ownership, retries, idempotency, cancellation, concurrency.
3. Data flow: validation, serialization, parsing, nullability, time zones, pagination, ordering, deduplication.
4. Error behavior: partial failure, rollback, retries, logging, user-facing errors, observability.
5. Tests: whether changed behavior is covered by meaningful tests, not only snapshots or happy paths.
6. UI behavior: loading, empty, error, disabled, responsive, keyboard, and stale-state cases when relevant.

For each touched subsystem, read enough surrounding code to understand local conventions. Do not demand patterns the project does not use.

## Step 4: Shift Perspective

Have each reviewer independently apply the three lenses below and return its own findings before seeing any other reviewer's output. Each finding should include the affected file and line, the failing scenario and impact, the proposed severity, and the evidence or verification limits. Require an explicit no-findings response when appropriate. Each lens must search seriously, but it may return no finding. Never invent an issue to satisfy the lens.

1. **Breaker:** Try to break the change in production. Stress invalid input, partial failure, repeated or concurrent execution, inconsistent state, exhaustion, timeouts, and violated data assumptions.
2. **Maintainer:** Approach the change without the author's mental model. Look for hidden contracts, misleading names, surprising side effects, unnecessary complexity, and tests coupled to implementation instead of behavior. Report maintainability only when the change creates a concrete defect risk or material future cost.
3. **Security auditor:** Trace every trust boundary. Check authentication, authorization, injection, secrets, sensitive output, least privilege, unsafe files or redirects, and the dependency delta: new packages, scripts, binaries, generated clients, and lockfile changes.

Use these perspective breakers when they fit the change:

- Read changed functions bottom-up once to disrupt narrative confirmation bias.
- State a function's expected contract before reading its body, then compare them.
- Assume nullable values are absent and external calls fail until the code proves otherwise.
- Ask what intended or observable behavior would break if the change were removed. If none, test whether the change is unnecessary or incomplete.

Pool and deduplicate findings across reviewers and lenses. Keep the evidence from each distinct failure path. Severity depends on impact and likelihood.

## Step 5: Hunt For Mismatches

Prioritize these bug classes:

- Intent mismatch: code does something narrower, broader, or different from what the change claims.
- Contract mismatch: caller and callee disagree about shape, units, nullability, encoding, permissions, or lifecycle.
- Boundary failure: first item, last item, empty input, duplicate input, deleted record, expired token, missing config, clock boundary, DST, timezone, huge input.
- Security regression: broken authorization, trusting client input, leaked secrets, unsafe redirects, injection, SSRF, path traversal, XSS, CSRF, privilege escalation.
- Data loss or corruption: destructive migration, irreversible write, accidental overwrite, missing transaction, race, non-idempotent retry.
- Async/concurrency issue: stale closure, double submit, orphaned job, out-of-order response, unawaited promise, cancellation gap, lock contention.
- Compatibility break: renamed field, changed default, removed export, altered response body, changed CLI flag, migration without backfill.
- Test gap with risk: behavior changed in a high-value path but no focused test would fail if the bug exists.

## Step 6: Verify Before Reporting

Before reporting a finding, try to falsify it:

- Read the surrounding implementation and existing tests.
- Search for call sites and consumers.
- Check whether a guard, invariant, or migration elsewhere already handles it.
- Run the smallest relevant test, typecheck, lint, build, or reproduction when practical.

If verification is not practical, be explicit about the uncertainty and downgrade the confidence. Do not present guesses as facts.

## Step 7: Cross-Review and Sign-off

Send the full candidate list and supporting evidence to every reviewer, including findings from the other models. Ask each reviewer to assess every candidate independently and return an explicit decision to include, reject, or request further verification, with reasons and a proposed severity for included findings. A reviewer can accept a finding it missed in its first pass.

Investigate disagreements using the reviewed code, contract, or relevant checks. Circulate the proposed final report and the disposition of every pooled candidate to all reviewers. Require explicit approval from every reviewer of the same report version, including which findings are included or excluded, their severity and material claims, and the overall verdict. Apply this gate to a `CLEAN` report as well. Any change to an approved draft requires fresh sign-off from all reviewers.

Keep the original reviewer roster for cross-review and sign-off. Continue investigating objections, sharing evidence, and revising the draft until every original reviewer agrees. There is no revision cap. A candidate stays open until every original reviewer explicitly agrees to include it at the same severity or to exclude it for an evidence-based reason. Dropping a disputed candidate or reviewer cannot resolve a disagreement.

After every three revision rounds without unanimous approval, give the owner a status update with each open candidate and every reviewer's position, without publishing findings or a verdict, and ask whether to keep reconciling. Continue only when they say so. Stopping leaves the review incomplete; it does not turn a majority or the orchestrator's judgment into approval.

Release the final report only after every original reviewer explicitly approves it. Silence, a timeout, a majority, and the orchestrator's judgment cannot substitute for approval. If execution is interrupted or a reviewer becomes unavailable, give the owner a status update without publishing findings or a verdict. Resume reconciliation with the original reviewers when possible.

## Step 8: Output Format

Lead with findings, ordered by severity. Use this format:

```markdown
**Findings**
- High: [file:line] Concrete issue and why it breaks. Explain the failing scenario and likely fix.
- Medium: [file:line] Concrete issue and why it matters.

**Verdict**
- [BLOCK | CONCERNS | CLEAN]

**Open Questions**
- Any unresolved intent, environment, or product questions that affect judgment.

**Verification**
- Commands or checks run, and whether they passed.
- Model assignments and unanimous sign-off on this report.

**Summary**
- One or two sentences only. If there are no findings, say that clearly and mention residual risk.
```

If there are no findings:

```markdown
**Findings**
No findings.

**Verdict**
CLEAN

**Verification**
- Commands or checks run, whether they passed, and the model assignments that signed off.

**Residual Risk**
- ...
```

Keep findings precise. Reference exact files and lines when possible. Avoid long code excerpts unless needed to prove the issue.

Use `BLOCK` when a Critical or High finding should prevent merge, `CONCERNS` when only narrower non-blocking findings remain, and `CLEAN` when no finding clears the review contract. The verdict follows the verified findings; it does not create them.

## Severity Guide

- Critical: exploitable security issue, data loss, financial loss, or outage likely in normal use.
- High: clear user-facing breakage, auth/permission failure, serious reliability issue, or migration/deploy blocker.
- Medium: real bug or meaningful maintainability risk with narrower blast radius.
- Low: minor edge case, confusing behavior, or small test gap worth fixing but not blocking.

Do not inflate severity to make the review feel useful.

## Stack-Agnostic Rules

Adapt to the stack in front of you:

- For web apps, inspect client/server boundaries, request validation, auth, caching, and hydration/state transitions.
- For backends, inspect contracts, transactions, idempotency, retries, migrations, queues, and observability.
- For CLIs/scripts, inspect argument parsing, filesystem safety, exit codes, dry-run behavior, and quoting.
- For data work, inspect schema assumptions, time zones, dedupe keys, incremental runs, and reproducibility.
- For infrastructure, inspect destructive operations, secret handling, least privilege, rollback, and environment drift.

Use the project's own commands and conventions first. If commands are missing, inspect package files, build configs, CI configs, or docs to infer the right verification path.

## Upstream Inspiration

The perspective-shifting techniques are adapted from Ethan Kreloff's `adversarial-reviewer` in [alirezarezvani/claude-skills](https://github.com/alirezarezvani/claude-skills/blob/aa8d778811a557a2c28ccadda4cf3d0bd028a4cc/engineering-team/skills/adversarial-reviewer/SKILL.md), reviewed at commit `aa8d778811a557a2c28ccadda4cf3d0bd028a4cc` under the MIT License. This adaptation deliberately removes mandatory findings and vote-based severity promotion.
