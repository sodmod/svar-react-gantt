/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M32).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the pure link router (`src/planner-router/route.js`). Run:
 * `npm run test:planner` (plain `node --test`, no extra dependency).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the router's pure functions classify and draw the geometry cases
 * below exactly as documented. It proves NOTHING about what a real browser
 * paints, about hit-testing, about hover/selection styling, or about the
 * `Links.jsx` integration (own culling, channel wiring, presentation
 * callback) — those are the Planner product's own real-Chromium suite's
 * job, not this file's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LINK_TOKENS,
  routeLink,
  assignChannels,
  buildRoundedPath,
  arrowPolygonPoints,
  boundingBox,
} from '../src/planner-router/route.js';

const ROW_HEIGHT = 40;

function rect(x, y, w, h = 24) {
  return { x, y, w, h };
}

test('standard route: enough horizontal room draws exit-right / vertical / enter-left with no extra bends', () => {
  const route = routeLink({
    sourceRect: rect(0, 0, 100),
    targetRect: rect(300, ROW_HEIGHT, 100),
    rowHeight: ROW_HEIGHT,
  });
  assert.equal(route.routeClass, 'standard');
  assert.equal(route.points.length, 4);
  const [p0, p1, p2, p3] = route.points;
  assert.equal(p0[0], 100); // source right edge
  assert.equal(p1[0], p2[0]); // one principal vertical
  assert.equal(p3[0], 300); // target left edge
  assert.equal(route.arrowDir, 'right');
});

test('D-166 §E: a one-day gap at the product default day-cell width (34px) is tight entry, top for a successor below', () => {
  // Predecessor ends at x=100; successor starts one default day-cell later.
  const route = routeLink({
    sourceRect: rect(0, 0, 100),
    targetRect: rect(100 + 34, ROW_HEIGHT, 100),
    rowHeight: ROW_HEIGHT,
  });
  assert.equal(route.routeClass, 'tightEntry');
  assert.equal(route.arrowDir, 'down');
  const entryPoint = route.points[route.points.length - 1];
  assert.equal(entryPoint[1], ROW_HEIGHT); // enters at the target's TOP edge
});

test('negative control: the rejected prototype threshold (gap >= clearance + 10px) would wrongly call the one-day case a standard L — this router does not', () => {
  const gap = 34; // the one-day gap above
  const rejectedThreshold = LINK_TOKENS.clearance + 10; // 22px
  assert.ok(
    gap >= rejectedThreshold,
    'the one-day gap must exceed the rejected demo threshold, or this control proves nothing',
  );
  const route = routeLink({
    sourceRect: rect(0, 0, 100),
    targetRect: rect(100 + gap, ROW_HEIGHT, 100),
    rowHeight: ROW_HEIGHT,
  });
  assert.notEqual(
    route.routeClass,
    'standard',
    'reverting to the rejected threshold would make this RED (D-166 §E, kickoff §17)',
  );
});

test('vertical mirror: a successor ABOVE the source also gets tight entry, from the bottom', () => {
  const route = routeLink({
    sourceRect: rect(0, ROW_HEIGHT, 100),
    targetRect: rect(100 + 10, 0, 100),
    rowHeight: ROW_HEIGHT,
  });
  assert.equal(route.routeClass, 'tightEntry');
  assert.equal(route.arrowDir, 'up');
  const entryPoint = route.points[route.points.length - 1];
  assert.equal(entryPoint[1], 0 + 24); // enters at the target's BOTTOM edge
});

test('D-166 §F: even a very short target bar stays in the tight-entry family, not a separate short-target route class', () => {
  const route = routeLink({
    sourceRect: rect(0, 0, 100),
    targetRect: rect(110, ROW_HEIGHT, 12), // 12px wide target, shorter than the archive's rejected ~20px case
    rowHeight: ROW_HEIGHT,
  });
  assert.equal(route.routeClass, 'tightEntry');
  const entryX = route.points[route.points.length - 1][0];
  assert.ok(
    entryX >= 110 && entryX <= 122,
    'entry x must stay inside the narrow bar',
  );
});

test('reverse-time bypass: a successor that starts before the predecessor ends is routed around, not through the bars', () => {
  const source = rect(200, 0, 100); // spans [200,300)
  const target = rect(50, ROW_HEIGHT, 100); // starts well before source ends
  const route = routeLink({
    sourceRect: source,
    targetRect: target,
    rowHeight: ROW_HEIGHT,
  });
  assert.equal(route.routeClass, 'reverseBypass');
  const box = boundingBox(route.points);
  // The route must reach at least as far right as the source's own end
  // before turning back — an "обход", not a direct crossing through it.
  assert.ok(box.x2 >= source.x + source.w);
});

test('blocking-bar corridor: an intervening bar pushes the single vertical clear of it, without a staircase', () => {
  const source = rect(0, 0, 50);
  const target = rect(400, ROW_HEIGHT * 3, 50);
  const blocker = rect(40, ROW_HEIGHT, 200); // sits on the naive vertical (source.x+w+clearance=62), in a row between source/target
  const route = routeLink({
    sourceRect: source,
    targetRect: target,
    rowHeight: ROW_HEIGHT,
    obstacles: [blocker],
  });
  assert.equal(route.routeClass, 'standard');
  const verticalX = route.points[1][0];
  assert.ok(
    verticalX >= blocker.x + blocker.w,
    'the vertical must clear the blocker on one side, not thread through it',
  );
  // Exactly one principal vertical segment (points[1].x === points[2].x) —
  // no staircase of alternating short segments.
  assert.equal(route.points[1][0], route.points[2][0]);
});

