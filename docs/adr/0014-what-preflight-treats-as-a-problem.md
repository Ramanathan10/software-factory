# 0014. What preflight treats as a problem, and where a repository's settings live

Status: Accepted
Date: 2026-11-23

## Context
`preflight.mjs` runs before setup and before each story. It has to tell a missing tool that stops every story from one the owner chose not to install, and it has to find settings that belong to one person, not to the repository the team shares.

## Decision
- Each person keeps their own checks for a repository, so a repository's section lives in their own machine profile under `repos`, never in the repository, and is validated with the profile that holds it.
- Components are `core` (every story), `gate` (a required gate's tool) or `optional` (a capability the owner may decline). `install` is a suggestion shown to the owner, never run unasked.
- A gate's tool matters only when a required gate names it; then the profile promises a check the machine cannot run, which is a problem. A declined optional component is silent. `git` missing is a problem, because no story can make a worktree without it; anything else only warns, since a pull request can be opened another way.
- A repository with no `origin` remote is refused, because every story's worktree is cut from the remote default branch and the lifecycle ends in a pull request. `detect` reports the remote as `null` in that case.
- Defaults: a story's worktree goes in `<worktreeRoot>/<branch>`, by default a folder named for the repository beside it. An absent `specDir` means `docs/specs`; an explicit `null` keeps specs out of the repository. `detect` reports the Command Center folder, which setup saves as `commandCenterPath` without asking; it is `null` when the files are not installed.
- A branch pattern must contain `{id}` and `{slug}` and nothing git refuses in a branch name (git-check-ref-format).

## Consequences
- A team cannot share gate commands through the repository; each person's setup asks for them.

## Where
- `skills/ai-sdlc-setup/scripts/preflight.mjs` — `loadProfiles`, `branchPatternProblem`, `components`, `componentSeverity`, `check`, `detect`
