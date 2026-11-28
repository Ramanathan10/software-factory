# PRURL-1 spec: a pull request URL with a path suffix is never watched, and cannot be corrected

Work item: GitHub issue #57 (bug, P1). Branch `story/prurl-1-pr-url-path-suffix-never-watched` from origin/main cb0ffc5. Spec location after approval: `docs/specs/story/prurl-1-pr-url-path-suffix-never-watched.md`, the branch's first commit.

## Context pack

`C:/Users/trojanmini/.ai-sdlc/stories/PRURL-1/context-pack.md`, with the reproduction in `repro-output.txt` beside it.

## Problem, reproduction and root cause

On cb0ffc5 (Node 24.18.0, temporary database):

1. `pr-opened` with `https://github.com/owner/repo/pull/3/files` is accepted, the story moves to `ci`, and `story.pr` keeps `/files`.
2. `watchOnce` reads nothing and warns about nothing. `githubPr()` returns `null`, so the loop skips the story (`mission-console/watcher.mjs:132`).
3. A corrected `pr-opened` is refused in `ci` (wrong phase), and after a replan back to `publishing` it is refused again: "Continue on the existing pull request."
4. A GitHub Enterprise PR URL is skipped the same way.

Root cause: the store and the watcher disagree on what a PR URL is. `pr-opened` (`mission-console/store.mjs:395-406`) stores any HTTPS URL verbatim and accepts a re-record only when it is byte-equal. `githubPr` (`watcher.mjs:12-17`) accepts only `https://github.com/<owner>/<repo>/pull/<n>`.

Owner's direction while planning: Hawkeye watches GitHub, GitHub Enterprise and Azure DevOps. The publisher and the PR review worker handle Azure DevOps too.

## Settled decisions

| Id | Decision |
|---|---|
| q1, r2-scope | github.com, GitHub Enterprise and Azure DevOps, all in this story. |
| q2, r2-ghe-hosts | GitHub Enterprise means any HTTPS host, other than dev.azure.com and *.visualstudio.com, whose path is `/<owner>/<repo>/pull/<n>`. Hawkeye reads it with `gh` on that host and runs GraphQL through `gh api graphql --hostname <host>`. No profile change. |
| r2-normalise | Canonical forms are given under "URL rule" below. A github.com or dev.azure.com URL that is not a PR is refused. The existing-PR check compares canonical forms without regard to case, and the store keeps the first spelling. Changed by plan critique finding 2: Azure DevOps PRs compare by organization, project, repository and id, so a visualstudio.com and a dev.azure.com address of the same PR match. Any other HTTPS URL is accepted, and `pr-opened` says Hawkeye does not watch it. |
| q3, r2-module | New module `mission-console/pull-request-url.mjs` with no dependencies. `watcher.mjs` keeps `githubPr` as a thin wrapper. |
| r3-ado-checks | Only Build and Status policies count as checks. |
| r3-ado-review | Review mapping is given under "Azure DevOps reader" below. |
| r3-ado-run | An async twin of the ADR 0025 rule, whose safe set also allows `=`. A new ADR records it. The sweep warning names the CLI for the host. |
| r3-ado-bounds | The publisher and the PR review worker learn Azure DevOps in this story. |
| r3-ado-verify | Verification uses stubbed `az` answers and a Windows stand-in `az.cmd` test. There is no live Azure DevOps read, and the PR says so. |
| r4-ado-publish | The Azure DevOps publishing path is given under "Skill changes" below. GrepLoop stays GitHub-only. |
| r4-ado-evidence | On Azure DevOps, evidence goes in words plus an Evidence section. Nothing is uploaded. |
| r4-ado-review | The Azure DevOps review path is given under "Skill changes" below. General threads are resolved too. Posted ids and item keys take the form `<threadId>/<commentId>`. |
| r4-ado-setup | No preflight change. The warnings and errors name the fix. |
| r5-restricted-az | `adapters/harnesses.mjs` is not changed. `RUNBOOK.md:51` says Azure DevOps stories need unrestricted workers. No follow-up issue. |
| q4, q5 | No before-and-after and no architecture diagram. |

## Design

### URL rule: `mission-console/pull-request-url.mjs`

