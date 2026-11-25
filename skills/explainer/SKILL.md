---
name: explainer
description: "Recommend and confirm an explanation format, then explain a concept, codebase, article, or model output. Use when the owner asks to explain, teach, visualize, or help them understand how something works, or asks for an explainer video. Offers simple, detailed, diagram or image, interactive HTML playground, or a ~1-minute HyperFrames explainer video (Motion, Illustrated, or 3D, with voiceover and captions). Do not use for production UI changes or publication-quality scientific figures."
---

# Explainer

The goal is understanding, not a more elaborate artifact. If no topic is supplied, ask what to explain first. Then infer which output would help the owner understand it and confirm that choice with them before producing the explanation. Do not create a file for an ordinary question.

## Recommend, confirm, then explain

Recommend exactly one of these five formats, based on what the question requires. Present the recommendation and all five choices in one concise question, using the host's option picker when available or a short text menu otherwise. Do not produce the full explanation or artifact until the owner confirms or changes the selection. Even if the request names a format, confirm it before starting. If the chosen format is unavailable, say why and ask them to select an available alternative rather than silently substituting it.

1. **Simple:** A short plain-language answer and, when useful, one concrete example. Recommend for a straightforward concept or quick decision.
2. **Detailed (ASD-STE100 80% of the way):** A fuller step-by-step explanation using short, direct sentences, consistent terms, and a worked example. Recommend when the mechanism, tradeoffs, or failure cases need more room but not a visual. "80%" expresses the owner's desired reading style, not a measured compliance score. Use the [official ASD-STE100 source](https://asd-ste100.org/) when relevant; do not claim formal compliance.
3. **Diagram or image:** Recommend when structure, ownership, dependencies, or a visual analogy carries the idea. Prefer a small static engineering diagram or table for exact relationships; use a local `diagram-design` skill when one is available for a polished diagram, or image generation for a bitmap illustration when that format helps.
4. **Interactive HTML playground:** Recommend when changing a parameter or stepping through states reveals the mechanism. Build controls with a clear teaching purpose. A preview of an interface can live here; implementing a real application belongs in its project.
5. **Explainer video:** Recommend when motion or timing is central and a video adds value beyond a playground. A ~1-minute HyperFrames video with optional voiceover and burned-in captions, in one of three modes: **Motion** (default, fastest), **Illustrated** (hand-drawn, about 6x the tokens), or **3D** (camera flythrough, about 7x the tokens).

When video is the recommendation, ask for the mode and whether captions stay on (default on) in the same question. If the owner picks video after a different recommendation, ask mode and captions once before building. After confirmation, read and follow [the video workflow](references/video.md).

Do not force an escalation from prose to diagram to webpage to video. The owner may choose any of the five, including a simpler format than the recommendation. Confirming the format does not authorize software installation, paid services, publication, or changes to external systems.

## Resolve the host before writing

1. For visual or interactive output, if the host provides an active bundled visualization skill, read and follow that skill's current rendering contract. It owns inline syntax, theme tokens, runtime globals, resource policy, and export behavior. This skill supplements it; it does not replace those contracts.
2. Otherwise, when the owner has requested a standalone interactive artifact, create a self-contained HTML document under the current task workspace's `output/visualizations` directory. Include its styles and interaction code, and return a clickable absolute file link. Open it with an available local browser tool when useful. Do not claim it appeared inline.
3. Never assume `/workspace`, a particular user home, host CSS utilities, Lucide, or `window.openai` exists. The bundled `scripts/` serve the video format only.
4. Follow the active system and user communication instructions, including progress updates. Keep the final explanation focused on what the visual demonstrates.

Do not modify an installed bundled skill or create another user-skill copy to resolve a naming overlap.

## Build the smallest useful visual

Start from the owner's question and identify what changes, what stays fixed, and what needs comparison. Show only the controls needed to explore those relationships. A single useful view is usually better than a dashboard of summaries. When appropriate, end with one small prediction or experiment that lets the owner check their mental model.

Keep input data, units, assumptions, and uncertainty clear. Source external facts; label illustrative data as illustrative. Do not invent precise values or qualitative scores to fill a layout.

For charts, derive scale limits from the data and include units. Keep labels readable at narrow widths, with space for the longest values. Preserve comparable scales across related panels. Give important series direct labels where practical.

For diagrams, encode sequence, ownership, or dependencies consistently. For maps, use sourced geographic geometry rather than approximate hand-drawn boundaries. Use product-specific styling for interface mockups.

## Portable HTML behavior

Write literal HTML through the host's file-editing tools. Use a complete document in fallback mode; only use a fragment when the active renderer requires one.

Use a unique root element and scope styles and selectors to it. Keep small datasets embedded and presentation interactions local. Prefer native SVG and browser APIs; diagrams and playgrounds need no network libraries.

If a requested visual requires a library, use an existing project dependency or a reviewed, pinned local asset with its license preserved. Do not fetch and execute mutable remote scripts. Do not add telemetry, external API calls, credential access, or persistent background services.

An explanation request authorizes a local explanation, not publication, installation of global tools, use of paid services, or mutations to external applications. Export or publish only when requested, using the relevant host workflow.

## Accessibility and appearance

Use native controls with visible labels and keyboard operation. Dynamic results should have appropriate accessible announcements without announcing every animation frame. Include a concise text alternative for each chart or diagram.

Support narrow mobile widths and normal desktop widths without clipped labels or horizontal page overflow. Use responsive geometry instead of shrinking all text inside a fixed SVG viewBox.

Provide light and dark appearance in standalone output, respecting the owner's theme. Pair color with labels or shapes, keep contrast readable, and respect reduced-motion preferences. Essential information must remain available without hovering. For video or animation, keep the key meaning available in captions, a transcript, or a static frame.

## Verify and deliver

Read the generated file back. Check the data mapping, units, totals, labels, selectors, and calculations.

Where browser tools are available, inspect desktop and narrow layouts, both themes, keyboard use, and the main interaction. An HTML file merely existing is not proof that its controls work. If browser verification is unavailable, state that limitation briefly.

Use the active host's inline contract only when supported. Otherwise return the local artifact link with a short explanation. Do not duplicate every value in prose. State what was not verified, especially narration, timing, or a browser interaction. The video format has its own delivery checks in [video-checks.md](references/video-checks.md).

## Provenance

See [PROVENANCE.md](PROVENANCE.md). This skill merges the owner's `explainer` and `hyperframes` skills from `software-factory` with `petergyang/video-explainer`, whose scripts, engines, styles, and font are bundled unchanged under the MIT license in `LICENSE`.
