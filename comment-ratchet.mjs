#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const DIRECTIVE = new RegExp(
  [
    "^\\s*eslint(-disable|-enable|-env)?\\b",
    "^\\s*global\\s",
    "^\\s*@ts-(expect-error|ignore|nocheck|check)\\b",
    "^\\s*/\\s*<reference\\b",
    "^\\s*@(vitest|jest)-environment\\b",
    "^\\s*(webpack|vite)[A-Z]\\w*:",
    "^\\s*[#@]__PURE__\\s*$",
    "^\\s*c8 ignore\\b",
    "^\\s*istanbul ignore\\b",
    "^\\s*prettier-ignore\\b",
    "^\\s*stylelint-(disable|enable)\\b",
    "^\\s*noqa\\b",
    "^\\s*type:\\s*ignore\\b",
    "^\\s*pragma:",
    "^\\s*pylint:",
    "^\\s*fmt:\\s*(off|on|skip)\\b",
    "^\\s*-\\*-.*coding",
    "^\\s*shellcheck\\s",
    "^\\s*#?Requires\\s",
    "^\\s*SPDX-License-Identifier:",
  ].join("|"),
);

const LANG = {
  ".js": "js", ".mjs": "js", ".cjs": "js", ".ts": "js", ".mts": "js", ".cts": "js",
  ".tsx": "tsx", ".jsx": "tsx",
  ".css": "css",
  ".html": "html", ".htm": "html",
  ".py": "py",
  ".sh": "sh", ".bash": "sh",
  ".ps1": "ps1", ".psm1": "ps1",
};

export function languageOf(file) {
  return LANG[extname(file).toLowerCase()];
}

function lineAt(src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw",
  "case", "do", "else", "yield", "await",
]);

export function scanJs(src, offset = 0, end = src.length) {
  const out = [];
  const braces = [];
  let i = offset;
  let prev = "";
  let prevWord = "";
  const regexAllowed = () => {
    if (prev === "") return true;
    if (/[\w$]/.test(prev)) return REGEX_AFTER_WORD.has(prevWord);
    return !/[)\]}]/.test(prev) || prev === "}";
  };
  const readString = (q) => {
    i++;
    while (i < end && src[i] !== q) {
      if (src[i] === "\\") i++;
      else if (src[i] === "\n") break;
      i++;
    }
    i++;
  };
  const readTemplate = () => {
    i++;
    while (i < end) {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "`") { i++; return; }
      if (src[i] === "$" && src[i + 1] === "{") { i += 2; braces.push("tpl"); return; }
      i++;
    }
  };
  const readRegex = () => {
    i++;
    let cls = false;
    while (i < end && src[i] !== "\n") {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "[") cls = true;
      else if (src[i] === "]") cls = false;
      else if (src[i] === "/" && !cls) break;
      i++;
    }
    i++;
    while (i < end && /[a-z]/i.test(src[i])) i++;
  };
  while (i < end) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const start = i;
      while (i < end && src[i] !== "\n") i++;
      out.push({ start, end: i, text: src.slice(start + 2, i), kind: "line" });
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const start = i;
      const close = src.indexOf("*/", i + 2);
      i = close === -1 || close + 2 > end ? end : close + 2;
      out.push({ start, end: i, text: src.slice(start + 2, Math.max(start + 2, i - 2)), kind: "block" });
      continue;
    }
    if (c === "'" || c === '"') { readString(c); prev = "v"; prevWord = ""; continue; }
    if (c === "`") { readTemplate(); prev = "v"; prevWord = ""; continue; }
    if (c === "/" && regexAllowed()) { readRegex(); prev = "v"; prevWord = ""; continue; }
    if (c === "{") { braces.push("block"); prev = c; prevWord = ""; i++; continue; }
    if (c === "}") {
      const top = braces.pop();
      if (top === "tpl") { i--; readTemplate(); prev = "v"; prevWord = ""; continue; }
      prev = c; prevWord = ""; i++; continue;
    }
    if (/[\w$]/.test(c)) {
      const start = i;
      while (i < end && /[\w$]/.test(src[i])) i++;
      prevWord = src.slice(start, i);
      prev = "w";
      continue;
    }
    if (!/\s/.test(c)) { prev = c; prevWord = ""; }
    i++;
  }
  return out;
}

export function scanCss(src, offset = 0, end = src.length) {
  const out = [];
  let i = offset;
  while (i < end) {
    const c = src[i];
    if (c === "'" || c === '"') {
      i++;
      while (i < end && src[i] !== c && src[i] !== "\n") { if (src[i] === "\\") i++; i++; }
      i++;
      continue;
    }
    if (c === "/" && src[i + 1] === "*") {
      const start = i;
      const close = src.indexOf("*/", i + 2);
      i = close === -1 || close + 2 > end ? end : close + 2;
      out.push({ start, end: i, text: src.slice(start + 2, Math.max(start + 2, i - 2)), kind: "block" });
      continue;
    }
    i++;
  }
  return out;
}

