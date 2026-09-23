/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M47, SVAR-M48, SVAR-M49).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the pure offscreen-endpoint-chip derivation
 * (`src/planner-router/offscreenChips.js`), Phase 4.1C R4 and R5. Run:
 * `npm run test:planner` (plain `node --test`).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the derivation answers the R4 and R5 findings on stated geometry:
 * no chip without a visible run (R4-1), one chip per route and per end
 * (R4-2, R5-2), a chip on a vertical run's exit (R4-3, R5 §3.3), identity
 * that is the route's own (R4-4, R5-3), an endpoint off the viewport in ANY
 * direction (R5-1), aggregate routes as chip sources (R5-4), and one chip per
 * presentation endpoint however many routes name it (R6-1). It proves
 * NOTHING about the real `<Gantt>` — the store's viewport values,
 * virtualization, the ribbon read — which is the Planner product's
 * real-Chromium product-scale suite's job.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyEndpoint,
  deriveEndpointChips,
  layoutChips,
  routeExitPoint,
  visibleRunLength,
  CHIP_SIZE,
  CHIP_EDGE_INSET,
  CHIP_GAP,
  MIN_VISIBLE_RUN,
} from '../src/planner-router/offscreenChips.js';
import { clampDelta } from '../src/planner-router/overlayViewport.js';
import { buildLink } from '../src/planner-router/route.js';

const VIEWPORT = { left: 1000, top: 500, right: 2000, bottom: 1100 };

function task(id, x, y, w = 60, h = 30, text = id) {
  return { id, text, $x: x, $y: y, $w: w, $h: h };
}

function rectOf(t) {
  return { x: t.$x, y: t.$y, w: t.$w, h: t.$h };
}

/** A canonical-link presentation route between two tasks. */
function linkRoute(id, source, target, obstacles = []) {
  const route = buildLink({
    sourceRect: rectOf(source),
    targetRect: rectOf(target),
    type: 'e2s',
    channelOffset: 0,
    obstacles,
    rowHeight: 40,
  });
  return {
    routeId: id,
    kind: 'link',
    points: route.points,
    canonicalLinkIds: [id],
    source: { id: source.id, rect: rectOf(source), name: source.text },
    target: { id: target.id, rect: rectOf(target), name: target.text },
  };
}

/**
 * An aggregate presentation route between two representatives.
 *
 * SVAR-M53 (Phase 4.1G R4): `canonical` names the REAL tasks each side's
 * representative stands in for, exactly as `aggregate.js` now records them.
 * Omitted means "itself", which is what a representative that is its own
 * endpoint honestly stands for.
 */
function aggregateRoute(id, source, target, memberLinkIds, canonical = {}) {
  const route = linkRoute(id, source, target);
  return {
    ...route,
    kind: 'aggregate',
    canonicalLinkIds: memberLinkIds,
    source: {
      ...route.source,
      canonicalIds: canonical.source ?? [source.id],
    },
    target: {
      ...route.target,
      canonicalIds: canonical.target ?? [target.id],
    },
  };
}

/* -- routeExitPoint -------------------------------------------------------- */

test('routeExitPoint: a horizontal run leaving through the right edge exits there', () => {
  const exit = routeExitPoint(
    [
      [1200, 700],
      [2500, 700],
    ],
    VIEWPORT,
  );
  assert.ok(exit);
  assert.equal(exit.edge, 'right');
  assert.deepEqual(exit.point, [2000, 700]);
});

test('routeExitPoint: a vertical run leaving through the bottom edge exits there (R4-3)', () => {
  const exit = routeExitPoint(
    [
      [1200, 700],
      [1500, 700],
      [1500, 3000],
      [2500, 3000],
    ],
    VIEWPORT,
  );
  assert.ok(exit);
  assert.equal(exit.edge, 'bottom');
  assert.deepEqual(exit.point, [1500, 1100]);
});

