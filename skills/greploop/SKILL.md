---
name: greploop
description: Iterate on Greptile feedback for a GitHub pull request, with at most five current-head review cycles. Use after opening a PR for the owner or when they ask to address Greptile findings. Requires Greptile to be configured for that repository.
---

# GrepLoop

Use the current task's PR and branch. Read the PR head SHA, checks, complete Greptile review summary, and all unresolved Greptile threads before changing code. Treat a read-only review request as read-only; it does not authorize commits, comments, or thread resolution. For a PR just opened for the owner, their standing instruction authorizes review-driven fixes on that PR branch within this skill's limits.

Greptile runs as a CI check. After the PR opens or a commit is pushed, wait for the Greptile check **on the current head SHA** and read its completed review. Do not post `@greptile review` because a check has not appeared, and do not act on feedback from an older head. If the check never appears, stalls, or Greptile is not configured, stop and report that limitation. Do not install or authorize a GitHub app or recreate the PR.

For each cycle:

1. Confirm the target PR, head SHA, working tree, and remaining cycle budget. The maximum is **five review cycles**, including attempts that produce no code changes.
2. Read the complete current-head review, including summary comments and every page of unresolved threads. A green check or 5/5 score is not proof that all findings are resolved.
3. Verify each finding against the surrounding code and tests. Fix only valid issues within the owner's task. Leave out-of-scope findings open and report them; do not change correct code merely to raise a score.
4. Run relevant checks. Stage only the files for the fix, commit, and push. Do not use `git add -A` in a dirty checkout.
5. For each addressed Greptile thread, reply **in that thread** with what changed and how it was verified. Confirm the reply posted, then resolve that thread. Leave unaddressed threads open. If the bot auto-resolves a thread, add the explanation when possible and report that it was auto-resolved.
6. Recheck the head SHA. If it changed and the budget allows, wait for the new current-head Greptile check before another cycle.

Stop at five cycles, an unavailable integration, a stalled review, or a finding needing a new scope decision. Report the PR URL, reviewed SHA, cycles used, checks, addressed and remaining findings. Never merge automatically or treat a score as a substitute for tests and judgment.

## Source

Adapted for a GitHub CI workflow from [michaelshimeles/skills/greploop](https://github.com/michaelshimeles/skills/tree/11b15767d7587bab11f6c4957507b5f26d1785c7/greploop), itself based on Greptile's skill. This edition omits GitLab, Perforce, and the upstream manual trigger helper. MIT license: [LICENSE](LICENSE).
