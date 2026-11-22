# Source and vetting review

## Identity

- Skill: before-and-after (local on-premise adaptation)
- Publisher: Michael Shimeles, repository [michaelshimeles/skills](https://github.com/michaelshimeles/skills)
- Source path: `before-and-after/`
- Reviewed commit: `4b72f46b045e6fef52e6a98d4c162dd309826aed` on `main`, fetched 2026-10-14
- Skill content commit: `d30d25a73fd6212e884b7bd3dad26fd563e819af` (2026-08-28, "vendor greploop, greploop-apps, and before-and-after skills")
- License on the upstream folder: PolyForm Shield 1.0.0, copyright 2026 James Clements
- Reviewed files: `SKILL.md`, `LICENSE`, `scripts/capture.sh`, `scripts/upload-and-copy.sh`, `scripts/adapters/0x0st.sh`, `scripts/adapters/blob.sh`, `scripts/adapters/gist.sh`
- Staged copy: a temporary clone outside this repository. No upstream file was copied into `skills/before-and-after/`

## Provenance

The upstream folder is a vendored redistribution, not a package authored in that repository. Its instructions install the unpinned npm package `@vercel/before-and-after` and upload screenshots through bundled shell adapters. The folder license is PolyForm Shield, which is narrower than MIT. This adaptation is original wording for a different verification path. It does not include the upstream scripts, license text, or package.

No registry audit was available for the GitHub folder. The local scanner is the audit that was run.

## Capabilities of the reviewed upstream

- Files read: two URLs or two local images; Vercel project metadata when a `.vercel.app` URL is protected
- Files written: screenshots under `~/Downloads` by default; clipboard contents
- Commands: `npm install -g @vercel/before-and-after`, `before-and-after`, `curl`, `vercel inspect`, `vercel whoami`, `gh pr view`, `gh pr edit`, `gh gist create`, adapter shell scripts
- Network destinations: `https://0x0.st` by default, `https://gist.github.com` and the GitHub API for the gist adapter, and any endpoint in `BLOB_UPLOAD_URL`
- Credentials: an existing `gh` login and Vercel CLI login; `vercel inspect` is used to obtain a deployment-protection bypass token
- External changes: public file upload, public gist creation, and pull-request body edits
- Background or update behavior: none found. The global install tracks a mutable package name rather than a pinned version

`scripts/capture.sh` calls `agent-browser:` as a shell command. Those invocations are host-specific syntax, and the upstream `SKILL.md` does not use that script for the main path.

## Scanner

Command:

```powershell
pwsh -NoProfile -File skills/skill-vetter/scripts/scan-skill.ps1 -TargetPath <temporary before-and-after directory>
```

PowerShell 7.5.4 was installed locally because the machine image had no `pwsh`. The scanner reported 7 files, 0 high findings, and 9 medium findings (network destinations and external-mutation wording) in `SKILL.md`, `LICENSE`, `scripts/capture.sh`, `scripts/upload-and-copy.sh`, and the three adapters. Exit code 1. Those hits match the manual review; the scanner did not flag the global npm install.

## Findings

1. **Public screenshot upload. Severity: high.** `scripts/adapters/0x0st.sh` posts the image to `https://0x0.st` with no authentication, and `SKILL.md` makes that the default upload. On-premise screens can contain customer and internal data. Required change: keep evidence local unless the user names a destination.
2. **Public gist upload. Severity: high.** `scripts/adapters/gist.sh` creates a public gist from the screenshot using the logged-in `gh` account. Required change: omit this adapter.
3. **Unpinned global install. Severity: high.** `SKILL.md` requires `npm install -g @vercel/before-and-after` before every run. That executes whatever version the registry serves. Required change: do not install or run that package from this skill.
4. **Deployment-protection bypass. Severity: high.** For a protected `.vercel.app` URL, the skill uses `vercel inspect` to obtain a bypass token. That is unnecessary for an on-premise product and handles a credential-like value. Required change: omit the Vercel bypass flow.
5. **Pull-request edits as a normal step. Severity: medium.** `gh pr edit` rewrites the PR body. Required change: edit a PR only when the user asks, and append to the existing body.
6. **Web-URL assumptions. Severity: medium.** The workflow expects two `file://`, `http://`, or `https://` URLs and a browser capture. It does not cover a desktop or private-network product, and it has no fallback when browser automation cannot see the screen. Required change: add computer use as that fallback and accept a running local app or an existing image.
7. **PolyForm Shield. Severity: medium.** Redistributing the upstream files would carry a non-compete license and a copyright notice that must stay attached. Required change: write an original adaptation and record the source, which this review does.

The useful upstream constraints that remain are: the running state is "after"; ask when the before state is missing; do not switch branches or restart the product to manufacture a before state; capture the relevant view rather than an unrequested full-screen dump.

## Risk

- Upstream grade: **High**. Publishing logged-in product screens and installing an unpinned global package are both above the skill's stated screenshot purpose.
- Residual risk of this adaptation: **Medium**. Computer use can operate a signed-in desktop session, and the images can contain private data. The local skill limits that to the named product, keeps files in the task workspace, and requires a user-named destination before anything is uploaded or attached.

## Verdict

`APPROVE WITH CHANGES`, satisfied by `skills/before-and-after/SKILL.md` and this review. Approval covers those local files at the reviewed upstream commit above. It does not approve installing `@vercel/before-and-after`, running the upstream scripts, or treating a later `main` commit as reviewed.

## Local validation

The same scanner was run against `skills/before-and-after` after the adaptation was written. It scanned 3 files, reported 0 high findings, and reported 3 medium findings:

- `SKILL.md` external-mutation: the words `publish` and `install` appear in the boundaries that forbid publishing the app and installing the upstream package.
- `references/source-and-review.md` external-mutation: the same words describe the upstream behavior and the required changes.
- `references/source-and-review.md` network: the recorded upstream URLs.

Those hits are descriptive. This adaptation does not upload screenshots, install a package, or contact those hosts.

Frontmatter contains `name` and `description`. The relative link in `SKILL.md` resolves to this review. `git diff --check` against `main` reported no whitespace errors. No screenshot capture was run, because this change adds the workflow rather than exercising a product UI.
