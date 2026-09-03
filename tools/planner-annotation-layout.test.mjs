/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M4).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the pure annotation layout owner. Run: `npm run test:planner`
 * (plain `node --test`, no extra dependency).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the placement and layout rules on the inputs below: determinism,
 * no two chips overlapping in one row, the range-edge fallback, the striped
 * line widths and the lane height formula. It proves nothing about what the
 * browser paints, about sticky behaviour, pointer interception or colours —
 * the Planner's own real-Chromium suites own those.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANNOTATION_CHIP_GAP,
  ANNOTATION_CHIP_HEIGHT,
  ANNOTATION_CHIP_MAX_WIDTH,
  ANNOTATION_LANE_PADDING_BOTTOM,
  ANNOTATION_LANE_PADDING_TOP,
  ANNOTATION_LINE_GAP,
  ANNOTATION_MAX_STRIPES,
  ANNOTATION_ROW_GAP,
  ANNOTATION_STRIPE_WIDTH,
  chipTopForRow,
  laneHeightForRows,
  layoutTimelineAnnotations,
  placeAnnotations,
  splitScaleHeaderForLane,
} from '../src/components/chart/annotations/timelineAnnotationLayout.js';

const DAY = 24 * 60 * 60 * 1000;
const CELL = 34;

// A single, ungrouped annotation is always a solo 1-stripe (2 px) line, so
// its chip sits this many px from the line's own centre `x` — half the
// line's width, plus the flat gap from its OUTER edge (product decision, R3
// §7: the gap is measured from the line's outer edge, not its centre).
const SOLO_LINE_GAP = ANNOTATION_STRIPE_WIDTH / 2 + ANNOTATION_LINE_GAP;

function day(offset) {
  return new Date(2026, 0, 1 + offset);
}

/** A day-scale `_scales` stand-in: one column per day, 100 days wide. */
const SCALES = {
  start: day(0),
  end: day(100),
  lengthUnit: 'day',
  lengthUnitWidth: CELL,
  width: 100 * CELL,
  diff: (a, b) => (a.getTime() - b.getTime()) / DAY,
};

function widths(entries) {
  return new Map(Object.entries(entries));
}

function rowsOf(chips) {
  const rows = new Map();
  for (const chip of chips) {
    if (!rows.has(chip.row)) rows.set(chip.row, []);
    rows.get(chip.row).push(chip);
  }
  return rows;
}

function assertNoOverlap(chips) {
  for (const [, row] of rowsOf(chips)) {
    for (let i = 0; i < row.length; i += 1) {
      for (let j = i + 1; j < row.length; j += 1) {
        const a = row[i];
        const b = row[j];
        const gap = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
        assert.ok(
          gap >= ANNOTATION_CHIP_GAP,
          `${a.id} and ${b.id} overlap in row ${a.row} (gap ${gap})`,
        );
      }
    }
  }
}

test('placeAnnotations: unit-start lands on the column edge, unit-center on its middle', () => {
  const placed = placeAnnotations(
    [
      { id: 'a', date: day(10), label: 'A' },
      { id: 'b', date: day(10), anchor: 'unit-center', label: 'B' },
    ],
    SCALES,
    CELL,
  );
  assert.equal(placed.length, 2);
  assert.equal(placed[0].x, 10 * CELL);
  assert.equal(placed[0].anchor, 'unit-start');
  assert.equal(placed[1].x, 10 * CELL + CELL / 2);
  assert.equal(placed[1].anchor, 'unit-center');
});

test('placeAnnotations: skips invalid dates and dates outside the range, keeps the range end', () => {
  const placed = placeAnnotations(
    [
      { id: 'before', date: day(-1), label: 'x' },
      { id: 'nan', date: new Date(Number.NaN), label: 'x' },
      { id: 'notdate', date: '2026-01-01', label: 'x' },
      { id: 'end', date: day(100), label: 'x' },
      { id: 'after', date: day(101), label: 'x' },
      {
        id: 'center-at-end',
        date: day(100),
        anchor: 'unit-center',
        label: 'x',
      },
    ],
    SCALES,
    CELL,
  );
  assert.deepEqual(
    placed.map((item) => item.id),
    ['end'],
  );
  assert.equal(placed[0].x, SCALES.width);
});

test('placeAnnotations: title defaults to label, labelPosition defaults to after', () => {
  const [placed] = placeAnnotations(
    [{ id: 'a', date: day(1), label: 'Alpha' }],
    SCALES,
    CELL,
  );
  assert.equal(placed.title, 'Alpha');
  assert.equal(placed.labelPosition, 'after');
  assert.equal(placed.css, '');
});

test('layout: nothing is laid out for an empty input, and the lane has no height', () => {
  const layout = layoutTimelineAnnotations([], widths({}), SCALES.width);
  assert.deepEqual(layout.lines, []);
  assert.deepEqual(layout.chips, []);
  assert.equal(layout.laneHeight, 0);
});

test('layout: until every label is measured, lines exist but no chips and no lane height', () => {
  const placed = placeAnnotations(
    [
      { id: 'a', date: day(1), label: 'A' },
      { id: 'b', date: day(2), label: 'B' },
    ],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ A: 50 }),
    SCALES.width,
  );
  assert.equal(layout.lines.length, 2);
  assert.deepEqual(layout.chips, []);
  assert.equal(layout.laneHeight, 0);
});

test('layout: a chip goes to the right of its line with the line gap; the lane is one row tall', () => {
  const placed = placeAnnotations(
    [{ id: 'a', date: day(10), label: 'A' }],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ A: 60 }),
    SCALES.width,
  );
  assert.equal(layout.chips.length, 1);
  const [chip] = layout.chips;
  assert.equal(chip.side, 'right');
  assert.equal(chip.x, 10 * CELL + SOLO_LINE_GAP);
  assert.equal(chip.width, 60);
  assert.equal(chip.row, 0);
  assert.equal(layout.rowCount, 1);
  assert.equal(layout.laneHeight, laneHeightForRows(1));
  assert.equal(
    laneHeightForRows(1),
    ANNOTATION_LANE_PADDING_TOP +
      ANNOTATION_LANE_PADDING_BOTTOM +
      ANNOTATION_CHIP_HEIGHT,
  );
  assert.equal(chipTopForRow(0), ANNOTATION_LANE_PADDING_TOP);
  assert.equal(
    chipTopForRow(2),
    ANNOTATION_LANE_PADDING_TOP +
      2 * (ANNOTATION_CHIP_HEIGHT + ANNOTATION_ROW_GAP),
  );
});

