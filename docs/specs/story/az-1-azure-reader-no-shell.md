# AZ-1 plan: the Azure DevOps reader never lets a shell interpret tracker data

## Problem

On Windows, `runJson` in `readiness-sync/trackers.mjs` starts `az` with `shell: true` and wraps each argument in double quotes. `cmd.exe` does not treat double quotes as quoting: an embedded quote ends the quoted span, and `%` expands inside quotes. Four values reach the command line: the pull request id taken from a relation URL, the task id taken from a relation URL, `settings.organization`, and the story id. Tracker data can therefore change the command that runs. Work item: issue #15. Context pack: `context-pack.md` on the story.

## Reproduction and root cause

Reproduced on unchanged code at `88b9cce` on Windows with a stand-in `az.cmd` that forwards `%*` the way the real one does:

- A pull request relation whose id holds shell metacharacters made `cmd.exe` run a second command, and `az` received a truncated argument list.
- An organization containing an environment-variable reference was expanded by `cmd.exe` before `az` saw it.
- Node prints DEP0190 on every Windows `az` call, because `shell: true` is used with an argument array.

The exact inputs stay outside the repository.

Root cause: `runJson` (lines 20-23) relies on double quotes for `cmd.exe`, and `read()` passes tracker and profile values to it unchecked.

Fixes ruled out during scouting:
- Starting `az` without a shell: Node refuses with ENOENT for `az` and EINVAL for `az.cmd`, because batch files need a shell.
- Escaping for `cmd.exe`: still failed, because `az.cmd` forwards `%*` and so parses the arguments a second time, inside a parenthesized block.
- Calling the Python behind `az`: this works only for the MSI install layout.

## Settled decisions

From the story brief (not re-asked): no exploit string or working payload in the issue, pull request, commit messages, tracked files or test names. Tests use a stand-in `az` and describe inputs neutrally. The GitHub issue is read only.

From planning:
1. **Approach:** an allow-list. `read()` validates the values it puts on the command line. On Windows, `runJson` also refuses any argument outside a fixed safe set before it starts the shell. The safe set is a positive list rather than a list of known bad characters, because `az.cmd` re-parses its arguments in a context where more characters matter.
2. **Invalid relation ids:** a task or pull request relation whose id is not all digits, or cannot be decoded, is skipped and the read carries on.
3. **Reporting skips:** the reader returns each skipped relation with the snapshot. `check-story` lists them in a `skippedRelations` field next to the checklist, without changing how any check is judged.
4. **DEP0190:** on Windows, `runJson` passes one command string to the shell instead of an argument array, so the warning stops.
5. **Before and after:** none. **Architecture diagram:** none.
6. **Platforms:** the checks in `read()` on story ids, relation ids and the organization apply on every platform. Only the argument guard in `runJson` is Windows-only.
7. **Bad organization:** `check-story` returns `problem` before reading anything. The message names `readiness.organization` and the rule, so the runbook sends the owner to `ai-sdlc-setup`. `read()` still throws if called directly.

## Design

### `readiness-sync/trackers.mjs`
- `runJson` is exported as `runJson(command, args, { platform = process.platform, exec = execFileSync } = {})`. The options exist so tests can choose the platform and replace the process call.
  - When `platform` is `win32` and `command` is `az`:
    - Every argument must match `^[A-Za-z0-9._:/-]+$`. Otherwise `runJson` throws `Refused an az argument that a Windows shell could reinterpret: <JSON-quoted value>`, and `exec` is not called.
    - Otherwise it calls `exec('az ' + args.join(' '), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true })`. That is one command string and no argument array. No argument can hold a space, so joining loses nothing.
  - Otherwise it calls `exec(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false })`, exactly as today.
- `trackers['azure-devops'].read`:
  - Before any `az` call, it throws when `String(id)` is not all digits (`^[0-9]+$`), naming the value.
  - Before any `az` call, it throws when `settings.organization` breaks the Azure DevOps naming rules, naming the value. The rules: letters, digits and hyphens only, starting and ending with a letter or digit (`^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$`). There is no length limit.
  - A child relation's task id is found as today: the last non-empty piece after splitting the URL on `/` and `%`, so a trailing slash is harmless.
    - The id must be all digits, or the relation is skipped with `{ kind: 'task', url }`.
    - A child relation without a string `url` is skipped with `url: null`.
  - A pull request relation is one whose `url` is a string containing `/Git/PullRequestId/`, as today. A relation without a string `url` is not a pull request relation.
    - Its id is the last `/` segment of its decoded URL. The id must be all digits, or the relation is skipped with `{ kind: 'pr', url }`.
    - A URL that fails to decode is skipped the same way.
  - The returned snapshot gains `skippedRelations`, always an array.
- A tracker row may define `invalid(settings)`, which returns a message or nothing. For an organization that breaks the rules, the Azure DevOps row returns: `readiness.organization "<value>" is not a valid Azure DevOps organization name: use letters, digits and hyphens, starting and ending with a letter or digit. Run the ai-sdlc-setup skill.`
- The GitHub reader is unchanged: `gh` is a native program and runs without a shell.

