/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M10).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the pure half of SVAR-M10. Run: `npm run test:planner`
 * (plain `node --test`, no extra dependency).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the two pure functions answer as documented on the inputs below. It
 * proves NOTHING about what a browser paints during a real gesture, and in
 * particular it does not prove that the store still collapses the width these
 * functions exist to repair — that is a fact about the installed store, and
 * only the Planner's own real-Chromium suite can observe it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectAncestorBarGeometry,
  resolveCollapsedSummaryGeometry,
} from '../src/components/chart/summaryDragGeometry.js';

/**
 * A tiny tree: OUTER > INNER > MILESTONE, plus an unrelated root leaf.
 *
 * No `type` field on purpose. Neither function under test reads one — the
 * rule is about the `parent` chain and the live `$x`/`$w`, and a bar of any
 * kind whose transient width the store collapsed gets the same answer.
 * Leaving it out states that dependency exactly, instead of implying a type
 * check that does not exist; the ids say which node is which.
 */
function tree(overrides = {}) {
  const tasks = {
    outer: { id: 'outer', parent: 0, $x: 100, $w: 34 },
    inner: { id: 'inner', parent: 'outer', $x: 100, $w: 34 },
    milestone: { id: 'milestone', parent: 'inner', $x: 117, $w: 31 },
    unrelated: { id: 'unrelated', parent: 0, $x: 500, $w: 68 },
    ...overrides,
  };
  return { tasks, getTask: (id) => tasks[id] };
}

test('SVAR-M10: the ancestor walk records every ancestor, in one map, and stops at the root', () => {
  const { tasks, getTask } = tree();
  const geometry = collectAncestorBarGeometry(getTask, tasks.milestone);
  assert.deepEqual([...geometry.keys()].sort(), ['inner', 'outer']);
  assert.deepEqual(geometry.get('outer'), { x: 100, w: 34 });
  assert.deepEqual(geometry.get('inner'), { x: 100, w: 34 });
});

test('SVAR-M10: a root task has no ancestors, and a missing task is not an error', () => {
  const { tasks, getTask } = tree();
  assert.equal(collectAncestorBarGeometry(getTask, tasks.unrelated).size, 0);
  assert.equal(collectAncestorBarGeometry(getTask, null).size, 0);
  assert.equal(
    collectAncestorBarGeometry(() => undefined, tasks.milestone).size,
    0,
  );
});

test('SVAR-M10: an ancestor with nothing to preserve is not recorded', () => {
  for (const broken of [{ $x: 100, $w: 0 }, { $x: 100, $w: -41 }, { $x: Number.POSITIVE_INFINITY, $w: 34 }]) {
    const { tasks, getTask } = tree({
      inner: { id: 'inner', parent: 'outer', ...broken },
    });
    const geometry = collectAncestorBarGeometry(getTask, tasks.milestone);
    assert.equal(geometry.has('inner'), false, JSON.stringify(broken));
    assert.equal(geometry.has('outer'), true, 'the rest of the chain still is');
  }
});

test('SVAR-M10: a cycle in the parent chain terminates instead of hanging', () => {
  const tasks = {
    a: { id: 'a', parent: 'b', $x: 1, $w: 2 },
    b: { id: 'b', parent: 'a', $x: 3, $w: 4 },
  };
  const geometry = collectAncestorBarGeometry((id) => tasks[id], tasks.a);
  assert.deepEqual([...geometry.keys()].sort(), ['a', 'b']);
});

test('SVAR-M10: a collapsed ancestor is drawn at its pre-gesture width, translated by the gesture', () => {
  const { tasks, getTask } = tree();
  const geometry = collectAncestorBarGeometry(getTask, tasks.milestone);
  // What the store writes on an accepted step: the extent of a single date.
  const collapsed = { id: 'outer', $x: 168, $w: 0 };
  assert.deepEqual(resolveCollapsedSummaryGeometry(collapsed, geometry, 51), {
    x: 151,
    w: 34,
  });
  // The bar it is drawn relative to keeps its own relationship to its content:
  // 100 + 34 === 134 ended on the milestone's centre before the gesture, and
  // 151 + 34 === 185 ends on it 51 px later.
  assert.equal(100 + 34 + 51, 151 + 34);
});

test('SVAR-M10: a NEGATIVE live width is repaired the same way', () => {
  const { tasks, getTask } = tree();
  const geometry = collectAncestorBarGeometry(getTask, tasks.milestone);
  assert.deepEqual(
    resolveCollapsedSummaryGeometry({ id: 'inner', $x: 168, $w: -41 }, geometry, 0),
    { x: 100, w: 34 },
  );
});

test('SVAR-M10: with the pointer up (dx 0) the bar returns exactly where it began', () => {
  const { tasks, getTask } = tree();
  const geometry = collectAncestorBarGeometry(getTask, tasks.milestone);
  assert.deepEqual(
    resolveCollapsedSummaryGeometry({ id: 'outer', $x: 999, $w: 0 }, geometry, 0),
    { x: 100, w: 34 },
  );
  for (const nonsense of [undefined, null, Number.NaN, 'x']) {
    assert.deepEqual(
      resolveCollapsedSummaryGeometry({ id: 'outer', $x: 999, $w: 0 }, geometry, nonsense),
      { x: 100, w: 34 },
      `dx=${String(nonsense)} must be treated as no displacement`,
    );
  }
});

test('SVAR-M10: every bar that has NOT collapsed keeps the store\'s own live geometry', () => {
  const { tasks, getTask } = tree();
  const geometry = collectAncestorBarGeometry(getTask, tasks.milestone);
  // A positive width: the store's live extent is real, and it wins.
  assert.equal(resolveCollapsedSummaryGeometry({ id: 'outer', $x: 168, $w: 12 }, geometry, 51), null);
  // The dragged bar itself is never in the map.
  assert.equal(resolveCollapsedSummaryGeometry({ id: 'milestone', $x: 168, $w: 0 }, geometry, 51), null);
  // Nor is any bar outside the chain.
  assert.equal(resolveCollapsedSummaryGeometry({ id: 'unrelated', $x: 0, $w: 0 }, geometry, 51), null);
  // And with no gesture ever taken there is nothing to restore.
  assert.equal(resolveCollapsedSummaryGeometry({ id: 'outer', $x: 168, $w: 0 }, null, 51), null);
});