export function scanHtml(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith("<!--", i)) {
      const close = src.indexOf("-->", i + 4);
      const end = close === -1 ? src.length : close + 3;
      out.push({ start: i, end, text: src.slice(i + 4, close === -1 ? end : close), kind: "block" });
      i = end;
      continue;
    }
    const open = /^<(script|style)\b[^>]*>/i.exec(src.slice(i, i + 500));
    if (open) {
      const tag = open[1].toLowerCase();
      const bodyStart = i + open[0].length;
      const closeAt = src.toLowerCase().indexOf(`</${tag}`, bodyStart);
      const bodyEnd = closeAt === -1 ? src.length : closeAt;
      const inner = /\btype\s*=\s*["']?(application\/(ld\+)?json|importmap|text\/template)/i.test(open[0])
        ? []
        : tag === "script" ? scanJs(src, bodyStart, bodyEnd) : scanCss(src, bodyStart, bodyEnd);
      out.push(...inner);
      i = bodyEnd;
      continue;
    }
    i++;
  }
  return out;
}

export function scanPython(src) {
  const out = [];
  const usesDoc = /__doc__/.test(src);
  let i = 0;
  let lineStartCode = true;
  let lastCodeChar = "";
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") { if (depth === 0) lineStartCode = true; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }
    if (c === "\\" && src[i + 1] === "\n") { i += 2; continue; }
    if (c === "#") {
      const start = i;
      while (i < src.length && src[i] !== "\n") i++;
      if (!(start === 0 && src.startsWith("#!"))) out.push({ start, end: i, text: src.slice(start + 1, i), kind: "line" });
      continue;
    }
    const str = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
    if (str) {
      const start = i;
      const atStatement = lineStartCode && depth === 0;
      const q = str[2];
      i += str[0].length;
      if (q.length === 3) {
        const close = src.indexOf(q, i);
        i = close === -1 ? src.length : close + 3;
      } else {
        while (i < src.length && src[i] !== q && src[i] !== "\n") { if (src[i] === "\\") i++; i++; }
        i++;
      }
      let j = i;
      while (j < src.length && (src[j] === " " || src[j] === "\t" || src[j] === "\r")) j++;
      const standalone = atStatement && (j >= src.length || src[j] === "\n" || src[j] === "#");
      const docPosition = lastCodeChar === "" || lastCodeChar === ":";
      if (standalone && docPosition && q.length === 3 && !usesDoc && !/[fFbB]/.test(str[1])) {
        out.push({ start, end: i, text: src.slice(start + str[0].length, i - 3), kind: "docstring" });
      }
      lineStartCode = false;
      lastCodeChar = q;
      continue;
    }
    if ("([{".includes(c)) depth++;
    if (")]}".includes(c)) depth = Math.max(0, depth - 1);
    lineStartCode = false;
    lastCodeChar = c;
    i++;
  }
  return out;
}