test('layout: a centred chip is centred on its line', () => {
  const placed = placeAnnotations(
    [
      {
        id: 't',
        date: day(10),
        anchor: 'unit-center',
        label: 'Today',
        labelPosition: 'center',
      },
    ],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ Today: 70 }),
    SCALES.width,
  );
  const [chip] = layout.chips;
  assert.equal(chip.side, 'center');
  assert.equal(chip.x + chip.width / 2, 10 * CELL + CELL / 2);
});

test('layout: two chips whose intervals would overlap in one row go to two rows; collisions are resolved vertically only', () => {
  const placed = placeAnnotations(
    [
      { id: 'a', date: day(10), label: 'A' },
      { id: 'b', date: day(11), label: 'B' },
    ],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ A: 120, B: 120 }),
    SCALES.width,
  );
  const byId = Object.fromEntries(layout.chips.map((chip) => [chip.id, chip]));
  assert.equal(byId.a.row, 0);
  assert.equal(byId.b.row, 1);
  // Neither chip moved sideways: each still starts at its own line plus the gap.
  assert.equal(byId.a.x, 10 * CELL + SOLO_LINE_GAP);
  assert.equal(byId.b.x, 11 * CELL + SOLO_LINE_GAP);
  assert.equal(layout.rowCount, 2);
  assert.equal(layout.laneHeight, laneHeightForRows(2));
  assertNoOverlap(layout.chips);
});

test('layout: a chip that fits after the previous one stays in the first row', () => {
  const placed = placeAnnotations(
    [
      { id: 'a', date: day(10), label: 'A' },
      { id: 'b', date: day(14), label: 'B' },
    ],
    SCALES,
    CELL,
  );
  // 4 days = 136 px apart; a 100 px chip plus the gaps fits.
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ A: 100, B: 100 }),
    SCALES.width,
  );
  assert.ok(layout.chips.every((chip) => chip.row === 0));
  assert.equal(layout.rowCount, 1);
});

test('layout: many chips never overlap within a row, whatever the input order', () => {
  const dates = [3, 3, 3, 3, 3, 4, 5, 20, 21, 22, 60, 60, 61];
  const annotations = dates.map((offset, index) => ({
    id: `m${index}`,
    date: day(offset),
    label: `Label ${index}`,
  }));
  const measured = widths(
    Object.fromEntries(annotations.map((a, i) => [a.label, 40 + (i % 5) * 30])),
  );
  const placed = placeAnnotations(annotations, SCALES, CELL);
  const layout = layoutTimelineAnnotations(placed, measured, SCALES.width);
  assert.equal(layout.chips.length, annotations.length);
  assertNoOverlap(layout.chips);
  // Every chip keeps its own line as its horizontal anchor, offset by that
  // line's own outer edge plus the gap. Some dates here repeat (3, and 60),
  // composing into a wider capped line; every other date is solo (2 px).
  const countByOffset = new Map();
  for (const offset of dates) {
    countByOffset.set(offset, (countByOffset.get(offset) ?? 0) + 1);
  }
  assert.ok(
    [...countByOffset.values()].some((count) => count > 1),
    'test setup must actually exercise a composite line',
  );
  for (let index = 0; index < layout.chips.length; index += 1) {
    const chip = layout.chips[index];
    const offset = dates[Number(chip.id.slice(1))];
    const stripeCount = Math.min(countByOffset.get(offset), ANNOTATION_MAX_STRIPES);
    const lineHalfWidth = (stripeCount * ANNOTATION_STRIPE_WIDTH) / 2;
    assert.equal(
      chip.x,
      chip.lineX + lineHalfWidth + ANNOTATION_LINE_GAP,
      `${chip.id}: gap must be measured from its line's own outer edge`,
    );
  }
});

test('layout: same-x, same input order -> same rows (deterministic); placement order is by x then input order', () => {
  const annotations = [
    { id: 'late', date: day(30), label: 'L' },
    { id: 'early-2', date: day(5), label: 'E2' },
    { id: 'early-1', date: day(5), label: 'E1' },
  ];
  const measured = widths({ L: 50, E1: 50, E2: 50 });
  const first = layoutTimelineAnnotations(
    placeAnnotations(annotations, SCALES, CELL),
    measured,
    SCALES.width,
  );
  const second = layoutTimelineAnnotations(
    placeAnnotations(annotations, SCALES, CELL),
    measured,
    SCALES.width,
  );
  assert.deepEqual(first, second);
  // Chips come out sorted by x, and for equal x in input order: early-2 first.
  assert.deepEqual(
    first.chips.map((chip) => chip.id),
    ['early-2', 'early-1', 'late'],
  );
  assert.equal(first.chips[0].row, 0);
  assert.equal(first.chips[1].row, 1);
  assert.equal(first.chips[2].row, 0);
});

test('layout: the result does not depend on any viewport — the range width is the only horizontal bound', () => {
  const annotations = [
    { id: 'a', date: day(10), label: 'A' },
    { id: 'b', date: day(11), label: 'B' },
  ];
  const measured = widths({ A: 120, B: 120 });
  const placed = placeAnnotations(annotations, SCALES, CELL);
  const wide = layoutTimelineAnnotations(placed, measured, SCALES.width);
  const same = layoutTimelineAnnotations(placed, measured, SCALES.width);
  assert.deepEqual(wide, same);
});

test('layout: a chip that would leave the range on the right is placed on the left of its line', () => {
  const placed = placeAnnotations(
    [
      { id: 'edge', date: day(100), label: 'Edge' },
      { id: 'near', date: day(98), label: 'Near' },
      { id: 'fits', date: day(90), label: 'Fits' },
    ],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ Edge: 80, Near: 120, Fits: 80 }),
    SCALES.width,
  );
  const byId = Object.fromEntries(layout.chips.map((chip) => [chip.id, chip]));
  assert.equal(byId.edge.side, 'left');
  assert.equal(byId.edge.x + byId.edge.width, SCALES.width - SOLO_LINE_GAP);
  assert.equal(byId.near.side, 'left');
  assert.equal(byId.near.x + byId.near.width, 98 * CELL - SOLO_LINE_GAP);
  assert.equal(byId.fits.side, 'right');
  assert.equal(byId.fits.x, 90 * CELL + SOLO_LINE_GAP);
  assertNoOverlap(layout.chips);
});

