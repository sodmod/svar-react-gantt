/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M47).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the pure offscreen-chip derivation
 * (`src/planner-router/offscreenChips.js`), Phase 4.1C R4. Run:
 * `npm run test:planner` (plain `node --test`).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the derivation answers the four R4 findings on stated geometry:
 * no chip without a visible run (R4-1), one chip per link (R4-2), a chip on
 * a vertical run's exit (R4-3), and identity that is the link's own (R4-4).
 * It proves NOTHING about the real `<Gantt>` — the store's viewport values,
 * the DOM correction pass, virtualization — which is the Planner product's
 * real-Chromium product-scale suite's job.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveOffscreenChips,
  layoutChips,
  routeExitPoint,
  CHIP_SIZE,
  CHIP_EDGE_INSET,
  CHIP_GAP,
} from '../src/planner-router/offscreenChips.js';
import { clampDelta } from '../src/planner-router/overlayViewport.js';
import { buildLink } from '../src/planner-router/route.js';

const VIEWPORT = { left: 1000, top: 500, right: 2000, bottom: 1100 };

function task(id, x, y, w = 60, h = 30, text = id) {
  return { id, text, $x: x, $y: y, $w: w, $h: h };
}

function routed(id, source, target, obstacles = []) {
  const route = buildLink({
    sourceRect: { x: source.$x, y: source.$y, w: source.$w, h: source.$h },
    targetRect: { x: target.$x, y: target.$y, w: target.$w, h: target.$h },
    type: 'e2s',
    channelOffset: 0,
    obstacles,
    rowHeight: 40,
  });
  return { link: { id, source: source.id, target: target.id }, route };
}

function byId(...tasks) {
  return new Map(tasks.map((t) => [t.id, t]));
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
      [1300, 700],
      [1300, 3000],
      [2800, 3000],
    ],
    VIEWPORT,
  );
  assert.ok(exit);
  assert.equal(exit.edge, 'bottom');
  assert.deepEqual(exit.point, [1300, 1100]);
});

test('routeExitPoint: a polyline entirely outside the viewport has no exit', () => {
  assert.equal(
    routeExitPoint(
      [
        [2200, 700],
        [2300, 700],
        [2300, 900],
        [2900, 900],
      ],
      VIEWPORT,
    ),
    null,
  );
});

test('routeExitPoint: a run that crosses the viewport from side to side exits on the far side', () => {
  const exit = routeExitPoint(
    [
      [200, 700],
      [300, 700],
      [300, 800],
      [2800, 800],
    ],
    VIEWPORT,
  );
  assert.ok(exit);
  assert.equal(exit.edge, 'right');
  assert.deepEqual(exit.point, [2000, 800]);
});

test('routeExitPoint: a polyline ending inside the viewport never leaves it', () => {
  assert.equal(
    routeExitPoint(
      [
        [200, 700],
        [300, 700],
        [300, 800],
        [1500, 800],
      ],
      VIEWPORT,
    ),
    null,
  );
});

/* -- deriveOffscreenChips -------------------------------------------------- */

test('R4-1: no chip when the whole route is off screen, however far the partner is', () => {
  // Both ends past the right edge: the classic orphan of "Чипсы набор без связи.jpg".
  const a = task('a', 2300, 600);
  const b = task('b', 3000, 900);
  const chips = deriveOffscreenChips(
    [routed('l1', a, b)],
    byId(a, b),
    VIEWPORT,
  );
  assert.deepEqual(chips, []);
});

test('R4-1: no chip for a partner that is only VERTICALLY off screen', () => {
  const a = task('a', 1200, 600);
  const b = task('b', 1500, 3000);
  const chips = deriveOffscreenChips(
    [routed('l1', a, b)],
    byId(a, b),
    VIEWPORT,
  );
  assert.deepEqual(chips, []);
});