test('routeExitPoint: a polyline entirely outside the viewport has no exit', () => {
  assert.equal(
    routeExitPoint(
      [
        [2200, 700],
        [2500, 700],
        [2500, 900],
      ],
      VIEWPORT,
    ),
    null,
  );
});

test('routeExitPoint: a run that crosses the viewport from side to side exits on the far side', () => {
  const exit = routeExitPoint(
    [
      [500, 700],
      [2500, 700],
    ],
    VIEWPORT,
  );
  assert.equal(exit.edge, 'right');
});

test('routeExitPoint: a polyline ending inside the viewport never leaves it', () => {
  assert.equal(
    routeExitPoint(
      [
        [500, 700],
        [1500, 700],
      ],
      VIEWPORT,
    ),
    null,
  );
});

/* -- visibleRunLength / classifyEndpoint ------------------------------------ */

test('visibleRunLength: only the clipped parts count, a vertical exactly like a horizontal', () => {
  assert.equal(
    visibleRunLength(
      [
        [500, 700],
        [1500, 700],
        [1500, 3000],
      ],
      VIEWPORT,
    ),
    500 + 400,
  );
  assert.equal(
    visibleRunLength(
      [
        [2200, 700],
        [2500, 700],
      ],
      VIEWPORT,
    ),
    0,
  );
});

test('classifyEndpoint: any overlap is visible; otherwise the horizontal side first, then the vertical', () => {
  const at = (x, y) => classifyEndpoint({ x, y, w: 60, h: 30 }, VIEWPORT);
  assert.equal(at(1200, 700), 'visible');
  assert.equal(at(1990, 700), 'visible'); // partly inside
  assert.equal(at(900, 700), 'left');
  assert.equal(at(2100, 700), 'right');
  assert.equal(at(1200, 400), 'top');
  assert.equal(at(1200, 1200), 'bottom');
  // Off to the right AND below: the timeline side wins the name.
  assert.equal(at(2100, 1200), 'right');
  // R5-1: a bar whose x-range overlaps the window but whose ROW is above it
  // is OFF SCREEN (top), which R4 called visible.
  assert.equal(at(1200, 300), 'top');
});

/* -- deriveEndpointChips --------------------------------------------------- */

test('R4-1: no chip when the whole route is off screen, however far the endpoints are', () => {
  const a = task('a', 2200, 700);
  const b = task('b', 2600, 900);
  assert.deepEqual(deriveEndpointChips([linkRoute('l1', a, b)], VIEWPORT), []);
});

test(`a route with less than ${MIN_VISIBLE_RUN}px inside the viewport gets no chip at either end`, () => {
  // A one-pixel sliver of the vertical inside the viewport's bottom edge.
  const a = task('a', 500, 1090, 60, 8);
  const b = task('b', 2600, 1300);
  const route = linkRoute('l1', a, b);
  const run = visibleRunLength(route.points, VIEWPORT);
  assert.ok(run < MIN_VISIBLE_RUN, `run ${run}`);
  assert.deepEqual(deriveEndpointChips([route], VIEWPORT), []);
});

test('R4-4 / R5-3 / D-170: a chip carries its route, role, endpoint and canonical identity', () => {
  const a = task('a', 1200, 700, 60, 30, 'Local');
  const b = task('b', 2600, 700, 60, 30, 'Partner');
  const chips = deriveEndpointChips([linkRoute('l1', a, b)], VIEWPORT);
  assert.equal(chips.length, 1);
  const [chip] = chips;
  // SVAR-M54 (D-170): the key is the ROUTE's own identity, never a shared
  // endpoint key (R6-1, retired a second time).
  assert.equal(chip.key, 'l1:target');
  assert.equal(chip.routeId, 'l1');
  assert.equal(chip.kind, 'link');
  assert.equal(chip.role, 'target');
  assert.deepEqual(chip.canonicalLinkIds, ['l1']);
  assert.equal(chip.partnerId, 'b');
  assert.equal(chip.localId, 'a');
  assert.equal(chip.partnerName, 'Partner');
  assert.equal(chip.direction, 'right');
  assert.equal(chip.exitEdge, 'right');
  assert.deepEqual(chip.anchor, [2000, 715]);
});

