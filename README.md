# Software Factory

Applications that run the AI software development lifecycle. The lifecycle itself is the `ai-sdlc` skill in the [agent-skills](https://github.com/Ramanathan10/agent-skills) repository; this repository holds the tooling that drives and observes it, so the skill stays free of application code.

## Contents

- [`mission-console/`](mission-console/README.md) - local dashboard and SQLite story store for AI SDLC runs, with a GitHub PR watcher. Moved from `agent-skills/skills/ai-sdlc/scripts/mission-console` with its history.

## Known gap

Mission Console's phase list (`mission-console/roles.mjs`) still follows the earlier seven-phase skill. The current `ai-sdlc` skill settles the before-and-after choice during planning, commits a spec, adds deterministic gates and Stryker mutation testing, draws the diagram before the pull request, and ends with a retro. Update the console's phases and events to match before using it for new stories.

## Test

```powershell
node --test mission-console/store.test.mjs
```