test('R4-4: a chip carries its own link, local and partner identity', () => {
  const a = task('a', 1200, 600, 60, 30, 'Local');
  const b = task('b', 2600, 700, 60, 30, 'Partner');
  const chips = deriveOffscreenChips(
    [routed('l1', a, b)],
    byId(a, b),
    VIEWPORT,
  );
  assert.equal(chips.length, 1);
  const [chip] = chips;
  assert.equal(chip.linkId, 'l1');
  assert.equal(chip.localId, 'a');
  assert.equal(chip.partnerId, 'b');
  assert.equal(chip.partnerName, 'Partner');
  assert.equal(chip.direction, 'right');
  assert.equal(chip.exitEdge, 'right');
  assert.equal(chip.anchor[0], VIEWPORT.right);
  // The route's final approach runs at the target row's own centre, and
  // that is the height the anchor sits at.
  assert.equal(chip.anchor[1], 715);
});

test('R4-2: three links out of one row to three offscreen partners are three chips ("Только одна.jpg")', () => {
  const s = task('s', 1200, 600);
  const t1 = task('t1', 2600, 700);
  const t2 = task('t2', 2700, 800);
  const t3 = task('t3', 2800, 3000);
  const chips = deriveOffscreenChips(
    [routed('l1', s, t1), routed('l2', s, t2), routed('l3', s, t3)],
    byId(s, t1, t2, t3),
    VIEWPORT,
  );
  assert.deepEqual(chips.map((c) => [c.linkId, c.partnerId]).sort(), [
    ['l1', 't1'],
    ['l2', 't2'],
    ['l3', 't3'],
  ]);
});

test('NEGATIVE-CONTROL SHAPE (documentary): keying by (local, direction) would keep one of the three', () => {
  const s = task('s', 1200, 600);
  const t1 = task('t1', 2600, 700);
  const t2 = task('t2', 2700, 800);
  const chips = deriveOffscreenChips(
    [routed('l1', s, t1), routed('l2', s, t2)],
    byId(s, t1, t2),
    VIEWPORT,
  );
  const retiredKeying = new Map(
    chips.map((c) => [`${c.localId}:${c.direction}`, c]),
  );
  assert.equal(chips.length, 2);
  assert.equal(retiredKeying.size, 1);
});

test('R4-3: a partner far right AND far below gets its chip on the vertical run, at the bottom edge', () => {
  const a = task('a', 1200, 600);
  const b = task('b', 2600, 3000);
  const chips = deriveOffscreenChips(
    [routed('l1', a, b)],
    byId(a, b),
    VIEWPORT,
  );
  assert.equal(chips.length, 1);
  const [chip] = chips;
  assert.equal(chip.direction, 'right');
  assert.equal(chip.exitEdge, 'bottom');
  assert.equal(chip.anchor[1], VIEWPORT.bottom);
  // The vertical the router chose: the source exit plus its clearance.
  assert.equal(chip.anchor[0], 1200 + 60 + 12);
});

test('a link crossing the viewport between two offscreen ends gets a chip at EACH side', () => {
  const a = task('a', 200, 600);
  const b = task('b', 2600, 700);
  const chips = deriveOffscreenChips(
    [routed('l1', a, b)],
    byId(a, b),
    VIEWPORT,
  );
  assert.deepEqual(
    chips.map((c) => [c.partnerId, c.direction, c.exitEdge]).sort(),
    [
      ['a', 'left', 'left'],
      ['b', 'right', 'right'],
    ],
  );
});

test('E-2 / collapsed firebreak: a link whose endpoint is absent from the task map produces nothing', () => {
  const a = task('a', 1200, 600);
  const b = task('b', 2600, 700);
  const chips = deriveOffscreenChips([routed('l1', a, b)], byId(a), VIEWPORT);
  assert.deepEqual(chips, []);
});