/* -- SVAR-M53: the canonical task behind the presentation endpoint --------- */

test('SVAR-M53: a canonical link chip stands for its own endpoint task', () => {
  const a = task('a', 1200, 700);
  const b = task('b', 2600, 700, 60, 30, 'Partner');
  const [chip] = deriveEndpointChips([linkRoute('l1', a, b)], VIEWPORT);
  assert.deepEqual(chip.partnerCanonicalIds, ['b']);
});

test("SVAR-M53: an aggregate chip stands for the hidden member task, not the group's representative", () => {
  const local = task('local', 1200, 700);
  const group = task('group', 2600, 700, 60, 30, 'Quality Assurance');
  const [chip] = deriveEndpointChips(
    [
      aggregateRoute('agg1', local, group, ['l1'], {
        target: ['qa-child'],
      }),
    ],
    VIEWPORT,
  );
  // The chip still NAMES the representative — that is the row the route
  // is drawn to, and R5 §3.4 has not changed.
  assert.equal(chip.partnerId, 'group');
  assert.equal(chip.partnerName, 'Quality Assurance');
  // ...but it knows the click belongs to the hidden task.
  assert.deepEqual(chip.partnerCanonicalIds, ['qa-child']);
});

test('SVAR-M53/M54 (D-170): two SEPARATE aggregate routes into one collapsed representative are two chips, each carrying only its own canonical task', () => {
  const localA = task('la', 1200, 620);
  const localB = task('lb', 1200, 900);
  const group = task('group', 2600, 700, 60, 30, 'Quality Assurance');
  // Two aggregate routes into ONE collapsed representative, standing for
  // two DIFFERENT hidden member tasks. Under retired R6-1 this used to fold
  // into one chip with an ambiguous `partnerCanonicalIds`; D-170 says these
  // are two visually separate rendered lines, so they are two chips, and
  // each one names exactly the task its OWN route stands for — no
  // ambiguity is created here any more, because nothing merges them.
  const chips = deriveEndpointChips(
    [
      aggregateRoute('aggA', localA, group, ['l1'], { target: ['qa-1'] }),
      aggregateRoute('aggB', localB, group, ['l2'], { target: ['qa-2'] }),
    ],
    VIEWPORT,
  );
  const naming = chips.filter((c) => c.partnerId === 'group');
  assert.equal(naming.length, 2);
  assert.deepEqual(
    naming.map((c) => c.partnerCanonicalIds).sort((a, b) => a[0] < b[0] ? -1 : 1),
    [['qa-1'], ['qa-2']],
  );
  assert.deepEqual(
    naming.map((c) => c.canonicalLinkIds[0]).sort(),
    ['l1', 'l2'],
  );

  // Two routes standing for the SAME hidden task are STILL two chips
  // (D-170 §A: cardinality follows the rendered route, not the endpoint),
  // each independently naming that one canonical task — the residual
  // ambiguity D-169 §C left open only ever arises WITHIN one aggregate
  // route's own multiple member targets (see the dedicated test below), not
  // from two routes converging on one representative.
  const same = deriveEndpointChips(
    [
      aggregateRoute('aggA', localA, group, ['l1'], { target: ['qa-1'] }),
      aggregateRoute('aggB', localB, group, ['l2'], { target: ['qa-1'] }),
    ],
    VIEWPORT,
  ).filter((c) => c.partnerId === 'group');
  assert.equal(same.length, 2);
  for (const chip of same) assert.deepEqual(chip.partnerCanonicalIds, ['qa-1']);
});

