---
name: self-improvement
description: Capture reusable corrections, diagnosed failures, knowledge gaps, missing capabilities, and better workflows across any agent or tool. Use when a lesson could prevent a future mistake; review relevant prior lessons before repeating similar work. Skip routine errors and one-off observations.
---

# Self-Improvement

Turn verified experience into concise guidance that the next person or agent can find and use. The workflow is tool-agnostic: it does not require a particular model, IDE, hook, memory system, shell, or operating system.

## Decide whether to capture

Capture a lesson when it has a concrete future trigger and action, such as:

- The owner corrects an assumption or workflow in a way that applies beyond this turn.
- An unexpected command, API, UI, or integration failure required diagnosis and has a reusable cause or workaround.
- A documented behavior differs from the observed behavior and the difference is verified.
- A repeated task reveals a safer or simpler method, or a missing capability the owner explicitly wants tracked.

Do not log every non-zero exit, transient outage, suggestion, or unverified guess. Correct the immediate problem first when possible. If a task is read-only or the relevant workspace is outside its scope, describe the proposed learning in the response; do not create files or change another project merely to log it.

## Find the source of truth

1. Check the current project's instructions and existing learning store before writing. Search for the same cause, correction, or pattern key. Update or link a matching entry instead of creating a duplicate.
2. Use the project's established system if it has one. Otherwise, when a persistent log is in scope, use `.learnings/LEARNINGS.md` for corrections and practices, `.learnings/ERRORS.md` for diagnosed failures, and `.learnings/FEATURE_REQUESTS.md` for explicitly tracked capability requests. Create only the files needed for the actual lesson.
3. Keep the entry with the project or tool whose future work it should guide. Do not copy it to every agent's private memory or scatter the same rule across multiple instruction files. Follow any host-specific permission rules for managed memory.

## Write the smallest useful entry

Preserve an existing log's format. For a new `.learnings/` entry, use a stable ID such as `LRN-YYYYMMDD-001`, `ERR-YYYYMMDD-001`, or `FEAT-YYYYMMDD-001`, followed by:

- **Trigger and context:** What task or condition exposed the issue?
- **Evidence:** What was observed or verified? Separate facts from inference.
- **Action:** What should the next agent or developer do differently, and when?
- **Status:** Pending, resolved, promoted, or not pursued; include the reason when closing it.
- **Pointers:** Relevant file, command, issue, or related learning, without pasting large logs.

For a recurring issue, keep one stable pattern key and record recurrence only when another distinct task confirms it. Redact secrets, tokens, personal data, and private payloads. Do not put speculative workarounds into permanent guidance as facts.

## Promote and review

Promote a lesson when it is verified and likely to affect future work. Put the distilled rule where the next worker already looks: a relevant `AGENTS.md`, `CLAUDE.md`, project README, tool instructions, or another established guidance file. Choose the file for its actual audience; do not assume every tool reads the same file. Keep one canonical rule and link to it when needed. Mark the source entry as promoted or resolved and point to the destination.

At a natural breakpoint or before similar work, review only relevant prior entries. Close stale or resolved items, connect repeated failures, and turn a recurring mechanical fix into a test or automation when that is safer than another reminder. When a verified pattern deserves a reusable skill, propose or create one in the established canonical skill repository rather than scattering copied instructions. A learning log is a triage queue, not a substitute for fixing the system.

No hook, background job, inter-agent message, or skill extraction runs automatically. Configure a tool-specific adapter only when the owner requests it and the current tool's capabilities are verified. Existing optional examples in [hook setup](references/hooks-setup.md) and [OpenClaw integration](references/openclaw-integration.md) are not universal setup instructions.

## Provenance

This portable edition preserves the learning lifecycle from the earlier [pskoett self-improvement skill](https://github.com/pskoett/pskoett-ai-skills/tree/main/skills/self-improvement) and the owner's canonical adaptation. It removes the assumption that OpenClaw or Claude is the primary host.
