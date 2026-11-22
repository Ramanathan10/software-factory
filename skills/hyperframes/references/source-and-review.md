# Source and vetting review

## Identity

- Skill: `hyperframes`, focused local adaptation for explainer videos.
- Publisher and source: [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes/tree/e1a8c7f1730149a81d5aa5863b963487a2e3955e/skills/hyperframes), also listed on [skills.sh](https://www.skills.sh/heygen-com/hyperframes/hyperframes).
- Reviewed revision: `e1a8c7f1730149a81d5aa5863b963487a2e3955e` on `main`, October 29, 2026. Repository license: Apache-2.0. This local edition is newly worded; the upstream scripts, templates, fonts, and CLI package are not copied.
- The upstream skill folder contains 77 files, about 1.14 MB. The file inventory and static scanner covered all 77; the main skill, relevant explainer and runtime references, installer guidance, scripts, and flagged template/network behavior were inspected. No upstream executable was run.

## Capabilities and findings

- The upstream skill directs `npx hyperframes` use and can install or refresh companion skills. Its CLI and media workflow may use external services, paid plans, or supplied credentials. A bundled image-location script reads `GEMINI_API_KEY` and sends image data to Google's API. Several templates load remote fonts or CDN JavaScript. These are unnecessary for Ram's explainer-video routing and are excluded here.
- The local edition reads the user's subject and local project, writes local video compositions and rendered output only after a video request, and uses an already available CLI. It has no executable helpers, network-loading templates, automatic updates, telemetry, or credential access. The HyperFrames engine itself remains a separate dependency and was not vetted or installed by this import.
- The advisory scanner reported 0 high and 44 medium findings in the upstream folder, largely external-mutation and network markers. These are not proof of malicious behavior, but they justify excluding the optional scripts and templates. Registry popularity and audit badges were not treated as a safety guarantee.

## Risk and verdict

Upstream package as-is: **High** for this environment because of executable helpers, mutable package installation, and external media/API paths. **APPROVE WITH CHANGES** for this focused Markdown-only adaptation: no auto-install, no secrets, no external uploads, and no claim that a video can render without a separately installed CLI. Residual risk arises when a later task runs the external engine or supplies media; review that action and its destinations then.
