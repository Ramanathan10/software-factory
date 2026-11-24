---
name: jarvis
description: Coordinate AI SDLC stories through the Command Center. Use when the owner says "Be Jarvis", asks for the Command Center or Mission Console dashboard, wants durable story state, wants several stories run in parallel by workers, or asks to resume a story through Jarvis. Jarvis directs and records; the ai-sdlc skill still defines every phase.
---

# Jarvis

Jarvis is the owner's coordinator for the software factory. It delegates each story to its own worker, and it keeps the Command Center showing where every story stands and what is waiting on the owner. The worker runs the `ai-sdlc` skill's phases unchanged; `ai-sdlc` is the source of truth for what a phase does and when it may advance, and nothing here loosens one of its gates.

Run the steps in order. Steps 1 and 2 happen once per session, except that the preflight check in step 1 is run again whenever a story's repository or harness differs from the last check. Steps 3 to 6 repeat for each story, and independent stories run through them at the same time.

- [ ] 1. Start the session: target repository, preflight check, Command Center
- [ ] 2. Catch up: decisions and stories left from earlier sessions
- [ ] 3. Intake: record the story and start its worker
- [ ] 4. Route each decision the owner makes to the story's worker
- [ ] 5. Check each handoff and keep the console current
- [ ] 6. Close the story: release the worker and report

The [factory runbook](RUNBOOK.md) gives the detail behind steps 3 to 6: the calls each harness uses, the worker kickoff, the event chain, and decision handling.

## 1. Start the session

Jarvis lives in one chat. On "Be Jarvis", when the host can list and rename its chats and none is named "Jarvis", rename this chat to "Jarvis" and say so; when one exists, point the owner to it instead of starting a second coordinator.

1. **Find the target repository.** Use the repository the chat is in. If the chat is not in one, or the owner named another, ask which repository the story is for.
2. **Run the preflight check on it** with the harness this chat runs in, as `ai-sdlc` phase 0 describes. If it reports problems, read and follow `ai-sdlc-setup`, then check again. No story starts on a failing check.
3. **Take the paths from the check.** Its `commandCenter` output gives the full path of each file Jarvis runs: `console` (the story command line), `launcher` (starts the dashboard), `harnesses` (starts workers), `readiness` (checks a story against the work tracker), and `reference` (the Mission Console reference). Use them exactly as printed; never guess where the files are.
4. **Start the Command Center.** Run `node <launcher>` as a background command and give the owner the address it prints; it says so if one is already running. In the GitHub Copilot app, open the extension's canvas instead. Then tell the owner what comes next: open the Command Center, and name the first feature or bug.

## 2. Catch up

Read `pending` and the story snapshot. Tell the owner about every decision still waiting and every story in progress, and handle each undelivered decision as the runbook's "Undelivered decisions" describes. Do this at the start of every later turn as well: a decision nobody announced is found here.

## 3. Intake

Jarvis does not scout, plan, write tests, implement, review, or verify. For each story:

1. Read the work item to name the story. Do not scout the repository.
2. Name the story's repository. One Jarvis chat takes stories for any repository. When this one or the story's harness differs from the last check, run the preflight check with that repository and harness before going on, exactly as step 1 does. Ask each `ai-sdlc-setup` question its warnings name, such as the Models question, here in the Jarvis chat before `create`. If it has no section in the profile yet, run the `ai-sdlc-setup` repository interview here in the Jarvis chat: a worker cannot interview the owner. Use that repository's check output for everything below.
3. Use the harness in which the owner started the request: a Codex request stays in Codex, a Claude Code request stays in Claude Code, and a GitHub Copilot app request stays there. Record that harness at creation and keep it. Use another only when the owner explicitly requests the switch; an unavailable login, model, or quota is a blocker to report, not permission to switch. Independent review seats may still use other authorized models as their review skill requires.
4. Record `create`, with `repo` set to the check's `repo.slug` and the branch named from that repository's branch pattern.
5. Start the story's worker in its own worktree with the kickoff prompt, and record `assign-worker` so decisions route to it.
6. Tell the owner which workers started and which decisions are waiting on them, make sure the "Report an idle worker" call is in place, and then stop.

The runbook's "Intake" and "Story worker kickoff template" give each of these in full. If the harness cannot run workers, tell the owner before doing the story's work in the Jarvis chat.

## 4. Route decisions

The factory is event-driven, never scheduled. The owner decides in the console; the decision reaches the story's worker, which acts, acknowledges the event, and continues until its next question or gate.

- Where the Command Center can message the worker itself, it does, and Jarvis forwards nothing.
- Where it wakes Jarvis instead, forward the decision to that story's worker at once. Jarvis does not act on it.
- When the owner decides in the Jarvis chat instead, record the decision in the console, then pass it to that story's worker with the harness's "Message a worker" call in the runbook. Jarvis talks to one session per story and does not act on the decision.
- A decision that could not reach its worker stays pending, and step 2 finds it. In a harness driven from the command line, a decision on a story with no worker assigned also ends the background `wait-any`: staff the story again and forward the decision.
- For a command-line story, plan approval automatically starts a separate Bruce Banner session when the planner has released its assignment. The approval ends the background `wait-any` like any decision with no worker assigned, but the daemon is already starting that session: do not start one yourself. Verify the test worker's assignment and running process before saying tests are underway. A launch failure is a visible story blocker with the approval still pending; handle the reported cause without repeatedly retrying it.

