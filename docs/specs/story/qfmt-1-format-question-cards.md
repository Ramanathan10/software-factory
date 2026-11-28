# QFMT-1 plan: format question prompts with bullets and numbered lists

## Problem
The Command Center inbox card prints a question's prompt as plain text in one `<p class="q-prompt">` (`command-center/ui/app.js:579`). Newlines collapse, so paragraphs, numbered steps, bullets and lettered `(a)`/`(b)` items run together, and `**` and backticks show as typed. The legacy Mission Console prints the prompt as plain text in a `<legend>` (`mission-console/console.mjs:150`). The MD-1 Markdown renderer (`command-center/ui/markdown.js`) already renders plans safely, building every node through `el` with no HTML parsing (ADR 0010), but prompts never reach it. Before capture registered at cb0ffc5.

## Settled decisions
1. Formatted: the question prompt on the Command Center inbox card and in the legacy Mission Console question form. Option labels, the detail-view timeline and the OS notification stay plain text.
2. Inside prompts a single line break is kept as a line break, so lettered items and stacked short lines stay apart. Plans render exactly as today.
3. Markdown in prompts: the subset the plan renderer already supports. No new syntax, no HTML.
4. Long prompts show in full; no inner scroll box.
5. Skill guidance in all four files that tell a worker how to write a prompt.
6. Legacy console: the `<legend>` is replaced by a formatted prompt block above the options, and the fieldset is labelled by it with `aria-labelledby`.
7. A browser-level UI test, skipped with a message when no Chrome or Edge is installed.
8. Before and after: screenshots of the same seeded inbox question card, headless Edge, throwaway Command Center, 1680 wide. Before = cb0ffc5 (registered); after = the reviewed branch with the same seed, including the real CHK-1 lettered prompt.
9. No architecture diagram.

## Design
- `renderMarkdown(text, el, { breaks })` in `command-center/ui/markdown.js`: with `breaks: true`, consecutive lines of a paragraph are joined with `el('br')` instead of a space. Without the option, output is unchanged.
- `command-center/ui/app.js` `questionBlock`: the prompt becomes `el('div', { class: 'md q-prompt', id: promptId }, ...renderMarkdown(question.prompt, el, { breaks: true }))`. The section keeps `aria-labelledby` = promptId.
- `command-center/ui/app.css`: `.question .q-prompt` keeps its size and drops its zero margin only where the `.md` rules need it; no scroll box.
- `mission-console/console.mjs` `questionForm`: imports the Command Center renderer as `import { renderMarkdown as markdown } from '../command-center/ui/markdown.js'`. The relative path resolves both for Node (`console-status.test.mjs` imports `console.mjs`) and in the browser. The alias avoids the legacy file's own `renderMarkdown(container, text)`, which keeps rendering the legacy Plan tab unchanged. It adds a small `el(tag, attrs, ...children)` builder over `document.createElement`, renders the prompt into `div.md` with an id, sets `aria-labelledby` on the fieldset, and drops the legend. The textarea's `aria-label` keeps the plain prompt.
- `mission-console/jarvis.mjs`: its route table serves `/command-center/ui/markdown.js` from `../command-center/ui/markdown.js` (text/javascript), the URL the browser resolves for that import. `mission-console/console.css`: `.md` list, paragraph and code rules.

## Acceptance criteria
1. On the inbox card, a prompt with `1.` lines shows an `ol`, with `-` lines a `ul`, with blank lines separate `p` elements, with `**x**` a `strong` and with backticks a `code`.
2. A prompt with `(a) …`, `(b) …` on consecutive lines shows each on its own line (a `br` between them).
3. A prompt containing `<img src=x onerror=alert(1)>` or `<script>` shows that text literally; no `img` or `script` node is created. A `javascript:` link renders as text.
4. The question group is still labelled by the prompt element (`aria-labelledby` matches an element id that holds the prompt).
5. Options, the detail timeline, the working plan and the OS notification render as before. Plans keep joining paragraph lines with a space (existing markdown tests unchanged and green).
6. The legacy Mission Console question form shows the same formatting, has no `legend`, and its fieldset's `aria-labelledby` points at the prompt block.
7. `no-html.test.mjs`, `ui-lint.test.mjs`, `node --test` and `node e2e/run.mjs` pass; the comment ratchet does not go up; no package dependencies are added.
8. Docs name the new behaviour, each with this wording (or a close edit of it): "The prompt renders as Markdown: use `1.` or `-` lines for lists and a blank line between paragraphs; a single line break is kept."
   - `mission-console/README.md`, the `question` row.
   - `skills/grill-me/SKILL.md`, where it says to ask the frontier.
   - `skills/jarvis/RUNBOOK.md`, the "Actions for the owner" bullet.
   - `skills/ai-sdlc/SKILL.md`, PR review step 4.

