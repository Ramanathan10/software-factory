# 0030. The watcher runs `az` with `=` in its safe set

Status: Accepted
Date: 2026-11-27

## Context
Hawkeye reads Azure DevOps pull requests with `az`. The thread read, `az devops invoke`, needs `--route-parameters project=<id> repositoryId=<id> pullRequestId=<n>`, so `=` must reach `az` intact. On Windows `az` is a batch file, which Node will not start without a shell (0004), and ADR 0025 lets the readiness reader pass only letters, digits and `. _ : / -` to a shell because `cmd.exe` quoting cannot be trusted. That safe set has no `=`.

## Decision
- The watcher has its own async runner, `runAz`, beside the GitHub one. On Windows it refuses any argument outside letters, digits and `. _ : / - =` before it starts anything, then passes one command string to a shell. Elsewhere it starts `az` with no shell.
- `=` is allowed because `az.cmd` passes `%*` through with each `=` intact, which a stand-in `az.cmd` test on Windows proves for the `--route-parameters` argument.
- Every value on the command line comes from the digits of the pull request id, an organization that matches the Azure DevOps naming rule, fixed words, or the two GUIDs in Azure DevOps's own answer, each checked against a GUID pattern before `az` runs. Nothing else from the pull request address reaches the shell.
- The readiness reader keeps its own set (0025): it never sends `=`.
- The GitHub reader reads any host with a `/<owner>/<repo>/pull/<n>` path, so it forwards `GH_ENTERPRISE_TOKEN` and `GITHUB_ENTERPRISE_TOKEN` to `gh` only when the pull request's host is the one named by `GH_HOST`. For every other host it removes them from the environment it passes, so a wrongly recorded address cannot receive them. `gh auth login` credentials and `GH_TOKEN` are untouched.
- The Azure reader bounds every string it hands the store to the store's limits (names 100, paths and links 500, keys 200, at most 100 names and 1000 keys), and names a team or group reviewer by display name, because its unique name is a long `vstfs:///` address. An over-long value would otherwise make the store refuse the whole observation.

## Alternatives
- Widen the readiness reader's set instead: that reader never needs `=`, so its guarantee would weaken for nothing.
- Pass the route parameters without `=`: `az devops invoke` has no other form.
- Call the REST API directly: it needs a token, which `az` already holds.

## Consequences
- A new `az` argument with another character fails on Windows until the set is widened deliberately.
- The Azure DevOps response shapes come from the REST reference, not a live read.

## Where
- `mission-console/watcher.mjs`, `mission-console/watcher-hosts.test.mjs`
