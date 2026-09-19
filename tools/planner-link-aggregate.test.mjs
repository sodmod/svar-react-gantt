/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M37).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the pure collapsed-group aggregation (`src/planner-router/
 * aggregate.js`). Run: `npm run test:planner` (plain `node --test`).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the aggregation's pure functions group, key and clip geometry
 * exactly as documented. It proves NOTHING about the real `<Gantt>`
 * integration (badge rendering, hover, popover, the reveal gesture) — that
 * is the Planner product's own real-Chromium suite's job, not this file's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  findVisibleRepresentative,
  buildAggregates,
  pickBadgeAnchor,
  collapsedAncestorsToOpen,
} from '../src/planner-router/aggregate.js';

/* A small tree: 0 (root) -> A -> [B, C], D (sibling leaf), E -> F -> G. */
const TREE = {
  A: { id: 'A', parent: 0, open: false },
  B: { id: 'B', parent: 'A' },
  C: { id: 'C', parent: 'A' },
  D: { id: 'D', parent: 0, open: true },
  E: { id: 'E', parent: 0, open: true },
  F: { id: 'F', parent: 'E', open: false },
  G: { id: 'G', parent: 'F' },
};

function getTask(id) {
  return TREE[id];
}

test('findVisibleRepresentative: a visible task resolves to itself', () => {
  const visible = new Set(['A', 'B', 'D']);
  assert.equal(findVisibleRepresentative('B', getTask, visible), 'B');
});

test('findVisibleRepresentative: a hidden task resolves to its nearest visible ancestor', () => {
  const visible = new Set(['A', 'D']); // A's children (B, C) are collapsed
  assert.equal(findVisibleRepresentative('B', getTask, visible), 'A');
  assert.equal(findVisibleRepresentative('C', getTask, visible), 'A');
});

test('findVisibleRepresentative: a task with no tree entry at all resolves to null (E-2 firebreak)', () => {
  // A filter that removed a task from the tasks the store was ever handed
  // leaves no tree entry for it — the same seam a collapsed ancestor uses,
  // by construction, never a name this module has to know about.
  const visible = new Set(['A']);
  assert.equal(findVisibleRepresentative('ghost', getTask, visible), null);
});

test('findVisibleRepresentative: reaching the root with nothing visible resolves to null (defensive)', () => {
  const visible = new Set(['nothing-is-visible']);
  assert.equal(findVisibleRepresentative('F', getTask, visible), null);
});

test('buildAggregates: a fully visible link is excluded, never re-drawn as an aggregate', () => {
  const visible = new Set(['B', 'D']);
  const links = [{ id: 'l1', source: 'B', target: 'D', mode: 'soft' }];
  assert.deepEqual(buildAggregates(links, getTask, visible), []);
});

test('buildAggregates: a link with one hidden endpoint aggregates to its representative, count 1', () => {
  const visible = new Set(['A', 'D']);
  const links = [{ id: 'l1', source: 'B', target: 'D', mode: 'soft' }];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].source, 'A');
  assert.equal(aggregates[0].target, 'D');
  assert.equal(aggregates[0].count, 1);
  assert.deepEqual(aggregates[0].memberLinkIds, ['l1']);
});

test('buildAggregates: two links collapsing to the same representative/direction/mode merge into one aggregate, count 2', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D', mode: 'soft' },
    { id: 'l2', source: 'C', target: 'D', mode: 'soft' },
  ];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 1);
  assert.equal(aggregates[0].count, 2);
  assert.deepEqual(
    new Set(aggregates[0].memberLinkIds),
    new Set(['l1', 'l2']),
  );
});

test('NEGATIVE CONTROL (D-166 §K, kickoff §17): mixed mode never aggregates into one badge', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D', mode: 'soft' },
    { id: 'l2', source: 'C', target: 'D', mode: 'informational' },
  ];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(
    aggregates.length,
    2,
    'different mode must never merge into one aggregate, even with the same representative endpoints',
  );
  for (const aggregate of aggregates) assert.equal(aggregate.count, 1);
});

test('buildAggregates: opposite direction between the same two representatives never merges (D-166: direction is part of the key)', () => {
  const visible = new Set(['A', 'D']);
  const links = [
    { id: 'l1', source: 'B', target: 'D', mode: 'soft' }, // A -> D
    { id: 'l2', source: 'D', target: 'C', mode: 'soft' }, // D -> A
  ];
  const aggregates = buildAggregates(links, getTask, visible);
  assert.equal(aggregates.length, 2);
  const bySource = new Map(aggregates.map((a) => [a.source, a]));
  assert.equal(bySource.get('A').target, 'D');
  assert.equal(bySource.get('D').target, 'A');
});

test('buildAggregates: a link with a filter-hidden endpoint (no tree entry) is skipped entirely, not aggregated (E-2 firebreak)', () => {
  const visible = new Set(['A', 'D']);
  const links = [{ id: 'l1', source: 'ghost', target: 'D', mode: 'soft' }];
  assert.deepEqual(buildAggregates(links, getTask, visible), []);
});

test('collapsedAncestorsToOpen: one collapsed ancestor -> just that one, in top-down order', () => {
  assert.deepEqual(collapsedAncestorsToOpen('B', getTask), ['A']);
});

test('collapsedAncestorsToOpen: two collapsed ancestors -> the FARTHER one first (top-down cascade)', () => {
  assert.deepEqual(collapsedAncestorsToOpen('G', getTask), ['F']);
});

test('collapsedAncestorsToOpen: stops at an already-open ancestor, opens nothing above it', () => {
  // D is already open (and has no children in this fixture, but the rule
  // is the same): nothing needs opening for an already-visible task.
  assert.deepEqual(collapsedAncestorsToOpen('D', getTask), []);
});

test('pickBadgeAnchor: both ends visible -> the midpoint of the (fully clipped) route', () => {
  const points = [
    [0, 0],
    [100, 0],
  ];
  const anchor = pickBadgeAnchor(points, { from: -10, to: 110 });
  assert.deepEqual(anchor, [50, 0]);
});

test('pickBadgeAnchor: only the target end on screen -> the anchor sits in the visible run near it', () => {
  const points = [
    [0, 0],
    [1000, 0],
  ];
  const anchor = pickBadgeAnchor(points, { from: 900, to: 1100 });
  assert.ok(anchor[0] >= 900 && anchor[0] <= 1000);
});

test('pickBadgeAnchor: both ends off screen but the route crosses the viewport -> anchor inside the crossing segment', () => {
  const points = [
    [0, 0],
    [1000, 0],
  ];
  const anchor = pickBadgeAnchor(points, { from: 400, to: 600 });
  assert.ok(anchor[0] >= 400 && anchor[0] <= 600);
});

test('NEGATIVE CONTROL (D-166 Blocker: no floating badge without a visible route segment): route never enters the viewport -> null', () => {
  const points = [
    [0, 0],
    [100, 0],
  ];
  const anchor = pickBadgeAnchor(points, { from: 500, to: 600 });
  assert.equal(
    anchor,
    null,
    'a route that never touches the viewport must not produce a badge anchor',
  );
});

test('pickBadgeAnchor: a bent route picks its anchor from the longest visible run, not the first one', () => {
  const points = [
    [0, 0],
    [50, 0],
    [50, 500],
    [1000, 500],
  ];
  // A short visible sliver near x=50 and a long one from x=200 to x=1000 at
  // y=500 — the anchor must land in the long run, not the short one.
  const anchor = pickBadgeAnchor(points, { from: 45, to: 1000 });
  assert.equal(anchor[1], 500);
});