### `readiness-sync/check-story.mjs`
- After the missing-settings check, `checkStory` calls the tracker's `invalid(settings)` when the row defines it. A message comes back as `{ problem }`, and `read` is never called.
- When the snapshot carries a non-empty `skippedRelations`, `checkStory` adds it to its result unchanged. Otherwise the result has no such field, so snapshot-fed and GitHub results are unchanged.

### `skills/jarvis/RUNBOOK.md`
- The readiness check's "It prints" table gains a row. `skippedRelations` means the reader skipped relations it could not read safely. The checklist did not see them, so Jarvis reports each one to the owner with the story's status.

### ADR
- `docs/adr/00NN-the-azure-reader-validates-instead-of-escaping.md` takes the next free number when the pull request is published (0023 today). It says why the reader validates rather than escapes:
  - Batch files re-parse their arguments.
  - Node refuses to start a batch file without a shell.
  - The worker launcher already refuses `.cmd` programs.

  It also says why skipped relations are reported, not judged.

## Acceptance criteria

1. On every platform, `read()` with a story id that is not all digits throws an error naming it, and the injected `run` is never called.
2. On every platform, `read()` with a bad organization throws an error naming it, and `run` is never called. Bad means shell metacharacters, spaces, or a leading or trailing hyphen. A valid organization such as `your-org` still reads.
3. A child relation whose id has shell metacharacters is skipped:
   - `run` is never called with it.
   - The other tasks are still read.
   - `skippedRelations` holds `{ kind: 'task', url }`.

   A task URL whose last piece after the `%` split is digits is read with those digits. A child relation with no `url` is skipped with `url: null`.
4. A pull request relation whose id has shell metacharacters, or whose URL cannot be decoded, is skipped the same way with `kind: 'pr'`. Well-formed pull request relations are still read.
5. With no bad relations, the snapshot equals today's apart from `skippedRelations: []`. The existing Azure test keeps passing with only that addition.
6. On every platform, `checkStory` with an Azure DevOps profile whose organization breaks the naming rules returns `problem` naming `readiness.organization`, and the injected `run` is never called.
7. `checkStory` includes `skippedRelations` when the snapshot has some and leaves the field out otherwise. The checklist and questions are the same as without the field.
8. `runJson('az', args, { platform: 'win32', exec })`:
   - With any argument outside the safe set, it throws, naming the argument, and `exec` is not called. This is checked for each of `" % ^ & | < > ! ( ) , ; =`, a space, CR, LF, and an empty string.
   - With safe arguments, it calls `exec('az ' + args.join(' '), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: true })` once and returns the parsed JSON.
9. `runJson('az', args, { platform: 'linux', exec })` and `runJson('gh', args, { platform: 'win32', exec })` call `exec(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], shell: false })`, as today.
10. This test runs on Windows only and is skipped elsewhere. It puts a temporary folder holding a stand-in `az.cmd` at the front of `process.env.PATH`, and restores `PATH` afterwards. The stand-in forwards `%*` to a Node script that appends each argv it receives to a log and answers with canned JSON. The real Azure CLI on the CI image must not run.
    - `runJson` with safe arguments: the log holds exactly those arguments, unchanged, and the JSON is returned.
    - `read()` on a story with one child relation whose id has shell metacharacters and one valid child:
      - The log holds the account, story and valid-task calls and nothing else.
      - No logged argument contains the bad id.
      - `skippedRelations` names the bad relation.
    - No input in the test is built to run a command if the defence failed.
11. `node --test` passes, the comment ratchet does not rise, and no new package dependency is added.

## Test level

Unit tests go in `readiness-sync/engine.test.mjs` or a new `readiness-sync/trackers.test.mjs`, with an injected `run`, `platform` and `exec`. One Windows-only integration test uses a stand-in `az.cmd` written to a temporary folder. The CI "Tests" pipeline runs it on `windows-latest`. Test names and inputs describe the values neutrally, for example "an id with shell metacharacters".

## Out of scope

- The GitHub and Linear readers.
- The worker launcher in `adapters/harnesses.mjs`.
- A general escaping helper for `cmd.exe`.
- Supporting `az` installs that are not on `PATH`.
- Organization values given as full URLs. The profile already stores the name only.

## Plan critique

Codex (gpt-6-sol) and a Claude reviewer critiqued the plan. Neither found a way for tracker or profile data to change the command. These changes came from their findings:
- The Windows test logs argv instead of looking for a marker file.
- The stand-in `az` goes first on `PATH`.
- The `exec` calls are pinned.
- The task id keeps today's split.
- The organization length limit is dropped.
- A relation without a `url` is covered.
- The runbook gains a row.
- Platform scope and the bad-organization result went to the owner.

## Run decisions

