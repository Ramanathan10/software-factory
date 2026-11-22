# Source and vetting review

## Identity

- Skill: explainer (renamed and expanded from the portable visualize adaptation).
- Reference: https://codex-tool-reference.simonw.chatgpt.site/skills/visualize
- Reference publisher: Simon Willison's hosted Codex tool reference; the page labels the source authority as flora-skills. This is a third-party snapshot, not an authenticated upstream distribution.
- Snapshot: August 31, 2026; reviewed September 26, 2026.
- Upstream identifier displayed: skill://flora-skills/root/.codex/skills/oai/visualize/SKILL.md.
- License: no license declaration observed on the supplied page. No upstream source or helper implementation is vendored. The local instructions are an independently worded adaptation.
- Reviewed material: the complete exposed SKILL.md code block, local SKILL.md, and this review. The page provides no downloadable package or immutable upstream commit.

## Provenance and limitations

The reference describes a host-specific visualization runtime already represented by Codex's bundled visualize plugin. It mentions scripts/render.py, utility styles, runtime-managed tabs and tooltips, icons, and inline rendering syntax. Those implementation files are not supplied on the page; a complete upstream package cannot be vetted or installed from this URL.

The adaptation therefore delegates supported inline output to the installed host skill and provides a standalone HTML fallback elsewhere. It does not pretend that copying instructions installs the renderer.

## Capabilities

- Reads: user-scoped data, applicable host skill, generated visualization files.
- Writes: local HTML or a requested video in the current task workspace, when the host has suitable tools.
- Commands: documented host file tools and optional browser inspection; no shipped executable code.
- Network: no runtime data requests or remote executable dependencies required; public source research may be needed for facts.
- Credentials: none.
- External changes: publication only upon explicit request through the relevant workflow.
- Background behavior: none; no automatic updates or telemetry.

## Findings and adaptations

1. Missing renderer and host assets: removed dependence on an absent helper and hard-coded workspace.
2. Communication mismatch: removed the snapshot's blanket silent-work rule; active host and user instructions govern communication.
3. Host renderer overlap: the local skill is named explainer and defers inline visual contracts to the active bundled visualize skill. Do not overwrite that plugin.
4. Unclear redistribution license: retain attribution and an original portable adaptation rather than copying the snapshot.
5. Remote script execution: default to native browser features or reviewed local assets.
6. Local scanner flagged external-mutation and telemetry terms in SKILL.md. Manual review confirms these occurrences restrict those capabilities rather than enable them.

## Risk and verdict

**Grade: Medium.** Generated HTML can contain local presentation JavaScript and must be reviewed and inspected; no credentials or external state changes are needed.

**APPROVE WITH CHANGES**, satisfied by this adaptation. Approval covers these local Markdown files, not the unavailable upstream runtime or future downloaded dependencies.

## Validation expectations

Check skill frontmatter, local reference resolution, Git whitespace, and static scanner results. Verify the discovery junctions expose the canonical files after integration. Actual visualization and video rendering remain per-use checks.

## Local expansion

Ram requested a broader explanation skill on October 29, 2026: clear writing, diagrams and images, interactive HTML, and explainer video when requested. The ASD-STE100 reference is the [official STEMG site](https://asd-ste100.org/); the skill offers an inspired plain-English style without claiming formal compliance. The video path is conditional on available tools and separate authorization for any paid voice service. No video generator or credential access is bundled.

Ram later specified five explicit output choices and a confirmation gate before the explanation, including when the request names a format. The “80% of the way to ASD-STE100” label is a qualitative style preference, not a compliance test or certified percentage.
