---
name: ai-sdlc-setup
description: Interview the owner once per machine and once per repository, then save the AI SDLC profiles that tell the lifecycle who the owner is and which checks must pass before a pull request opens. Use when AI SDLC preflight reports a missing or invalid profile, when the owner says "set up AI SDLC" or "redo AI SDLC setup", or when a story starts in a repository that has no profile yet.
---

# AI SDLC Setup

Detect what the machine and repository already answer, interview the owner only for decisions, and save two profiles that `ai-sdlc` reads on every run. "The owner" is the person running this session.

| Profile | Holds | Lives at |
|---|---|---|
| Machine | Who the owner is and what this machine may do | `profile.json` in the AI SDLC home: `AI_SDLC_HOME`, default `~/.ai-sdlc`. Never committed. |
| Repository | The checks every change to this repository must pass | `.ai-sdlc.json` in the repository root, or `repos["owner/name"]` in the machine profile when the repository cannot hold the file |

The schemas and filled-in examples are in [assets](assets/): [profile.schema.json](assets/profile.schema.json), [repo-profile.schema.json](assets/repo-profile.schema.json), [profile.example.json](assets/profile.example.json), and [repo-profile.example.json](assets/repo-profile.example.json). The profiles work the same from any agent harness. To keep work and personal setups apart on one machine, point `AI_SDLC_HOME` at a different folder for each.

## 1. Detect

From the target repository, run this skill's script with Node 22 or newer:

```
node <this skill>/scripts/preflight.mjs detect <repository>
```

It reports installed tools, existing profiles, the repository's name and default branch, package scripts, manifests, lockfiles, scanner and Stryker configuration, and CI files. Read the CI configuration, contribution guide, and agent instruction files it points to for the commands the project already uses. Do not ask the owner for anything these answer.

Skip the machine interview when a valid machine profile exists, and the repository interview when a valid repository profile exists, unless the owner asked to redo setup.

## 2. Interview

Ask in rounds, each question with a recommended answer worded so "yes" accepts it. Use the host's question tool when it has one. Every answer is the owner's own; do not copy another person's profile or infer preferences from their history.

### Machine, once per machine

1. **Name.** What to call the owner (`ownerName`).
2. **Cross-model sharing.** Whether plans and code may go to additional model providers for critique and review (`crossModelReviewAuthorized`). Recommend no on a work machine until the owner confirms their employer's policy.
3. **Shared resources.** Local services, databases, ports, or hosts that parallel stories must not fight over (`sharedResources`). Offer the ones detection found.
4. **Verification environment.** Where before-and-after and live tests run by default (`defaultVerificationEnvironment`).

### Repository, once per repository

1. **Gates.** Propose a command for each gate from what detection found, and ask the owner to confirm or correct the set: `test`, `lint`, `typecheck`, `build`, `secrets`, `dependencies`, `staticAnalysis`, `mutation`. A gate with a command is required before every pull request. A gate the owner declines is saved as `null`, which records the decision so it is not asked again.
2. **Missing tools.** For a gate the owner wants whose tool is not installed, ask whether they will install it, use an alternative that is installed, or leave the gate out. Do not install anything yourself without approval. Prefer scanner commands that use a configuration committed to the repository and do not send code or metrics to an outside service.
3. **Mutation testing.** Recommend Stryker on changed files where it supports the language (`npx stryker run --mutate {files}` for JavaScript and TypeScript, `dotnet stryker --mutate {files}` for C#). `{files}` is replaced with the changed production files at run time.
4. **Required pipelines.** CI pipelines that must succeed before a pull request is reported ready, and whether each only triggers on the default branch (`requiredPipelines`).
5. **Review bot.** Whether Greptile reviews pull requests in this repository (`reviewBot`: `greptile` or `none`).
6. **Spec location.** Where the approved spec is committed (`specDir`, default `docs/specs`), or `null` to keep specs out of the repository and in the pull request description.
7. **Sharing limit.** Whether this repository forbids cross-model sharing even when the machine allows it (`crossModelReviewAuthorized: false`). Omit the field otherwise.
8. **Where the profile lives.** Committed as `.ai-sdlc.json` so everyone working in the repository shares it, or kept in the machine profile when the repository should not hold it.

## 3. Save

Write the machine profile to the AI SDLC home, creating the folder if needed. Write the repository profile where the owner chose. When that is `.ai-sdlc.json`, leave the file uncommitted and tell the owner; it reaches the default branch through the repository's normal review, not as part of an unrelated story.

Profiles hold names, commands, and settings. Never write a password, token, key, or connection string into one; name the resource and let the tool's own sign-in supply the credential.

## 4. Verify

```
node <this skill>/scripts/preflight.mjs check <repository>
```

It validates both profiles against the schemas and confirms each gate's tool exists. Fix every reported problem with the owner, then show the saved profiles and the list of gates that will run before a pull request. Tell the owner they can edit the files directly or say "redo AI SDLC setup".

## Later changes

When `ai-sdlc` needs an answer a profile lacks, such as a new repository or a new pipeline, ask that one question and update the profile; do not rerun the whole interview. When the check reports a tool that has gone missing, return to the missing-tools question for that gate.