- Before and after: none (owner).
- Architecture diagram: none (owner).
- Gates (profile): `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`, with mutation testing on the changed production files.
- The RUNBOOK row is documentation only and has no test.
- Not a delivery-model, lifecycle-model or e2e change: no worker start, decision delivery, Jarvis wake, store or phase change. `node e2e/run.mjs` is not required, and CI still runs it.
- Spec location: `docs/specs/story/az-1-azure-reader-no-shell.md`, committed as the branch's first commit after approval.

## Context pack

Story: the Azure DevOps reader runs `az` through a shell on Windows with naive quoting. Issue #15. Branch `story/az-1-azure-reader-no-shell` from origin/main 88b9cce.

### Reproduction (bug lane)

Reproduced on unchanged code at 88b9cce, Windows, Node 24.18.0, with a stand-in `az.cmd` that forwards `%*` to a Node script the same way the real `az.cmd` forwards to Python.

- A pull request relation URL whose id holds shell metacharacters made `cmd.exe` run a second command. The stand-in received a truncated argument list (`repos pr show --id 77`, no `--org`), and the second command ran. Result: command execution from tracker data.
- An organization containing an environment-variable reference was expanded by `cmd.exe` before `az` saw it. The stand-in received the value of the environment variable instead of the organization.
- Node prints DEP0190 on every Windows `az` call because `shell: true` is used with an argument array.

The exact inputs, scripts and outputs are kept outside Git, in the story folder of the AI SDLC home. They do not go in the spec, commits, tests or the pull request.

### Root cause

`runJson` in `readiness-sync/trackers.mjs:20-23` sets `shell: true` for `az` on win32 and wraps each argument in `"..."`. Double quotes are not quoting for `cmd.exe`: an embedded `"` closes the quote, and `%` expands even inside quotes. Every value reaching argv:

| Value | Source | Line |
|---|---|---|
| PR id | `decodeURIComponent(relation.url).split('/').pop()`, tracker data | 45 |
| Task id | `tail(relation.url)`, split on `/` and `%`; a raw `"`, `&`, `|` still passes | 38, 40 |
| `settings.organization` | profile | 32 |
| story `id` | `read(id, ...)`; `check-story.mjs` passes a `Number`, but `read` accepts anything | 36 |

### Fix options checked

- Drop the shell: `execFileSync('az', ...)` without a shell gives ENOENT, and `az.cmd` gives EINVAL. Node refuses batch files without a shell since its 2024 batch-file fix. Not possible as is.
- `cmd.exe /d /s /c` with documented quote-and-caret escaping: still ran the second command in the probe, because `%*` inside `az.cmd` re-parses the arguments after the first parse removed the escapes. Not safe.
- Call the Python that `az.cmd` forwards to (`..\python.exe -IBm azure.cli`): works for the MSI layout only; pip and other installs differ. Fragile.
- Allow-list: ids must be digits, the organization must match Azure DevOps name rules, and on win32 `runJson` refuses any argument containing `" % ^ & | < > !` CR or LF, naming the value. With every argument limited to safe characters, the shell has nothing to reinterpret.

### Files

- `readiness-sync/trackers.mjs`: `runJson`, `readOnly`, `trackers['azure-devops'].read`.
- `readiness-sync/engine.test.mjs`: tracker tests; the Azure test stubs `run`, so `runJson` has no coverage today.
- `readiness-sync/check-story.mjs`: CLI; turns a thrown error into "The story could not be read: ..." and exit 1.
- `adapters/harnesses.mjs:216` `launchProblem`: the worker launcher refuses a `.cmd` program instead of shelling; precedent for refusing over escaping.
- `docs/adr/0013-readiness-checks-only-read.md`: the readiness check design.

### Conventions and rules

- AGENTS.md: run `node --test` before committing; no package dependencies; no source comments (`comment-ratchet.mjs`), so a reason the code cannot show goes in an ADR under `docs/adr/` (next free number at publish time, currently after 0022); no personal or real work details in tracked files (`private-details.test.mjs`); keep the story store and Command Center harness-neutral.
- Not a delivery-model, lifecycle-model or e2e change: no worker start, decision delivery, Jarvis wake, store or phase change.
- Security: no exploit string or working payload in the issue, PR, commit messages, tracked files or test names. Tests describe inputs neutrally ("an id with shell metacharacters").
- Profile: gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; spec at `docs/specs/story/az-1-azure-reader-no-shell.md` (matching earlier specs there), committed first after approval; pipeline "Tests" runs on windows-latest, macos-latest and ubuntu-latest, then `node e2e/run.mjs`; implementation level full; review round limit 3; reply to every PR comment before resolving it.

### Tests

- Focused: `node --test readiness-sync/engine.test.mjs`
- Full: `node --test`
- CI runs on Windows too, so a stand-in `az.cmd` test can run there and skip elsewhere; the allow-list checks run on every platform with the platform injected.

### Risks

- Too strict an allow-list could refuse a real organization name. Azure DevOps organization names are letters, digits and hyphens.
- A relation with a non-numeric id would now fail the whole read instead of passing a bad id to `az`.
