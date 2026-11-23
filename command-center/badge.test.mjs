import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { roles } from '../mission-console/roles.mjs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');

// A ring style or motion with no rule draws a plain ring or a still glyph, and nothing fails.
test('every ring style and motion a badge names has a rule in app.css', () => {
  const css = read('./ui/app.css');
  for (const [id, { badge }] of Object.entries(roles)) {
    assert.ok(css.includes('.ring.' + badge.ring + ' '), id + ' names the ring style "' + badge.ring + '", which app.css does not draw');
    if (badge.motion) assert.ok(css.includes('.avatar.moving .k-' + badge.motion + ' '), id + ' names the motion "' + badge.motion + '", which app.css does not animate');
  }
});

test('every module the Command Center page imports is served', () => {
  const service = read('./console-service.mjs');
  for (const file of ['./ui/app.js', './ui/badge.js', './ui/markdown.js', './ui/attention.js']) {
    for (const [, name] of read(file).matchAll(/from '\.\/([\w-]+\.js)'/g)) {
      assert.ok(service.includes("['/" + name + "', ['" + name + "'"), file + ' imports ' + name + ', which command-center/console-service.mjs does not serve');
    }
  }
});
