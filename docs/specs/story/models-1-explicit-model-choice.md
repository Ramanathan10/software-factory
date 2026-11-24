# MODELS-1 plan: make setup ask for each harness's models explicitly

## Problem

A profile can name models for one harness and none for another. The second then runs every phase on its program default without anyone choosing it. Three gaps allow it: setup's Models step is never asked of a profile saved before it existed; the step recommends leaving a tier out, which cannot be told apart from never asking; preflight never warns. Context pack: `context-pack.md` on the story.

## Settled decisions (your answers)

1. **Keep the default** is saved as `null` for the tier. A missing tier or harness means never asked.
2. **Tiers asked: deep and standard only** (your feedback). `fast` is not new: it is a third tier already in the schema, which no phase uses unless you move one to it in `phaseTiers`; it exists for cheap work you might choose to move later. Setup no longer mentions it, the warning never requires it, and it stays in the schema so a profile that already names it still validates. WAKE-1's `coordinator` runs at `standard`, so it is covered.
3. **A missing choice is a warning**, judged only for the harness of the story being started.
3a. **Setup asks every question it has no answer for** (your feedback; scope settled in `ask-all`: every machine and repository question). Root cause: setup step 1 says "Skip the machine interview when a valid profile exists", so a question added later is never asked. Change: preflight keeps one list of the interview's questions and the profile field each one fills; `check` returns `unanswered` (machine and repository questions whose field is missing) and a warning for each, e.g. "The profile has no answer for the Models question (models.claude-code). Ask ai-sdlc-setup machine question 10." Setup asks every unanswered question, one at a time, never folding or skipping one, and skips only questions the profile already answers. A test fails when the schema gains a field that is neither on that list nor marked as not asked (schemaVersion, commandCenterPath, phaseTiers, adapters, repos, declinedComponents, the repository's crossModelReviewAuthorized limit), so a new question cannot ship without being asked of existing profiles.
4. **Names and default** come from a reader per harness row behind `node <harnesses> models <harness> [repository]`.
5. **Before and after:** command output, three runs. **Diagram:** none.

## Design

### Profile (`assets/profile.schema.json`, `profile.example.json`)
- Each tier in `models.<id>` is a non-empty string or `null`. Description: `null` = the owner chose the program's default; a tier or harness left out = never asked.
- The example shows one harness with a `null` tier.

### Preflight (`scripts/preflight.mjs`)
- New exported pure `modelWarning(models, phaseTiers, harness)` where `harness` is a resolved row `{ name, id, model }`. Returns `null` when the row takes no model option (Copilot app, Cursor) or when `models[id]` has a key (string or `null`) for both `deep` and `standard`; otherwise `"<name> has no model choice recorded for <deep and/or standard>. Ask the owner the ai-sdlc-setup Models question for <name>; "keep the default" is saved as null."`
- `check(repo, env, found, harness)` stays synchronous: the 4th argument is the already-resolved row, and its warning is added to `warnings`.
- The CLI takes `check <repo> [harness]`. It resolves the name or install id with `row()` from the harnesses file at the `commandCenter` path the check already locates, loaded with `await import` in the CLI only (that file cannot be `require`d). An unknown harness is reported as a problem naming the known ones, not a stack trace. With no harness, the output is as today.
- `nextSteps` names the models question for a models warning and keeps the install advice only for component warnings.
- ADR 0009 gains one line: preflight's CLI loads the harness rows from the Command Center it found, at run time, only when a harness is named.

### Reader (`adapters/harnesses.mjs`)
- Command-line rows gain `models({ env, repository })` returning `{ names, namesFrom, default, defaultFrom }`:
  - Claude Code: names from `<CLAUDE_CONFIG_DIR or ~/.claude>/cache/model-catalog/*-cc.json` (`catalog.config.models[].id`, plus the alias keys it lists). Default from `ANTHROPIC_MODEL`, then `<repository>/.claude/settings.local.json`, `<repository>/.claude/settings.json`, then the user `settings.json` `model`; otherwise "the account's default".
  - Codex: names from `<CODEX_HOME or ~/.codex>/models_cache.json` (`models[].slug`, hidden ones left out); default from `model` in `config.toml` there; otherwise "the program's built-in default".
  - A missing or changed file gives `names: []` and says where it looked.
- CLI: `node harnesses.mjs models <harness> [repository]` prints that JSON; the usage text names both modes.
- `modelFor` unchanged (`null` already passes no `--model`).

