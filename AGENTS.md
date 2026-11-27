# Software Factory

This repository holds the software factory: the lifecycle skills under `skills/` and the Command Center application. An agent working here is doing one of two things: setting the factory up for the person in the chat, or changing the factory itself.

## Setting the factory up for someone

Follow this when the person asks to install, set up, or try the factory, or says "Be Jarvis" in this checkout before the skills are installed. A harness finds the skills only after they are installed, so nothing under `skills/` is in use yet.

1. From the root of this checkout, run `node install.mjs`. It needs Node 22 or newer and installs no packages.
2. Tell the person what it printed, harness by harness. Three results need them:
   - "No supported harness was found": ask which harness they use, then run it again with that name, for example `node install.mjs claude-code`.
   - "blocked": a skill of the same name is already in their harness. `node install.mjs --replace` moves theirs aside into the harness's `ai-sdlc-backups` folder and deletes nothing; ask before running it.
   - "Story sessions will not start": pass on the fix it names.
3. Stop there. This chat loaded its skills before the install, so it cannot run a story. Tell the person to restart the harness, open a chat in the repository they want work done in, which must have an `origin` remote, and say "Be Jarvis. Run AI SDLC." The first run asks the setup questions once.

`node install.mjs --check` reports what is installed without changing anything.

## Changing the factory

- The repository is meant to be shared, so keep it free of personal skills and of real work details such as organization, people, or repository names.
- Skills say "the owner" for the person running the session; never name a person in a skill.
- Run `node --test` before committing. Keep the application free of package dependencies unless a story adds them deliberately.
- A change to how decisions reach a worker or how worker turns start is checked by the delivery model; `.claude/skills/verify-decision-delivery/SKILL.md` says how.
- A change to how workers start, how decisions reach them, or how Jarvis is woken is also tried end to end: `node e2e/run.mjs` runs each scenario under `e2e/scenarios/` against a throwaway Command Center with scripted workers and a scripted Jarvis. It uses no model, and the Tests workflow runs it on every pull request.
- A bug found in a live story gets a scenario there that fails without the fix; `e2e/README.md` says how to write one. A bug that only a model's choices show is fixed in the skill that misled it; it gets no scenario.
- Keep the story store and Command Center harness-neutral. Anything specific to one agent harness belongs under `adapters/`. Every harness is one row in `adapters/harnesses.mjs`, installed by `install.mjs` and described once in the factory runbook; only code a harness must load itself goes in `adapters/<harness>/`.
- When the `ai-sdlc` phases change, update the store's transitions and the Jarvis phase table in the same change. A phase's dashboard lanes are part of its entry in `mission-console/roles.mjs`.
- A change to `mission-console/store.mjs`, the phases in `roles.mjs`, or the Jarvis phase table is checked by the lifecycle model; `.claude/skills/verify-story-lifecycle/SKILL.md` says how to read its failures.
- A change to how a phase ends is traced through the story worker, chat Jarvis and background Jarvis on each harness, and every file that restates it changes together: `skills/ai-sdlc/SKILL.md`, `skills/jarvis/SKILL.md`, `skills/jarvis/RUNBOOK.md`, `skills/jarvis/BACKGROUND.md`, `mission-console/README.md`, `e2e/README.md` and `.claude/skills/verify-story-lifecycle/SKILL.md`.
- Keep imported third-party skills self-contained. Vet an exact upstream revision before importing or updating one, and preserve its source and license.
- Profiles and story databases hold names and settings only. Never commit a profile or a database.
- `private-details.test.mjs` checks both of the sharing rules above: no owner's name, nickname or `PRIVATE_WORDS` entry in a tracked file, and no profile or database.
- Source files carry no comments: `comment-ratchet.mjs` holds each file to its count in `comment-ratchet.json`, and `node --test` fails if one goes up. Put a reason the code cannot show in an ADR under `docs/adr/`, and sweep the remaining comments with `/delete-comment`.
