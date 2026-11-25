# Provenance

`explainer` merges three skills into one (2026-11-25):

| Source | What it contributed |
| --- | --- |
| `software-factory` `skills/explainer` at `802c99726ef2fbbe47936d2b9b219825d7fa13d6` | `SKILL.md`: the five-format recommendation and confirmation, HTML, accessibility, and verification guidance |
| `software-factory` `skills/hyperframes` at the same commit | Guardrails in `references/video.md`: approve before running the CLI, skill-install and update-check opt-outs, storyboard first, transcript and static explanation, say what was not verified |
| `petergyang/video-explainer` `skills/video-explainer` at `45132da1e9e3b43f358e5c3bb810ca81eb69ee4f` (MIT) | The video pipeline: `scripts/`, `assets/`, `fonts/`, `styles/`, `references/video-reference.md`, `references/video-checks.md`, and the workflow in `references/video.md` |

## Earlier reviews carried forward

- **explainer** was an independently worded adaptation of a third-party snapshot of Codex's `visualize` skill (https://codex-tool-reference.simonw.chatgpt.site/skills/visualize, snapshot 2026-08-31, reviewed 2026-09-26, no license observed, nothing copied), later expanded at the owner's request with the five formats and the confirmation step. The ASD-STE100 label is a style preference, not a compliance claim. Verdict: approve with changes, medium risk.
- **hyperframes** was a newly worded, Markdown-only adaptation of `heygen-com/hyperframes` `skills/hyperframes` at `e1a8c7f1730149a81d5aa5863b963487a2e3955e` (Apache-2.0); no upstream scripts, templates, fonts, or CLI were copied. Verdict: approve with changes. Its hand-authored composition contract is superseded by `build.py`, which generates the composition from `script.md`.

## video-explainer review (2026-11-25)

Verdict: approve with changes, high capability risk. Upstream files are bundled unmodified except two moves: `reference.md` became `references/video-reference.md` (its example `S=` path now points here) and `eval.md` became `references/video-checks.md`. The upstream `SKILL.md` was reworded into `references/video.md`. The repository-level README, demo screenshots, and `tests/test_pipeline.py` were not imported. The Inter font keeps its SIL OFL license in `fonts/OFL.txt`.

Capabilities found:

- Runs `npx -y hyperframes@0.9.79` (pinned version, no lockfile hash), which downloads a headless Chrome and, with `--voice`, the Parakeet and Kokoro models.
- Creates a Python venv at `~/.cache/video-explainer/venv` and installs `numpy`, plus `kokoro-onnx` and `soundfile` with `--voice`.
- Downloads `three@0.149.0` from jsDelivr into `~/.cache/video-explainer/vendor/`, and rendered pages load `gsap@3.14.2` from jsDelivr. Both versions are pinned; neither has a subresource integrity hash. This is the one place the merged skill loads remote scripts, and it is limited to the video render.
- Fetches images and clips from user-named URLs, Wikimedia Commons, and video pages through `yt-dlp`.
- Optional paid Gemini calls (TTS voice and Lyria music) with `GEMINI_API_KEY` read from the environment or `~/.config/video-explainer/.env`. Narration text and music prompts go to `generativelanguage.googleapis.com` with `store: false`.
- Serves the review page on `127.0.0.1` only, with an Origin check and a 1 MiB cap on feedback posts.
- Deletes and rebuilds only its own `hf/`, `work/`, and render folders inside the project.

No telemetry, self-update, encoded payloads, credential-store access, or privilege escalation was found. Base64 use is limited to decoding Gemini audio responses and packing Blender meshes.

## Restrictions

- Ask before running `setup.sh`, installing tools, or using `Voice: gemini` or `generate.py`, since those download code or spend money.
- Export `HYPERFRAMES_SKIP_SKILLS=1` and `HYPERFRAMES_NO_UPDATE_CHECK=1` before running scripts that call HyperFrames.
- Keep the Gemini key out of chat and out of this repository.
- Keep project output (`renders/`, `media/`, `work/`) outside this repository.

## Platform note

The video scripts assume a POSIX shell: `setup.sh` and `scripts/py` are Bash and use the `venv/bin/python` layout. On Windows, run them under WSL. The other four formats have no platform dependency.
