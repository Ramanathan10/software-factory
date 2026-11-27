# BAA-1: The before-and-after card offers the spec's choice first

Branch `story/baa-1-comparison-card-follows-spec`, worktree `C:/repos/software-factory-worktrees/story/baa-1-comparison-card-follows-spec`, base `cb0ffc5` (origin/main).

## Problem

When review hands off, the story enters `comparison-choice` and the Command Center at once shows "Capture before-and-after evidence for <title>?" with "Capture it" as the primary button (`command-center/ui/app.js:621-631`). It reads nothing from the plan, spec or profile. Jarvis records the approved spec's choice itself (`skills/jarvis/SKILL.md:75`), but only on its next turn, so the card offers the opposite of a spec that said no during that gap. RETRO-2: review handoff 4276 at 05:23:00Z, a click on "Capture it" at 05:23:20Z (4277), Jarvis woken after (4278) and had to ask the owner to undo it.

The store holds no structured field for the spec's before-and-after choice: only free Markdown in `story.plan` and the committed spec, and `story.comparisonRequested`, which only the `comparison-choice` event sets (`mission-console/store.mjs:177-184`, `389-394`). Answers to the planning question vary in id and option order across stories, so the dashboard cannot read the choice reliably. This story therefore stops the wrong click; it does not show the spec's choice. That needs a store field, filed as its own issue.

## Settled decisions

1. While Jarvis holds a `comparison-choice` story (`jarvisHold(story)` in `command-center/ui/jarvis.js` returns `waiting` or `checking`), the dashboard does not offer the choice: no card, and the story is not waiting on the owner. (`baa1-hold`)
2. No store field in this story. File a GitHub issue for a structured before-and-after field on the `plan` event, to take up after PRURL-1 merges. (`baa1-store-field`)
3. When the card shows, neither button is primary. Title: "Before-and-after for <title>: capture it or skip?". Hint: "Jarvis records the approved spec's choice itself. Answer here only if the spec left it open." The baseline screenshot picker stays. (`baa1-fallback`)
4. The older Mission Console UI (`mission-console/console.mjs`, `index.html`) is out of scope. (`baa1-old-ui`)
5. Before and after: screenshots (below). (`baa1-before-after`)
6. Architecture diagram: none. (`baa1-diagram`)
7. Test level: `command-center/card.test.mjs` only; no e2e scenario. (`baa1-test-level`)

## Acceptance criteria

1. A `comparison-choice` story with `waitingOnJarvis` set and no Jarvis turn shows no comparison card in the inbox and no "Waiting on you" row; it is not counted in the "Waiting on you" stat or the tab title, and raises no desktop notification.
2. The same holds for a `comparison-choice` story with a running Jarvis turn (`jarvis.turn` or `jarvis.waking`).
3. A held `comparison-choice` story with no worker and no blocker shows Jarvis as its owner on the board (`data-role` coordinator, "Waiting on Jarvis ..." or "Jarvis is checking"), like any other story Jarvis holds.
4. A `comparison-choice` story with no hold shows the card, counts as waiting on the owner, and raises the notification when it first appears, including when a hold ends.
5. The shown card has the title "Before-and-after for <title>: capture it or skip?", the hint "Jarvis records the approved spec's choice itself. Answer here only if the spec left it open.", the baseline screenshot picker, and two buttons, "Capture it" (sends `comparison-choice` with `run: true`) and "Skip" (`run: false`), neither with the `primary` class.
6. The inbox follows the hold without any other change to the story: a held story whose hold clears (phase, questions and plan unchanged) gains the card and its "Waiting on you" row on the next render, and a shown card disappears on the next render once a hold begins.
7. A `comparison-choice` story with an open question (for example a failed Jarvis turn's `action-jarvis-<seq>`) is waiting on the owner as today.
8. The OWN-1 test in `card.test.mjs` ("an assigned worker, an open question, a blocker, approval and comparison-choice keep their owner while Jarvis checks or is waited on") drops its comparison-choice case (KEEP-6) and its title says so; criterion 3 replaces it.
9. `command-center/no-html.test.mjs`, `command-center/ui-lint.test.mjs` and the full `node --test` pass; no source comment is added; no file outside `command-center/ui/app.js` and `command-center/card.test.mjs` changes, apart from this spec.
10. A GitHub issue exists for the structured before-and-after field, naming the `plan` event, `mission-console/store.mjs`, the lifecycle model, the files that restate `plan`, and the dependency on PRURL-1, and the PR description links it.

## Design

In `command-center/ui/app.js`:

- `waitingOnYou`: `comparison-choice` counts only when `!jarvisHold(story)`. Because `jarvisHolds`, `ownerOf`, `isBusy`, `belongsTo`, `renderStats` (stat, tab title, notification) and the board words all read `waitingOnYou`, they follow without further change.
- `renderDecisions`: build the comparison card only when the story is waiting on the owner in that phase (the same test as `waitingOnYou` minus questions), with the new title and hint and no `primary` class on either button.
- `render`: add each story's `waitingOnYou` result to `decisionKey` (`app.js:804`), which today holds only id, phase, open question ids, plan and draft plan, so the inbox re-renders when a hold starts or ends.

No change to `command-center/serve.mjs`, `coordinator.mjs`, the store, the skills or the docs. No doc describes the card's buttons; `mission-console/README.md:91` stays true.

## Limits (facts)

- Stories whose harness is not command-line get no hold (`coordinator.mjs:63-64`) and see the card at once; criterion 5 covers them.
- A failed or lost Jarvis turn posts an `action-jarvis-<seq>` question, which ends the hold (`coordinator.mjs:66`), so the card cannot stay hidden indefinitely.
- During a worker start (`busy`, `serve.mjs:224`) the coordinator reports no news; no worker starts in `comparison-choice`.

## Test plan

`command-center/card.test.mjs`, under its fake DOM, red before the change: criteria 1-8. Focused: `node --test command-center/card.test.mjs command-center/no-html.test.mjs command-center/ui-lint.test.mjs`. Full: `node --test`. Secrets: `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation is skipped by the profile.

## Before and after

Screenshots of the board and the inbox on a throwaway Command Center started from a script on its own port and temp database, with `start({ launch })` stubbed and a long `quietMs` so no real Jarvis wakes; never the live Command Center. Three stories in `comparison-choice`: Jarvis waiting, Jarvis checking, and no hold. Before reference: origin/main `cb0ffc5`, captured right after approval.

## Out of scope

- A structured store field and showing the spec's choice as primary (the issue in criterion 10).
- The older Mission Console UI.
- The Low review findings follow-up (ai-sdlc Publishing step 4, `mission-console/README.md` lines 32 and 149): a separate story.

## Plan critique

Codex (OpenAI) was at its usage limit and GPT-5.6 Sol through cursor-agent was out of credit, so one other provider reviewed the plan: Grok 4.7 (xAI). Its one finding, confirmed in the code and fixed above: the inbox renders only when `decisionKey` changes, and that key omits Jarvis state, so a hold that ended would leave the fallback card missing (criterion 6, the `render` line in Design).

## Coordination

QFMT-1 edits `questionBlock` in the same file. Merge main before publishing.

## Context pack

See `C:\Users\trojanmini\.ai-sdlc\stories\BAA-1\context-pack.md` (registered on the story); its findings are restated in Problem and Limits above.