### Skills and docs
- `ai-sdlc-setup` step 10: for each harness the owner runs stories in, run the `models` mode, show the default and where it comes from (and that a worker started by the Command Center inherits the daemon's environment), then ask one question each for `deep` and `standard`: "Keep <harness>'s default (today <model>)" recommended, plus names from that output only. If it found no names, ask the owner to read them from the program's own model picker. Save every answer, the default as `null`. Verify section: a models warning is answered by this one question, not the components question. "Later changes": the same.
- `ai-sdlc` phase 0: pass the session's harness to the check. A models warning in a chat with the owner: ask the one setup question and save it. A story worker under the Command Center cannot write the profile: record the warning as `activity` and continue on what is recorded; Jarvis asks it.
- Jarvis skill step 1/2 and runbook: run the check with the story's harness, and again whenever the repository **or** the harness differs from the last check; ask the models question in the Jarvis chat before `create`. Runbook line on model choice: `null` means the owner chose the program's default; each command-line harness section says where its names and default are read (via the `models` mode).
- ADR 0007: the `null` rule and the warning.
- Story window (`command-center/ui/app.js` `modelOf`): a `null` tier reads "<harness> default · chosen in the profile".

## Acceptance criteria

1. Schema accepts a `null` tier, rejects an empty string and an unknown tier; the example validates. (unit)
2. `check` with Claude Code and no `models["claude-code"]`, or with one tier in use missing, warns naming the harness, the missing tiers and the question; `nextSteps` names the models question. (unit)
3. With `{ deep: null, standard: null }` or named models for every tier in use: no model warning. With no harness, Cursor or the Copilot app: no model warning. (unit)
4. `fast` is never required, even when a phase is moved to it; setup text does not ask it. (unit)
4a. A profile missing any interview answer (e.g. no `workerPermissions`, no `reviewBot` for the repository) gets one warning per missing answer naming the question; a complete profile has `unanswered: []`. The schema-coverage test fails if a schema field is neither a question nor marked not asked. (unit)
5. CLI: `check <repo> "Claude Code"` and `check <repo> claude-code` both warn; `check <repo> Bogus` reports a problem listing the known harnesses and exits 1. (unit, child process)
6. A worker turn gets `--model <name>` where named and no `--model` where `null`. (unit)
7. `models` reader: fake Claude Code and Codex homes give names and default with their sources; a repository settings file beats the user one; `ANTHROPIC_MODEL` beats both; a missing or malformed file gives no names and the path looked at. CLI rejects a bad mode with usage. (unit)
8. Story window wording for a `null` tier. (unit if `modelOf` is reachable from a test; otherwise checked in before-and-after)
9. `node --test` green, including private details and the comment ratchet; gitleaks clean.

## Before and after

Throwaway `AI_SDLC_HOME` with a profile that names Codex models only and nothing for Claude Code, on this repository. Run `node <preflight> check <repo> "Claude Code"`:
- Before: on origin/main 30b49b7, captured right after approval: clean, no warning (the bug; the harness argument is ignored).
- After: the new warning.
- After saving `"claude-code": { "deep": null, "standard": null }`: clean.
Plus `node adapters/harnesses.mjs models "Claude Code"` output after. Shown to you as text before the PR opens.

## Feedback round 1

1. "What does fast mean": answered in decision 2; fast dropped from setup and from the warning.
2. "Ask the questions without skipping any": decision 3a, for every machine and repository question (`ask-all`). A repository gate counts as answered when its key is present, `null` included, so each of the eight gates is its own question. After merge, an existing profile that lacks any answer gets one warning per missing answer on its next check, which is the intended way it gets asked.

## Overlap with WAKE-1

WAKE-1 adds `coordinator` to `phaseTiers` in `roles.mjs`, `preflight.mjs` and the schema, and edits setup step 10's tier wording and the Jarvis skill/runbook. This story edits the `models` schema block, `check`/`nextSteps`/CLI in `preflight.mjs`, adds tests, rewrites step 10, and edits the Jarvis check rule. Expect text conflicts in step 10, the runbook and possibly the Jarvis skill; whichever merges second rebases and has the rebase reviewed.

## Out of scope

Changing the models in your profile; Copilot or Cursor models; validating a saved name against the list (a bad name already fails the first turn within the 10-second settle); a live e2e run (worker start and decision delivery do not change).

## Gates

`node --test`; `gitleaks git --no-banner --log-opts=origin/main..HEAD`. Mutation is declined in the profile.

## Plan critique

Codex is over its usage limit, so no cross-model panel; one independent Claude reviewer critiqued the plan. Its findings, checked against the code: sync `check` cannot load the harness file (fixed: CLI-only `await import`, `check` takes a resolved row); `nextSteps` and setup text call every warning a component (fixed); a worker cannot write the profile (fixed: workers report, Jarvis asks); Jarvis re-checks only on a new repository (fixed: repository or harness); the reader ignored repository settings and config-folder variables (fixed); unknown harness and usage text (fixed). One finding rejected: the coordinator tier runs in the story's harness per WAKE-1's approved plan, not Jarvis's.

## Context pack

Worktree `C:/repos/software-factory-worktrees/story/models-1-explicit-model-choice`, branch `story/models-1-explicit-model-choice`, base origin/main 30b49b7.

### Relevant files

- `skills/ai-sdlc-setup/SKILL.md` machine step 10 "Models": asks per harness, tells the agent to recommend leaving a tier out (silent default). Step 3 Save: "Save every answer, including one that matches the default". "Later changes": ask one question when ai-sdlc needs an answer the profile lacks.
- `skills/ai-sdlc-setup/assets/profile.schema.json`: `models` = object keyed by harness install id, each `{deep, standard, fast}` strings (minLength 1), `additionalProperties: false`. Description says a harness or tier left out uses the default. `phaseTiers` enum per phase.
- `skills/ai-sdlc-setup/assets/profile.example.json`: `"models": { "claude-code": { "deep": "opus", "standard": "sonnet", "fast": "haiku" } }`.
- `skills/ai-sdlc-setup/scripts/preflight.mjs`: `check(repo, env, found)` is sync, has no notion of harness; returns `warnings` (only missing components today) and `models: machine.models ?? {}`. Keeps its own `phaseTiers` copy (ADR 0009; test keeps equal to `roles.mjs`). CLI: `check|detect [repoDir]`.
- `skills/ai-sdlc-setup/scripts/preflight.test.mjs`: `workspace(t, {machineProfile, repoEntry})` helper; model test at line 92.
- `adapters/harnesses.mjs`: harness rows (`Claude Code` id `claude-code`, `Codex` id `codex` are command-line with `model: name => ['--model', name]`; Copilot app in-app, Cursor none). `workerSettings`, `modelFor` (`models[id]?.[tier] || undefined`, so `null` already means "no --model"), `modelPlan`. CLI mode `start` only.
- `command-center/ui/app.js` `modelOf`: shows "<name> · set in the profile, not run yet" or "Not run yet · <harness> will choose".
- `skills/ai-sdlc/SKILL.md` phase 0 (warnings handling, Models section), `skills/jarvis/SKILL.md` step 1/2 (preflight per repository), `skills/jarvis/RUNBOOK.md` line 41 (model per turn; "Where the profile names no model, the program's own default is used").
- ADR 0007 (phase table drives tiers), ADR 0009 (skill scripts stand alone), ADR 0014 (what preflight treats as a problem vs warning).

### Where each harness keeps its model names and default (this machine, verified)

- Codex: names in `~/.codex/models_cache.json` (`models[].slug`, `visibility: "list"|"hide"`, `priority`); default is `model = "..."` in `~/.codex/config.toml` (`CODEX_HOME` overrides the folder), else the program's built-in default.
- Claude Code: names in `~/.claude/cache/model-catalog/<id>-cc.json` (`catalog.config.models[].id`, `section: main|overflow`; `provider_alias_targets` maps aliases such as `opus` to a full id); `claude --model` also takes the aliases. Default is `ANTHROPIC_MODEL`, else `model` in `~/.claude/settings.json` (`CLAUDE_CONFIG_DIR` overrides the folder), else the account's default. The catalog is an undocumented cache whose format may change.

### Conventions and rules

- AGENTS.md "Changing the factory": harness-specific code only in `adapters/`; harness described once in the runbook; no comments (comment ratchet); no package dependencies; `node --test` before committing; no owner names, repositories or model choices in tracked files (`private-details.test.mjs`); ADRs for reasons the code cannot show.
- Profile schema, example, preflight and its tests change together (brief).
- Never write a model name into a skill from memory.

### Tests

- Focused: `node --test skills/ai-sdlc-setup/scripts/preflight.test.mjs adapters/harnesses.test.mjs`
- Full: `node --test`; secrets: `gitleaks git --no-banner --log-opts=origin/main..HEAD`.

### Similar earlier changes

- Models and phaseTiers were added with ADR 0007; declined gates are saved as `null` "which records the decision so it is not asked again" (setup repository step 1): the precedent for an explicit null.
- `declinedComponents` silences a warning once the owner decides: precedent for a recorded decision clearing a warning.

### Overlap with WAKE-1 (story/wake-1-wake-jarvis-when-needed, in testing)

WAKE-1 adds `coordinator: 'standard'` to `phaseTiers` in `roles.mjs` and `preflight.mjs`, accepts `phaseTiers.coordinator` in the schema, adjusts the preflight/roles tests, and mentions the coordinator tier in the setup skill's tier text (step 10). This story edits the `models` part of the schema, adds a warning to `check`, a new preflight test, and rewrites step 10. Expect a text conflict in step 10 and possibly next to `phaseTiers` in preflight.mjs; whichever merges second rebases. Deriving the tiers to ask from the effective `phaseTiers` values means WAKE-1's new entry needs no extra change here.

### Risks

- Reading a harness's private cache can break when the program changes its format; the reader must fail to "unknown" and setup must fall back to asking the owner to read the program's own model picker, never to a remembered name.
- `check` is sync and used by many tests; keep the signature change additive.
- A warning on every story for Copilot or Cursor would be noise: those harnesses take no model option.
