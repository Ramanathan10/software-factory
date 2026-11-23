# 0011. Badges, role colours and notifications show state without relying on motion or a second look

Status: Accepted
Date: 2026-11-23

## Context
The Command Center is watched at a glance. Amber means a decision waits on the owner, red blocked, green done. Each crew member has a badge that moves while it works, but some people turn motion off, and a role colour close to a state colour reads as that state: the watcher's yellow sat 3.9 apart from the amber of "waiting on you" in OKLab (x100), so a busy watcher glowed like a decision.

## Decision
- A role's badge in `roles.mjs` gives `fill`, `accent` and `ink` (the persona's palette), `ring` (the accent ring's style), `glyph` (a 24x24 stroke drawing of the job) and `move` (the part of the glyph that plays `motion` while the agent works). `badge.js` gives the moving part the class `k-<motion>`, and `app.css` has one rule per ring style and per motion and animates them only while the avatar is `moving`. Only full-size badges move. `badge.test.mjs` fails when a badge names a ring style or motion with no rule, because a missing rule draws a plain ring or a still glyph and nothing else fails.
- The badge's outer ring is left to the dashboard, which shows state with it so it reads the same with motion off: dashed when idle, grey when queued, bright while working, amber while a decision waits. The owner is never busy, so the owner's badge has no motion; their ring and pill glow a steady amber instead. A busy card or Track row says so at its edge: its border takes the role colour and a short streak of that colour runs around it, one lap every 3 seconds, while the inside stays still. An earlier light sweep across the whole card was replaced because six at once drew the eye away from the cards that changed. With motion turned off the streak is hidden and the coloured border remains.
- Each role's colour comes from its persona's badge, and the two roles one persona plays share a colour. No role colour may be within 8 of amber, red or green in OKLab (x100), which is plainly visible on a border, and each must reach 4.5:1 contrast on both `--panel` (tracks) and `--panel-2` (story cards), since both draw story ids in the role colour. `badge.test.mjs` checks both.
- While the owner types their own answer, the amber border belongs to the text box alone, so the recommended option loses its amber.
- Busy state is bucketed by time, so "is working" fades without a new event.
- The owner is told once about each thing that starts waiting on them, even when the tab is in the background. Nothing counts as new on the first frame, so opening the page announces nothing, and a new question on a story that was already waiting counts as a new thing. The tab title starts with the number of stories waiting. Browsers allow asking for notification permission only from a click, so a button is offered until the permission is answered.

## Consequences
- A new role needs a colour that passes both checks, which narrows the palette.
- A new ring style or motion needs a rule in `app.css` in the same change.

## Where
- `mission-console/roles.mjs` — `roles` badges
- `command-center/ui/badge.js`, `command-center/ui/app.css` (role colours, `.avatar::after`, badge rules, `.question:has(...)`)
- `command-center/ui/app.js` — `avatar`, `announce`, `render`, the notification button
- `command-center/ui/attention.js` — `newlyWaiting`, `titleFor`
- `command-center/badge.test.mjs`