test('D-170 §C (residual ambiguity): ONE aggregate route whose own members target two different tasks is still one chip with an ambiguous partnerCanonicalIds', () => {
  const local = task('local', 1200, 700);
  const group = task('group', 2600, 700, 60, 30, 'Quality Assurance');
  // A single collapsed-group aggregate can itself stand for members with
  // different target tasks (`aggregate.js`'s own `targetCanonicalIds`) —
  // this is a property of ONE route, so D-170's route-owned rule does not
  // (and should not) split it: one rendered line, one chip, and the
  // representative-landing fallback in `OffscreenLinkChips.onReveal` still
  // applies, exactly as D-169 §C left it.
  const [chip] = deriveEndpointChips(
    [aggregateRoute('agg', local, group, ['l1', 'l2'], { target: ['qa-1', 'qa-2'] })],
    VIEWPORT,
  );
  assert.equal(chip.partnerId, 'group');
  assert.deepEqual(chip.partnerCanonicalIds, ['qa-1', 'qa-2']);
  assert.deepEqual(chip.canonicalLinkIds, ['l1', 'l2']);
});

test('SVAR-M53: an endpoint that carries no canonical ids stands for itself', () => {
  // An upstream caller that never adopts the field must behave exactly as
  // it did before SVAR-M53.
  const a = task('a', 1200, 700);
  const b = task('b', 2600, 700);
  const bare = linkRoute('l1', a, b);
  delete bare.source.canonicalIds;
  delete bare.target.canonicalIds;
  const [chip] = deriveEndpointChips([bare], VIEWPORT);
  assert.deepEqual(chip.partnerCanonicalIds, ['b']);
});

test('R5-1: a source whose bar overlaps the window horizontally but whose row is ABOVE it gets its chip at the top exit', () => {
  // The route's vertical crosses the whole viewport: the source is above,
  // the target below and to the right. R4 gave only the target's chip.
  const a = task('a', 1100, 300);
  const b = task('b', 2600, 1400);
  const chips = deriveEndpointChips([linkRoute('l1', a, b)], VIEWPORT);
  assert.equal(chips.length, 2);
  const source = chips.find((c) => c.role === 'source');
  const target = chips.find((c) => c.role === 'target');
  assert.equal(source.partnerId, 'a');
  assert.equal(source.direction, 'top');
  assert.equal(source.exitEdge, 'top');
  assert.equal(source.anchor[1], VIEWPORT.top);
  assert.equal(target.partnerId, 'b');
  assert.equal(target.direction, 'right');
  assert.equal(target.exitEdge, 'bottom');
  assert.equal(target.anchor[1], VIEWPORT.bottom);
});

test('R5-1 / P04: a shorter route and a longer one with the same semantic state give the same two chips', () => {
  // Same vertical through the viewport, sources of different lengths: a
  // long bar whose start is far left of the window and a short one lying
  // just inside its x-range, both with their ROW above the band. R4 gave
  // the long one both chips at some positions and the short one only its
  // target's; the semantic state is the same, so the answer is too.
  const longSource = task('long', 200, 300, 900);
  const shortSource = task('short', 1040, 300, 60);
  const target = task('t', 2600, 1400);
  const long = deriveEndpointChips(
    [linkRoute('lLong', longSource, target)],
    VIEWPORT,
  );
  const short = deriveEndpointChips(
    [linkRoute('lShort', shortSource, target)],
    VIEWPORT,
  );
  assert.deepEqual(long.map((c) => c.role).sort(), ['source', 'target']);
  assert.deepEqual(short.map((c) => c.role).sort(), ['source', 'target']);
  for (const chips of [long, short]) {
    assert.equal(chips.find((c) => c.role === 'source').direction, 'top');
    assert.equal(chips.find((c) => c.role === 'source').exitEdge, 'top');
    assert.equal(chips.find((c) => c.role === 'target').exitEdge, 'bottom');
  }
});

