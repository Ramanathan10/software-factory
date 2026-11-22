---
name: ai-sdlc-setup
description: Interview the owner once per machine and once per repository, then save the AI SDLC profiles that tell the lifecycle who the owner is and which checks must pass before a pull request opens. Also confirms the software the lifecycle needs, such as Stryker, gitleaks, and the video tools, is installed, and offers to install what is missing. Use when AI SDLC preflight reports a missing or invalid profile or a missing component, when the owner says "set up AI SDLC" or "redo AI SDLC setup", or when a story starts in a repository that has no profile yet.
---

# AI SDLC Setup

Detect what the machine and repository already answer, interview the owner only for decisions, and save two profiles that `ai-sdlc` reads on every run. "The owner" is the person running this session.

| Profile | Holds | Lives at |
|---|---|---|
| Machine | Who the owner is and what this machine may do | `profile.json` in the AI SDLC home: `AI_SDLC_HOME`, default `~/.ai-sdlc`. Never committed. |
| Repository | The checks the owner runs on every change to this repository | `repos["owner/name"]` in the machine profile. Never written into the repository. |

The schemas and filled-in examples are in [assets](assets/): [profile.schema.json](assets/profile.schema.json), [repo-profile.schema.json](assets/repo-profile.schema.json), [profile.example.json](assets/profile.example.json), and [repo-profile.example.json](assets/repo-profile.example.json). Both profiles are the owner's own: people working in the same repository may each keep different checks. The profiles work the same from any agent harness. To keep work and personal setups apart on one machine, point `AI_SDLC_HOME` at a different folder for each.

## 1. Detect

From the target repository, run this skill's script with Node 22 or newer:

```
node <this skill>/scripts/preflight.mjs detect <repository>
```

It reports installed tools, existing profiles, the repository's name and default branch, package scripts, manifests, lockfiles, scanner and Stryker configuration, and CI files. Read the CI configuration, contribution guide, and agent instruction files it points to for the commands the project already uses. Do not ask the owner for anything these answer.

Its `components` list is the software the lifecycle runs beyond the agent: `git` and the pull request CLI, Stryker and gitleaks behind the gates, and `ffmpeg` and `hyperframes` for video. Each entry says what it is needed for, whether it was found, and a suggested install command.

The script cannot see what the agent host can do. Check your own tool list for the three abilities the evidence phases use, and note which are present:

- A browser tool that can open a local or private page and take a screenshot, for `before-and-after`.
- Computer use or a desktop screenshot tool, for a desktop app or a window the browser cannot reach.
- Screen recording, for a before-and-after recording of a transition.

Skip the machine interview when a valid machine profile exists, and the repository interview when a valid repository profile exists, unless the owner asked to redo setup.

## 2. Interview

Ask in rounds, each question with a recommended answer worded so "yes" accepts it. Use the host's question tool when it has one. Every answer is the owner's own; do not copy another person's profile or infer preferences from their history.

### Machine, once per machine

1. **Name.** What to call the owner (`ownerName`).
2. **Cross-model sharing.** Whether plans and code may go to additional model providers for critique and review (`crossModelReviewAuthorized`). Recommend no on a work machine until the owner confirms their employer's policy.
3. **Shared resources.** Local services, databases, ports, or hosts that parallel stories must not fight over (`sharedResources`). Offer the ones detection found.
4. **Verification environment.** Where before-and-after and live tests run by default (`defaultVerificationEnvironment`).
5. **Missing components.** Show the owner one table of every component and host ability from detection: what it is for, and whether it is available. For each missing component, ask whether to install it now, using the suggested command, or to go without. Install only what the owner approves, one command at a time, then run detection again to confirm it is found. `hyperframes` is a separate engine this repository has not vetted; say so when offering it, and install it in the video project, not globally. Save a declined optional component in `declinedComponents` so the check stops raising it. A missing host ability cannot be installed from here: tell the owner which evidence it rules out (screenshots, desktop capture, or recordings) and that enabling it is a setting of their agent host.

### Repository, once per repository

1. **Gates.** Propose a command for each gate from what detection found, and ask the owner to confirm or correct the set: `test`, `lint`, `typecheck`, `build`, `secrets`, `dependencies`, `staticAnalysis`, `mutation`. A gate with a command is required before every pull request. A gate the owner declines is saved as `null`, which records the decision so it is not asked again. Setup suggests gitleaks for `secrets` and no tool for `dependencies` or `staticAnalysis`; propose those two only when the repository or its CI already uses a scanner, and otherwise save them as `null`.
2. **Missing tools.** For a gate the owner wants whose tool is not installed, ask whether to install it now with the suggested command from detection, use an alternative that is installed, or leave the gate out. Do not install anything yourself without approval. A tool added to the repository, such as Stryker as a development dependency, changes its manifest and lockfile; say so before installing, and leave that change uncommitted for the owner to put through the repository's normal review. Prefer scanner commands that use a configuration committed to the repository and do not send code or metrics to an outside service.
3. **Mutation testing.** Recommend Stryker on changed files where it supports the language (`npx stryker run --mutate {files}` for JavaScript and TypeScript, `dotnet stryker --mutate {files}` for C#). `{files}` is replaced with the changed production files at run time.
4. **Required pipelines.** CI pipelines that must succeed before a pull request is reported ready, and whether each only triggers on the default branch (`requiredPipelines`).
5. **Review bot.** Whether Greptile reviews pull requests in this repository (`reviewBot`: `greptile` or `none`).
6. **Spec location.** Where the approved spec is committed (`specDir`, default `docs/specs`), or `null` to keep specs out of the repository and in the pull request description.
7. **Sharing limit.** Whether this repository forbids cross-model sharing even when the machine allows it (`crossModelReviewAuthorized: false`). Omit the field otherwise.

## 3. Save

Write the machine profile to the AI SDLC home, creating the folder if needed, with the repository profile under `repos["owner/name"]`. Write nothing into the repository: no profile file, and no part of the AI SDLC home.

Profiles hold names, commands, and settings. Never write a password, token, key, or connection string into one; name the resource and let the tool's own sign-in supply the credential.

## 4. Verify

```
node <this skill>/scripts/preflight.mjs check <repository>
```

It validates both profiles against the schemas, confirms each gate's tool exists, and reports each component as found or missing. `problems` stop a story; `warnings` do not. A missing tool that a required gate names, or missing `git`, is a problem. A missing pull request CLI or optional component is a warning. Fix every reported problem with the owner, and return to the missing-components question for each warning.

## 5. Hand off

End setup with a short report, not just "done":

1. The saved profiles and the gates that will run before a pull request.
2. What is ready and what is not: each component and host ability, and for each one that is missing, the evidence or gate the lifecycle will go without.
3. The check's `nextSteps`, in the owner's words: name a feature or bug to start a story, or say "Be Jarvis" to coordinate several from the Command Center.

Tell the owner they can edit the profile file directly or say "redo AI SDLC setup".

Then give the owner a home for the factory. When the host can list and rename its chats, and no chat is already named "Jarvis", rename this chat to "Jarvis" and say so. When a Jarvis chat exists, point the owner to it and leave this chat's name alone. When the host cannot rename, ask the owner to rename it.

## Later changes

When `ai-sdlc` needs an answer a profile lacks, such as a new repository or a new pipeline, ask that one question and update the profile; do not rerun the whole interview. When the check reports a tool or component that has gone missing, return to the missing-tools or missing-components question for it.
