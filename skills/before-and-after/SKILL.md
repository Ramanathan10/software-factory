---
name: before-and-after
description: Capture a matched before-and-after view of an on-premise product and report what changed. Use when the user asks for before and after screenshots, a visual diff, PR screenshots, or proof of a UI change on a local, desktop, or private-network product. Prefer tests, API or log checks, and browser automation; use computer use only when those cannot show the screen.
---

# Before and after

Show the same on-premise screen before and after a change, then say what actually changed. On-premise here means a product the agent can reach on the machine or its private network: a desktop app, an internal web app, localhost, or a private hostname. A public preview URL is not required.

## When this applies

Use this skill when the user asks for a before/after capture, a visual diff, PR screenshots, or evidence of a user-visible change.

The current running state is the **after** state. Keep the before state as whatever the user names: a second private URL or port, a previous build, or an existing image. If they give only one state, ask which before reference to use. Do not invent one by switching branches, stashing work, or restarting the product.

## What to hold constant

Match the comparison on purpose:

- Same screen, route, or window
- Same window size, zoom, and theme
- Same record, fixture, or account
- Same viewport when the product is a web UI. Use a phone or tablet size only when the user asks or the change is specific to that layout

Capture the product window or the relevant element. Leave other applications out of the frame. A full-monitor capture is only for a change whose layout depends on the whole screen, and only when the user asks for it.

## Choose how to verify

Use the first method that can show the user-visible result. Computer use is the fallback.

1. **Behavioral checks.** Tests, CLI output, HTTP responses, logs, or file diffs. Stop here when these fully answer what changed and the user did not ask for images.
2. **Structured UI checks.** The host's browser tools, an accessibility snapshot, or a DOM snapshot against a local or private URL the agent can already open, including an existing authenticated browser session.
3. **Computer use.** The host's computer-use tool or subagent, which can see the desktop and operate the mouse and keyboard. Use it when the earlier methods cannot show the screen.

Step 3 is the right path for a native or thick-client app, a window the browser tools cannot attach to, an embedded webview, or a private page that is visible on the desktop but not reachable by the browser automation. In Cursor, delegate that capture to the computer-use subagent. On another host, use that host's computer-use or desktop screenshot tool. If the host has neither computer use nor a browser that can open the product, say the screen was not verified.

## Capture

1. Confirm both states and the screen to compare. Accept two private URLs, two existing images, or one running product plus a saved before image.
2. Capture **before** while that state is still available. If the change is already applied and no before image or build was provided, ask for one.
3. Capture **after** with the same framing and data.
4. Read both images before writing the comparison. Recapture when the framing, theme, or data setup differ enough that the product change is unclear.

When falling back to computer use:

- Say which earlier method could not show the screen.
- Tell the computer-use agent the product, the exact screen, and the record or fixture to open.
- Limit it to that product window. Leave other applications, permission prompts, and account settings alone.
- Ask for a screenshot of that window for each state.
- Record instead of a screenshot only as the next section describes.

Two existing images need no new capture. Compare those files directly.

## Record a transition

Record only when a still pair cannot show the change, such as a transition or an animation. Use the host's own screen recorder when it has one, or the video a browser test runner already records. Otherwise use `ffmpeg`, which records the screen without either:

```
ffmpeg -f gdigrab -framerate 15 -t 8 -i title="<window title>" -pix_fmt yuv420p output/before-after/<screen>-before.mp4
```

`gdigrab` is the Windows input. On macOS use `-f avfoundation` and on Linux `-f x11grab`, each cropped to the region the window occupies.

- Record the product window, or the region it occupies. Never record the whole desktop.
- Start the recording in the background, perform the steps with the browser or computer-use tool, and let `-t` end it. Keep each clip to the seconds the change takes.
- Perform the same steps, at the same window size, for before and for after.
- Read frames from each clip before reporting, and discard a recording that does not show the comparison.

With neither a host recorder nor `ffmpeg`, say the recording was not made and offer a still pair.

## Report

Lead with what changed on the screen. Include:

- The before and after references
- Which verification method was used, and why computer use was required when it was used
- The visible difference, including anything that did not change and was part of the claim
- Framing or data differences that remain
- The local paths of the images

A pair of images is the evidence. The written difference is the result.

## Where evidence goes

Save images and recordings in the current task workspace, under `output/before-after/`, with names that identify the screen and state, such as `billing-review-before.png` and `billing-review-after.png`.

Keep the files on the machine. Put them in a pull request, ticket, or chat attachment only when the user asks, and only in a destination they name. When an image will leave the machine, crop fields that are not needed to see the change, including personal data, account identifiers, tokens, and secrets.

A local Markdown comparison may embed the workspace image paths:

```markdown
| Before | After |
|:------:|:-----:|
| ![Before](output/before-after/billing-review-before.png) | ![After](output/before-after/billing-review-after.png) |
```

When the user asks to add that comparison to a pull request, append it to the existing body and use images that PR can already render. Leave the pull request unchanged otherwise.

## Boundaries

- Reach the product through localhost, a private hostname already available on the machine, or the installed app. Do not open a tunnel or publish the app in order to photograph it.
- Use an existing signed-in desktop or browser session for the named product. If the product is sitting on a login screen, ask the user. Do not retrieve passwords or read credential stores.
- Stay inside the requested product and screen.
- Do not install `@vercel/before-and-after`, run the upstream upload scripts, or send screenshots to a public file host.
- Do not treat a screenshot of the wrong build, the wrong account, or an unrelated window as the before state.

## Provenance

This is a local adaptation for on-premise products. The reviewed upstream package and the changes required before import are in [source and review](references/source-and-review.md).