## Tests
- Unit, `command-center/markdown.test.mjs`: `breaks: true` splits paragraph lines with `br`; default unchanged; lists, fences and quotes unaffected.
- Card, `command-center/card.test.mjs`: a question card renders `ol`, `ul`, `br`, `strong`, `code`; `<img onerror>` stays a text node; `aria-labelledby` matches the prompt id.
- Browser, a new `command-center/question-card.browser.test.mjs`: starts a throwaway Command Center on a free port with its own home and database, seeds a story with one question, opens it in headless Chrome or Edge over the DevTools protocol (Node's built-in WebSocket, no packages), and presses "Open inbox" (the question card is only in the document while the approver filter is on), and checks AC 1–4 in the live DOM. It also opens the legacy Mission Console page for the same story and checks AC 6. It looks for Chrome or Edge in the standard install paths and `PATH`; when none is found it skips with a message. It cleans up the browser, server and temp folders.
- Legacy console: `console-status.test.mjs` keeps loading `console.mjs` in Node; the browser test covers the rendered form.

## Out of scope
Option labels, the timeline, the OS notification, answered-question history; `mission-console/store.mjs`, `watcher.mjs`, `command-center/serve.mjs`, `adapters/harnesses.mjs`, `skills/ai-sdlc-setup`.

## Run decisions
- Spec at `docs/specs/story/qfmt-1-format-question-cards.md`, first commit. Gates `node --test`, gitleaks. Pipeline Tests (also `node e2e/run.mjs`). Implementation level full; review limit 3.
- Before and after as decision 8. No diagram.

## Plan critique
Codex (profile deep model) and Cursor's GPT and Gemini models were unavailable (usage limits); Grok 4.7 via Cursor reviewed the plan. Its three findings were verified against the code and fixed above: (1) a served-only `./markdown.js` import would break `console-status.test.mjs`, which loads `console.mjs` in Node; (2) `console.mjs` already declares `renderMarkdown(container, text)` for its Plan tab, so the import is aliased and the legacy Plan tab is untouched; (3) the inbox question card is only in the document while the approver filter is on, so the browser test opens the inbox first. One reviewer, not a cross-model panel.

## Context pack

Scout: Black Widow.

Story: Format the questions on Command Center cards with bullets and numbered lists. Feature. Base: origin/main cb0ffc5. Scout: Black Widow.

## Summary

- The inbox question card prints `question.prompt` as plain text in one `<p class="q-prompt">` (`command-center/ui/app.js:579`). CSS has no `white-space` rule for it (`app.css:264`), so every newline collapses: paragraphs, numbered steps, bullets and lettered items run together in one block. Backticks and `**` show as literal characters.
- The Markdown renderer from MD-1 (`command-center/ui/markdown.js`, `renderMarkdown(text, el)`) is used through `md()` (`app.js:38`) only for plans: the approval card, the working-plan disclosure, the plan comment window, the approved-design window and the detail view's Plan section. Question prompts never go through it.
- Switching the prompt to `md()` alone fixes numbered lists, bullets, paragraphs, inline code and bold. It does not fix lettered items: `renderMarkdown` joins consecutive non-list lines into one paragraph, so `(a) … (b) … (c) …` on separate lines still runs together. A real prompt (CHK-1 `chk1-docs`) uses that form.
- The renderer builds every node through `el` and never parses HTML (ADR 0010); links are allowed only for `http(s):` and `mailto:`. `no-html.test.mjs` and `ui-lint.test.mjs` cover `app.js` and `markdown.js` and stay green if the prompt goes through `md()`.

## Evidence

- Before capture (headless Edge, throwaway Command Center on port 4291 with its own home and database, PATH stripped of `claude` and `codex`), at cb0ffc5: `evidence/before-question-card.png`, `evidence/before-board.png`, `evidence/before-question-dom.json`. The card holds three questions: the real CHK-1 `chk1-docs` prompt (lettered items, paragraphs) and two seeded prompts using numbered items, bullets, `**bold**` and backticks. DOM: each prompt is a `P` with no children and `white-space: normal`.
- Capture scripts: `capture/seed.mjs`, `capture/capture.mjs`, `capture/real-question.json` (reusable for the after capture: same seed, same 1680-wide viewport).
- Live database, read-only snapshot: 352 questions across 30 stories; 62 multi-line. Of those, 59 have blank-line paragraphs, 24 use backticks, 11 numbered items, 7 bullets, 2 lettered `(a)` items, 0 bold. Prompt length: median 428, 90th percentile 986, longest 2927 characters (store cap 4000, `mission-console/store.mjs:38`). Options are capped at 300 characters (`store.mjs:57`).

## Where a question's text appears

| Surface | Code | Today |
|---|---|---|
| Inbox question card, prompt | `app.js:560` `questionBlock`, `q-prompt` `<p>` with `id` used by the section's `aria-labelledby` | plain text, newlines collapsed |
| Inbox question card, options | `app.js:580`, text inside `<button>` with a `recommended` tag | plain text |
| Collapsed "Waiting on you" row | `app.js:625` | story title only; prompt not shown |
| OS notification | `app.js:211` `announce`, body `story.title + '\n' + questions[0].prompt` | raw prompt; Markdown marks would show as typed |
| Detail view timeline | `app.js:772`; a `question` event's `detail` is the raw prompt (`store.mjs:61`), an `answer` event's is the answer | plain `<li>` text |
| Answered questions | not shown anywhere except the timeline | n/a |
| Legacy Mission Console | `mission-console/console.mjs:148` `questionForm`, prompt in a `<legend>` | plain text |

## Relevant files

- `command-center/ui/app.js` (questionBlock, renderDecisions, announce, openDetail), `command-center/ui/app.css` (`.question .q-prompt`, `.md`, `.md.scroll`), `command-center/ui/markdown.js`.
- Tests: `command-center/markdown.test.mjs` (renderer unit tests with a fake `el`, a node-count bound for termination), `command-center/card.test.mjs` (loads `app.js` against a fake DOM `Node` class and asserts card output; the place for a question-card test), `no-html.test.mjs`, `ui-lint.test.mjs`.
- Skills that tell workers how to write a question prompt: `skills/jarvis/RUNBOOK.md:165` (action questions), `skills/ai-sdlc/SKILL.md` PR review step 4, `skills/grill-me/SKILL.md` (frontier format), `mission-console/README.md:137` (`question` row).
- ADR 0010 (dashboards build every node). Next free ADR number at publish time; none expected unless a decision needs a reason the code cannot show.

## Conventions and rules

- AGENTS.md: no comments in source (`comment-ratchet.json`), no package dependencies, `node --test` before committing, keep personal and real work details out of tracked files, a change to behaviour a doc or skill states names every such file in an acceptance criterion.
- Profile: gates `node --test` and `gitleaks git --no-banner --log-opts=origin/main..HEAD`; pipeline "Tests" (also runs `node e2e/run.mjs`); spec at `docs/specs/story/qfmt-1-format-question-cards.md` as the first commit; implementation level full; review round limit 3; reply to every PR comment before resolving it.
- Stay out of: `skills/ai-sdlc-setup` (SETUP-1), `command-center/serve.mjs` and `adapters/harnesses.mjs` (LAUNCH-1), `mission-console/store.mjs` and `watcher.mjs` (PRURL-1).
- Focused tests: `node --test command-center/markdown.test.mjs command-center/card.test.mjs command-center/no-html.test.mjs command-center/ui-lint.test.mjs`. Full: `node --test`, then `node e2e/run.mjs`.

## Risks

- Accessibility: the prompt's `id` labels the question group. A `div.md` container keeps the `id`; a long formatted prompt becomes a long accessible name. Consider `aria-describedby` for the body if the prompt gets long.
- Soft line breaks: treating every single newline as a break changes the plan renderer too if done inside `renderMarkdown` for everyone; scoping it to prompts needs an option or a separate entry point.
- Long prompts (up to 2927 characters seen) push options far down the card once paragraphs and lists add height.
- Markdown in the OS notification body shows raw marks.
- `card.test.mjs`'s fake DOM must handle the nodes `md()` adds (it already renders plan cards, so `ul`/`ol`/`li`/`code` are fine).

## Open decisions for the interview (proposed frontier, each with a recommendation)

1. Which surfaces get formatted? Recommend: the inbox card prompt (the owner's ask). Options stay plain text. Timeline, notification and legacy console are separate questions below.
2. Lettered items and single line breaks. Recommend: inside prompts, keep a single newline as a line break (so `(a)`/`(b)` lines and short stacked lines stay apart), in addition to full Markdown lists. Alternatives: teach the renderer `(a)`-style items; or render strict Markdown and rely on skill guidance.
3. Which Markdown in prompts? Recommend: the same subset the plan renderer already supports (paragraphs, numbered and bulleted lists with nesting, bold, italic, inline code, safe links, code fences, quotes), no new syntax.
4. Long prompts. Recommend: show in full, no scroll box; the card already scrolls.
5. Timeline in the detail view: format `question` event details there too? Recommend: no; the timeline stays one-line plain text.
6. OS notification body. Recommend: leave as is (out of scope).
7. Legacy Mission Console `questionForm`. Recommend: leave it (the owner reviews in the Command Center).
8. Skill guidance. Recommend: yes, one sentence in the `question` row of `mission-console/README.md` and in `skills/grill-me/SKILL.md` saying the prompt renders as Markdown and lists should use `1.` or `-`. Alternative: also `skills/jarvis/RUNBOOK.md:165` and `skills/ai-sdlc/SKILL.md` PR review step 4.
9. Before and after: capture it? Recommend: yes, screenshots of the same seeded question card in the inbox, headless Edge on a throwaway Command Center, before = cb0ffc5 (already captured), after = the reviewed branch.
10. Architecture diagram. Recommend: none.
11. Test level. Recommend: unit tests in `markdown.test.mjs` for any renderer change, and a `card.test.mjs` test that a question card renders the prompt's list as `ol`/`ul` and that `<img onerror>` in a prompt stays text.