test('R5 §3.1: one end offscreen -> one chip; both -> two; the target never suppresses the source', () => {
  const inside = task('in', 1200, 700);
  const right = task('right', 2600, 700);
  const left = task('left', 200, 900);
  const one = deriveEndpointChips([linkRoute('l1', inside, right)], VIEWPORT);
  assert.deepEqual(
    one.map((c) => c.role),
    ['target'],
  );
  const oneSource = deriveEndpointChips(
    [linkRoute('l2', left, inside)],
    VIEWPORT,
  );
  assert.deepEqual(
    oneSource.map((c) => c.role),
    ['source'],
  );
  const both = deriveEndpointChips([linkRoute('l3', left, right)], VIEWPORT);
  assert.deepEqual(both.map((c) => c.role).sort(), ['source', 'target']);
  assert.equal(both.find((c) => c.role === 'source').exitEdge, 'left');
  assert.equal(both.find((c) => c.role === 'target').exitEdge, 'right');
});

test('R5 §3.3: a route whose only visible part is a vertical still gets both endpoint chips', () => {
  // Source above, target below-right; both horizontals are off screen
  // (one above the band, one below it), only the vertical crosses it.
  const a = task('a', 1100, 300);
  const b = task('b', 2600, 1400);
  const route = linkRoute('l1', a, b);
  const horizontals = route.points.filter(
    (p) => p[1] >= VIEWPORT.top && p[1] <= VIEWPORT.bottom,
  );
  assert.equal(horizontals.length, 0);
  const chips = deriveEndpointChips([route], VIEWPORT);
  assert.equal(chips.length, 2);
  assert.equal(chips.find((c) => c.role === 'source').exitEdge, 'top');
  assert.equal(chips.find((c) => c.role === 'target').exitEdge, 'bottom');
  // Both anchors sit on the same vertical.
  assert.equal(chips[0].anchor[0], chips[1].anchor[0]);
});

test('R4-2 / R5-2 / D-170: three routes out of one row to three offscreen partners are three chips; a fan-in of two into ONE offscreen task is TWO SEPARATE chips', () => {
  const s = task('s', 1200, 700);
  const t1 = task('t1', 2600, 800);
  const t2 = task('t2', 2700, 900);
  const t3 = task('t3', 2800, 1000);
  const fanOut = deriveEndpointChips(
    [linkRoute('l1', s, t1), linkRoute('l2', s, t2), linkRoute('l3', s, t3)],
    VIEWPORT,
  );
  assert.deepEqual(fanOut.map((c) => c.partnerId).sort(), ['t1', 't2', 't3']);
  const a = task('a', 1100, 600);
  const b = task('b', 1100, 900);
  const far = task('far', 2600, 750);
  const fanIn = deriveEndpointChips(
    [linkRoute('l4', a, far), linkRoute('l5', b, far)],
    VIEWPORT,
  );
  // Two routes, same task, drawn as two separate rendered lines: TWO chips
  // (D-170 §A, Pavel's exact case), each carrying only its own route and
  // link, never the other's.
  assert.equal(fanIn.length, 2);
  assert.deepEqual(fanIn.map((c) => c.partnerId).sort(), ['far', 'far']);
  assert.deepEqual(fanIn.map((c) => c.routeId).sort(), ['l4', 'l5']);
  assert.deepEqual(fanIn.map((c) => c.canonicalLinkIds).sort(), [['l4'], ['l5']]);
  assert.deepEqual(fanIn.map((c) => c.key).sort(), ['l4:target', 'l5:target']);
  for (const chip of fanIn) {
    assert.equal(chip.exitEdge, 'right');
    assert.equal(chip.anchor[0], VIEWPORT.right);
  }
});

test('D-170 (retired R6-1 documentary): the old merge-by-endpoint fold no longer exists; `mergeByEndpoint` is not exported', async () => {
  const mod = await import('../src/planner-router/offscreenChips.js');
  assert.equal(mod.mergeByEndpoint, undefined);
});