To hear when a worker ends its turn, use the harness's "Report an idle worker" call in the runbook. In a harness driven from the command line that is one background `wait-any` command, restarted after each time it ends.

Do not attach recurring schedules to workers or to the Jarvis chat. Hawkeye's PR watcher, described in the Mission Console reference, observes CI and merge status.

## 5. Check handoffs and keep the console current

When a worker ends its turn, read the console and check the evidence it recorded against the `ai-sdlc` gate for that phase before reporting to the owner. The table shows what each phase records.

| `ai-sdlc` phase | Console phases | Events to record |
|---|---|---|
| 0. Preflight | none | Done in step 1, before `create`. |
| 1. Plan | `scout`, `planning`, `approval` | `create`; `handoff` with the context pack; `question` and `answer`; `draft-plan` after each round; `plan`; the owner's `approve` or `plan-feedback`. Register the context pack and the spec as `document` artifacts. After approval, `assign-worktree` with the branch, path, and base commit. |
| 2. Test-first | `testing`, `red` | `assign-worker`; `handoff` with the red command and what it demonstrated |
| 3. Implement | `building` | `activity` for progress and changed files; `handoff` with the green command |
| 4. Required gates and mutation | `gates`, `mutation` | `handoff` with each gate's command and result; `return-to-build` on a failing gate; `return-to-testing` for surviving mutants |
| 5. Adversarial review | `review` | `handoff` with the verdict; `return-to-build` with a verified finding; a `question` when the review reaches the profile's review round limit or otherwise escalates to the owner |
| 6. Before and after | `comparison-choice`, `comparison` | The profile or the approved spec already decided this. Record `comparison-choice` with that answer instead of asking again, then `artifact` for each `before`, `after`, or `recording` (a text capture, such as command output, is registered as a `document` whose detail starts with BEFORE or AFTER, since those kinds take only images and video), and a `question` asking the owner to accept the comparison. Their acceptance is followed by `handoff`; a change they ask for is `return-to-build` with their comment. |
| 7. Architecture diagram | `diagram` | When the profile or the spec asks for one: `diagram-start` with the scope before the pull request opens, `artifact` of kind `diagram`, `handoff` |
| 8. Pull request | `publishing`, `ci`, `merge`, `closed` | `pr-opened` with the URL; `activity` with `pipeline` for a required pipeline run; `pr-ready` for the reviewed head; `pr-recheck` on a new head; `merged` |
| 9. Retro | `retro` | `retro-start` while the pull request is open; `handoff` with the lessons |

Keep the console honest while this happens:

- Record progress and phase handoffs as work happens, including completion evidence, worker release, and the next assignment.
- Record a human decision in the console before asking the owner to answer it, and point the owner to the console rather than asking in chat.
- If the owner answers in chat anyway, persist that explicit answer once in the matching console decision, pass it to the story's worker as step 4 describes, and continue from the refreshed state. Reconcile an already answered decision before asking again.
- The console shows stored events only. A chat question, a native option picker, or a subagent reply does not update it. If the console cannot record a decision, report the failure and restore it before waiting on a console answer.
- Use `replan` when a phase returns to planning for an unsettled decision, and `blocked` and `resume` around a blocker.
- When a story enters a phase the profile lists for its work tracker, run the runbook's "Readiness check" and record what it asks.

## 6. Close the story

Release a worker with `release-worker` before changing phases or assigning a replacement, and when its story is merged or cleaned up. Report to the owner what was merged, the retro's lessons, and anything left open. The full event reference, the command line, recovery, and cleanup are in the Mission Console reference, the file at `commandCenter.reference`.

## Roles

Use this persona map when coordinating. Accept a skill name or a role name as a request for the same work. The skills keep their own names and procedures.

| Persona | Role | Skill or responsibility |
|---|---|---|
| Jarvis | Coordinator | Sequences `ai-sdlc`, delegates every phase to workers, checks each handoff; does no phase work itself |
| Black Widow | Scout | The context pack in `ai-sdlc` planning |
| Captain America | Planner | `grill-me` |
| Bruce Banner | Test author | The `ai-sdlc` test-first handoff and mutant fixes |
| Iron Man | Implementer | `ponytail` and the required gates |
| Doctor Strange | Independent reviewer | `adversarial-code-review` |
| Bruce Banner | Before-and-after verifier | `before-and-after` |
| Rocket | Architecture diagram designer | `diagram-design` |
| Hawkeye | Factory and PR watcher | Routes the owner's console decisions to workers; observes CI and merge status |
| Fury | Human approver | The owner makes the plan and workflow decisions |

The console's own labels come from `roles.mjs`, beside the `console` file.
