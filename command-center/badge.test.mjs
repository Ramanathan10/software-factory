import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { roles } from '../mission-console/roles.mjs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');

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

const linear = c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const channels = hex => [1, 3, 5].map(at => linear(parseInt(hex.slice(at, at + 2), 16) / 255));
const oklab = hex => {
  const [r, g, b] = channels(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
};
const difference = (a, b) => Math.hypot(...oklab(a).map((value, at) => value - oklab(b)[at])) * 100;
const contrast = (a, b) => {
  const [hi, lo] = [a, b].map(hex => { const [r, g, b] = channels(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }).sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test('each role color is readable, and looks like neither a state color nor another persona', () => {
  const css = read('./ui/app.css');
  const token = name => css.match(new RegExp('--' + name + ':\\s*(#[0-9a-f]{6})', 'i'))?.[1];
  const states = { amber: token('amber'), red: token('red'), green: token('green') };
  const colors = Object.fromEntries(Object.keys(roles).map(id => {
    const value = css.match(new RegExp('\\[data-role="' + id + '"\\] \\{ --role: ([^;]+);'))?.[1];
    assert.ok(value, id + ' has no --role color in app.css');
    return [id, value.startsWith('var(') ? token(value.slice(6, -1)) : value];
  }));
  for (const [id, color] of Object.entries(colors)) {
    for (const ground of ['panel', 'panel-2']) {
      assert.ok(contrast(color, token(ground)) >= 4.5, id + ' is ' + contrast(color, token(ground)).toFixed(2) + ':1 on --' + ground + '; story ids in it need 4.5:1');
    }
    if (id === 'approver') continue;
    for (const [state, value] of Object.entries(states)) {
      assert.ok(difference(color, value) >= 8, id + ' is ' + difference(color, value).toFixed(1) + ' from ' + state + ', which means a state');
    }
    for (const [other, value] of Object.entries(colors)) {
      if (other === id || roles[other].alias === roles[id].alias) continue;
      assert.ok(difference(color, value) >= 8, id + ' and ' + other + ' are ' + difference(color, value).toFixed(1) + ' apart');
    }
  }
});