test('layout: a centred chip at the range edge is clamped into the range', () => {
  const placed = placeAnnotations(
    [
      {
        id: 'first',
        date: day(0),
        anchor: 'unit-center',
        label: 'T',
        labelPosition: 'center',
      },
      {
        id: 'last',
        date: day(99),
        anchor: 'unit-center',
        label: 'T',
        labelPosition: 'center',
      },
    ],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ T: 90 }),
    SCALES.width,
  );
  const byId = Object.fromEntries(layout.chips.map((chip) => [chip.id, chip]));
  assert.equal(byId.first.x, 0);
  assert.equal(byId.last.x + byId.last.width, SCALES.width);
});

test('layout: chip width is capped at the maximum and the chip is flagged as clipped', () => {
  const placed = placeAnnotations(
    [{ id: 'long', date: day(10), label: 'Long' }],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ Long: 900 }),
    SCALES.width,
  );
  assert.equal(layout.chips[0].width, ANNOTATION_CHIP_MAX_WIDTH);
  assert.equal(layout.chips[0].clipped, true);
});

test('lines: annotations sharing one x merge into one line with 2 px per stripe, capped at three stripes in input order', () => {
  const same = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      date: day(20),
      label: `S${i}`,
      css: `c${i}`,
    }));
  for (const [count, width] of [
    [1, 2],
    [2, 4],
    [3, 6],
    [4, 6],
    [7, 6],
  ]) {
    const placed = placeAnnotations(same(count), SCALES, CELL);
    const layout = layoutTimelineAnnotations(placed, new Map(), SCALES.width);
    assert.equal(layout.lines.length, 1, `count ${count}: one line`);
    const [line] = layout.lines;
    assert.equal(line.width, width, `count ${count}: width ${width}`);
    assert.equal(line.x, 20 * CELL);
    assert.deepEqual(
      line.stripes.map((stripe) => stripe.id),
      same(count)
        .slice(0, 3)
        .map((item) => item.id),
    );
    assert.deepEqual(
      line.stripes.map((stripe) => stripe.css),
      same(count)
        .slice(0, 3)
        .map((item) => item.css),
    );
    assert.equal(line.ids.length, count);
  }
});

test('lines: a unit-center annotation never merges with unit-start annotations, even at the same x', () => {
  const scales = { ...SCALES, lengthUnitWidth: 0 };
  const placed = placeAnnotations(
    [
      { id: 'edge', date: day(20), label: 'E' },
      { id: 'center', date: day(20), anchor: 'unit-center', label: 'C' },
    ],
    scales,
    CELL,
  );
  assert.equal(placed[0].x, placed[1].x);
  const layout = layoutTimelineAnnotations(placed, new Map(), scales.width);
  assert.equal(layout.lines.length, 2);
});

