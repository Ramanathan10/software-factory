import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Plans, answers, and timeline details are written by agents and shown to the owner; the dashboards build
// every node themselves, so none of that text is ever parsed as HTML.
const files = ['command-center/ui/app.js', 'command-center/ui/markdown.js', 'command-center/ui/attention.js', 'command-center/ui/badge.js', 'mission-console/console.mjs'];

test('the dashboards never parse text as HTML', () => {
  const found = [];
  for (const file of files) {
    readFileSync(new URL('../' + file, import.meta.url), 'utf8').split('\n').forEach((line, index) => {
      if (/\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser|srcdoc)\b/.test(line)) found.push(file + ':' + (index + 1));
    });
  }
  assert.deepEqual(found, [], 'Build nodes with el() or node() and set text with textContent; agent-written text must not become markup.');
});
