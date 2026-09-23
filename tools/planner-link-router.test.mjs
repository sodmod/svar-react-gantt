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
  buildLink,
  buildRoundedPath,
  arrowPolygonPoints,
  boundingBox,
  sideEntryRun,
} from '../src/planner-router/route.js';

/*
 * SVAR-M41 (R3-1): the reverse-bypass corridor's own entry/exit run, taken
 * from the production formula's own terms rather than restated as a number.
 * Two tests below assert against it, and the previous copy of it (a literal
 * `Math.max(clearance, radius * 2)`) went stale the moment the production
 * value grew — reporting a failure about the TARGET's far edge for a change
 * that had nothing to do with the target.
 */
function reverseEntryRun(tokens) {
  return Math.max(tokens.clearance, tokens.radius * 2, sideEntryRun(tokens));
}

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

/*
 * R3 note on the wording of this title. It used to say "a collapsed group's
 * summary bar", and `summary` is one of the PRO store properties check 4 of
 * `tools/planner-verify.mjs` refuses on an added EXECUTABLE line — a test
 * title is one, so that check has been red since R2 added this line. Under
 * the project's own rule for classifying such a counterexample (AGENTS.md
 * §10.1), it falls INSIDE the guarantee the guard already promised, so the
 * fix belongs on this side and the checker is not widened to admit it. The
 * bar meant here is the Community `task.type === 'summary'` row kind the
 * product paints as a group ribbon, never the PRO `summary.autoConvert` /
 * `summary.autoProgress` API, which this fork does not use.
 */
test('R2-2/R2-8: a reverse-bypass target far WIDER than the gap to the source does not send the corridor past the target\'s own far edge (a collapsed group\'s ribbon bar, "Неправильно проложенный маршрут.jpg")', () => {
  // A collapsed group's own representative rect: hundreds of pixels wide,
  // starting at the chart's own left edge — the source sits well inside
  // its horizontal span, exactly AggregateLinks.jsx's own real geometry.
  const source = rect(1350, 500, 30);
  const target = rect(0, 0, 1900, 30);
  const route = routeLink({
    sourceRect: source,
    targetRect: target,
    rowHeight: 30,
  });
  assert.equal(route.routeClass, 'reverseBypass');

  const entryRun = reverseEntryRun(LINK_TOKENS);
  const sx = source.x + source.w;
  const hx = route.points[1][0];
  assert.ok(
    hx <= sx + entryRun + 0.5,
    `the swing-out point (hx=${hx}) must clear only the SOURCE's own bar (sx=${sx} + entryRun=${entryRun}), not the target's far edge (${target.x + target.w})`,
  );
  const box = boundingBox(route.points);
  assert.ok(
    box.x2 < target.x + target.w,
    `the route's own bounding box (x2=${box.x2}) must not reach the target's far edge (${target.x + target.w}) merely because the target bar is wide`,
  );
});

test("negative control: clearing the target's far edge (the retired formula) really did send the corridor hundreds of px past where it needed to turn", () => {
  const source = rect(1350, 500, 30);
  const target = rect(0, 0, 1900, 30);
  const entryRun = reverseEntryRun(LINK_TOKENS);
  const sx = source.x + source.w;
  const oldHx = Math.max(sx, target.x + target.w) + entryRun;
  assert.ok(
    oldHx > sx + entryRun + 400,
    'this control only proves something if the retired formula really did swing hundreds of px further out than the source alone needs',
  );
});

