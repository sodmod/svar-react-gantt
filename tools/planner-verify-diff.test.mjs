/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for `planner-verify-diff.mjs`, the unified-diff line classifier
 * behind planner-verify.mjs's check 4 (PRO DRIFT). Run directly:
 *   `node --test tools/planner-verify-diff.test.mjs`
 *
 * Phase 4.1C R2, reviewer finding F-R4B: the previous parser (inlined in
 * planner-verify.mjs) recognized a `+++ b/<path>` file header by TEXT
 * PREFIX alone, anywhere in the diff stream. An added SOURCE line whose own
 * text starts with `++` is rendered by `git diff` as a body line starting
 * with `+++`, which the old parser misread as a new file header — silently
 * corrupting path tracking for every added line after it. These tests
 * construct synthetic unified-diff text directly (no real git repository
 * needed) so the parser's structural correctness can be proven on its own,
 * independent of any one commit's exact diff shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseUnifiedDiffAdditions } from './planner-verify-diff.mjs';

test('a body line whose own text starts with `++` does not reset path tracking (reviewer F-R4B)', () => {
  const diff = [
    'diff --git a/src/foo.js b/src/foo.js',
    'index 1111111..2222222 100644',
    '--- a/src/foo.js',
    '+++ b/src/foo.js',
    '@@ -1,0 +2,3 @@',
    '+let __probeCounter = 0;',
    '+++__probeCounter;',
    '+export function probe() { return __probeCounter; }',
    '',
  ].join('\n');

  const added = parseUnifiedDiffAdditions(diff);
  assert.equal(added.length, 3);
  for (const line of added) assert.equal(line.path, 'src/foo.js');
  assert.deepEqual(
    added.map((l) => l.line),
    [2, 3, 4],
  );
  assert.deepEqual(
    added.map((l) => l.text),
    [
      'let __probeCounter = 0;',
      '++__probeCounter;', // the diff marker's single leading '+' stripped, the source's own '++' intact
      'export function probe() { return __probeCounter; }',
    ],
  );
});

test('normal multi-file unified diff (with context lines): correct path and line tracking throughout', () => {
  const diff = [
    'diff --git a/src/a.js b/src/a.js',
    'index aaaaaaa..bbbbbbb 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1,3 +1,4 @@',
    ' function a() {',
    '+  const extra = 1;',
    '   return 1;',
    ' }',
    'diff --git a/src/b.js b/src/b.js',
    'new file mode 100644',
    'index 0000000..ccccccc',
    '--- /dev/null',
    '+++ b/src/b.js',
    '@@ -0,0 +1,2 @@',
    '+export function b() {',
    '+  return 2;',
    '',
  ].join('\n');

  const added = parseUnifiedDiffAdditions(diff);
  assert.deepEqual(
    added.map((l) => ({ path: l.path, line: l.line, text: l.text })),
    [
      { path: 'src/a.js', line: 2, text: '  const extra = 1;' },
      { path: 'src/b.js', line: 1, text: 'export function b() {' },
      { path: 'src/b.js', line: 2, text: '  return 2;' },
    ],
  );
});

test('a deleted file\'s `+++ /dev/null` header is not mistaken for a normal path', () => {
  const diff = [
    'diff --git a/src/gone.js b/src/gone.js',
    'deleted file mode 100644',
    'index 1111111..0000000',
    '--- a/src/gone.js',
    '+++ /dev/null',
    '@@ -1,1 +0,0 @@',
    '-export function gone() {}',
    '',
  ].join('\n');
  const added = parseUnifiedDiffAdditions(diff);
  assert.deepEqual(added, []);
});

test('"\\ No newline at end of file" marker does not disturb hunk line counting', () => {
  const diff = [
    'diff --git a/src/c.js b/src/c.js',
    'index 1111111..2222222 100644',
    '--- a/src/c.js',
    '+++ b/src/c.js',
    '@@ -1 +1,2 @@',
    '-export const c = 1;',
    '\\ No newline at end of file',
    '+export const c = 1;',
    '+export const d = 2;',
    '\\ No newline at end of file',
    '',
  ].join('\n');
  const added = parseUnifiedDiffAdditions(diff);
  assert.deepEqual(
    added.map((l) => ({ path: l.path, line: l.line, text: l.text })),
    [
      { path: 'src/c.js', line: 1, text: 'export const c = 1;' },
      { path: 'src/c.js', line: 2, text: 'export const d = 2;' },
    ],
  );
});

test('an added line beginning with `---` (three literal dashes in the source) does not falsely open a new file header', () => {
  // Mirrors the F-R4B class from the OTHER marker: an added source line
  // whose own text happens to start with two dashes renders as a diff body
  // line starting with three. It must stay body content, exactly like the
  // `++` case, and must not be misread as a `--- a/<path>` header either.
  const diff = [
    'diff --git a/src/d.js b/src/d.js',
    'index 1111111..2222222 100644',
    '--- a/src/d.js',
    '+++ b/src/d.js',
    '@@ -1,0 +2,2 @@',
    '+-- a section divider, not a diff header',
    '+export const after = true;',
    '',
  ].join('\n');
  const added = parseUnifiedDiffAdditions(diff);
  assert.deepEqual(
    added.map((l) => ({ path: l.path, line: l.line, text: l.text })),
    [
      { path: 'src/d.js', line: 2, text: '-- a section divider, not a diff header' },
      { path: 'src/d.js', line: 3, text: 'export const after = true;' },
    ],
  );
});

test('an unrecognized marker inside a hunk whose declared counts are not yet exhausted fails closed', () => {
  const diff = [
    'diff --git a/src/e.js b/src/e.js',
    'index 1111111..2222222 100644',
    '--- a/src/e.js',
    '+++ b/src/e.js',
    '@@ -0,0 +1,1 @@',
    '#not a valid unified-diff line marker',
    '',
  ].join('\n');
  assert.throws(() => parseUnifiedDiffAdditions(diff), /unrecognized line inside a hunk/);
});

test('empty diff text: no added lines, no crash', () => {
  assert.deepEqual(parseUnifiedDiffAdditions(''), []);
});
