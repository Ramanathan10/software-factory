import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const templatePath = fileURLToPath(new URL('./skills/ai-sdlc/references/plan-template.md', import.meta.url));
const skillPath = fileURLToPath(new URL('./skills/ai-sdlc/SKILL.md', import.meta.url));
const TEMPLATE = 'skills/ai-sdlc/references/plan-template.md';
const REQUIRED_PHRASE = 'still gets a red test on the text it adds';

function template() {
  assert.ok(existsSync(templatePath), `${TEMPLATE} must exist`);
  return readFileSync(templatePath, 'utf8').replace(/\r\n/g, '\n');
}

function skill() {
  return readFileSync(skillPath, 'utf8').replace(/\r\n/g, '\n');
}

function sectionOf(text, heading) {
  const level = heading.match(/^#+/)[0].length;
  const lines = text.split('\n');
  let fence = null;
  let start = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const marker = lines[i].match(/^(`{3,})/);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (lines[i].startsWith(fence)) fence = null;
      continue;
    }
    if (fence) continue;
    const found = lines[i].match(/^(#+) /);
    if (start === -1) {
      if (lines[i].trim() === heading) start = i;
    } else if (found && found[1].length <= level) {
      return lines.slice(start, i).join('\n');
    }
  }
  return start === -1 ? null : lines.slice(start).join('\n');
}

function skeletonOf(name) {
  const section = sectionOf(template(), `## ${name}`);
  assert.ok(section, `${TEMPLATE} must have a "## ${name}" section`);
  const fenced = section.match(/^(`{3,})[^\n]*\n([\s\S]*?)^\1[ \t]*$/m);
  assert.ok(fenced, `"## ${name}" must hold one fenced skeleton`);
  return fenced[2];
}

const headingLines = skeleton => skeleton.split('\n').filter(line => /^#{1,6} /.test(line));

function levels(skeleton, wanted) {
  return headingLines(skeleton).filter(line => wanted.includes(line.match(/^#+/)[0].length));
}

function checkTitleThen(skeleton, expected) {
  const found = levels(skeleton, [1, 2]);
  assert.match(found[0], /^# <ID>: \S/);
  assert.deepEqual(found.slice(1), expected);
}

test('the Feature plan skeleton holds its sections in order', () => {
  const skeleton = skeletonOf('Feature plan');
  checkTitleThen(skeleton, [
    '## Problem',
    '## Settled decisions',
    '## Design',
    '## Acceptance criteria',
    '## Test level',
    '## Run decisions',
    '## Out of scope',
    '## Plan critique',
  ]);
  const lines = headingLines(skeleton);
  const design = lines.indexOf('## Design');
  assert.match(lines[design + 1], /^### \S/, 'Design holds at least one ### area');
});

test('the Bug plan skeleton holds its sections in order', () => {
  const skeleton = skeletonOf('Bug plan');
  checkTitleThen(skeleton, [
    '## Problem',
    '## Reproduction',
    '## Root cause',
    '## Settled decisions',
    '## Fix',
    '## Acceptance criteria',
    '## Test level',
    '## Run decisions',
    '## Out of scope',
    '## Plan critique',
  ]);
  const lines = headingLines(skeleton);
  const fix = lines.indexOf('## Fix');
  assert.match(lines[fix + 1], /^### \S/, 'Fix holds at least one ### area');
});

test('the Context pack skeleton holds its five subsections in order', () => {
  const skeleton = skeletonOf('Context pack');
  assert.deepEqual(headingLines(skeleton), [
    '## Context pack',
    '### Files and entry points',
    '### Rules that apply',
    '### Commands',
    '### Similar earlier changes',
    '### Risks',
  ]);
});

test('both plan skeletons say a text-only story still gets a red test', () => {
  for (const name of ['Feature plan', 'Bug plan']) {
    const skeleton = skeletonOf(name);
    const at = skeleton.indexOf('## Test level');
    assert.notEqual(at, -1, `${name} has a Test level section`);
    const rest = skeleton.slice(at + '## Test level'.length);
    const next = rest.search(/^#{1,6} /m);
    const description = next === -1 ? rest : rest.slice(0, next);
    assert.ok(description.includes(REQUIRED_PHRASE), `${name}: Test level says "${REQUIRED_PHRASE}"`);
  }
});

test('the template uses no heading deeper than three levels and no HTML', () => {
  const text = template();
  assert.doesNotMatch(text, /^#{4,} /m);
  assert.doesNotMatch(text, /<\/?(a|b|br|details|div|em|h[1-6]|hr|i|img|li|ol|p|span|strong|summary|table|td|th|tr|ul)[\s\/>]/i);
  assert.doesNotMatch(text, /!\[[^\]]*\]\(/);
});

test('SKILL.md names the template in each phase that uses it', () => {
  const text = skill();
  const wanted = [
    ['### Feature lane', 'Feature plan'],
    ['### Bug lane', 'Bug plan'],
    ['### Write and approve the spec', null],
    ['## 2. Test-first handoff', null],
  ];
  for (const [heading, plan] of wanted) {
    const section = sectionOf(text, heading);
    assert.ok(section, `SKILL.md has "${heading}"`);
    assert.ok(section.includes('references/plan-template.md'), `"${heading}" names references/plan-template.md`);
    if (plan) assert.ok(section.includes(plan), `"${heading}" names the ${plan}`);
  }
});

test('SKILL.md says the context pack is appended to the committed spec', () => {
  const text = skill();
  assert.ok(sectionOf(text, '### Scout').includes('appended to the committed spec'));
  assert.ok(sectionOf(text, '### Scout').includes('Context pack shape of `references/plan-template.md`'));
  assert.match(sectionOf(text, '## 2. Test-first handoff'), /spec location and the spec is not committed yet/);
  assert.match(sectionOf(text, '### Write and approve the spec'), /context pack appended as its last section/);
  assert.ok(sectionOf(text, '## 2. Test-first handoff').includes('## Context pack'));
});