test('D-166 §G/§H: visible fan-out from one source is assigned separate, deterministic channels — never a shared trunk', () => {
  const links = [
    {
      id: 'b-link',
      sourceId: 's',
      sourceSide: 'end',
      targetId: 't1',
      targetSide: 'start',
    },
    {
      id: 'a-link',
      sourceId: 's',
      sourceSide: 'end',
      targetId: 't2',
      targetSide: 'start',
    },
    {
      id: 'c-link',
      sourceId: 's',
      sourceSide: 'end',
      targetId: 't3',
      targetSide: 'start',
    },
  ];
  const channels = assignChannels(links);
  const values = links.map((l) => channels.get(l.id));
  assert.deepEqual(
    new Set(values).size,
    3,
    'every fanned-out link gets its own channel',
  );
  // Deterministic by id, not by array order: 'a-link' sorts first.
  assert.equal(channels.get('a-link'), 0);
  assert.equal(channels.get('b-link'), 1);
  assert.equal(channels.get('c-link'), 2);
});

test('negative control: collapsing channelStep to zero collapses distinct fan-out channels onto the same x — this router does not do that by default', () => {
  const route1 = routeLink({
    sourceRect: rect(0, 0, 50),
    targetRect: rect(300, ROW_HEIGHT, 50),
    rowHeight: ROW_HEIGHT,
    channelOffset: 0,
  });
  const route2 = routeLink({
    sourceRect: rect(0, 0, 50),
    targetRect: rect(300, ROW_HEIGHT * 2, 50),
    rowHeight: ROW_HEIGHT,
    channelOffset: 1,
  });
  assert.notEqual(
    route1.points[1][0],
    route2.points[1][0],
    'distinct channel offsets must land on distinct vertical x positions',
  );
  const zeroStepTokens = { ...LINK_TOKENS, channelStep: 0 };
  const collapsed1 = routeLink({
    sourceRect: rect(0, 0, 50),
    targetRect: rect(300, ROW_HEIGHT, 50),
    rowHeight: ROW_HEIGHT,
    channelOffset: 0,
    tokens: zeroStepTokens,
  });
  const collapsed2 = routeLink({
    sourceRect: rect(0, 0, 50),
    targetRect: rect(300, ROW_HEIGHT * 2, 50),
    rowHeight: ROW_HEIGHT,
    channelOffset: 1,
    tokens: zeroStepTokens,
  });
  assert.equal(
    collapsed1.points[1][0],
    collapsed2.points[1][0],
    'channelStep=0 is the negative control: channels collapse onto one x (kickoff §17)',
  );
});

test('fan-in from several sources into one target also gets separate channels (deterministic by id)', () => {
  const links = [
    {
      id: 'link-2',
      sourceId: 's2',
      sourceSide: 'end',
      targetId: 't',
      targetSide: 'start',
    },
    {
      id: 'link-1',
      sourceId: 's1',
      sourceSide: 'end',
      targetId: 't',
      targetSide: 'start',
    },
  ];
  const channels = assignChannels(links);
  assert.equal(channels.get('link-1'), 0);
  assert.equal(channels.get('link-2'), 1);
});

test('a link with no colliding sibling gets channel 0', () => {
  const channels = assignChannels([
    {
      id: 'solo',
      sourceId: 's',
      sourceSide: 'end',
      targetId: 't',
      targetSide: 'start',
    },
  ]);
  assert.equal(channels.get('solo'), 0);
});

test('rounded path: a corner radius never exceeds half of the shorter adjacent segment', () => {
  const points = [
    [0, 0],
    [10, 0], // short 10px segment
    [10, 100],
  ];
  const d = buildRoundedPath(points, LINK_TOKENS.radius);
  // With a 10px segment and radius 12, the effective radius clamps to 5:
  // the quadratic control point must land at x=5, not x=12.
  assert.match(d, /Q10,0 10,5/);
});

test('arrowhead: a rightward tip produces a filled triangle whose back sits arrowLength behind the tip', () => {
  const points = arrowPolygonPoints([100, 50], 'right', LINK_TOKENS).split(' ');
  const [tip, p1, p2] = points.map((pair) => pair.split(',').map(Number));
  assert.deepEqual(tip, [100, 50]);
  assert.equal(p1[0], 100 - LINK_TOKENS.arrowLength);
  assert.equal(p2[0], 100 - LINK_TOKENS.arrowLength);
  assert.ok(Math.abs(p1[1] - p2[1] + LINK_TOKENS.arrowWidth) < 1e-9);
});

test('unsupported link type (not creatable through the product UI) still produces a route rather than throwing', () => {
  const route = routeLink({
    sourceRect: rect(0, 0, 50),
    targetRect: rect(300, ROW_HEIGHT, 50),
    type: 's2e',
    rowHeight: ROW_HEIGHT,
  });
  assert.equal(route.routeClass, 'generic');
  assert.ok(route.points.length >= 2);
});
