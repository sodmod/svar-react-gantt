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
  ANNOTATION_LANE_PADDING,
  ANNOTATION_LINE_GAP,
  ANNOTATION_ROW_GAP,
  chipTopForRow,
  laneHeightForRows,
  layoutTimelineAnnotations,
  placeAnnotations,
} from '../src/components/chart/annotations/timelineAnnotationLayout.js';

const DAY = 24 * 60 * 60 * 1000;
const CELL = 34;

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
  assert.equal(chip.x, 10 * CELL + ANNOTATION_LINE_GAP);
  assert.equal(chip.width, 60);
  assert.equal(chip.row, 0);
  assert.equal(layout.rowCount, 1);
  assert.equal(layout.laneHeight, laneHeightForRows(1));
  assert.equal(
    laneHeightForRows(1),
    ANNOTATION_LANE_PADDING * 2 + ANNOTATION_CHIP_HEIGHT,
  );
  assert.equal(chipTopForRow(0), ANNOTATION_LANE_PADDING);
  assert.equal(
    chipTopForRow(2),
    ANNOTATION_LANE_PADDING + 2 * (ANNOTATION_CHIP_HEIGHT + ANNOTATION_ROW_GAP),
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
  assert.equal(byId.a.x, 10 * CELL + ANNOTATION_LINE_GAP);
  assert.equal(byId.b.x, 11 * CELL + ANNOTATION_LINE_GAP);
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
  // Every chip keeps its own line as its horizontal anchor.
  for (const chip of layout.chips) {
    assert.equal(chip.x, chip.lineX + ANNOTATION_LINE_GAP);
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
  assert.equal(
    byId.edge.x + byId.edge.width,
    SCALES.width - ANNOTATION_LINE_GAP,
  );
  assert.equal(byId.near.side, 'left');
  assert.equal(byId.near.x + byId.near.width, 98 * CELL - ANNOTATION_LINE_GAP);
  assert.equal(byId.fits.side, 'right');
  assert.equal(byId.fits.x, 90 * CELL + ANNOTATION_LINE_GAP);
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
