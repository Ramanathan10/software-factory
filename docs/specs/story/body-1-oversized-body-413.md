# BODY-1: An oversized request body resets the connection instead of returning 413

Work item: https://github.com/Ramanathan10/software-factory/issues/65. Branch `story/body-1-oversized-body-413`, base origin/main 17bdf35. Committed after approval as `docs/specs/story/body-1-oversized-body-413.md`, the branch's first commit.

## Context pack

- `command-center/console-service.mjs:47-56` `readBody(request, limit, message)` iterates `for await (const chunk of request)` and throws `InputError(message, 413)` once the running size passes `limit`.
- Callers in the same file: `readJson` (32 KiB; `/api/decision`, `/api/clear`, `/api/deliver`), `/api/worker/start` (1 MiB), `/api/attachment` (10 MiB).
- The request handler's `catch` (about line 216) sends `{ error: message }` with `error.status`.
- The dashboard (`command-center/ui/app.js`) shows `body.error` on a non-ok response; a reset shows as a network error.
- `InputError` is in `mission-console/store.mjs:27`.
- Rules (AGENTS.md): `node --test` before committing; no package dependencies; no source comments (comment ratchet); no personal or work details. DLV-1 and IDLE-1 change `hand`, `notify`, `deliverPending`, `onDecision` in the same file: do not touch them; merge main before publishing.
- Focused test: `node --test command-center/console-service.test.mjs`. Gates: `node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation testing is skipped for this repository.

## Problem and root cause

Issue #65: a decision slightly over the limit gets 413; a much larger one resets the connection and the dashboard shows a network error. Throwing inside `for await` calls the iterator's `return()`, which destroys the request and its socket while the client is still uploading. The 413 is written to a destroyed socket, and unread bytes make the OS send a TCP reset.

## Reproduction (unchanged 17bdf35, Node 24.18.0, Windows 11)

- Fresh connection per request: 200 KB `/api/decision` → 413 (5/5); 5 MB `/api/decision` → ECONNRESET (5/5); 50 MB `/api/attachment` → ECONNRESET (5/5).
- Keep-alive `http.Agent`: every size alternates 413 / ECONNRESET.
- Evidence: `C:/Users/trojanmini/.ai-sdlc/stories/BODY-1/repro-before.txt`, `repro-before-noagent.txt`.

## Fix

In `readBody` only: once the size passes the limit, drop the chunks already kept and discard every later chunk, but keep reading to the end of the body; then throw `InputError(message, 413)`. No cap on how much is discarded (the server listens on 127.0.0.1 only). No change to routes, limits, `hand`, `notify`, `deliverPending` or `onDecision`.

## Acceptance criteria

1. On a fresh connection, a 5 MB POST to `/api/decision` returns 413 with `{"error":"Decision exceeds 32 KiB."}`.
2. On a fresh connection, an 11 MiB POST to `/api/attachment` returns 413 with `{"error":"Screenshot exceeds 10 MiB."}`.
3. A 200 KB decision still returns 413 with the same message.
4. Over one keep-alive connection (`http.Agent`, `keepAlive: true`, `maxSockets: 1`), the request after an oversized POST reuses the socket and gets its normal response.
5. Bodies under the limit behave as before; `node --test` passes.

## Test level

Integration tests in `command-center/console-service.test.mjs` against `startServer(0)` and a temp database, written first by a separate subagent. Criteria 1-2 each use a fresh connection (`agent: false` or `Connection: close`). Criterion 4 uses `node:http` with a keep-alive agent and asserts `reusedSocket` and the second status; `fetch` reconnects silently and would pass on unchanged code. The test author shows red on unchanged code with exactly these clients. `/api/worker/start` shares `readBody` and is not tested separately.

## Out of scope

Other routes, limit values, the dashboard's error display, early `Content-Length` rejection, decision delivery. No e2e scenario (bug-audit find, not a live-story or delivery bug). No ADR: the regression test guards the reason.

## Settled decisions (owner answers in the console)

- Fix approach: read and discard the rest of the body, then return 413.
- Drain bound: all of it, no cap.
- Test plan: as above.
- Acceptance criteria and out-of-scope list: accepted as written.
- Before and after: command output from the reproduction script (5 MB decision, 50 MB attachment, 200 KB decision; fresh and keep-alive connections) against a throwaway Command Center on its own port and database. Before already captured on unchanged code; after is the same script on the fixed branch.
- Architecture diagram: none.

## Plan critique

One reviewer (Claude) on a neutral packet; the second provider (codex) failed on a usage limit, so not a cross-model panel. Its three findings (fetch hides criterion 4, reused connections hide criteria 1-2, kept chunks held during the drain) are folded into the criteria, test level and fix above.