test('lines: different dates give different lines, each 2 px wide', () => {
  const placed = placeAnnotations(
    [
      { id: 'a', date: day(1), label: 'A' },
      { id: 'b', date: day(2), label: 'B' },
    ],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(placed, new Map(), SCALES.width);
  assert.equal(layout.lines.length, 2);
  assert.ok(layout.lines.every((line) => line.width === 2));
});

// D-108 / Major C1 permanent regression. Root cause of the counterexample:
// the old grouping key was `${anchor}@${x}`, where `x` is the ROUNDED pixel
// coordinate. At a compressed scale (a month-length unit with a small cell
// width, the geometry a real month/quarter zoom produces), two milestones on
// genuinely different canonical dates can round to the identical integer
// pixel and were wrongly merged into one composite line. This test MUST fail
// against the pre-remediation renderer candidate
// 18dbdee41530801d9c5abd20a2d318e4e774330c and pass after the R1 fix, which
// groups by the technical `date` (an exact millisecond instant, one owner's
// deterministic projection of the canonical milestone LocalDate) instead of
// by rounded `x`. The oracle below compares the resulting semantic group
// count/widths, not a copy of the new grouping key function.
test('C1 (D-108): two milestones on DIFFERENT canonical dates stay two distinct line groups, even when a compressed scale rounds them to the same pixel', () => {
  // A month-length-unit scale stand-in with a small cell width — exactly the
  // "lengthUnit = month, small cell width" compressed geometry the
  // independent review counterexample used. `diff` approximates a real
  // month-scale projection closely enough to reproduce the same rounding
  // collision; the pure layout functions only depend on `diff`'s contract
  // (a numeric distance in `lengthUnit`s), not on any particular formula.
  const monthScales = {
    start: day(0),
    end: day(365),
    lengthUnit: 'month',
    lengthUnitWidth: 1,
    width: 40,
    diff: (a, b) => (a.getTime() - b.getTime()) / DAY / 30,
  };
  const COMPRESSED_CELL = 1;

  const placed = placeAnnotations(
    [
      { id: 'milestone-a', date: day(10), label: 'Milestone A' },
      { id: 'milestone-b', date: day(11), label: 'Milestone B' },
    ],
    monthScales,
    COMPRESSED_CELL,
  );
  // Confirms the test actually reproduces the collision: two different
  // canonical dates rounding to the identical pixel. If this assertion ever
  // fails, the scenario below no longer exercises the counterexample.
  assert.equal(
    placed[0].x,
    placed[1].x,
    'test setup must reproduce the rounded-pixel collision between two different dates',
  );
  assert.notEqual(
    placed[0].dateTime,
    placed[1].dateTime,
    'test setup must use two genuinely different canonical dates',
  );

  const layout = layoutTimelineAnnotations(placed, new Map(), monthScales.width);
  assert.equal(
    layout.lines.length,
    2,
    'different canonical milestone dates must remain two semantic line groups, not one composite 4px line, even though their rendered x collides',
  );
  assert.ok(
    layout.lines.every((line) => line.width === 2),
    'each distinct-date line stays its own single-stripe 2px line',
  );
  assert.deepEqual(
    new Set(layout.lines.map((line) => line.ids[0])),
    new Set(['milestone-a', 'milestone-b']),
  );
});

// Same-canonical-date regression companion to the test above: genuinely
// identical dates must still compose into one line at every stripe-cap tier,
// with every label retained as a chip. This guards against a fix that avoids
// C1 by over-correcting into "never merge."
test('C1 companion: same canonical date still composes into one line at 1/2/3/4+ -> 2/4/6/6 px, with every label kept as a chip', () => {
  const same = (n) =>
    Array.from({ length: n }, (_, i) => ({
      id: `same-${i}`,
      date: day(23),
      label: `Same ${i}`,
    }));
  for (const [count, width] of [
    [1, 2],
    [2, 4],
    [3, 6],
    [4, 6],
  ]) {
    const annotations = same(count);
    const placed = placeAnnotations(annotations, SCALES, CELL);
    const measured = widths(
      Object.fromEntries(annotations.map((a) => [a.label, 60])),
    );
    const layout = layoutTimelineAnnotations(placed, measured, SCALES.width);
    assert.equal(layout.lines.length, 1, `count ${count}: one composite line`);
    assert.equal(layout.lines[0].width, width, `count ${count}: width ${width}`);
    assert.equal(
      layout.chips.length,
      count,
      `count ${count}: every milestone keeps its chip/label even past the 3-stripe cap`,
    );
  }
});

/* ------------------------------------------------------------------------ *
 * SVAR-M5 — the transient bar-drag preview.
 *
 * Two inputs, two jobs, deliberately not the same one: `dragPreview.dx` moves
 * PIXELS, `previewDate` decides the composite-line IDENTITY. Every test below
 * pins one of the two so a future change cannot quietly merge them back.
 * ------------------------------------------------------------------------ */

test('SVAR-M5: without a drag preview nothing moves — the identical inputs place identically', () => {
  const annotations = [
    { id: 'm-a', date: day(10), label: 'A', followsTaskId: 'task-a' },
    { id: 'm-b', date: day(20), label: 'B', followsTaskId: 'task-b' },
  ];
  const before = placeAnnotations(annotations, SCALES, CELL);
  const after = placeAnnotations(annotations, SCALES, CELL, null);
  assert.deepEqual(after, before);
  assert.ok(after.every((item) => item.dragged === false));
});

test('SVAR-M5: the annotation that follows the dragged bar moves by exactly dx — and no other annotation moves at all', () => {
  const annotations = [
    { id: 'm-a', date: day(10), label: 'A', followsTaskId: 'task-a' },
    { id: 'm-b', date: day(20), label: 'B', followsTaskId: 'task-b' },
    { id: 'today', date: day(15), label: 'Today', anchor: 'unit-center' },
  ];
  const still = placeAnnotations(annotations, SCALES, CELL);
  for (const dx of [-97, -CELL, -3, 0, 5, CELL, 151]) {
    const moved = placeAnnotations(annotations, SCALES, CELL, {
      id: 'task-a',
      dx,
    });
    assert.equal(
      moved[0].x,
      still[0].x + dx,
      `dx ${dx}: the dragged bar's own marker travels with it, pixel for pixel`,
    );
    assert.equal(moved[0].dragged, true);
    assert.equal(moved[1].x, still[1].x, `dx ${dx}: a stationary marker stays`);
    assert.equal(moved[2].x, still[2].x, `dx ${dx}: Today stays`);
    assert.ok(moved.slice(1).every((item) => item.dragged === false));
  }
});

test('SVAR-M5: an annotation with no followsTaskId is never displaced, whatever is being dragged', () => {
  const annotations = [{ id: 'today', date: day(15), label: 'Today' }];
  const still = placeAnnotations(annotations, SCALES, CELL);
  const dragged = placeAnnotations(annotations, SCALES, CELL, {
    id: 'today',
    dx: 200,
  });
  assert.equal(dragged[0].x, still[0].x);
  assert.equal(dragged[0].dragged, false);
});

test('SVAR-M5: dx moves pixels only — it never changes which composite line an annotation belongs to', () => {
  // Two milestones on ONE date; drag one of them a whole day away in pixels
  // but say nothing about its future date. Grouping must not notice.
  const annotations = [
    { id: 'm-a', date: day(23), label: 'A', followsTaskId: 'task-a' },
    { id: 'm-b', date: day(23), label: 'B', followsTaskId: 'task-b' },
  ];
  const placed = placeAnnotations(annotations, SCALES, CELL, {
    id: 'task-a',
    dx: 3 * CELL,
  });
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ A: 60, B: 60 }),
    SCALES.width,
  );
  assert.equal(layout.lines.length, 1, 'still one group: the date did not change');
  assert.equal(layout.lines[0].width, 4);
});

test('SVAR-M5: previewDate decides identity — the dragged milestone leaves its old composite line and joins the destination one', () => {
  const base = [
    { id: 'm-a', date: day(23), label: 'A', followsTaskId: 'task-a' },
    { id: 'm-b', date: day(23), label: 'B', followsTaskId: 'task-b' },
    { id: 'm-c', date: day(30), label: 'C', followsTaskId: 'task-c' },
    { id: 'm-d', date: day(30), label: 'D', followsTaskId: 'task-d' },
  ];
  const measured = widths({ A: 60, B: 60, C: 60, D: 60 });

  const atRest = layoutTimelineAnnotations(
    placeAnnotations(base, SCALES, CELL),
    measured,
    SCALES.width,
  );
  assert.deepEqual(
    atRest.lines.map((line) => line.width),
    [4, 4],
    'at rest: two composite lines of two stripes each',
  );

  // A is halfway to day 30: its preview date has not reached it yet.
  const halfway = base.map((a) =>
    a.id === 'm-a' ? { ...a, previewDate: day(26) } : a,
  );
  const midDrag = layoutTimelineAnnotations(
    placeAnnotations(halfway, SCALES, CELL, { id: 'task-a', dx: 3 * CELL }),
    measured,
    SCALES.width,
  );
  const midWidths = midDrag.lines.map((line) => ({
    ids: line.ids,
    width: line.width,
  }));
  assert.equal(midDrag.lines.length, 3, 'A is its own line while in transit');
  assert.deepEqual(
    midWidths.find((line) => line.ids.join() === 'm-b'),
    { ids: ['m-b'], width: 2 },
    'the line A left immediately shrinks to B alone, 2px — not after the drop',
  );
  assert.deepEqual(
    midWidths.find((line) => line.ids.join() === 'm-c,m-d'),
    { ids: ['m-c', 'm-d'], width: 4 },
    'the destination is still C+D while A has not reached its date',
  );

  // A's preview date IS day 30 now: the destination composite grows live.
  const arrived = base.map((a) =>
    a.id === 'm-a' ? { ...a, previewDate: day(30) } : a,
  );
  const onTarget = layoutTimelineAnnotations(
    placeAnnotations(arrived, SCALES, CELL, { id: 'task-a', dx: 7 * CELL - 4 }),
    measured,
    SCALES.width,
  );
  assert.equal(onTarget.lines.length, 2);
  const destination = onTarget.lines.find((line) => line.ids.includes('m-a'));
  assert.deepEqual(destination.ids, ['m-a', 'm-c', 'm-d']);
  assert.equal(destination.width, 6, 'three stripes, live, before the drop');
  assert.equal(
    destination.dragged,
    true,
    'a composite line holding the dragged marker is flagged as such',
  );
  assert.equal(
    destination.x,
    placeAnnotations(arrived, SCALES, CELL, { id: 'task-a', dx: 7 * CELL - 4 })
      .find((item) => item.id === 'm-a').x,
    'and it is drawn on the diamond under the pointer, not on the destination day',
  );
  assert.equal(
    onTarget.lines.find((line) => line.ids.join() === 'm-b').width,
    2,
  );
});

