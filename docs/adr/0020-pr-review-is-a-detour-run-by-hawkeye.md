# 0020. PR review is a detour phase run by Hawkeye

Status: Accepted
Date: 2026-11-25

## Context
Hawkeye recorded a pull request's head, its checks and whether it merged, but never its reviews. Review comments from people or bots reached a story only when someone went to look, and a story could show "PR ready to merge" while comments were still open. The owner wants each incoming comment summarized with the worker's proposed resolution and reasoning, and put to them as a decision in the Command Center, as Grill Me does.

## Decision
- `pr-review` is a detour phase, like `diagram` and `retro`. `pr-review-start` enters it from `ci` or `merge` while the pull request is open, and its `handoff` always returns to `ci`, because a fix pushes a new head whose checks must run again. `return-to-build` and `merged` are accepted there; `retro-start` is not. It has its own "PR review" lane after Ship.
- Hawkeye (role `watcher`) runs the phase, on the `standard` tier.
- The poller stays read-only on GitHub: `gh pr view` and one `gh api graphql` query per poll. Only the `pr-review` worker writes to GitHub, and only after the owner's decision.
- `summarizeReview` reduces the query to one `review` object used for the wake, the board and the ready gate alike. A thread's key is its id plus its last comment id, so a reply in an existing thread is new feedback. Up to 10 items travel with the wake as evidence; the full key list is kept so a hidden item surfacing never looks new.
- The worker records the node id of each comment it posts (`activity` with `posted`, kept as `prPosted`, newest 500). Hawkeye skips those ids, and a thread whose last comment is one of them. The owner's own GitHub comments still count, though the factory replies with the same login.
- A key the story has not seen (`prSeen`) wakes Jarvis, marked `feedback: true` on the event so the coordinator counts it as news while a `ci` worker is assigned between turns. The check part of an observation wakes as before, and only when the check fields changed, so a review-only change on a passed PR does not wake through the old "previous status was passed" rule.
- During `pr-review` the review part is recorded but never wakes: the worker reads GitHub again before its handoff, and its own replies must not wake Jarvis. Keys seen there join `prSeen`. A merge or a check change observed there is still recorded as pending news; as in `ci`, Jarvis reads it once the worker's turn needs a look or the worker hands off.
- `pr-ready` is refused while the observed head has changes requested or unresolved threads. Outdated threads and change requests made on an earlier head are shown on the card but do not block, as the owner decided; GitHub may still refuse the merge until that reviewer reviews again.
- A card in `ci` or `merge` says "No review activity for …" once the last review activity is more than 24 hours old. The flag does not wake Jarvis.

## Consequences
- Review feedback reaches the owner as one question per thread or comment, with the worker's proposal recommended.
- Each review wake costs one Jarvis turn and one Hawkeye worker turn.
- The observation fetches the first 100 threads and the last 100 reviews and comments, and says when more exist; it does not page further.

## Where
- `mission-console/watcher.mjs` — `summarizeReview`, `readGitHubPr`, `watchOnce`
- `mission-console/store.mjs` — `reviewOf`, `observePr`, `pr-review-start`, the `pr-review` handoff, the `pr-ready` gate, `posted`
- `mission-console/roles.mjs` — the `pr-review` phase, Hawkeye's skills, `phaseTiers`
- `command-center/coordinator.mjs` — `needs`
- `command-center/ui/app.js` — `reviewState`, `idleReasons`
- `skills/ai-sdlc/SKILL.md` — "PR review" in phase 8
