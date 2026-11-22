# Copilot adapter setup

The shared answers (owner name, cross-model sharing, shared resources, verification environment, and each repository's gates and required pipelines) come from the `ai-sdlc-setup` skill and live in the AI SDLC profiles. Run that skill first. This file covers only what the GitHub Copilot app adapter needs on top.

Run once per machine, when `copilot.json` is missing from the AI SDLC home (`AI_SDLC_HOME`, default `~\.ai-sdlc`). Ask one question at a time with `ask_user`. Every question may be skipped; record a skipped answer as empty. Do not infer answers from another user's habits.

## Questions

1. **Repositories.** "Which repositories will you run stories in, and what nicknames do you use for them?" Match each to a configured app project (`list_repositories`); offer to add missing ones. -> `repoAliases`: `{ "<nickname>": "<owner/repo>" }`.
2. **Protected automations.** "Does this chat already hold recurring jobs Jarvis must never replace?" -> `protectedAutomations` (list of names).
3. **Readiness sync (optional).** "Do you track work in Azure DevOps and want Jarvis to check Done-Done readiness (unlinked PRs, missing effort, open tasks) as stories move through the console?" If yes, and `az login` works, ask for the organization, project, team, and the Done-Done handoff person. Copy `readiness-sync\profiles\example-team.json` from the installed extension folder to `readiness-profile.json` in the AI SDLC home and fill it in. Jarvis then runs `node <extension folder>\readiness-sync\check-story.mjs <adoId> --profile <AI SDLC home>\readiness-profile.json` when a story reaches the profile's `triggers.consolePhases`, and raises each returned gap as a console question. It is read-only and never writes to Azure DevOps.

## Saving

Write `copilot.json` in the AI SDLC home:

```json
{
  "repoAliases": {},
  "protectedAutomations": []
}
```

Show the saved file and tell the owner they can edit it directly. If a later story needs an answer it lacks, such as a new repository nickname, ask that single question and update the file. Names and settings only; never write a credential into it.
