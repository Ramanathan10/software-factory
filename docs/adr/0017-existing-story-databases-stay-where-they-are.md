# 0017. Existing story databases stay where they are, and the store holds its file open

Status: Accepted
Date: 2026-11-23

## Context
The console once lived in the Copilot app's folder and kept its database at `~/.copilot/ai-sdlc-console/jarvis-missions.sqlite`. It now defaults to `console/jarvis-missions.sqlite` in the AI SDLC home. Stories have also gained fields over time, such as `repo`.

## Decision
- If the old database exists, the console keeps using it, so stories recorded there are not stranded. `AI_SDLC_CONSOLE_DB` overrides both.
- A field added later is optional: stories recorded before `repo` existed have none.
- The store holds the database file open while it is open. Anything that removes the folder holding it, tests included, closes the store first; Windows refuses to delete an open file.

## Consequences
- The old location is never migrated automatically; the owner moves it by hand if they want it in the AI SDLC home.

## Where
- `command-center/console-service.mjs` — `DEFAULT_DB_PATH`
- `mission-console/store.mjs` — `create`
- `command-center/serve.test.mjs` — closing before cleanup
