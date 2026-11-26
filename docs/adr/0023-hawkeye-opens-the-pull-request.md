# 0023. Hawkeye opens the pull request

Status: Accepted
Date: 2026-11-26

## Context
`publishing` had no worker. The background Jarvis may not push, so a finished story waited for the owner to open a Jarvis chat. Five stories stalled for hours, and twice the owner answered "Done" when the branch was never pushed.

## Decision
- `publishing` is a worker phase run by Hawkeye (`watcher`). Jarvis stays read-only; Hawkeye already owns the ship lane and pushes in PR review.
- The publisher merges `origin/main`, reruns the profile's gates, pushes, and opens the pull request, or pushes to the open one. Every exit is `release-worker` then the phase event, because the store refuses a phase change while a worker is assigned.
- `return-to-build` is accepted from `publishing`, for a merge conflict or a gate failure that also passes on unchanged `origin/main`. A gate that fails on `origin/main` too goes to the owner as a `question`, then `blocked`. After the answer the publisher records `resume` and continues.
- The publisher, not Jarvis, records `diagram-start` as its first step, since only it knows the merge has not run yet. Rocket's `handoff` returns the story to `publishing`. A diagram is drawn once per story.
- Whoever starts the publisher acks the pending `comparison-choice` first, so no decision reaches the publisher after it releases.

## Consequences
- A story already waiting in `publishing` needs no special handling: answering its open question wakes Jarvis, which starts the publisher.
- A conflict can send a story round build and publishing more than once; the build phase starts by merging and resolving.

## Where
- `mission-console/store.mjs`, `mission-console/roles.mjs`, `command-center/ui/app.js`
- `skills/ai-sdlc/SKILL.md` (Publishing), `skills/jarvis/SKILL.md`
