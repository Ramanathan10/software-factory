# Software Factory

Everything needed to run the AI software development lifecycle from one clone: the skills that define the lifecycle and the Command Center application that coordinates and observes it.

## Contents

| Path | What it is |
|---|---|
| `skills/` | The lifecycle skills (below). |
| [`mission-console/`](mission-console/README.md) | Story store (SQLite), event rules, `jarvis.mjs` CLI, PR watcher, and the original standalone dashboard. Works from any agent harness. |
| `command-center/` | Local HTTP service and dashboard UI: stories, questions, plan approval with comments, evidence, attachments. Harness-neutral; wakes the coordinator through an `onDecision` callback. `serve.mjs` runs it on its own. |
| [`adapters/copilot/`](adapters/copilot/RUNBOOK.md) | GitHub Copilot app adapter: the canvas extension, the Copilot calls for the [factory runbook](skills/jarvis/RUNBOOK.md), adapter setup, and `install.ps1`. |
| `readiness-sync/` | Optional read-only Azure DevOps readiness checker. Never writes to Azure DevOps. |
| `install.mjs` | Links the skills into Codex, Claude Code, and Cursor, and reports what is linked. |
| `scripts/link-skills.ps1` | The earlier PowerShell version of the same linking. |

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
node ./command-center/serve.mjs
```

`serve.mjs` runs the Command Center at `http://127.0.0.1:4174/` (pass another port as its argument). Starting it twice reports the one already running.

## Install

Codex, Claude Code, and Cursor read the skills in place through one link per skill:

```powershell
node install.mjs
```

It sets up each of those harnesses it finds on the machine; name one (`codex`, `claude-code`, `cursor`) to set it up anyway. It never replaces a skill that is already there. If a harness's skills folder is itself a single link to another repository, it says so and leaves it alone. `node install.mjs --check` reports what is linked without changing anything.

Then open the harness and say "Be Jarvis. Run AI SDLC." The first run asks the `ai-sdlc-setup` questions once and saves the profiles; later runs ask only for an answer a profile lacks.

For the GitHub Copilot app, which needs copies:

```powershell
powershell -ExecutionPolicy Bypass -File .\adapters\copilot\install.ps1
```

It installs the extension and the skills under `~\.copilot`, backing up anything it replaces and keeping an existing `diagram-design`. Restart the app and say "Be Jarvis. Run AI SDLC."

## State and profiles

- Stories: `AI_SDLC_CONSOLE_DB` when set; otherwise an existing `~\.copilot\ai-sdlc-console\jarvis-missions.sqlite`; otherwise `console\jarvis-missions.sqlite` in the AI SDLC home (`AI_SDLC_HOME`, default `~\.ai-sdlc`).
- Owner, sharing rules, and each repository's gates: the AI SDLC profiles written by the `ai-sdlc-setup` skill. Both live in the AI SDLC home and are each person's own; nothing is written into the repository a story runs in.
- Copilot-only answers: `copilot.json` in the AI SDLC home (see the adapter setup).

## Known gaps

- Only the Copilot adapter exists. Claude Code and Codex adapters are not written yet; each needs a runbook naming its calls for the four steps the factory runbook leaves to the harness: start a worker, message a worker, wake the coordinator, and report an idle worker.
- The Copilot extension cannot be executed outside the Copilot app, so `extension.mjs` is covered only by the service tests behind it.
- The console still has a `comparison-choice` step after review; `ai-sdlc` now settles that during planning, so Jarvis records the planned answer there instead of asking again.
- `serve.mjs` looks for `adapters/<name>/adapter.mjs` to deliver the owner's decisions to a story's worker, or to Jarvis when the worker cannot be reached. No adapter provides one yet, so outside the Copilot app a decision waits in the store until Jarvis reads `pending`.
- The Copilot installer is Windows PowerShell only. Neither installer has been run on a clean machine.
