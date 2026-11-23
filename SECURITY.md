# Security policy

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for a security problem.

Include what is affected, how to reproduce it, and what an attacker gains. You will get an acknowledgement within a week. Fixes land on `main`; there are no maintained release branches.

## What is in scope

- The Command Center and story store (`command-center/`, `mission-console/`): the server is meant to listen on `127.0.0.1` only. Anything that exposes it beyond the local machine, or lets a web page or another local user read or change stories, is in scope.
- The supervisor and `adapters/`: starting a worker with more permission than the profile grants, or running a command built from story content.
- `install.mjs`: writing outside a harness's own folders, or deleting rather than moving aside what it replaces.
- The skills: an instruction that would lead an agent to leak secrets, skip a required gate, or act outside the repository a story runs in.

## What to expect of the factory

Workers are AI agents that run commands in a worktree of your repository with the permissions your profile gives them. Review what a worker may do before you raise those permissions, and review every pull request it opens. Profiles and story databases stay on your machine and are never committed.
