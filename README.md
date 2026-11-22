# Software Factory

Everything needed to run the AI software development lifecycle from one clone: the skills that define the lifecycle and the Command Center application that coordinates and observes it.

## Contents

| Path | What it is |
|---|---|
| `skills/` | The lifecycle skills (below). |
| [`mission-console/`](mission-console/README.md) | Story store (SQLite), event rules, `jarvis.mjs` CLI, PR watcher, and the original standalone dashboard. Works from any agent harness. |
| `command-center/` | Local HTTP service and dashboard UI: stories, questions, plan approval with comments, evidence, attachments. Harness-neutral; wakes the coordinator through an `onDecision` callback. |
| [`adapters/copilot/`](adapters/copilot/RUNBOOK.md) | GitHub Copilot app adapter: the canvas extension, runbook, adapter setup, and `install.ps1`. |
| `readiness-sync/` | Optional read-only Azure DevOps readiness checker. Never writes to Azure DevOps. |
| `scripts/link-skills.ps1` | Links the skills into Codex, Claude Code, and Cursor. |

## Skills

| Skill | Role in the factory |
|---|---|
| `ai-sdlc` | The lifecycle: preflight, plan, test-first, implement, required gates, review, pull request, retro. |
| `ai-sdlc-setup` | One-time interview per machine and per repository; saves the profiles and provides the preflight check. |
| `jarvis` | Coordinator: delegates stories to workers and mirrors `ai-sdlc` phases into the Command Center. |
| `grill-me` | Plan interview. |
| `ponytail` | Smallest complete implementation. |
| `adversarial-code-review` | Cross-model code review with unanimous sign-off. |
| `before-and-after` | Matched before-and-after evidence of a visible change. |
| `diagram-design` | Architecture diagrams for pull request descriptions. |
| `greploop` | Iterating on Greptile review feedback. |
| `learnings`, `self-improvement` | The retro: lessons for the target repository and for the workflow. |
| `explainer`, `hyperframes` | Explanations in the right format, including video. |

The skills were moved here from the agent-skills repository at commit `127ee3a`; their earlier history is there. `self-improvement` also remains in agent-skills as a separate copy.

When the `ai-sdlc` phases change, update `mission-console/roles.mjs`, the store's transitions, and the phase table in `skills/jarvis/SKILL.md` in the same change.

## Run and test

Node 24 or later (Node 22 needs `--experimental-sqlite`). No package installation.

```powershell
node --test
node ./mission-console/jarvis.mjs demo
```

## Install

Codex, Claude Code, and Cursor read the skills in place through one link per skill:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\link-skills.ps1
```

It never replaces a skill that is already there. If a harness's skills folder is itself a single link to another repository, the script says so and leaves it alone.

For the GitHub Copilot app, which needs copies:

```powershell
powershell -ExecutionPolicy Bypass -File .\adapters\copilot\install.ps1
```

It installs the extension and the skills under `~\.copilot`, backing up anything it replaces and keeping an existing `diagram-design`. Restart the app and say "Be Jarvis. Run AI SDLC."

## State and profiles

- Stories: `AI_SDLC_CONSOLE_DB` when set; otherwise an existing `~\.copilot\ai-sdlc-console\jarvis-missions.sqlite`; otherwise `console\jarvis-missions.sqlite` in the AI SDLC home (`AI_SDLC_HOME`, default `~\.ai-sdlc`).
- Owner, sharing rules, and each repository's gates: the AI SDLC profiles written by the `ai-sdlc-setup` skill.
- Copilot-only answers: `copilot.json` in the AI SDLC home (see the adapter setup).

## Known gaps

- Only the Copilot adapter exists. Claude Code and Codex adapters are not written yet; they need the same four things the Copilot adapter does: start a worker, message a worker, wake the coordinator, and report an idle worker.
- The Copilot extension cannot be executed outside the Copilot app, so `extension.mjs` is covered only by the service tests behind it.
- The console still has a `comparison-choice` step after review; `ai-sdlc` now settles that during planning, so Jarvis records the planned answer there instead of asking again.
- The installers are Windows PowerShell only and have not been run on a clean machine.
