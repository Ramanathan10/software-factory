import { test } from "node:test";
import assert from "node:assert/strict";
import { findComments, commentOnlyLines, compare } from "./comment-ratchet.mjs";

const texts = (file, src) => findComments(file, src).map((c) => c.text.trim());

test("js: strings, templates and regexes are not comments", () => {
  const src = [
    'const url = "http://x.test/*not*/";',
    "const t = `a ${b /* real */} // still template`;",
    "const r = /\\/\\/[a-z]*/g; // trailing",
    "const d = a / b / c; /* div */",
    "if (x) return /re//*x*/.test(y);",
    "/* eslint-disable no-console */",
    "// @ts-expect-error legacy",
  ].join("\n");
  assert.deepEqual(texts("a.ts", src), ["real", "trailing", "div", "x"]);
});

test("js: adjacent line comments merge into one comment", () => {
  const src = "// one\n// two\nconst a = 1;\n\n// three\n";
  const found = findComments("a.mjs", src);
  assert.equal(found.length, 2);
  assert.equal(commentOnlyLines(src, found), 3);
});

test("js: a trailing comment does not count as a comment-only line", () => {
  const src = "const a = 1; // why\n/* block\n   spans */\n";
  assert.equal(commentOnlyLines(src, findComments("a.js", src)), 2);
});

test("python: hash in strings, docstrings, and __doc__ users", () => {
  const src = [
    "#!/usr/bin/env python3",
    '"""Module doc."""',
    "import os  # noqa: F401",
    "def f(x):",
    '    """Function doc."""',
    '    s = "#not" + \'#no\'',
    '    q = """',
    "    # not a comment",
    '    """',
    "    return s  # real",
  ].join("\n");
  assert.deepEqual(texts("a.py", src), ["Module doc.", "Function doc.", "real"]);
  assert.deepEqual(texts("b.py", src + "\nprint(__doc__)\n"), ["real"]);
});

test("shell: shebang, quotes, heredocs and parameter expansion", () => {
  const src = [
    "#!/usr/bin/env bash",
    "# real one",
    'echo "#nope" \'#nope\' ${#arr[@]} $# a#b',
    "cat <<'EOF'",
    "# inside heredoc",
    "EOF",
    "ls # trailing",
    "# shellcheck disable=SC2086",
  ].join("\n");
  assert.deepEqual(texts("a.sh", src), ["real one", "trailing"]);
});

test("powershell: block comments, strings and here-strings", () => {
  const src = [
    "#Requires -Version 7",
    "<# block #>",
    '$a = "#no" + \'#no\'',
    '$h = @"',
    "# inside here-string",
    '"@',
    "Get-Thing # trailing",
  ].join("\n");
  assert.deepEqual(texts("a.ps1", src), ["block", "trailing"]);
});

test("html: markup comments plus script and style comments, json skipped", () => {
  const src = [
    "<!-- top -->",
    '<script type="application/json">{"a": "// no"}</script>',
    "<script>const a = 1; // js</script>",
    "<style>a { color: red; /* css */ }</style>",
  ].join("\n");
  assert.deepEqual(texts("a.html", src), ["top", "js", "css"]);
});

test("compare: new comments fail, stale baselines fail, equal passes", () => {
  const found = new Map([["a.mjs", { comments: [{ line: 1, text: "x" }, { line: 2, text: "y" }] }]]);
  assert.equal(compare(found, { "a.mjs": 2 }).length, 0);
  assert.match(compare(found, { "a.mjs": 1 })[0], /allows 1/);
  assert.match(compare(found, { "a.mjs": 3 })[0], /--update/);
  assert.match(compare(new Map(), { "gone.mjs": 1 })[0], /--update/);
});

import { stripComments } from "./comment-ratchet.mjs";
test("stripComments: removing comments and blank lines leaves the same code", () => {
  const before = "// why\nconst a = 1; // note\n\n/* block */\nconst b = a /* inline */ + 2;\n";
  const after = "const a = 1;\nconst b = a + 2;\n";
  assert.equal(stripComments("a.mjs", before), stripComments("a.mjs", after));
  assert.notEqual(stripComments("a.mjs", before), stripComments("a.mjs", "const a = 2;\nconst b = a + 2;\n"));
  assert.equal(stripComments("a.mjs", "try { f(); } catch { /* none */ }\n"), stripComments("a.mjs", "try { f(); } catch {}\n"));
  const py = "def f():\n    # why\n    return 1  # note\n";
  assert.equal(stripComments("a.py", py), "def f():\n    return 1");
});

test("CRLF checkouts find the same comments", () => {
  const src = "#!/bin/sh\n# real\ncat <<EOF\n# body\nEOF\nls # tail\n";
  assert.deepEqual(texts("a.sh", src.replace(/\n/g, "\r\n")), texts("a.sh", src));
});

import { loadRepo, scanRepo } from "./comment-ratchet.mjs";
test("the repository has no comments beyond the baseline", () => {
  const { root, config } = loadRepo();
  assert.deepEqual(compare(scanRepo(root, config), config.baseline ?? {}), []);
});