test('SVAR-M36: the reverse-bypass corridor gives its source-exit and target-entry corners the FULL rounding radius, not half of it', () => {
  const source = rect(200, 0, 100); // spans [200,300)
  const target = rect(50, ROW_HEIGHT * 4, 100); // far enough below for a tall, unconstrained vertical run
  const route = routeLink({
    sourceRect: source,
    targetRect: target,
    rowHeight: ROW_HEIGHT,
  });
  assert.equal(route.routeClass, 'reverseBypass');

  const [p0, p1, , , p4, p5] = route.points;
  // The source-exit run (p0 -> p1, horizontal) and the target-entry run
  // (p4 -> p5, horizontal) are the two runs a full-radius corner needs at
  // least `2 * radius` of. `clearance` (12) alone is shorter than that
  // (`2 * radius` = 24) — this is exactly what made the target-entry
  // corner read tighter than the corridor's own already-smooth corners.
  const sourceExitRun = p1[0] - p0[0];
  const targetEntryRun = p5[0] - p4[0];
  assert.ok(
    sourceExitRun >= 2 * LINK_TOKENS.radius,
    `source-exit run (${sourceExitRun}) must be at least 2*radius so its corner is not clamped below the full radius`,
  );
  assert.ok(
    targetEntryRun >= 2 * LINK_TOKENS.radius,
    `target-entry run (${targetEntryRun}) must be at least 2*radius so its corner is not clamped below the full radius`,
  );
});

test('negative control: a clearance-only entry run (12px) would clamp the target-entry corner to HALF the radius token', () => {
  const entryRun = LINK_TOKENS.clearance;
  const halfRadiusCap = entryRun / 2;
  assert.ok(
    halfRadiusCap < LINK_TOKENS.radius,
    'this control only proves something if a clearance-only run really would have capped the corner below the full radius (SVAR-M36 red-before)',
  );
});

test('SVAR-M34: the reverse-bypass corridor runs exactly on the row separator, not merely outside the bar ("плохо реализовано.jpg", R1 correction)', () => {
  // Real product geometry (measured from a running build): a 48px row with
  // a 41px bar leaves ~3.5px of free margin on each side — far less than
  // the retired `rowHeight / 4` (12px) the corridor used to assume, but
  // still enough that the corridor should sit ON the row boundary, not
  // merely somewhere clear of the bar.
  const rowHeight = 48;
  const barHeight = 41;
  const source = rect(1200, 243, 34, barHeight); // below and to the right
  const target = rect(136, 195, 34, barHeight); // above and to the left
  const route = routeLink({
    sourceRect: source,
    targetRect: target,
    rowHeight,
  });
  assert.equal(route.routeClass, 'reverseBypass');

  // points[2] -> points[3] is the corridor's own horizontal run, between
  // the two verticals.
  const cy = route.points[2][1];
  assert.equal(route.points[3][1], cy, 'the corridor is a single flat run');

  const rowBottom = target.y + target.h / 2 + rowHeight / 2;
  assert.equal(
    cy,
    rowBottom,
    'the corridor must sit exactly on the row separator (R1: the first cut of this fix pulled it back by up to clearance/2 even with room to spare, landing it a few px above the line instead of on it)',
  );
  assert.ok(
    cy >= target.y + target.h,
    `corridor y=${cy} must still stay outside the target bar's own vertical span [${target.y}, ${target.y + target.h}]`,
  );
});

test('SVAR-M34: a bar that leaves NO margin at all still gets pulled back by the smallest step that clears it', () => {
  const rowHeight = 40;
  const source = rect(1000, 200, 34); // below and to the right
  const target = rect(100, 160, 34, rowHeight); // fills its own row exactly
  const route = routeLink({
    sourceRect: source,
    targetRect: target,
    rowHeight,
  });
  assert.equal(route.routeClass, 'reverseBypass');
  const cy = route.points[2][1];
  const rowBottom = target.y + target.h / 2 + rowHeight / 2;
  assert.equal(
    cy,
    rowBottom - 1,
    'with zero margin the exact boundary would touch the bar, so the fallback pulls back by 1px, the smallest step that clears it',
  );
});

test('negative control: the retired rowHeight/4 gutter would have cut across a bar that nearly fills its row', () => {
  const rowHeight = 48;
  const target = rect(136, 195, 34, 41);
  const rowCenter = target.y + target.h / 2;
  const rowBottom = rowCenter + rowHeight / 2;
  const oldGutterInset = Math.min(LINK_TOKENS.clearance / 2, rowHeight / 4);
  const oldCy = rowBottom - oldGutterInset;
  assert.ok(
    oldCy > target.y && oldCy < target.y + target.h,
    'this control only proves something if the retired formula really did land inside the bar (SVAR-M34 kickoff-style red-before)',
  );
});