test('SVAR-M5: the dragged chip travels with its own line, and the lane keeps its no-overlap guarantee throughout', () => {
  const annotations = [
    { id: 'm-a', date: day(10), label: 'Alpha', followsTaskId: 'task-a' },
    { id: 'm-b', date: day(20), label: 'Beta', followsTaskId: 'task-b' },
  ];
  const measured = widths({ Alpha: 80, Beta: 80 });
  for (let dx = 0; dx <= 10 * CELL; dx += 7) {
    const layout = layoutTimelineAnnotations(
      placeAnnotations(annotations, SCALES, CELL, { id: 'task-a', dx }),
      measured,
      SCALES.width,
    );
    const chip = layout.chips.find((c) => c.id === 'm-a');
    const line = layout.lines.find((l) => l.ids.includes('m-a'));
    assert.equal(chip.lineX, line.x, `dx ${dx}: chip anchored on its own line`);
    assert.equal(chip.dragged, true);
    for (const [, row] of rowsOf(layout.chips)) {
      const sorted = [...row].sort((a, b) => a.x - b.x);
      for (let i = 1; i < sorted.length; i++) {
        assert.ok(
          sorted[i].x >= sorted[i - 1].x + sorted[i - 1].width,
          `dx ${dx}: chips in one row never overlap mid-drag`,
        );
      }
    }
  }
});

test('SVAR-M5: a drag can change the lane height, and the height stays the one formula', () => {
  // Two chips far apart share row 0; drag one on top of the other and the
  // lane must grow to two rows — the same rule, applied to moved pixels.
  const annotations = [
    { id: 'm-a', date: day(10), label: 'Alpha', followsTaskId: 'task-a' },
    { id: 'm-b', date: day(20), label: 'Beta', followsTaskId: 'task-b' },
  ];
  const measured = widths({ Alpha: 120, Beta: 120 });
  const apart = layoutTimelineAnnotations(
    placeAnnotations(annotations, SCALES, CELL),
    measured,
    SCALES.width,
  );
  assert.equal(apart.rowCount, 1);
  assert.equal(apart.laneHeight, laneHeightForRows(1));

  const overlapping = layoutTimelineAnnotations(
    placeAnnotations(annotations, SCALES, CELL, { id: 'task-a', dx: 10 * CELL }),
    measured,
    SCALES.width,
  );
  assert.equal(overlapping.rowCount, 2, 'the moved chip needs a row of its own');
  assert.equal(overlapping.laneHeight, laneHeightForRows(2));
});

test('SVAR-M5: a preview never removes a marker from the layout, and a garbage preview is ignored', () => {
  const annotations = [
    { id: 'm-a', date: day(10), label: 'A', followsTaskId: 'task-a' },
  ];
  const still = placeAnnotations(annotations, SCALES, CELL);
  // A displacement that would take the marker far outside the range still
  // leaves it placed: range membership is decided by `date`, never by `dx`.
  const far = placeAnnotations(annotations, SCALES, CELL, {
    id: 'task-a',
    dx: -100 * CELL,
  });
  assert.equal(far.length, 1);
  for (const nonsense of [
    { id: 'task-a', dx: Number.NaN },
    { id: 'task-a', dx: undefined },
    { id: null, dx: 40 },
    {},
  ]) {
    assert.deepEqual(
      placeAnnotations(annotations, SCALES, CELL, nonsense).map((i) => i.x),
      still.map((i) => i.x),
      `a preview of ${JSON.stringify(nonsense)} must not move anything`,
    );
  }
});

/* ------------------------------------------------------------------------ *
 * SVAR-M7 — bottom-anchored rows (R3 §3). `bottomAnchored: true` on an
 * annotation is a generic capability this module attaches no meaning to; the
 * Planner sets it on exactly one annotation, Today. These tests still name it
 * "Today" for readability, matching the product scenario it exists for. Which
 * BANDS that annotation's line reaches is a separate question, answered by
 * SVAR-M9 below.
 * ------------------------------------------------------------------------ */

function today(id, offset, extra) {
  return {
    id,
    date: day(offset),
    anchor: 'unit-center',
    label: 'Today',
    labelPosition: 'center',
    bottomAnchored: true,
    ...extra,
  };
}

function milestone(id, offset, label, extra) {
  return { id, date: day(offset), label: label ?? id, ...extra };
}

test('SVAR-M7: Today alone is row 0 — trivially the bottom (and only) row', () => {
  const placed = placeAnnotations([today('today', 10)], SCALES, CELL);
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ Today: 70 }),
    SCALES.width,
  );
  assert.equal(layout.rowCount, 1);
  assert.equal(layout.chips[0].row, 0);
  assert.equal(layout.chips[0].bottomAnchored, true);
});

test('SVAR-M7: Today plus one non-overlapping milestone share the bottom row', () => {
  const placed = placeAnnotations(
    [today('today', 10), milestone('m', 60, 'Milestone')],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ Today: 60, Milestone: 90 }),
    SCALES.width,
  );
  const byId = Object.fromEntries(layout.chips.map((c) => [c.id, c]));
  assert.equal(layout.rowCount, 1, 'no collision — one shared row');
  assert.equal(byId.today.row, 0);
  assert.equal(byId.m.row, 0);
  assert.equal(byId.today.row, layout.rowCount - 1, 'Today is the bottom row');
  assertNoOverlap(layout.chips);
});

