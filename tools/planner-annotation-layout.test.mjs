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