test('negative control (R1): the first cut of this fix (clearance/2 pullback) would have missed the row separator by several px even with room to spare', () => {
  const rowHeight = 48;
  const target = rect(136, 195, 34, 41);
  const rowCenter = target.y + target.h / 2;
  const rowBottom = rowCenter + rowHeight / 2;
  const bottomMargin = rowBottom - (target.y + target.h);
  const firstCutInset = Math.max(
    0,
    Math.min(LINK_TOKENS.clearance / 2, bottomMargin - 1),
  );
  const firstCutCy = rowBottom - firstCutInset;
  assert.notEqual(
    firstCutCy,
    rowBottom,
    'this control only proves something if the first cut really did miss the exact separator',
  );
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

/* ======================================================================== *
 * SVAR-M41 (R3-1, Pavel manual acceptance remediation — "Не исправлено.jpg")
 *
 * The screenshot's own geometry, as a fixture: two forward links whose
 * verticals are pushed hard right by a GROUP row's summary bar (which in
 * this product spans the whole project width), so the corridor cap is what
 * decides where the vertical lands and therefore how much run is left for
 * the final approach.
 * ======================================================================== */

const BROKEN_ROUTE_FIXTURE = Object.freeze({
  // "Concept refinement", the shared source of both links in the shot.
  sourceRect: { x: 25, y: 25, w: 172, h: 36 },
  // "Combat prototype" and "Build pipeline hardening", the two targets
  // Pavel's own arrows point at.
  targets: [
    { x: 503, y: 697, w: 340, h: 36 },
    { x: 365, y: 890, w: 206, h: 36 },
  ],
  // Two collapsed-group ribbons in rows between them, each as wide as the
  // whole timeline — the reason the single global corridor push always
  // overshoots the target here.
  obstacles: [
    { x: 0, y: 186, w: 1800, h: 8 },
    { x: 25, y: 610, w: 1600, h: 8 },
  ],
  rowHeight: 48,
});

function finalRunOf(points) {
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function arrowBox(pointsAttr) {
  const pairs = pointsAttr.split(' ').map((p) => p.split(',').map(Number));
  return {
    x1: Math.min(...pairs.map((p) => p[0])),
    x2: Math.max(...pairs.map((p) => p[0])),
    y1: Math.min(...pairs.map((p) => p[1])),
    y2: Math.max(...pairs.map((p) => p[1])),
  };
}

test('R3-1: the screenshot geometry keeps a valid final run — corner radius, a visible run and the arrowhead all fit', () => {
  for (const targetRect of BROKEN_ROUTE_FIXTURE.targets) {
    const route = routeLink({
      sourceRect: BROKEN_ROUTE_FIXTURE.sourceRect,
      targetRect,
      obstacles: BROKEN_ROUTE_FIXTURE.obstacles,
      rowHeight: BROKEN_ROUTE_FIXTURE.rowHeight,
    });
    const finalRun = finalRunOf(route.points);
    assert.ok(
      finalRun + 0.5 >= sideEntryRun(LINK_TOKENS),
      `final run ${finalRun} must be at least sideEntryRun (${sideEntryRun(LINK_TOKENS)}) for target x=${targetRect.x}`,
    );
    // The corner is not allowed to eat the run: what is left of it after
    // the last corner's own radius must still hold the whole arrowhead.
    const cornerRadius = Math.min(LINK_TOKENS.radius, finalRun / 2);
    assert.ok(
      finalRun - cornerRadius >= LINK_TOKENS.arrowLength,
      `after a ${cornerRadius}px corner only ${finalRun - cornerRadius}px is left for a ${LINK_TOKENS.arrowLength}px arrowhead`,
    );
    assert.equal(
      cornerRadius,
      LINK_TOKENS.radius,
      'and the corner keeps its FULL radius rather than being clamped by a short run',
    );
  }
});

test('R3-1: the drawn path actually REACHES the target — the arrow-trimmed endpoint is never deduped away into the corner', () => {
  for (const targetRect of BROKEN_ROUTE_FIXTURE.targets) {
    const link = buildLink({
      sourceRect: BROKEN_ROUTE_FIXTURE.sourceRect,
      targetRect,
      obstacles: BROKEN_ROUTE_FIXTURE.obstacles,
      rowHeight: BROKEN_ROUTE_FIXTURE.rowHeight,
    });
    const corner = link.points[link.points.length - 2];
    const coordinates = [
      ...link.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g),
    ].map((m) => [Number(m[1]), Number(m[2])]);
    const endOfPath = coordinates[coordinates.length - 1];
    assert.ok(
      endOfPath[0] > corner[0] + LINK_TOKENS.radius,
      `the path ends at ${JSON.stringify(endOfPath)}, which is not past its own last corner ${JSON.stringify(corner)} — the final run was not drawn at all`,
    );
    assert.ok(
      endOfPath[0] < targetRect.x,
      'and it stops short of the bar, leaving the arrowhead its own space',
    );
  }
});

test('R3-1: the arrowhead is outside the target bar, on the side it enters from', () => {
  for (const targetRect of BROKEN_ROUTE_FIXTURE.targets) {
    const link = buildLink({
      sourceRect: BROKEN_ROUTE_FIXTURE.sourceRect,
      targetRect,
      obstacles: BROKEN_ROUTE_FIXTURE.obstacles,
      rowHeight: BROKEN_ROUTE_FIXTURE.rowHeight,
    });
    assert.equal(link.arrowDir, 'right');
    const box = arrowBox(link.arrow);
    assert.ok(box.x2 <= targetRect.x + 0.01, 'arrow tip is at the bar edge');
    assert.ok(
      box.x1 >= targetRect.x - LINK_TOKENS.arrowLength - 0.01,
      'and the whole triangle sits immediately outside it, not buried under the bar',
    );
    assert.ok(
      box.x1 > link.points[link.points.length - 2][0],
      'the triangle begins past the last corner, so it reads as an entry rather than as a bend',
    );
  }
});

test('NEGATIVE CONTROL / R3-1: the retired `tx - minRun` cap collapses the final run, over-rounds the corner and deletes the endpoint', () => {
  const tokens = LINK_TOKENS;
  for (const targetRect of BROKEN_ROUTE_FIXTURE.targets) {
    // Exactly what `standardRoute` used to compute, restated here rather
    // than reintroduced into production: `vx` pushed past the target by the
    // full-width group ribbons, then capped at `tx - minRun`.
    const vx = targetRect.x - tokens.minRun;
    const brokenPoints = [
      [
        BROKEN_ROUTE_FIXTURE.sourceRect.x + BROKEN_ROUTE_FIXTURE.sourceRect.w,
        BROKEN_ROUTE_FIXTURE.sourceRect.y +
          BROKEN_ROUTE_FIXTURE.sourceRect.h / 2,
      ],
      [
        vx,
        BROKEN_ROUTE_FIXTURE.sourceRect.y +
          BROKEN_ROUTE_FIXTURE.sourceRect.h / 2,
      ],
      [vx, targetRect.y + targetRect.h / 2],
      [targetRect.x, targetRect.y + targetRect.h / 2],
    ];
    const finalRun = finalRunOf(brokenPoints);
    assert.equal(finalRun, tokens.minRun);
    assert.ok(
      finalRun < sideEntryRun(tokens),
      'this control only proves something if the retired cap really did fall below the room a side entry needs',
    );
    assert.ok(
      finalRun / 2 < tokens.radius,
      'and really did clamp the last corner below the full radius token',
    );
    // The decisive part: `trimForArrow` + `dedupePoints` delete the endpoint.
    const d = buildRoundedPath(
      [
        ...brokenPoints.slice(0, -1),
        [targetRect.x - (tokens.arrowLength - 1), brokenPoints[3][1]],
      ],
      tokens.radius,
    );
    assert.ok(
      !d.includes(`L${targetRect.x - (tokens.arrowLength - 1)},`),
      'the retired geometry put the trimmed endpoint within the 0.5px dedupe window, so the drawn path ended at the corner with no final run at all (SVAR-M41 red-before)',
    );
  }
});

test('R3-1: a side entry is never EMITTED without room for corner + run + arrowhead — the fallback is the tight-entry family, not a compressed L', () => {
  // A forward gap just above the retired threshold (2*clearance + minRun =
  // 34) and below the real one: a standard L here would have had only
  // `gap - clearance` = 22px of final approach.
  const route = routeLink({
    sourceRect: { x: 0, y: 0, w: 100, h: 24 },
    targetRect: { x: 100 + 36, y: 40, w: 100, h: 24 },
    rowHeight: 40,
  });
  assert.equal(route.routeClass, 'tightEntry');
  assert.equal(route.arrowDir, 'down');
  assert.equal(
    route.points[route.points.length - 1][1],
    40,
    "it enters at the target bar's TOP edge, the accepted tight-entry family (D-166 §E)",
  );
});

test('NEGATIVE CONTROL / R3-1: the retired classifier threshold would have called that same gap a standard L', () => {
  const gap = 36;
  const retired = 2 * LINK_TOKENS.clearance + LINK_TOKENS.minRun;
  assert.ok(
    gap > retired,
    'this control only proves something if the retired threshold really did classify this gap as a standard L',
  );
  assert.ok(
    gap - LINK_TOKENS.clearance < sideEntryRun(LINK_TOKENS),
    'and if the standard L it would have produced really did lack the room a side entry needs',
  );
});

test('R3-1: a capped corridor keeps fan-in members on separate verticals rather than collapsing them onto one trunk (D-166 §G)', () => {
  const targetRect = BROKEN_ROUTE_FIXTURE.targets[0];
  const xs = [0, 1, 2].map(
    (channelOffset) =>
      routeLink({
        sourceRect: BROKEN_ROUTE_FIXTURE.sourceRect,
        targetRect,
        obstacles: BROKEN_ROUTE_FIXTURE.obstacles,
        rowHeight: BROKEN_ROUTE_FIXTURE.rowHeight,
        channelOffset,
      }).points[1][0],
  );
  assert.equal(new Set(xs).size, 3, 'three channels, three distinct verticals');
  for (let i = 1; i < xs.length; i++) {
    assert.equal(
      Math.abs(xs[i] - xs[i - 1]),
      LINK_TOKENS.channelStep,
      'and they stay exactly channelStep apart',
    );
  }
});

test('R3-1: the reverse-bypass corridor returns to the target with the same valid side entry', () => {
  const route = routeLink({
    sourceRect: { x: 200, y: 0, w: 100, h: 24 },
    targetRect: { x: 50, y: 160, w: 100, h: 24 },
    rowHeight: 40,
  });
  assert.equal(route.routeClass, 'reverseBypass');
  const finalRun = finalRunOf(route.points);
  assert.ok(
    finalRun + 0.5 >= sideEntryRun(LINK_TOKENS),
    `reverse-bypass final run ${finalRun} must also satisfy sideEntryRun (${sideEntryRun(LINK_TOKENS)})`,
  );
});

test('R3-1: an unsupported link type is left alone — the guard does not rewrite a `generic` route into a family built for e2s', () => {
  const route = routeLink({
    sourceRect: { x: 0, y: 0, w: 50, h: 24 },
    targetRect: { x: 300, y: 40, w: 50, h: 24 },
    type: 's2e',
    rowHeight: 40,
  });
  assert.equal(route.routeClass, 'generic');
});

/* -- SVAR-M54 (Phase 4.1G R8, D-171): the router names each segment's bundle -- */

test('SVAR-M54: every route class names one bundle per segment of its raw polyline', () => {
  const cases = [
    routeLink({
      sourceRect: rect(0, 0, 100),
      targetRect: rect(300, ROW_HEIGHT, 100),
      rowHeight: ROW_HEIGHT,
    }),
    routeLink({
      sourceRect: rect(0, 0, 100),
      targetRect: rect(120, ROW_HEIGHT, 100),
      rowHeight: ROW_HEIGHT,
    }),
    routeLink({
      sourceRect: rect(300, 0, 100),
      targetRect: rect(100, ROW_HEIGHT * 2, 100),
      rowHeight: ROW_HEIGHT,
    }),
    routeLink({
      sourceRect: rect(0, 0, 100),
      targetRect: rect(300, ROW_HEIGHT, 100),
      type: 's2e',
      rowHeight: ROW_HEIGHT,
    }),
  ];
  assert.deepEqual(
    cases.map((r) => r.routeClass),
    ['standard', 'tightEntry', 'reverseBypass', 'generic'],
  );
  for (const route of cases) {
    assert.equal(route.segmentBundles.length, route.points.length - 1);
    for (const key of route.segmentBundles) assert.match(key, /^[hv]@-?\d/);
  }
  // buildLink passes the router's answer through untouched.
  const built = buildLink({
    sourceRect: rect(0, 0, 100),
    targetRect: rect(300, ROW_HEIGHT, 100),
    rowHeight: ROW_HEIGHT,
  });
  assert.deepEqual(built.segmentBundles, cases[0].segmentBundles);
});

test('SVAR-M54: a fan-out separated by channelStep keeps ONE channel base; its port runs are one line each', () => {
  const source = rect(0, 0, 100);
  const routes = [0, 1, 2].map((channelOffset, i) =>
    routeLink({
      sourceRect: source,
      targetRect: rect(400, ROW_HEIGHT * (2 + i * 3), 100),
      channelOffset,
      rowHeight: ROW_HEIGHT,
    }),
  );
  const verticals = routes.map((r) => r.points[1][0]);
  assert.deepEqual(
    verticals.map((x) => x - verticals[0]),
    [0, LINK_TOKENS.channelStep, 2 * LINK_TOKENS.channelStep],
  );
  // One base for all three verticals, one line for the shared source run,
  // three different lines for the three targets' approach runs.
  assert.equal(new Set(routes.map((r) => r.segmentBundles[1])).size, 1);
  assert.equal(new Set(routes.map((r) => r.segmentBundles[0])).size, 1);
  assert.equal(new Set(routes.map((r) => r.segmentBundles[2])).size, 3);
});

test('SVAR-M54: a capped fan-in keeps ONE channel base at the target even though its offsets are subtracted', () => {
  const target = rect(200, ROW_HEIGHT * 4, 100);
  const blocker = rect(0, ROW_HEIGHT * 2, 400);
  const routes = [0, 1].map((channelOffset) =>
    routeLink({
      sourceRect: rect(0, ROW_HEIGHT * channelOffset * 0.5, 100),
      targetRect: target,
      channelOffset,
      obstacles: [blocker],
      rowHeight: ROW_HEIGHT,
    }),
  );
  const [a, b] = routes.map((r) => r.points[1][0]);
  assert.equal(a - b, LINK_TOKENS.channelStep);
  assert.equal(routes[0].segmentBundles[1], routes[1].segmentBundles[1]);
  assert.equal(
    routes[0].segmentBundles[1],
    `v@${200 - sideEntryRun(LINK_TOKENS)}`,
  );
});

test('SVAR-M54: verticals of two different corridors are two bundles, however close they are drawn', () => {
  // Two sources whose own clearance bases differ by exactly one channelStep:
  // drawn 7px apart, but the router placed them around two different bases,
  // so they are not one bundle and nothing here pretends otherwise.
  const target = rect(400, ROW_HEIGHT * 6, 100);
  const one = routeLink({
    sourceRect: rect(0, 0, 100),
    targetRect: target,
    rowHeight: ROW_HEIGHT,
  });
  const two = routeLink({
    sourceRect: rect(0, ROW_HEIGHT, 100 + LINK_TOKENS.channelStep),
    targetRect: target,
    rowHeight: ROW_HEIGHT,
  });
  assert.equal(two.points[1][0] - one.points[1][0], LINK_TOKENS.channelStep);
  assert.notEqual(one.segmentBundles[1], two.segmentBundles[1]);
});
