---
name: hyperframes
description: "Create or edit an explainer video with HyperFrames, an HTML-to-video composition tool. Use when the owner requests a video explanation and HyperFrames is available or explicitly chosen; do not use for ordinary prose, diagrams, or interactive HTML lessons."
---

# HyperFrames for explainer videos

This is a focused local adaptation of HeyGen's HyperFrames skill. Read [the explainer-video workflow](references/explainer-video.md) before building a video. For a general explanation, use `explainer` first to choose the right format; video is not the default.

## Scope and setup

- The skill contains instructions, not the HyperFrames engine. Check whether a compatible HyperFrames CLI is already installed in the project or on the machine. Prefer the project's pinned version and lockfile. Do not run `npx` in a way that downloads a package, install/update skills or plugins, or change a project dependency without the owner's authorization.
- The upstream CLI can install or refresh other skills. For an approved CLI run, disable that behavior with `HYPERFRAMES_SKIP_SKILLS=1`; also use `HYPERFRAMES_NO_UPDATE_CHECK=1` to avoid automatic freshness checks. Run from the video project, never from this skill folder.
- No HeyGen, Google, ElevenLabs, music catalog, or other external service is implied by a video request. Do not search for credentials or upload private content. Ask before using a paid or external media service. Use user-provided or appropriately licensed local media when possible.
- If the CLI is missing, provide a storyboard or an HTML animation if that meets the request, and state that a rendered HyperFrames video requires a separate CLI install. Do not call a preview or animation a finished video.

## Composition contract

- Keep `index.html` as the root composition and put scene files under `compositions/`. Keep media under `assets/` and use relative `assets/...` paths.
- Set the root `data-duration` to the full video length. Timed elements use `class="clip"`, `data-start`, and `data-duration` in seconds. A clip displays over `[start, start + duration)`; an animation that finishes exactly at the end may never be seen.
- Each scene builds one paused GSAP timeline and registers it under its `data-composition-id` after building its tweens. Keep scene markup, styles, and scripts inside `<template>`. Use unique element IDs across the assembled film.
- Make every visible frame a deterministic function of timeline time. Avoid wall-clock time, unseeded randomness, network fetches, infinite repeats, and autonomous timers. Do not call `play()` on the render timeline or media.
- Animate children of timed clips rather than tweening their `display` or `visibility`. Avoid CSS/GSAP transform conflicts. Give audio elements IDs, and mark video as muted or explicitly carrying audio.
- Keep important text inside the title-safe area and verify it at phone width. Do not assume a font or media URL resolves merely because it works in a normal browser.

## Build and verify

Start with one claim and one worked example. Use a short storyboard before composing scenes. The source for each factual claim and number must be clear; mark illustrative values. A diagram that grows as it is explained is usually more effective than a sequence of bullet slides.

With an already approved local CLI, use its documented `timeline`, `check`, `snapshot`, `preview`, and `render` commands. Treat `check` as a structural test, not proof of the visuals. Inspect frames at the beginning, middle, and end of each scene, the seams between scenes, and a narrow/mobile rendering. Render a playable file when requested; verify that it exists and plays, and inspect audio separately when audio is included. Say plainly what could not be checked.

Provide a transcript or captions and a static explanation so the idea remains accessible without motion or sound. Keep all output in the current task workspace. Do not publish or upload the result unless requested.

## Provenance

See [source and review](references/source-and-review.md). This edition intentionally omits upstream installers, executable helpers, remote-loading templates, and unrelated video types.