test('D-170: two real routes to one offscreen task, leaving through DIFFERENT edges, are two separate chips, each on its own exit', () => {
  // `far` lies past the right edge and below the bottom one: horizontal
  // first, so it is "right". `a`'s route leaves through the right edge on
  // its own row; `above`'s route comes down from above the viewport and
  // leaves through the bottom. Under retired R6-1 these folded into one
  // chip; D-170 keeps them apart because they are two separate rendered
  // lines.
  const a = task('a', 1100, 700);
  const above = task('above', 1100, 200);
  const far = task('far', 2600, 1400);
  const chips = deriveEndpointChips(
    [linkRoute('l1', a, far), linkRoute('l2', above, far)],
    VIEWPORT,
  );
  const naming = chips.filter((c) => c.partnerId === 'far');
  assert.equal(naming.length, 2);
  assert.deepEqual(
    naming.map((c) => `${c.routeId}:${c.exitEdge}`).sort(),
    ['l1:bottom', 'l2:bottom'],
  );
});

test('D-170: a task that is the SOURCE of one visible route and the TARGET of another gets two separate chips', () => {
  const far = task('far', 2600, 750);
  const a = task('a', 1100, 600);
  const c = task('c', 3800, 900);
  // a -> far (far is the target), far -> c (far is the source); both
  // routes have a visible run? The second one runs from far (off right)
  // to c (further right) — no visible run, so it contributes nothing.
  // Use a route that comes BACK into the viewport instead: far -> b.
  const b = task('b', 1100, 950);
  const chips = deriveEndpointChips(
    [linkRoute('l1', a, far), linkRoute('l2', far, b)],
    VIEWPORT,
  );
  const naming = chips.filter((ch) => ch.partnerId === 'far');
  assert.equal(naming.length, 2);
  assert.deepEqual(naming.map((c) => c.role).sort(), ['source', 'target']);
  void c;
});

test('R6-1: chips for two DIFFERENT endpoints are never merged, however close their anchors', () => {
  const a = task('a', 1100, 700);
  const far1 = task('far1', 2600, 700);
  const far2 = task('far2', 2600, 740);
  const chips = deriveEndpointChips(
    [linkRoute('l1', a, far1), linkRoute('l2', a, far2)],
    VIEWPORT,
  );
  assert.equal(chips.length, 2);
  assert.deepEqual(chips.map((c) => c.partnerId).sort(), ['far1', 'far2']);
});

test('D-170: a canonical link and an aggregate that both name one representative are two separate chips, each with only its own member links', () => {
  const group = task('group', 2600, 700, 900, 12, 'Group');
  const a = task('a', 1100, 600);
  const b = task('b', 1100, 900);
  const chips = deriveEndpointChips(
    [linkRoute('l1', a, group), aggregateRoute('agg', b, group, ['m1', 'm2'])],
    VIEWPORT,
  );
  const naming = chips.filter((c) => c.partnerId === 'group');
  assert.equal(naming.length, 2);
  const link = naming.find((c) => c.kind === 'link');
  const aggregate = naming.find((c) => c.kind === 'aggregate');
  assert.deepEqual(link.canonicalLinkIds, ['l1']);
  assert.deepEqual(aggregate.canonicalLinkIds, ['m1', 'm2']);
});

test('NEGATIVE-CONTROL SHAPE (documentary): the retired R6-1 endpoint key would have given one chip for two separate routes; D-170 keys by route and gives two', () => {
  const a = task('a', 1100, 600);
  const b = task('b', 1100, 900);
  const far = task('far', 2600, 750);
  const chips = deriveEndpointChips(
    [linkRoute('l4', a, far), linkRoute('l5', b, far)],
    VIEWPORT,
  );
  // D-170: each rendered route is its own chip.
  assert.equal(chips.length, 2);
  const keys = chips.map((c) => c.key).sort();
  assert.deepEqual(keys, ['l4:target', 'l5:target']);
  // What the retired R6-1 rule would have done with the same candidates:
  // fold both into the ONE key it computed from the shared endpoint alone.
  // This is documentary only — `partnerId` is `far` for both chips above,
  // which is exactly the key R6-1 used to merge them; D-170 no longer does.
  assert.ok(chips.every((c) => c.partnerId === 'far'));
});