export function scanShell(src) {
  const out = [];
  const lines = src.split("\n");
  let pos = 0;
  let heredoc = null;
  let quote = null;
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n];
    if (heredoc) {
      const body = heredoc.strip ? line.replace(/^\t+/, "") : line;
      if (body === heredoc.tag) heredoc = null;
      pos += line.length + 1;
      continue;
    }
    if (n === 0 && line.startsWith("#!")) { pos += line.length + 1; continue; }
    for (let k = 0; k < line.length; k++) {
      const c = line[k];
      if (quote) {
        if (c === "\\" && quote === '"') { k++; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "\\") { k++; continue; }
      if (c === "'" || c === '"' || c === "`") { quote = c; continue; }
      const here = /^<<(-?)\s*(['"]?)([A-Za-z_]\w*)\2/.exec(line.slice(k));
      if (here) { heredoc = { tag: here[3], strip: here[1] === "-" }; k += here[0].length - 1; continue; }
      if (c === "#" && (k === 0 || /[\s;&|()]/.test(line[k - 1]))) {
        out.push({ start: pos + k, end: pos + line.length, text: line.slice(k + 1), kind: "line" });
        break;
      }
    }
    pos += line.length + 1;
  }
  return out;
}

export function scanPowerShell(src) {
  const out = [];
  let i = 0;
  let atWordStart = true;
  while (i < src.length) {
    const c = src[i];
    if (c === "<" && src[i + 1] === "#") {
      const close = src.indexOf("#>", i + 2);
      const end = close === -1 ? src.length : close + 2;
      out.push({ start: i, end, text: src.slice(i + 2, close === -1 ? end : close), kind: "block" });
      i = end;
      atWordStart = true;
      continue;
    }
    if (c === "@" && (src[i + 1] === '"' || src[i + 1] === "'") && /\r?\n/.test(src.slice(i + 2, i + 4))) {
      const q = src[i + 1];
      const close = src.indexOf(`\n${q}@`, i + 2);
      i = close === -1 ? src.length : close + 3;
      continue;
    }
    if (c === "'" || c === '"') {
      i++;
      while (i < src.length && src[i] !== c) { if (c === '"' && src[i] === "`") i++; i++; }
      i++;
      atWordStart = false;
      continue;
    }
    if (c === "`") { i += 2; continue; }
    if (c === "#" && atWordStart) {
      const start = i;
      while (i < src.length && src[i] !== "\n") i++;
      out.push({ start, end: i, text: src.slice(start + 1, i), kind: "line" });
      continue;
    }
    atWordStart = /[\s;|(){}=,]/.test(c);
    i++;
  }
  return out;
}

let typescript;
function loadTypeScript() {
  if (typescript !== undefined) return typescript;
  try {
    typescript = createRequire(join(process.cwd(), "package.json"))("typescript");
  } catch {
    typescript = null;
  }
  return typescript;
}

export function scanTsx(src) {
  const ts = loadTypeScript();
  if (!ts) throw new Error("Scanning .tsx/.jsx needs the typescript package installed in this repository.");
  const sf = ts.createSourceFile("x.tsx", src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const seen = new Map();
  const add = (pos, end) => seen.set(pos, { start: pos, end, text: src.startsWith("//", pos) ? src.slice(pos + 2, end) : src.slice(pos + 2, end - 2), kind: src.startsWith("//", pos) ? "line" : "block" });
  const visit = (node) => {
    for (const at of [node.pos, node.end]) {
      for (const r of ts.getLeadingCommentRanges(src, at) ?? []) add(r.pos, r.end);
      for (const r of ts.getTrailingCommentRanges(src, at) ?? []) add(r.pos, r.end);
    }
    if (ts.isJsxExpression(node) && !node.expression) wrappers.push([node.getStart(sf), node.end]);
    node.getChildren(sf).forEach(visit);
  };
  const wrappers = [];
  visit(sf);
  const found = [...seen.values()].sort((a, b) => a.start - b.start);
  for (const c of found) {
    const w = wrappers.find(([s, e]) => s <= c.start && c.end <= e);
    if (w) [c.wrapStart, c.wrapEnd] = w;
  }
  return found;
}

const SCANNERS = { tsx: scanTsx, js: scanJs, css: scanCss, html: scanHtml, py: scanPython, sh: scanShell, ps1: scanPowerShell };

export function rawComments(file, src) {
  const lang = languageOf(file);
  return lang ? SCANNERS[lang](src) : [];
}

export function stripComments(file, input) {
  const src = input.replace(/\r\n/g, "\n");
  let out = "";
  let at = 0;
  for (const c of rawComments(file, src)) {
    const start = c.wrapStart ?? c.start;
    const end = c.wrapEnd ?? c.end;
    if (start < at) continue;
    out += src.slice(at, start);
    at = end;
  }
  out += src.slice(at);
  const python = languageOf(file) === "py";
  return out
    .split("\n")
    .map((line) => (python ? line.replace(/(\S)[ \t]+/g, "$1 ") : line.trim().replace(/[ \t]+/g, " ").replace(/\{ \}/g, "{}")).trimEnd())
    .filter((line) => line !== "")
    .join("\n");
}

export function findComments(file, input) {
  const src = input.replace(/\r\n/g, "\n");
  const raw = rawComments(file, src).filter((c) => !DIRECTIVE.test(c.text.replace(/^[*\s]+/, "")));
  const comments = [];
  for (const c of raw) {
    const line = lineAt(src, c.start);
    const endLine = lineAt(src, c.end);
    const last = comments.at(-1);
    const between = last ? src.slice(last.end, c.start) : null;
    if (last && c.kind === "line" && last.kind === "line" && /^[ \t]*\r?\n[ \t]*$/.test(between)) {
      last.end = c.end;
      last.endLine = endLine;
      last.text += `\n${c.text}`;
      continue;
    }
    comments.push({ ...c, line, endLine });
  }
  return comments;
}

export function commentOnlyLines(src, comments) {
  const lines = src.split("\n");
  const covered = new Array(lines.length).fill(false);
  const masked = src.split("");
  for (const c of comments) for (let k = c.start; k < c.end; k++) if (masked[k] !== "\n") masked[k] = " ";
  const maskedLines = masked.join("").split("\n");
  let count = 0;
  for (const c of comments) {
    for (let n = c.line; n <= c.endLine; n++) {
      if (covered[n - 1]) continue;
      covered[n - 1] = true;
      if (maskedLines[n - 1].trim() === "") count++;
    }
  }
  return count;
}

function repoFiles(root, config) {
  const tracked = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  return tracked.filter((f) => {
    if (!languageOf(f)) return false;
    if (config.languages && !config.languages.includes(languageOf(f))) return false;
    return !(config.exclude ?? []).some((prefix) => f === prefix || f.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`));
  });
}

export function scanRepo(root, config) {
  const result = new Map();
  for (const file of repoFiles(root, config)) {
    let src;
    try { src = readFileSync(join(root, file), "utf8"); } catch { continue; }
    const comments = findComments(file, src);
    if (comments.length) result.set(file, { comments, lines: commentOnlyLines(src.replace(/\r\n/g, "\n"), comments) });
  }
  return result;
}

export function compare(found, baseline) {
  const problems = [];
  const files = new Set([...found.keys(), ...Object.keys(baseline)]);
  for (const file of [...files].sort()) {
    const have = found.get(file)?.comments.length ?? 0;
    const allowed = baseline[file] ?? 0;
    if (have > allowed) {
      const list = found.get(file).comments.map((c) => `    ${file}:${c.line}  ${c.text.split("\n")[0].trim().slice(0, 100)}`);
      problems.push(`${file} has ${have} comment(s); the baseline allows ${allowed}. Put the reason in a name, a test or an ADR under docs/adr/ instead:\n${list.join("\n")}`);
    } else if (have < allowed) {
      problems.push(`${file} has ${have} comment(s) but the baseline still allows ${allowed}. Run the ratchet with --update to lock in the lower count.`);
    }
  }
  return problems;
}

export function loadRepo() {
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const configPath = join(root, "comment-ratchet.json");
  return { root, configPath, config: JSON.parse(readFileSync(configPath, "utf8")) };
}

const MODES = ["--check", "--list", "--verify", "--stats", "--init", "--update"];

function main(argv) {
  const mode = argv[0] ?? "--check";
  if (!MODES.includes(mode)) {
    console.error("Usage: node comment-ratchet.mjs [--check | --list [path ...] | --verify [ref] | --stats | --init | --update]");
    return 2;
  }
  const { root, configPath, config } = loadRepo();
  const found = scanRepo(root, config);
  if (mode === "--list") {
    const only = argv.slice(1);
    for (const [file, { comments }] of found) {
      if (only.length && !only.some((p) => file === p || file.startsWith(`${p.replace(/\/$/, "")}/`))) continue;
      for (const c of comments) console.log(`${file}:${c.line}-${c.endLine}\t${c.text.replace(/\s*\n\s*/g, " ⏎ ").trim()}`);
    }
    return 0;
  }
  if (mode === "--verify") {
    const base = argv[1] ?? "origin/main";
    const changed = execFileSync("git", ["diff", "--name-only", "--diff-filter=M", base, "--"], { cwd: root, encoding: "utf8" }).split("\n").filter((f) => f && languageOf(f));
    const codeChanged = [];
    for (const file of changed) {
      const before = execFileSync("git", ["show", `${base}:${file}`], { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });
      const after = readFileSync(join(root, file), "utf8");
      if (stripComments(file, before) !== stripComments(file, after)) codeChanged.push(file);
    }
    console.log(`${changed.length - codeChanged.length} of ${changed.length} changed source files differ from ${base} only in comments and blank lines.`);
    if (codeChanged.length) console.log(`Code also changed in:\n  ${codeChanged.join("\n  ")}`);
    return 0;
  }
  if (mode === "--stats") {
    let comments = 0, lines = 0;
    for (const v of found.values()) { comments += v.comments.length; lines += v.lines; }
    console.log(JSON.stringify({ files: found.size, comments, commentOnlyLines: lines }));
    return 0;
  }
  if (mode === "--init") {
    if (Object.keys(config.baseline ?? {}).length) {
      console.error("The baseline already exists. Use --update, which can only lower it.");
      return 1;
    }
    config.baseline = Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)).map(([f, v]) => [f, v.comments.length]));
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    return 0;
  }
  if (mode === "--update") {
    const next = {};
    const raised = [];
    for (const [file, { comments }] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
      const allowed = config.baseline?.[file] ?? 0;
      if (comments.length > allowed) raised.push(`${file}: ${allowed} -> ${comments.length}`);
      next[file] = Math.min(comments.length, allowed);
      if (next[file] === 0) delete next[file];
    }
    config.baseline = next;
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
    if (raised.length) {
      console.error(`The ratchet only goes down. These files gained comments and still fail:\n  ${raised.join("\n  ")}`);
      return 1;
    }
    return 0;
  }
  const problems = compare(found, config.baseline ?? {});
  if (problems.length) {
    console.error(`Comment ratchet failed:\n\n${problems.join("\n\n")}`);
    return 1;
  }
  return 0;
}

function isMain() {
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main(process.argv.slice(2));
