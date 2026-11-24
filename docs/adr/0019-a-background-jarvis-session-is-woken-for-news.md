# 0019. A background Jarvis session is woken for news

Status: Accepted
Date: 2026-11-24
Supersedes: the wake mechanism of [0012](0012-jarvis-is-woken-only-for-news.md)

## Context
When a worker releases its assignment, hands off, or ends a turn that needs a look, the next step waits on Jarvis. Jarvis was a chat, and only a background `wait-any` brought it back. Claude Code returns to the chat when that command ends; Codex does not, so a Codex story sat with no worker until the owner typed. The board said "Idle", which did not tell the owner anything was waiting.

## Decision
- The daemon wakes one background Jarvis session per story, in the story's harness and worktree, through the same `startWorker` and `messageWorker` calls workers use (ADR 0004), one turn at a time (ADR 0002). Its phase is `coordinator`, so its model comes from the coordinator tier, `standard` unless the profile moves it.
- A command-line story is woken when it has pending news, it has been quiet for ten seconds, and some news has a seq above the highest seq the previous Jarvis turn was given (`story.jarvis.handled`). News is what `wait-any` reports today, minus `create`, minus a plan approval (the daemon starts the test author for it, ADR 0018), minus a "Hold" answer to a Jarvis failure. With a worker assigned, only a `turn-ended` that needs attention counts, and only between the worker's turns. A story is not woken while it is closed, while a worker start or a Jarvis turn is in flight for it, or while a Jarvis failure question is open.
- The seq rule is what bounds the loop: news recorded during a turn gets exactly one follow-up turn, and news a finished turn saw but left unacknowledged does not wake it again.
- The background Jarvis's program runs with `AI_SDLC_ACTOR=jarvis`. `jarvis.mjs record` copies that onto each event as `by: "jarvis"`, and the store keeps such events out of pending. So Jarvis never wakes itself, without relying on the model to mark its writes. The Jarvis skill tells the owner's chat to add `by` too, so its own `create` or question does not race it. Workers the background Jarvis starts are spawned by the daemon, so they do not inherit the marker.
- The store records `jarvis-woken` before the launch, then `jarvis-turn-started` and `jarvis-turn-ended`, on `story.jarvis`, apart from `story.worker`. They change no phase, are not news, are accepted on a blocked story or one awaiting cleanup, and refuse a second running turn. `supervisor.idle` and the supervisor's count of what a worker recorded ignore them, so a Jarvis turn that starts the next worker cannot wait on itself, and Jarvis's writes cannot hide a silent worker turn.
- A failed or lost Jarvis turn is not retried. The daemon records an `action-jarvis-<seq>` question in plain words, from the harness row's `explain` when it recognises the log (usage limit, lapsed sign-in), otherwise the last log line and the log path. "Done" gives one new turn; "Hold" gives none, and the daemon acknowledges it itself. That question is accepted on a blocked story or one awaiting cleanup, so it can always be shown.
- The plain-words reason is read from the log's last line only: earlier lines hold tool output and the instructions Jarvis read, which can mention a usage limit without being one.
- An answer to an `action-jarvis-` question goes to the coordinator even when the story has a worker, and it wakes Jarvis even when no worker `turn-ended` is pending. The turn after a failed or lost one starts a fresh session, so a session that cannot be resumed is not retried on every Done.
- A restart that finds `jarvis-woken` with no turn after it records the turn as lost, as ADR 0018 does for an interrupted start. A turn an earlier daemon left running is adopted. Once its process is gone, it is recorded as ended when Jarvis recorded something of its own (`by: "jarvis"`) after the turn started, and as lost otherwise, as the supervisor does for a silent worker turn. A turn whose only work was an `ack` or a worker start leaves no such event, so after a restart it is reported as lost and the owner is asked: a false question is preferred to a failure that goes unreported.
- Stories that predate this change have no `story.jarvis`, so their whole pending backlog counts as news on the first start. The runbook asks the owner to acknowledge already-handled events before that start, rather than the coordinator ignoring news it has never seen.
- The owner's chat keeps its powers but no longer runs a background `wait-any` in command-line harnesses; it catches up from the console feed at the start of each turn. The GitHub Copilot app keeps its in-app wake, and Cursor has no workers.

## Consequences
- In Codex and Claude Code the next role is staffed within the quiet period plus one Jarvis turn, with no chat open.
- Each wake costs one model turn on the coordinator tier. Batching and the seq rule keep that to one turn per burst of news.
- `wait-any` stays as a command, for a harness or a person that wants to watch the store.
- The owner's chat and the background Jarvis can both try to staff a story; the daemon's one in-flight start per story and the store's refusal of a second worker keep that to one worker.

## Where
- `command-center/coordinator.mjs` — `needs`, `unhandled`, `wake`, `finish`, `reconcile`, `ask`
- `command-center/serve.mjs` — `jarvisKickoff`, the coordinator in `start`, `onDecision`
- `mission-console/store.mjs` — `jarvis-woken`, `jarvis-turn-started`, `jarvis-turn-ended`, `by`, `jarvisNotice`
- `mission-console/jarvis.mjs` — `AI_SDLC_ACTOR` in `record`
- `adapters/harnesses.mjs` — `explain`, `environment`
- `command-center/supervisor.mjs` — `recordedSince`
- `command-center/ui/jarvis.js` — `jarvisStatus`
- `skills/jarvis/BACKGROUND.md`