test('R5-4: an aggregate route is a chip source like any other, with its representatives as endpoints', () => {
  const group = task('group', 800, 700, 900, 12, 'Group');
  const outside = task('out', 2600, 900, 60, 30, 'Outside');
  const chips = deriveEndpointChips(
    [aggregateRoute('aggregate:group:out:soft', group, outside, ['m1', 'm2'])],
    VIEWPORT,
  );
  assert.equal(chips.length, 1);
  const [chip] = chips;
  assert.equal(chip.kind, 'aggregate');
  assert.equal(chip.routeId, 'aggregate:group:out:soft');
  assert.deepEqual(chip.canonicalLinkIds, ['m1', 'm2']);
  assert.equal(chip.partnerId, 'out');
  assert.equal(chip.localId, 'group');
  assert.equal(chip.partnerName, 'Outside');
});

test('R5 §3.4 reverse side: the collapsed representative offscreen and the outside task visible gives the representative a chip', () => {
  const group = task('group', 200, 300, 500, 12, 'Group');
  const outside = task('out', 1500, 800, 60, 30, 'Outside');
  const chips = deriveEndpointChips(
    [aggregateRoute('aggregate:group:out:soft', group, outside, ['m1'])],
    VIEWPORT,
  );
  assert.equal(chips.length, 1);
  assert.equal(chips[0].role, 'source');
  assert.equal(chips[0].partnerId, 'group');
  assert.equal(chips[0].partnerName, 'Group');
});

test('E-2 / collapsed firebreak: a route whose endpoint has no rectangle produces nothing', () => {
  const a = task('a', 1200, 700);
  const route = linkRoute('l1', a, task('b', 2600, 700));
  route.target.rect = undefined;
  assert.deepEqual(deriveEndpointChips([route], VIEWPORT), []);
});

test('R4-7: the same inputs always give the same chips, and a viewport move recomputes them from scratch', () => {
  const a = task('a', 1200, 700);
  const b = task('b', 2600, 700);
  const routes = [linkRoute('l1', a, b)];
  const first = deriveEndpointChips(routes, VIEWPORT);
  const second = deriveEndpointChips(routes, VIEWPORT);
  assert.deepEqual(first, second);
  const further = { ...VIEWPORT, left: 2000, right: 3000 };
  const flipped = deriveEndpointChips(routes, further);
  assert.equal(flipped.length, 1);
  assert.equal(flipped[0].partnerId, 'a');
  assert.equal(flipped[0].role, 'source');
  assert.equal(flipped[0].direction, 'left');
});

/* -- layoutChips ----------------------------------------------------------- */

test('layoutChips: a right-edge chip hangs above its run and hugs the right edge', () => {
  const chips = [{ key: 'k', exitEdge: 'right', anchor: [2000, 715] }];
  const pos = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 0 });
  const p = pos.get('k');
  assert.equal(p.top, 715 - CHIP_GAP - CHIP_SIZE.height);
  // Hugging the edge means the edge inset OR the accepted clamp margin,
  // whichever keeps it further in (R1-5/R2-4: the clamp always wins).
  assert.equal(
    p.left,
    Math.min(
      VIEWPORT.right - CHIP_EDGE_INSET - CHIP_SIZE.width,
      VIEWPORT.right - 8 - CHIP_SIZE.width,
    ),
  );
});

test('layoutChips: a bottom-edge chip sits centred on the vertical it continues, just inside the edge', () => {
  const chips = [{ key: 'k', exitEdge: 'bottom', anchor: [1272, 1100] }];
  const pos = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 0 });
  const p = pos.get('k');
  assert.equal(
    p.top,
    Math.min(
      VIEWPORT.bottom - CHIP_EDGE_INSET - CHIP_SIZE.height,
      VIEWPORT.bottom - 8 - CHIP_SIZE.height,
    ),
  );
  assert.equal(p.left, 1272 - CHIP_SIZE.width / 2);
});