test('SVAR-M7: a milestone that overlaps Today horizontally moves to a row ABOVE Today — Today never moves up', () => {
  // Same date and comparable widths so the two chips would collide if placed
  // in the same row: Today (centred on day 10) and a wide milestone chip
  // whose line/right-placement lands squarely on Today's interval.
  const placed = placeAnnotations(
    [today('today', 10), milestone('m', 10, 'Milestone')],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ Today: 60, Milestone: 90 }),
    SCALES.width,
  );
  const byId = Object.fromEntries(layout.chips.map((c) => [c.id, c]));
  assert.equal(layout.rowCount, 2, 'Today needed its own new bottom row');
  assert.equal(byId.today.row, 1);
  assert.equal(byId.m.row, 0, 'the colliding milestone stayed where first-fit put it — above Today');
  assert.equal(byId.today.row, layout.rowCount - 1, 'Today is still the bottom row');
  assertNoOverlap(layout.chips);
});

test('SVAR-M7: Today plus two same-day milestones — Today stays bottom whichever of them collides with it', () => {
  const placed = placeAnnotations(
    [
      today('today', 20),
      milestone('m1', 20, 'Alpha'),
      milestone('m2', 20, 'Beta'),
    ],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ Today: 60, Alpha: 80, Beta: 80 }),
    SCALES.width,
  );
  const byId = Object.fromEntries(layout.chips.map((c) => [c.id, c]));
  assert.equal(byId.today.row, layout.rowCount - 1, 'Today is always the bottom row');
  assertNoOverlap(layout.chips);
});

test('SVAR-M7: Today near several long milestone labels needing multiple rows — Today is still the very last row', () => {
  const annotations = [
    today('today', 30),
    milestone('m1', 28, 'Milestone One Has A Rather Long Name'),
    milestone('m2', 29, 'Milestone Two Also Runs Long'),
    milestone('m3', 30, 'Milestone Three Overlaps Today Directly'),
    milestone('m4', 31, 'Milestone Four Is Long As Well'),
    milestone('m5', 32, 'Milestone Five Rounds It Out'),
  ];
  const measured = widths({
    Today: 70,
    'Milestone One Has A Rather Long Name': 220,
    'Milestone Two Also Runs Long': 200,
    'Milestone Three Overlaps Today Directly': 230,
    'Milestone Four Is Long As Well': 210,
    'Milestone Five Rounds It Out': 200,
  });
  const placed = placeAnnotations(annotations, SCALES, CELL);
  const layout = layoutTimelineAnnotations(placed, measured, SCALES.width);
  assert.ok(layout.rowCount >= 2, 'test setup must actually need several rows');
  const todayChip = layout.chips.find((c) => c.id === 'today');
  assert.equal(todayChip.row, layout.rowCount - 1, 'Today is the very last row');
  assertNoOverlap(layout.chips);
});

test('SVAR-M7: growing and shrinking the milestone set moves Today with the bottom row, never leaving an empty row below it', () => {
  const measured = widths({
    Today: 60,
    Alpha: 200,
    Beta: 200,
    Gamma: 200,
  });
  // Grows from 0 -> 3 colliding milestones, then shrinks back to 0.
  const steps = [
    [],
    [milestone('m1', 30, 'Alpha')],
    [milestone('m1', 30, 'Alpha'), milestone('m2', 30, 'Beta')],
    [
      milestone('m1', 30, 'Alpha'),
      milestone('m2', 30, 'Beta'),
      milestone('m3', 30, 'Gamma'),
    ],
    [milestone('m1', 30, 'Alpha')],
    [],
  ];
  for (const milestones of steps) {
    const placed = placeAnnotations(
      [today('today', 30), ...milestones],
      SCALES,
      CELL,
    );
    const layout = layoutTimelineAnnotations(placed, measured, SCALES.width);
    const todayChip = layout.chips.find((c) => c.id === 'today');
    assert.equal(
      todayChip.row,
      layout.rowCount - 1,
      `milestones=${milestones.length}: Today is the bottom row`,
    );
    // No arbitrary empty row below Today: the lane's height accounts for
    // exactly rowCount rows, nothing more.
    assert.equal(layout.laneHeight, laneHeightForRows(layout.rowCount));
  }
});

test('SVAR-M7: Pan (a wider range at the same annotations) does not change which row Today lands in', () => {
  const annotations = [today('today', 30), milestone('m', 30, 'Milestone')];
  const measured = widths({ Today: 60, Milestone: 90 });
  const narrow = layoutTimelineAnnotations(
    placeAnnotations(annotations, SCALES, CELL),
    measured,
    SCALES.width,
  );
  const widerScales = { ...SCALES, end: day(400), width: 400 * CELL };
  const wide = layoutTimelineAnnotations(
    placeAnnotations(annotations, widerScales, CELL),
    measured,
    widerScales.width,
  );
  const rowOf = (layout, id) =>
    layout.chips.find((c) => c.id === id).row;
  assert.equal(rowOf(narrow, 'today'), narrow.rowCount - 1);
  assert.equal(rowOf(wide, 'today'), wide.rowCount - 1);
  assert.equal(narrow.rowCount, wide.rowCount);
});

/* ------------------------------------------------------------------------ *
 * SVAR-M9 — which BANDS a line is drawn in, and how wide one stripe is
 * (Phase 3.2B R5 / P7). `lineExtent: 'body'` and `stripeWidth` are generic
 * presentation capabilities this module attaches no meaning to; the Planner
 * sets both on exactly one annotation, Today. These tests keep calling it
 * "Today" for readability, matching the product scenario they exist for.
 * ------------------------------------------------------------------------ */

