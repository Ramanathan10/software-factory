# Explainer video

Read this only after the owner has confirmed the video format in `SKILL.md`. Commands, `script.md` syntax, engine APIs, and `style.json` keys are in [video-reference.md](video-reference.md). The final checklist is [video-checks.md](video-checks.md).

Input: a topic, article, codebase, or rough notes. Output: one `renders/<slug>-vN.mp4` at 1920x1080 (`16:9`) and 30 fps (or `9:16` / `1:1` when requested), plus the `script.md`, `media/`, and `graphics/` files that produced it. Pass `--share` to `render.py` only when a smaller 720p copy in `renders/share/` is requested.

You write the script, narration, and scene code. The bundled scripts fetch media, synthesize voice, align words, compile the HyperFrames composition, render the MP4, run the 10-check QA, and serve the review page.

## 0. Check the engine before promising a video

- The scripts need a POSIX shell: `setup.sh` and `scripts/py` are Bash. On Windows, run them in WSL.
- Run `scripts/setup.sh` (or `setup.sh --voice` for spoken narration) only after the owner approves. It downloads a headless Chrome (about 390 MB) and `hyperframes@0.9.79` through `npx`, creates a Python venv in `~/.cache/video-explainer/venv`, and with `--voice` installs Kokoro TTS and the Parakeet alignment model. If a system tool such as `ffmpeg` or Node 22+ is missing, list it with its install command and ask before installing.
- Before any script that calls HyperFrames, export `HYPERFRAMES_SKIP_SKILLS=1` and `HYPERFRAMES_NO_UPDATE_CHECK=1` so the CLI does not install skills or check for updates. Run from the video project, never from this skill folder.
- If the owner declines setup or the engine cannot install, offer a storyboard or the interactive HTML format instead. Do not call a preview, storyboard, or HTML animation a video.

## 1. Mode and captions

The mode and captions answer comes with the format confirmation in `SKILL.md`, so do not ask again. Set them in `script.md`:

1. **Motion (default)** (`Mode: motion`): Full-frame 2D kinetic graphics, live SVG routes and charts, CSS 3D cards or devices, and press clippings on `ExplainerStage`. Fastest and cheapest.
2. **Illustrated** (`Mode: illustrated`): Hand-drawn picture-book animation with gouache, pastel, paper grain, 10 fps line boil, and word-synced characters on `StoryBrush` and `IllustratedStage`. About 6x the tokens of Motion.
3. **3D** (`Mode: 3d`): Single-take Three.js camera flythroughs with studio lighting, bloom, camera-facing labels, and optional Blender meshes on `Studio3D`. About 7x the tokens of Motion.

Captions are on unless the owner turns them off.

## 2. Research, source media, and write `script.md`

`script.md` is the storyboard: claims are settled here before anything animates.

Create one project folder named with a short slug (`graphics/`, `media/`, `captures/`) where the owner asks, else `projects_dir` from `style.json`, else the current folder. Keep it outside the skills repository.

Verify every claim, number, quote, and step against the owner's files or primary sources, and mark illustrative values as illustrative. Pull real photos, product visuals, clips, or page captures when they ground the story (`media.py image`, `media.py clip`, `capture.py`), and inspect each downloaded image so broken or irrelevant assets stay out of the render. Never upload private material to fetch or generate media.

- **Keep runtime to 60 to 75 seconds (2-minute cap).** Target 135 to 185 spoken words across 5 to 8 scenes when voiced, or 8 to 12 beats when `Voice: none` (45 to 60s and 100 to 150 words for `Audience: eli5`). Stay at or under 120s (about 260 words). For another length, write about 2.5 spoken words per second and set `Max duration: <seconds>`. Cut tangents rather than rushing speech.
- **Default to `Audience: general` (smart non-engineer).** Plain English, concrete mental models, everyday cause and effect. No raw file paths, internal names, error codes, CLI flags, or unexplained acronyms in speech or visuals. Switch to `eli5` or `technical` only when requested.
- **Land the hook in 3 seconds and follow one example end to end.** Open on a recognizable situation with a concrete question, tension, or number that reads with the sound off. Trace one specific request, dollar, or user through every step, introduce the abstract model only when it answers the question, and close by answering the opening question.
- **Write clean spoken copy.** No throat-clearing openers, binary contrasts, colon reveals, or hype adjectives. Short sentences, active verbs. Do not repeat the whole narration as on-screen text.
- **Set audio and theme headers:** `Mode: motion | illustrated | 3d`, `Audience: general`, `Voice: kokoro:af_heart` (or `gemini:Kore`, an audio file, or `none`), `Music: synth:cosmic` (`synth:warm`, `synth:minimal`, a path, or `none`), `Sound effects: on` with word-anchored `## Sound` cues (`- @s05:iron: rumble 0.8`), `Captions: auto` (or `off`), and `Style: default | paper | blueprint`.