test('R4-7: the same inputs always give the same chips, and a viewport move recomputes them from scratch', () => {
  const a = task('a', 1200, 600);
  const b = task('b', 2600, 700);
  const links = [routed('l1', a, b)];
  const first = deriveOffscreenChips(links, byId(a, b), VIEWPORT);
  const again = deriveOffscreenChips(links, byId(a, b), VIEWPORT);
  assert.deepEqual(first, again);
  // Pan right until BOTH ends are inside: no chip is left at all.
  const moved = { ...VIEWPORT, left: 1100, right: 2800 };
  assert.deepEqual(deriveOffscreenChips(links, byId(a, b), moved), []);
  // Pan further, so the SOURCE is the offscreen one: the chip changes ends,
  // derived afresh, rather than remembering the old one.
  const further = { ...VIEWPORT, left: 2000, right: 3000 };
  const flipped = deriveOffscreenChips(links, byId(a, b), further);
  assert.equal(flipped.length, 1);
  assert.equal(flipped[0].partnerId, 'a');
  assert.equal(flipped[0].direction, 'left');
});

/* -- layoutChips ----------------------------------------------------------- */

test('layoutChips: a right-edge chip hangs above its run and hugs the right edge', () => {
  const chips = [
    { key: 'k', linkId: 'l1', exitEdge: 'right', anchor: [2000, 715] },
  ];
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
  const chips = [
    { key: 'k', linkId: 'l1', exitEdge: 'bottom', anchor: [1272, 1100] },
  ];
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

test('layoutChips: every chip stays inside the viewport, including one anchored at a corner', () => {
  const chips = [
    { key: 'a', linkId: 'l1', exitEdge: 'bottom', anchor: [1005, 1100] },
    { key: 'b', linkId: 'l2', exitEdge: 'right', anchor: [2000, 505] },
  ];
  const pos = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 16 });
  for (const p of pos.values()) {
    assert.ok(p.left >= VIEWPORT.left + 8);
    assert.ok(p.left + CHIP_SIZE.width <= VIEWPORT.right - 8 - 16);
    assert.ok(p.top >= VIEWPORT.top + 8);
    assert.ok(p.top + CHIP_SIZE.height <= VIEWPORT.bottom - 8);
  }
});

test('layoutChips: two chips on one anchor are stacked, never merged or dropped (R4 §5)', () => {
  const chips = [
    { key: 'a', linkId: 'l1', exitEdge: 'right', anchor: [2000, 715] },
    { key: 'b', linkId: 'l2', exitEdge: 'right', anchor: [2000, 715] },
  ];
  const pos = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 0 });
  const a = pos.get('a');
  const b = pos.get('b');
  assert.equal(pos.size, 2);
  assert.notEqual(a.top, b.top);
  assert.ok(Math.abs(a.top - b.top) >= CHIP_SIZE.height);
});

test('layoutChips: a fan-out whose verticals are a channelStep apart is stacked at the bottom edge', () => {
  const chips = [
    { key: 'a', linkId: 'l1', exitEdge: 'bottom', anchor: [1272, 1100] },
    { key: 'b', linkId: 'l2', exitEdge: 'bottom', anchor: [1279, 1100] },
    { key: 'c', linkId: 'l3', exitEdge: 'bottom', anchor: [1286, 1100] },
  ];
  const pos = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 0 });
  const tops = [...pos.values()].map((p) => p.top).sort((x, y) => x - y);
  assert.equal(new Set(tops).size, 3);
  assert.ok(tops[1] - tops[0] >= CHIP_SIZE.height);
  assert.ok(tops[2] - tops[1] >= CHIP_SIZE.height);
});

test('layoutChips: the order is deterministic — link id decides between equal anchors', () => {
  const chips = [
    { key: 'b', linkId: 'l2', exitEdge: 'right', anchor: [2000, 715] },
    { key: 'a', linkId: 'l1', exitEdge: 'right', anchor: [2000, 715] },
  ];
  const first = layoutChips(chips, VIEWPORT, { clampDelta, rightGutter: 0 });
  const second = layoutChips([...chips].reverse(), VIEWPORT, {
    clampDelta,
    rightGutter: 0,
  });
  assert.deepEqual(first.get('a'), second.get('a'));
  assert.deepEqual(first.get('b'), second.get('b'));
  // l1 (the lower id) is the one directly on the run; l2 is stacked above.
  assert.ok(first.get('a').top > first.get('b').top);
});