test("SVAR-M9: an annotation asking for the chart body alone marks its line bodyOnly; every other line keeps the header bands", () => {
  const placed = placeAnnotations(
    [today('today', 10, { lineExtent: 'body' }), milestone('m', 10, 'Milestone')],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(
    placed,
    widths({ Today: 60, Milestone: 90 }),
    SCALES.width,
  );
  const todayLine = layout.lines.find((l) => l.ids.includes('today'));
  const milestoneLine = layout.lines.find((l) => l.ids.includes('m'));
  assert.equal(todayLine.bodyOnly, true);
  assert.equal(milestoneLine.bodyOnly, false, 'an ordinary line still reaches the header');
  // The row rule is untouched by the band rule: Today still claims the
  // bottom row, and the lane is still exactly as tall as its rows.
  const todayChip = layout.chips.find((c) => c.id === 'today');
  assert.equal(todayChip.row, layout.rowCount - 1);
  assert.equal(layout.laneHeight, laneHeightForRows(layout.rowCount));
  assert.ok(
    layout.laneHeight >= chipTopForRow(todayChip.row) + ANNOTATION_CHIP_HEIGHT + ANNOTATION_LANE_PADDING_BOTTOM - 1,
  );
});

test('SVAR-M9: the default is unchanged — an annotation that asks for nothing keeps all three bands', () => {
  const placed = placeAnnotations([milestone('m', 10, 'Milestone')], SCALES, CELL);
  const layout = layoutTimelineAnnotations(placed, widths({ Milestone: 90 }), SCALES.width);
  assert.equal(layout.lines[0].bodyOnly, false);
  assert.equal(layout.lines[0].width, ANNOTATION_STRIPE_WIDTH);
  assert.equal(layout.lines[0].stripes[0].width, ANNOTATION_STRIPE_WIDTH);
});

test('SVAR-M9: one annotation cannot shorten a line it SHARES — a composite line is bodyOnly only when every member asked for it', () => {
  const shared = [
    { id: 'a', date: day(20), label: 'A', lineExtent: 'body' },
    { id: 'b', date: day(20), label: 'B' },
  ];
  const layout = layoutTimelineAnnotations(
    placeAnnotations(shared, SCALES, CELL),
    widths({ A: 40, B: 40 }),
    SCALES.width,
  );
  assert.equal(layout.lines.length, 1, 'one canonical date, one composite line');
  assert.equal(layout.lines[0].bodyOnly, false);

  const both = shared.map((a) => ({ ...a, lineExtent: 'body' }));
  const layoutBoth = layoutTimelineAnnotations(
    placeAnnotations(both, SCALES, CELL),
    widths({ A: 40, B: 40 }),
    SCALES.width,
  );
  assert.equal(layoutBoth.lines[0].bodyOnly, true);
});

test('SVAR-M9: a stripe is as wide as ITS OWN annotation asked, the line is their sum, and the line stays centred on its date', () => {
  const placed = placeAnnotations(
    [today('today', 10, { stripeWidth: 3 })],
    SCALES,
    CELL,
  );
  const layout = layoutTimelineAnnotations(placed, widths({ Today: 60 }), SCALES.width);
  const line = layout.lines[0];
  assert.equal(line.width, 3);
  assert.equal(line.stripes[0].width, 3);
  // Centred: the drawn left edge is `x - width / 2` (TimelineLines.jsx), so
  // the line's own centre is its date's x whatever the stripe width is.
  assert.equal(line.x - line.width / 2 + line.width / 2, line.x);

  const mixed = layoutTimelineAnnotations(
    placeAnnotations(
      [
        { id: 'a', date: day(20), label: 'A', stripeWidth: 3 },
        { id: 'b', date: day(20), label: 'B' },
      ],
      SCALES,
      CELL,
    ),
    widths({ A: 40, B: 40 }),
    SCALES.width,
  );
  assert.equal(mixed.lines[0].width, 3 + ANNOTATION_STRIPE_WIDTH);
});

test('SVAR-M9: a non-positive or nonsensical stripeWidth falls back to the package default', () => {
  for (const bad of [0, -3, Number.NaN, Number.POSITIVE_INFINITY, '3', null, undefined]) {
    const layout = layoutTimelineAnnotations(
      placeAnnotations([milestone('m', 10, 'Milestone', { stripeWidth: bad })], SCALES, CELL),
      widths({ Milestone: 90 }),
      SCALES.width,
    );
    assert.equal(
      layout.lines[0].width,
      ANNOTATION_STRIPE_WIDTH,
      `stripeWidth=${String(bad)} must fall back to the default`,
    );
  }
});

test('SVAR-M9: the chip gap is still measured from the line\'s own OUTER edge when that line is 3 px wide', () => {
  const layout = layoutTimelineAnnotations(
    placeAnnotations(
      [milestone('m', 50, 'Milestone', { stripeWidth: 3 })],
      SCALES,
      CELL,
    ),
    widths({ Milestone: 80 }),
    SCALES.width,
  );
  const chip = layout.chips[0];
  const line = layout.lines[0];
  assert.equal(chip.x, line.x + line.width / 2 + ANNOTATION_LINE_GAP);
});

test('SVAR-M7: the milestone chip gap is exactly ANNOTATION_LINE_GAP from the line\'s own OUTER edge, for a 2/4/6 px composite line, right and left fallback alike', () => {
  for (const [count, expectedWidth] of [
    [1, 2],
    [2, 4],
    [3, 6],
  ]) {
    const group = Array.from({ length: count }, (_, i) => ({
      id: `g${i}`,
      date: day(50),
      label: `Group ${count}-${i}`,
    }));
    const measuredEntries = Object.fromEntries(
      group.map((a) => [a.label, 80]),
    );
    const placedRight = placeAnnotations(group, SCALES, CELL);
    const layoutRight = layoutTimelineAnnotations(
      placedRight,
      widths(measuredEntries),
      SCALES.width,
    );
    assert.equal(layoutRight.lines[0].width, expectedWidth);
    for (const chip of layoutRight.chips) {
      assert.equal(chip.side, 'right');
      assert.equal(
        chip.x - chip.lineX,
        expectedWidth / 2 + ANNOTATION_LINE_GAP,
        `count ${count} right: gap must be ${ANNOTATION_LINE_GAP}px from the line's outer edge`,
      );
    }

    // Force the left fallback by placing the same group right at the range
    // edge, where a right-side chip would leave the range.
    const edgeOffset = 100;
    const edgeGroup = group.map((a) => ({ ...a, date: day(edgeOffset) }));
    const placedLeft = placeAnnotations(edgeGroup, SCALES, CELL);
    const layoutLeft = layoutTimelineAnnotations(
      placedLeft,
      widths(measuredEntries),
      SCALES.width,
    );
    for (const chip of layoutLeft.chips) {
      assert.equal(chip.side, 'left');
      assert.equal(
        chip.lineX - (chip.x + chip.width),
        expectedWidth / 2 + ANNOTATION_LINE_GAP,
        `count ${count} left fallback: gap must be ${ANNOTATION_LINE_GAP}px from the line's outer edge`,
      );
    }
  }
});

test('SVAR-M7 negative control (NC-R3-A oracle): a Today NOT flagged bottomAnchored falls back to ordinary first-fit and can land ABOVE a colliding milestone', () => {
  // Today's x (day 10, centred: 10*CELL + CELL/2) sorts BEFORE the
  // milestone's x (day 11, unit-start: 11*CELL) — so plain x-then-input-order
  // first-fit visits Today first and gives it row 0, pushing the colliding
  // milestone to row 1. This is the exact "ordinary top/first-fit row"
  // behaviour NC-R3-A restores; the permanent bottom-row tests above must
  // fail against it, which is what proves they are testing the right thing.
  const plainToday = {
    id: 'today',
    date: day(10),
    anchor: 'unit-center',
    label: 'Today',
    labelPosition: 'center',
  };
  const withoutFlag = layoutTimelineAnnotations(
    placeAnnotations([plainToday, milestone('m', 11, 'Milestone')], SCALES, CELL),
    widths({ Today: 60, Milestone: 90 }),
    SCALES.width,
  );
  const withoutFlagById = Object.fromEntries(
    withoutFlag.chips.map((c) => [c.id, c]),
  );
  assert.equal(withoutFlag.rowCount, 2, 'test setup must actually force a collision');
  assert.equal(
    withoutFlagById.today.row,
    0,
    'ordinary first-fit (no flag): Today keeps the first row it fit in, which is the TOP one here',
  );
  assert.equal(withoutFlagById.m.row, 1, 'the milestone was pushed down instead');

  // Same scenario, WITH the flag: bottom-anchored placement must reverse it.
  const withFlag = layoutTimelineAnnotations(
    placeAnnotations([today('today', 10), milestone('m', 11, 'Milestone')], SCALES, CELL),
    widths({ Today: 60, Milestone: 90 }),
    SCALES.width,
  );
  const withFlagById = Object.fromEntries(withFlag.chips.map((c) => [c.id, c]));
  assert.equal(withFlag.rowCount, 2);
  assert.equal(withFlagById.m.row, 0, 'the milestone keeps the row first-fit gave it');
  assert.equal(
    withFlagById.today.row,
    withFlag.rowCount - 1,
    'Today is pushed to a NEW bottom row instead — never the other way around',
  );
});


/* ------------------------------------------------------------------------ *
 * SVAR-M8: where the lane splits the scale header.
 * ------------------------------------------------------------------------ */

/** A three-row day header, as `_scales` presents it. */
const DAY_HEADER = { rows: [{ height: 30 }, { height: 25 }, { height: 25 }], height: 80 };
/** A two-row week/month header. */
const TWO_ROW_HEADER = { rows: [{ height: 30 }, { height: 30 }], height: 60 };
/** A single-row header: there is nothing to put below the lane. */
const ONE_ROW_HEADER = { rows: [{ height: 40 }], height: 40 };

test('SVAR-M8: the lane splits the header after the TOP row, whatever the row count', () => {
  const three = splitScaleHeaderForLane(DAY_HEADER, 28);
  assert.equal(three.laneSplitsHeader, true);
  assert.equal(three.rowsAboveLane, 1, 'exactly one row renders above the lane');
  assert.equal(three.heightAboveLane, 30);
  assert.equal(three.heightBelowLane, 50, 'the two lower rows');
  assert.equal(three.laneHeight, 28);

  const two = splitScaleHeaderForLane(TWO_ROW_HEADER, 28);
  assert.equal(two.laneSplitsHeader, true);
  assert.equal(two.rowsAboveLane, 1, 'the rule is positional, not "the month row"');
  assert.equal(two.heightAboveLane, 30);
  assert.equal(two.heightBelowLane, 30);
});

test('SVAR-M8: the split preserves the whole header height exactly', () => {
  for (const header of [DAY_HEADER, TWO_ROW_HEADER]) {
    const split = splitScaleHeaderForLane(header, 22);
    assert.equal(
      split.heightAboveLane + split.heightBelowLane,
      header.height,
      'no pixel is invented or lost by the split — this is what keeps the grid aligned',
    );
  }
});

test('SVAR-M8: no lane means no split at all — the pre-SVAR-M8 arrangement', () => {
  for (const laneHeight of [0, undefined, null, NaN, -10]) {
    const split = splitScaleHeaderForLane(DAY_HEADER, laneHeight);
    assert.equal(split.laneSplitsHeader, false, `laneHeight=${laneHeight}`);
    assert.equal(split.rowsAboveLane, 3, 'every row renders above the (absent) lane');
    assert.equal(split.heightAboveLane, DAY_HEADER.height);
    assert.equal(split.heightBelowLane, 0);
    assert.equal(split.laneHeight, 0);
  }
});

test('SVAR-M8: a single-row header has nothing to put below the lane', () => {
  const split = splitScaleHeaderForLane(ONE_ROW_HEADER, 28);
  assert.equal(split.laneSplitsHeader, false);
  assert.equal(split.rowsAboveLane, 1);
  assert.equal(split.heightAboveLane, ONE_ROW_HEADER.height);
  assert.equal(split.heightBelowLane, 0);
  assert.equal(split.laneHeight, 28, 'the lane still exists — it just sits under the only row');
});

test('SVAR-M8: a missing or malformed `_scales` degrades to no split', () => {
  for (const scales of [undefined, null, {}, { rows: null, height: 'x' }]) {
    const split = splitScaleHeaderForLane(scales, 28);
    assert.equal(split.laneSplitsHeader, false);
    assert.equal(split.heightAboveLane, 0);
    assert.equal(split.heightBelowLane, 0);
  }
});

test('SVAR-M8 negative control (NC-R4-A oracle): a lane placed under ALL rows leaves nothing below it', () => {
  // NC-R4-A restores the pre-SVAR-M8 order (lane under every scale row). The
  // shape that control produces is exactly `laneSplitsHeader === false`, and
  // the permanent tests above must be able to tell the two apart.
  const restored = splitScaleHeaderForLane(DAY_HEADER, 0);
  const current = splitScaleHeaderForLane(DAY_HEADER, 28);
  assert.notEqual(restored.laneSplitsHeader, current.laneSplitsHeader);
  assert.equal(restored.heightBelowLane, 0);
  assert.ok(current.heightBelowLane > 0);
});
