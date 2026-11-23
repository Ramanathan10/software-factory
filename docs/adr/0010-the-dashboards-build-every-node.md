# 0010. The dashboards build every node themselves and never render a bare count

Status: Accepted
Date: 2026-11-23

## Context
Plans, answers and timeline details shown on the dashboards are written by agents. Parsing any of that text as HTML would let an agent, or anything an agent copied, run script in the owner's browser. Separately, `replaceChildren` prints `false` and `0` as text, so `story.artifacts?.length && el(...)` once put the count 0 on the page with `false` beside it (1035544).

## Decision
- Both dashboards build every DOM node themselves. Markdown is rendered by `markdown.js` through `el`, and badges are built as SVG nodes by `badge.js`, so no text is ever parsed as markup. `no-html.test.mjs` fails on `innerHTML`, `insertAdjacentHTML`, `DOMParser` and the other HTML sinks in the dashboards' browser code.
- A section a story has nothing for is left out with a real boolean or `null`, never guarded by a bare count. `ui-lint.test.mjs` fails on an element guarded by a bare count.

## Consequences
- Rendering rich text needs code in `markdown.js` rather than a library that returns HTML.
- The Content-Security-Policy in `console-service.mjs` allows only same-origin scripts and styles, which this makes possible.

## Where
- `command-center/ui/markdown.js`, `command-center/ui/badge.js`, `command-center/ui/app.js` (the detail view), `mission-console/console.mjs`
- `command-center/no-html.test.mjs`, `command-center/ui-lint.test.mjs`