`pullRequestUrl(url)` returns `{ kind, host, canonical, key }` for a recognised PR, `{ kind: "not-a-pr" }` for a github.com or dev.azure.com URL that is not a PR, and `null` otherwise. It throws nothing; the store turns `not-a-pr` into its own `InputError`, so the refusal is a 400, never a 500. `key` identifies the PR for comparisons: for GitHub, the canonical form lowercased; for Azure DevOps, `azure:<org>/<project>/<repo>/<id>` lowercased with the project decoded, so `https://<org>.visualstudio.com[/DefaultCollection]/...` and `https://dev.azure.com/<org>/...` for the same PR share a key.

- **Credentials:** a URL with a username or password is never recognised.
- **Protocol:** the protocol must be `https:`.
- **GitHub (`kind: "github"`):** the path matches `^/([\w.-]+)/([\w.-]+)/pull/([1-9]\d*)(?:/.*)?$` on any host except the Azure DevOps hosts. The canonical form is `https://<host>/<owner>/<repo>/pull/<n>`, with no query, fragment or suffix. `/pull/3x` and `/pull/03` do not match.
- **Azure DevOps (`kind: "azure-devops"`):** either of these forms:
  - host `dev.azure.com`, path `/<org>/<project>/_git/<repo>/pullrequest/<id>`
  - host `<org>.visualstudio.com`, path `[/DefaultCollection]/<project>/_git/<repo>/pullrequest/<id>`

  `<id>` is `[1-9]\d*`. Anything after the id is dropped, along with any query or fragment. The canonical form keeps the host and the path up to the id, with path segments as the URL parser encodes them (a project name with a space stays `%20`).
- **Refused (non-PR):** a URL on github.com or dev.azure.com that matches neither form.
- **Unrecognised:** any other HTTPS URL returns `null`.

`watcher.mjs` exports `githubPr(url)`, which returns `canonical` when `kind === 'github'` and `null` otherwise. That keeps `store.test.mjs:11` and its existing asserts working. The one behaviour change is that a GitHub Enterprise URL now returns its canonical form. The existing assert at `store.test.mjs:358` (`https://example.com/example/repo/pull/12` → `null`) is GitHub-Enterprise-shaped, so it changes to expect the canonical URL. That expectation is part of the approved behaviour, not a weakened test.

### Store: `pr-opened` in `mission-console/store.mjs`

- **Unchanged checks:** the existing ones stay (string up to 500 characters, HTTPS, non-empty path, no credentials).
- **Refused non-PR URL:** a URL on github.com or dev.azure.com that is not a PR → 400 "Use the pull request's URL."
- **Recognised PR:** the store keeps `canonical` in `story.pr` on the first record. A re-record is accepted when its `key` equals the stored PR's `key`, and `story.pr` keeps the first spelling. A different key → 409 "Continue on the existing pull request."
- **Unrecognised HTTPS URL:** stored as `parsed.href`, as today. A re-record must be byte-equal, as today. The event detail is `<url>. Hawkeye does not watch <host>; record pr-ready without a head once its checks pass.`
- **Event detail for a recognised PR:** the canonical URL, unchanged from today.
- **`observePr`:** unchanged. The watcher sends `story.pr` back, so the equality at `store.mjs:109` holds.
- **Placement:** no other store change. The store imports the URL module; the module imports nothing from the store.

### Watcher: `mission-console/watcher.mjs`

- **`watchOnce`:** skips a story whose `story.pr` is unrecognised, as today. The `pr-opened` detail already told the owner. A recognised story is read by the reader for its `kind`. The `readPr` injection stays, and its signature gains nothing: the reader works out the kind from the URL. The warning on a failed read names the CLI:
  - GitHub: "Hawkeye could not observe <story>. Check GitHub CLI access to <host> and the next poll."
  - Azure DevOps: "Hawkeye could not observe <story>. Check Azure CLI access (az extension add --name azure-devops, then az login) and the next poll."
- **GitHub reader (`readGitHubPr`):**
  - runs `gh pr view <canonical>` (gh takes the host from the URL)
  - runs `gh api graphql --hostname <host> ...`
  - compares the returned URL's key with the stored key, the same as `watcher.mjs:121` without regard to case

  A github.com read sends exactly the arguments it sends today, plus `--hostname github.com`.