test('layoutChips: a top-edge chip sits centred on its vertical, just inside the top edge (R5-1)', () => {
  const chips = [{ key: 'k', exitEdge: 'top', anchor: [1272, 500] }];
  const pos = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 0 });
  const p = pos.get('k');
  assert.equal(
    p.top,
    Math.max(VIEWPORT.top + CHIP_EDGE_INSET, VIEWPORT.top + 8),
  );
  assert.equal(p.left, 1272 - CHIP_SIZE.width / 2);
});

test('layoutChips: every chip stays inside the viewport, including one anchored at a corner', () => {
  const chips = [
    { key: 'a', exitEdge: 'bottom', anchor: [1005, 1100] },
    { key: 'b', exitEdge: 'right', anchor: [2000, 505] },
    { key: 'c', exitEdge: 'top', anchor: [1995, 500] },
  ];
  const pos = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 16 });
  for (const p of pos.values()) {
    assert.ok(p.left >= VIEWPORT.left + 8);
    assert.ok(p.left + CHIP_SIZE.width <= VIEWPORT.right - 8 - 16);
    assert.ok(p.top >= VIEWPORT.top + 8);
    assert.ok(p.top + CHIP_SIZE.height <= VIEWPORT.bottom - 8);
  }
});

test('layoutChips: two chips on one anchor are stacked, never merged or dropped (R4 §5, R5 §3.2)', () => {
  const chips = [
    { key: 'l1:target', exitEdge: 'right', anchor: [2000, 715] },
    { key: 'l2:target', exitEdge: 'right', anchor: [2000, 715] },
  ];
  const pos = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 0 });
  const a = pos.get('l1:target');
  const b = pos.get('l2:target');
  assert.equal(pos.size, 2);
  assert.notEqual(a.top, b.top);
  assert.ok(Math.abs(a.top - b.top) >= CHIP_SIZE.height);
});

test('layoutChips: a fan-out whose verticals are a channelStep apart is stacked at the bottom edge, and three top-exit chips stack downwards', () => {
  const bottom = [
    { key: 'a', exitEdge: 'bottom', anchor: [1272, 1100] },
    { key: 'b', exitEdge: 'bottom', anchor: [1279, 1100] },
    { key: 'c', exitEdge: 'bottom', anchor: [1286, 1100] },
  ];
  const pos = layoutChips(bottom, VIEWPORT, { clampDelta, rightGutter: 0 });
  const tops = [...pos.values()].map((p) => p.top).sort((x, y) => x - y);
  assert.equal(new Set(tops).size, 3);
  assert.ok(tops[1] - tops[0] >= CHIP_SIZE.height);
  assert.ok(tops[2] - tops[1] >= CHIP_SIZE.height);
  const top = bottom.map((c) => ({
    ...c,
    exitEdge: 'top',
    anchor: [c.anchor[0], 500],
  }));
  const posTop = layoutChips(top, VIEWPORT, { clampDelta, rightGutter: 0 });
  const topsTop = [...posTop.values()].map((p) => p.top).sort((x, y) => x - y);
  assert.equal(new Set(topsTop).size, 3);
  assert.ok(topsTop[0] >= VIEWPORT.top + CHIP_EDGE_INSET);
});

test('layoutChips: the order is deterministic — the chip key decides between equal anchors', () => {
  const chips = [
    { key: 'l2:target', exitEdge: 'right', anchor: [2000, 715] },
    { key: 'l1:target', exitEdge: 'right', anchor: [2000, 715] },
  ];
  const first = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 0 });
  const second = layoutChips([...chips].reverse(), VIEWPORT, {
    clampDelta,
    rightGutter: 0,
  });
  assert.deepEqual(first.get('l1:target'), second.get('l1:target'));
  assert.deepEqual(first.get('l2:target'), second.get('l2:target'));
  // l1 (the lower key) is the one directly on the run; l2 is stacked above.
  assert.ok(first.get('l1:target').top > first.get('l2:target').top);
});