`Voice: gemini` and `generate.py` (Lyria music) are paid Google API calls. Use them only when the owner explicitly asks. The key is read from `GEMINI_API_KEY` or `~/.config/video-explainer/.env`; never search for it or ask for it in chat.

Go straight from `script.md` into narration, graphics, QA, and the review page unless the owner asked to approve the script first.

## 3. Narrate and align

Run `narrate.py` to synthesize cached per-scene audio, trim dead air, align words with Parakeet, write `start` and `end` times back into `script.md`, and write `work/transcript.md`. Read `work/transcript.md` before coding graphics so animations and sound cues hit exact spoken words via `stage.cue("s03", "keyword", 1.2)`.

## 4. Build graphics

Point consecutive rows in `## Scenes` at `graphics/world.html` so `build.py` mounts one continuous composition and injects `stage.css`, `stage.js`, `explainer-data.js`, plus `illustrated.js` (`Mode: illustrated`) or `three.min.js` and `studio3d.js` (`Mode: 3d`). Build in one agent; the engines are designed for it.

- **Build on the engines.** Use `ExplainerStage`, `StoryBrush` / `IllustratedStage`, `Studio3D`, and `blender_export.py` instead of writing your own noise, shaders, or mesh packers.
- **Make a moving film, not slides.** One hero visual fills 60 to 85% of the frame and visibly transforms every 2 to 3 seconds: the camera dives, pans, or draws a live path, and objects morph rather than swap. A diagram that grows as it is explained beats a sequence of cards. Save the single-beat visuals (`card:`, `flow:`, `number:`) for one-off moments.
- **Keep labels readable.** Callouts are 1 to 4 words (28px+ labels, 88px to 160px hero numbers) with WCAG AA contrast, above the caption band (`y < 860` on `16:9`, `y < 1400` on `9:16`). Tie each number and label to the object it describes.
- **Spend tokens where they show (Illustrated and 3D).** Pick one setting and move the camera through it instead of building a new world per scene. Bake each Illustrated prop and character once and reuse it. In 3D, use procedural meshes and turn to Blender only when sculpted or fractured geometry clearly adds value.
- **Keep every frame deterministic on seek.** Bind updates to `stage.onTick` / `stage.onDraw` and end with `.finalize()`. Load 3D assets synchronously. No `Math.random()`, wall-clock time, network fetches, or CSS `transform` rules on GSAP-animated elements. Put `data-layout-allow-overflow` on full-bleed `<canvas>` or offscreen art.

## 5. Preview, draft, QA, review, and final

1. **Pre-flight:** Run `render.py "$P" --preview` (about 3s) and inspect the tiled `work/preview/contact.jpg` for framing, contrast, or whiteout bugs. Open individual `work/preview/frame-*.png` files only when diagnosing a specific beat.
2. **Draft and QA:** Run `render.py "$P" --draft` and `qa.py "$P"`. Fix any failed check (10/10 required) and inspect `work/qa/contact.jpg` and `work/qa/opening.jpg` (plus `work/qa/cuts/*.jpg` around suspect transitions).
3. **Fresh-eyes check:** `qa.py` measures motion, not whether the video reads as slides. Give `work/qa/contact.jpg` and `work/qa/opening.jpg` to a fresh subagent with only the mode and the hook line (judge them yourself if there are no subagents) and ask: Does any frame read as a slide, meaning text or cards on a flat background with no moving hero visual? Do the first 15 seconds open on a striking visual that changes every 2 to 3 seconds? Does any art look like generic clip art? Fix every yes, re-render the draft, and check again.
4. **Browser review loop:** Start `review.py "$P"` in a background shell (it listens on `127.0.0.1` only), share its URL, and run `review.py --poll "$P/work"` in the foreground. Apply feedback, re-run `narrate.py` only if spoken words changed, render `--draft`, refresh with `review.py "$P" --no-open`, run `review.py --ack "$P/work" BATCH_ID`, and poll again until approved.
5. **Final delivery:** Run `render.py "$P"` and `qa.py "$P"`, answer every check in [video-checks.md](video-checks.md), and confirm the final file exists and plays. Ask the owner to check voice pacing and mix balance. Report the `.mp4` path, duration, and loudness, point to `work/transcript.md` as the transcript, and add a short static explanation of the idea. Say plainly what could not be checked. Do not publish or upload the video unless asked. Offer to save custom theme or caption tweaks to `~/.config/video-explainer/style.json`.
