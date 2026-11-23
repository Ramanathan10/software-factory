import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// The browser code of both dashboards, where a child value becomes visible text.
const files = ['command-center/ui/app.js', 'command-center/ui/markdown.js', 'command-center/ui/attention.js', 'mission-console/console.mjs'];

// 1035544: `story.artifacts?.length && el(...)` put the count 0 on the page, and `false` beside it.
test('no element is guarded by a bare count, which renders 0 as text', () => {
  const found = [];
  for (const file of files) {
    const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
    for (const match of source.matchAll(/\.length\s*&&\s*(el|node|md)\(/g)) {
      found.push(file + ':' + (source.slice(0, match.index).split('\n').length));
    }
  }
  assert.deepEqual(found, [], 'Write `list.length > 0 && el(...)`: with an empty list, `list.length && el(...)` is 0, and the page shows "0".');
});