- **Azure DevOps reader (`readAzurePr`):** runs `az` through the async safe runner, always with `--org https://dev.azure.com/<org>` (or `https://<org>.visualstudio.com`) and `-o json`.
  1. `az repos pr show --id <id>` reads:
     - `status`: `active`, `completed` (merged) or `abandoned` (closed)
     - `lastMergeSourceCommit.commitId`, lowercased: the head; missing or null throws "Azure DevOps returned an incomplete PR observation." as `summarizePr` does for GitHub
     - `reviewers[].vote`, `creationDate`, `repository.id`, `repository.project.id`
     - `repository.webUrl` and `pullRequestId`, for the same-PR check
  2. `az repos pr policy list --id <id>` reads the evaluations. Only policies whose `configuration.type.displayName` is `Build` or `Status` count as checks:
     - `rejected` or `broken` → failed (the name goes into `failures`, as GitHub's does)
     - `queued` or `running` → pending
     - `approved` or `notApplicable` → good

     Status follows `summarizePr`'s rules: merged or closed first, then failed, running, passed, no-checks.
  3. `az devops invoke --area git --resource pullRequestThreads --route-parameters project=<project GUID> repositoryId=<repo GUID> pullRequestId=<id> --api-version 7.1` reads the threads. Both GUIDs come from step 1. A GUID must match `^[0-9A-Fa-f-]{36}$`, or the read throws before `az` runs.
- **Same-PR check (Azure DevOps):** the key of `repository.webUrl + '/pullrequest/' + pullRequestId` must equal the stored key, or the read throws "Azure DevOps returned a different PR." (`webUrl` is often on dev.azure.com without DefaultCollection even for a visualstudio.com organization; the shared key makes that the same PR.)
- **Azure DevOps review summary:** same shape as `summarizeReview`.
  - `approvals`: reviewers with vote 10 or 5. `changesRequested`: vote -10 or -5. Reviewers are named by `uniqueName`, falling back to `displayName`.
  - `unresolved`: threads whose status is `active` or `pending` and that have at least one comment whose `commentType` is not `system`.
  - `earlier`: 0.
  - `items`: those threads, newest last comment first, at most 10.
    - `key`: `<threadId>/<lastCommentId>`, skipped when that id is in `prPosted`
    - `kind`: `thread` when it has `threadContext.filePath`, else `comment`
    - `path` and `line`: from `threadContext.filePath` and `rightFileStart.line`
    - `author`: the first comment author's `uniqueName`, falling back to `displayName` (a string, as `reviewOf` requires)
    - `bot`: true when the author's `uniqueName` does not match `^[^@\s]+@[^@\s]+$`
    - `excerpt`: the first comment's content
    - `url`: `<canonical>?discussionId=<threadId>`
  - `keys`: every item key. `more`: false. `lastActivityAt`: the latest of `creationDate` and the comments' `publishedDate`/`lastUpdatedDate`.
- **Async safe runner:** a function in `watcher.mjs` beside `run`.
  - On win32 it starts `az` through a shell with one command string, and refuses before starting any argument containing a character outside letters, digits and `. _ : / - =`.
  - Elsewhere it uses `execFile` with no shell.
  - It never sends a value taken from the URL path except the PR id (digits) and the organization. The organization must match `^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$` (the ADR 0025 rule).
  - The same timeout, `maxBuffer`, `windowsHide` and abort `signal` as the GitHub reader.

### Lifecycle model

`mission-console/lifecycle-model.mjs` gains a suffixed PR URL among its `pr-opened` inputs. It also gains a re-record of the same PR in another spelling, so `verify-story-lifecycle` explores normalisation and the accepted re-record. The check runs clean after the change.

### ADR

`docs/adr/00NN-the-watcher-runs-az-with-equals-in-its-safe-set.md` takes the next free number when the PR is published (0030 today), and the ADR index adds a row for it. It records:
- why the watcher runs `az` through a shell on Windows (ADR 0004 and 0025)
- why `=` joins the set: `--route-parameters` needs it, and `az.cmd` passes `%*` through with `=` intact, which the stand-in test proves
- that every value comes from the GUIDs and digits in Azure DevOps's own answer, or from a validated organization

### Skill changes: `skills/ai-sdlc/SKILL.md` phase 8

A repository is on Azure DevOps when its `origin` is on dev.azure.com or visualstudio.com, the test preflight uses (`preflight.mjs:125`).

- **Evidence paragraph:** add "On Azure DevOps, give the comparison in words and list each file in the Evidence section; do not upload."
- **GrepLoop paragraph:** add "GrepLoop runs on GitHub only; on Azure DevOps record `activity` saying the review bot was skipped."
- **Publishing intro:** "This phase authorizes the push and `gh pr create`" becomes "This phase authorizes the push and opening the pull request: `gh pr create`, or `az repos pr create` on Azure DevOps."
- **Publishing step 2:** "Find an existing pull request: `story.pr`, then `gh pr list --head <branch> --state open`, or on Azure DevOps `az repos pr list --source-branch <branch> --status active`."
- **Publishing step 6:**
  - GitHub keeps `gh pr create` with `Closes #<n>`.
  - Add: "On Azure DevOps, write the body to a file and run `az repos pr create --source-branch <branch> --target-branch <default branch> --title <title> --description @<file>`, with `--work-items <id>` when the work item is an Azure DevOps work item. When `az` or its `azure-devops` extension is missing or not signed in, record a `question` naming `az extension add --name azure-devops` and `az login`, then end the turn."
- **Publishing step 7:** "`pr-opened` with the URL" becomes "`pr-opened` with the pull request's web address. On Azure DevOps that is `repository.webUrl` + `/pullrequest/` + `pullRequestId` from the `az repos pr create` or `az repos pr list` answer, never its `url` field, which is the REST address the store refuses."
- **PR review step 2:**
  - Add: "On Azure DevOps, run `az repos pr show --id <id>` for `repository.id` and `repository.project.id`, then read the threads with `az devops invoke --area git --resource pullRequestThreads --route-parameters project=<project id> repositoryId=<repository id> pullRequestId=<id> --api-version 7.1`. A thread without a file is a conversation comment."
  - "with `gh api graphql`" stays for GitHub.
  - The bot rule gains: "Azure DevOps has no bot flag: an author whose unique name is not an email address is a bot."
- **PR review step 3:** "maps each question id to its GitHub item" becomes "to its item on the PR".
- **PR review step 6:**
  - Add: "On Azure DevOps, reply with `az devops invoke --area git --resource pullRequestThreadComments --route-parameters project=<project id> repositoryId=<repository id> pullRequestId=<id> threadId=<thread id> --http-method POST --in-file <file> --api-version 7.1` and resolve by setting the thread's status to `fixed` (`--resource pullRequestThreads`, the same route parameters with `threadId`, `--http-method PATCH`, `--in-file` holding `{"status":"fixed"}`). Resolve a conversation-comment thread too. Record the reply as `<threadId>/<commentId>` in `posted`."
  - "Conversation comments get a reply only" becomes "On GitHub, conversation comments get a reply only."
- **PR review steps 8 and 9:** "read GitHub again" becomes "read the PR again". On Azure DevOps, the thread left for the rebuild keeps status `active`.

### Docs that restate the behaviour (new wording)

- **`mission-console/README.md:32`:** "Hawkeye observes pull requests on GitHub, GitHub Enterprise and Azure DevOps after Jarvis registers them with `pr-opened`. The Command Center does this itself every 30 seconds while it runs, with the GitHub CLI signed in to each GitHub host and, for Azure DevOps, the Azure CLI with its `azure-devops` extension. Without the Command Center, start the watcher in a separate terminal with the same database:"
- **`mission-console/README.md:38`:**
  - "The watcher polls registered `github.com` PRs" becomes "The watcher polls registered PRs on github.com, GitHub Enterprise and Azure DevOps".
  - "It only reads GitHub (`gh pr view` and one `gh api graphql` query); a failed read records nothing and warns." becomes "It only reads: `gh pr view` and one `gh api graphql` query on the PR's GitHub host, or on Azure DevOps `az repos pr show`, `az repos pr policy list` and one `az devops invoke` read of the threads, where only Build and Status policies count as checks. A failed read records nothing and warns, naming the CLI to check. A PR on any other host is not watched, and its `pr-opened` event says so."
- **`mission-console/README.md:48`:** "Hawkeye supplies GitHub evidence" becomes "Hawkeye supplies evidence from the PR's host". "does not modify GitHub … or treat an unavailable GitHub response" becomes "does not modify the PR's host … or treat an unavailable response from it".
- **`mission-console/README.md:155`:** "| `pr-opened` | `url` is the observed HTTPS PR URL. The store keeps its canonical form, `https://<host>/<owner>/<repo>/pull/<n>` on GitHub and GitHub Enterprise or the Azure DevOps address up to `/pullrequest/<id>`, dropping any suffix, query or fragment. A github.com or dev.azure.com URL that is not a pull request is refused. A later `pr-opened` must name the same pull request, compared in canonical form without regard to case. Any other HTTPS URL is kept as given, and the event says Hawkeye does not watch it. |"
- **`mission-console/README.md:170`:** "Hawkeye polls registered GitHub PRs with the GitHub CLI" becomes "Hawkeye polls registered GitHub, GitHub Enterprise and Azure DevOps PRs with their CLIs".
- **`skills/jarvis/SKILL.md:77`:** "omit the head only when the PR is not on github.com or no watcher is running" becomes "omit the head only when its `pr-opened` event said Hawkeye does not watch the PR's host, or no watcher is running".

- `skills/jarvis/RUNBOOK.md:51` (r5-restricted-az): after "and records the refusal as a console `action-` question." add "A story whose repository is on Azure DevOps needs `unrestricted` workers: a restricted Claude Code worker is not allowed to run `az`."

 `skills/jarvis/BACKGROUND.md`, `e2e/README.md` and `.claude/skills/verify-story-lifecycle/SKILL.md` name no PR host or `gh` command for PRs (searched), so they do not change. This change does not alter how a phase ends.

## Acceptance criteria

Unit tests in `mission-console/store.test.mjs` (or a new `mission-console/pull-request-url.test.mjs` for the module). Every `az`/`gh` call is stubbed.

### URL rule
1. `pullRequestUrl` canonicalises:
   - `https://github.com/o/r/pull/3/files`, `/pull/3/commits/abc`, `/pull/3/checks?check_run_id=1`, `/pull/3/`, `/pull/3#discussion_r1` → `https://github.com/o/r/pull/3`
   - `https://ghe.example.com/o/r/pull/3/files` → `https://ghe.example.com/o/r/pull/3`, kind `github`
   - `https://dev.azure.com/org/Proj/_git/repo/pullrequest/12?_a=files` and `.../pullrequest/12/` → `https://dev.azure.com/org/Proj/_git/repo/pullrequest/12`, kind `azure-devops`
   - `https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12#x` → `https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12`
2. `pullRequestUrl` returns `null` for:
   - `/pull/30x`, `/pull/0`
   - a GitLab `/-/merge_requests/3`
   - `http://github.com/o/r/pull/3`
   - `https://user@github.com/o/r/pull/3`

### Store
3. `pr-opened` with `.../pull/3/files` stores `https://github.com/o/r/pull/3`, and `watchOnce` with a stub `readPr` reads that URL once and records `pr-observed`.
4. After `pr-opened` `/pull/3` and a replan back to `publishing`, `pr-opened` with `/pull/3/files` or `https://github.com/O/R/pull/3#x` is accepted, and `story.pr` is unchanged. `/pull/30` and `/pull/4` are refused with 409 "Continue on the existing pull request." The same holds for Azure DevOps with `pullrequest/12` versus `pullrequest/120`, and a re-record of `https://dev.azure.com/org/Proj/_git/repo/pullrequest/12` after `https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12` is accepted.
5. `pr-opened` with `https://github.com/o/r/issues/3`, `https://github.com/o/r` or `https://dev.azure.com/org/Proj/_git/repo` is refused with 400 "Use the pull request's URL." through the console CLI as well as the store, and the phase stays `publishing`.
6. `pr-opened` with `https://gitlab.example.com/o/r/-/merge_requests/3` is accepted as given. Its event detail contains "Hawkeye does not watch gitlab.example.com", and `watchOnce` makes no read for it.

### Watcher
7. GitHub Enterprise:
   - `readGitHubPr` on `https://ghe.example.com/o/r/pull/3` calls `gh pr view https://ghe.example.com/o/r/pull/3 ...` and `gh api graphql --hostname ghe.example.com ...` (stubbed `run`)
   - on github.com, the existing call arguments are kept, plus `--hostname github.com`
   - a returned URL for another PR throws "GitHub returned a different PR."
8. Azure DevOps reader (stubbed `run` with JSON shaped like the Azure DevOps REST reference):
   - status `completed` → merged, `abandoned` → closed
   - head = `lastMergeSourceCommit.commitId`
   - a rejected Build policy → failed, with its name in `failures`
   - a running Status policy → running
   - a rejected Minimum-reviewers policy alone, or no policy at all → no-checks (only Build and Status count)
   - an approved Build policy plus a rejected Minimum-reviewers policy → passed
   - an uppercase `commitId` is stored lowercased; a null `lastMergeSourceCommit` warns and records nothing
   - uppercase project and repository GUIDs are accepted
   - a comment author object becomes its `uniqueName` string
   - votes 10 and 5 → approvals; votes -10 and -5 → changesRequested
   - an active file thread and an active general thread → two items: `thread` with path and line, and `comment`
   - a thread holding only system comments is not counted
   - a thread whose last comment id is in `prPosted` as `<threadId>/<commentId>` is skipped
   - an author with uniqueName `Build\Project Collection Build Service` is a bot
   - `repository.webUrl` for another repository throws "Azure DevOps returned a different PR."
   - a stored `https://org.visualstudio.com/DefaultCollection/Proj/_git/repo/pullrequest/12` with `webUrl` `https://dev.azure.com/org/Proj/_git/repo` and id 12 is observed, not refused
9. The async runner on win32 (injected platform and exec):
   - refuses `project=a b` and `x"y` before exec is called
   - passes `project=<guid>`
   - an organization that breaks the naming rule throws before any `az` call
10. Windows only, skipped elsewhere: a stand-in `az.cmd` placed first on `PATH` that logs its argv receives `--route-parameters project=<guid> repositoryId=<guid> pullRequestId=12` with each `=` intact, as in the AZ-1 test pattern. `PATH` is restored afterwards.
11. A failed read warns with the per-host text: GitHub names "GitHub CLI access to <host>"; Azure DevOps names "az extension add --name azure-devops".

### Lifecycle, docs and gates
12. `lifecycle-model.mjs` includes a suffixed URL and a re-record in another spelling, and the lifecycle check passes.
13. Each doc line listed above reads as the new wording, and phase 8 of `skills/ai-sdlc/SKILL.md` carries each change listed.
14. `node --test` passes, the comment ratchet does not go up, `node e2e/run.mjs` passes, and `gitleaks git --no-banner --log-opts=origin/main..HEAD` is clean.

Test level: unit, plus one Windows-only integration test for the stand-in `az.cmd`.

## Implementation order (one PR)

1. URL module, store `pr-opened`, `githubPr` wrapper, lifecycle model. This alone fixes issue #57 on github.com.
2. GitHub Enterprise in `readGitHubPr`.
3. Async `az` runner, Azure DevOps reader, `watchOnce` dispatch and warnings, ADR.
4. Skill and doc text.

## Out of scope

- `command-center/serve.mjs` and `adapters/harnesses.mjs` (LAUNCH-1, in parallel).
- Uploading evidence to Azure DevOps.
- GrepLoop on Azure DevOps.
- A preflight check for the `azure-devops` extension.
- A live Azure DevOps or GitHub Enterprise read.
- A repair path for stored PR URLs: the live database has none that is non-canonical.
- An e2e scenario: this is an audit bug, not one found in a live story (AGENTS.md).

## Run decisions

- No before-and-after; no architecture diagram.
- From the profile:
  - gates `node --test` and gitleaks
  - required pipeline "Tests"
  - implementation level full
  - spec at `docs/specs/story/<branch-name>.md`

## Risks

- **Azure DevOps response shapes come from the REST reference, not a live read.** A field the reference names differently in `az` output would fail only in real use. The PR says that no live read was made.
- **`=` through `az.cmd`:** test 10 checks it on Windows CI.
- **Case-insensitive comparison:** an Azure DevOps project name with `%20` compares by its encoded form. Two spellings, one encoded and one not, are the same after the URL parser normalises them.

## Plan critique

Cross-model review: Cursor Agent (model grok-4.5, provider xAI) reviewed a neutral packet (requirements, constraints, this spec, the code paths). Codex could not run: its usage limit lasts until 30 November, so this is a single-provider critique, not a panel. All eight findings were checked against the code and accepted; each is folded in above:

1. The no-checks criterion contradicted itself; a reviewer-only policy set is now no-checks.
2. Azure DevOps `webUrl` can differ from a visualstudio.com URL; Azure DevOps keys are now host-independent.
3. The publisher could record the REST `url` the store refuses; step 7 now names the web address.
4. An Azure DevOps author is an object; items now carry its `uniqueName` string.
5. The head is lowercased, and a missing head throws as GitHub does.
6. GUIDs are matched without regard to case.
7. The review skill names the route parameters and where they come from.
8. A refused URL is a store `InputError` (400), not a module throw (500).
