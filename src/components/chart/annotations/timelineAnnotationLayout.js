/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M4).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The ONE owner of timeline-annotation geometry, as pure functions over
 * presentation data:
 *
 *   placeAnnotations            date -> x on the laid-out timeline, with the
 *                               very expression the store uses for a bar's left
 *                               edge, so a line and a bar naming the same date
 *                               land on the same pixel on every scale
 *   layoutTimelineAnnotations   which annotations share one vertical line
 *                               (and how it is striped), and in which ROW of
 *                               the annotation lane each chip sits so that no
 *                               two chips overlap
 *
 * WHAT THESE FUNCTIONS KNOW, AND WHAT THEY DO NOT
 *
 * They know pixels: a technical `Date`, the current scale geometry, a measured
 * chip width, the width of the whole timeline range. They decide nothing about
 * what an annotation MEANS — no clock, no notion of "today", no working-day
 * rule, no date business rule. The consumer supplies the date, the label, the
 * anchor and a `css` class its own stylesheet colours.
 *
 * THE LAYOUT RULES (the Planner's own accepted product rules, restated as code)
 *
 *   - collisions between chips are resolved VERTICALLY only: a chip goes into
 *     the first row in which its horizontal interval is free. A chip is never
 *     shifted sideways to make room for another chip;
 *   - the only horizontal exception is the RANGE-EDGE fallback: a chip placed
 *     beside its line that would leave the timeline range on the right is
 *     placed on the left of the line instead; a centred chip that would leave
 *     the range is clamped to the range. Both are computed against the FULL
 *     range width, never against the viewport, so panning cannot flip a side;
 *   - placement order is deterministic: by x, then by input order for equal x.
 *     Input order is the consumer's display order and is preserved as such;
 *   - annotations whose lines land on the same x (and share an anchor kind)
 *     merge into ONE striped line: one 2 px stripe per annotation, at most
 *     three stripes, in input order — the fourth and later annotations keep
 *     their chips but add no stripe;
 *   - the lane is as tall as the rows it needs; there is no row cap.
 *
 * The result depends on the inputs alone. Horizontal scroll is not an input,
 * so a pan cannot change a row, a side or the lane height.
 */

/** Height of one chip, in px. Also written inline on every chip element. */
export const ANNOTATION_CHIP_HEIGHT = 22;
/** Vertical distance between two rows of chips, in px. */
export const ANNOTATION_ROW_GAP = 4;
/** Padding above the first row and below the last one, in px. */
export const ANNOTATION_LANE_PADDING = 4;
/** Minimum horizontal distance between two chips sharing a row, in px. */
export const ANNOTATION_CHIP_GAP = 6;
/** Horizontal gap between a line and a chip placed beside it, in px. */
export const ANNOTATION_LINE_GAP = 6;
/** A chip is never wider than this; longer labels are clipped with an ellipsis. */
export const ANNOTATION_CHIP_MAX_WIDTH = 240;
/** One colour stripe of a composite line, in px. */
export const ANNOTATION_STRIPE_WIDTH = 2;
/** A composite line shows at most this many stripes. */
export const ANNOTATION_MAX_STRIPES = 3;

const EMPTY_PLACED = Object.freeze([]);

export const EMPTY_ANNOTATION_LAYOUT = Object.freeze({
  lines: Object.freeze([]),
  chips: Object.freeze([]),
  rowCount: 0,
  laneHeight: 0,
});

/**
 * Where each annotation's line stands on the laid-out timeline.
 *
 * `scales` is the store's `_scales` (`start`, `end`, `lengthUnit`,
 * `lengthUnitWidth`, `width`, `diff`) and `cellWidth` the store's `cellWidth`
 * — the same two values the bars are placed from. A date outside
 * `[start, end]` gets no entry; `end` itself is kept because a date whose
 * column ends exactly at the range edge is a legitimate right-boundary anchor.
 *
 * @returns an array in INPUT ORDER of `{ id, x, anchor, label, title,
 *   labelPosition, css }`.
 */
export function placeAnnotations(annotations, scales, cellWidth) {
  if (
    !annotations ||
    !annotations.length ||
    !scales ||
    typeof scales.diff !== 'function' ||
    !Number.isFinite(cellWidth)
  ) {
    return EMPTY_PLACED;
  }
  const { start, end, lengthUnit, lengthUnitWidth, width, diff } = scales;
  const placed = [];
  for (const annotation of annotations) {
    const date = annotation && annotation.date;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    if (date < start || date > end) continue;
    // The bar rule, verbatim: the column's left edge for this date.
    const unitStart = Math.round(diff(date, start, lengthUnit) * cellWidth);
    const anchor =
      annotation.anchor === 'unit-center' ? 'unit-center' : 'unit-start';
    const x =
      anchor === 'unit-center' ? unitStart + lengthUnitWidth / 2 : unitStart;
    if (!Number.isFinite(x) || x < 0 || x > width) continue;
    const label = annotation.label == null ? '' : String(annotation.label);
    const title =
      annotation.title == null || annotation.title === ''
        ? label
        : String(annotation.title);
    placed.push({
      id: annotation.id,
      x,
      anchor,
      label,
      title,
      labelPosition: annotation.labelPosition === 'center' ? 'center' : 'after',
      css: annotation.css || '',
    });
  }
  return placed;
}

function overlaps(left, right, row) {
  for (const [otherLeft, otherRight] of row) {
    if (
      left < otherRight + ANNOTATION_CHIP_GAP &&
      right + ANNOTATION_CHIP_GAP > otherLeft
    ) {
      return true;
    }
  }
  return false;
}

/**
 * The lane height for a given number of chip rows.
 */
export function laneHeightForRows(rowCount) {
  if (rowCount <= 0) return 0;
  return (
    ANNOTATION_LANE_PADDING * 2 +
    rowCount * ANNOTATION_CHIP_HEIGHT +
    (rowCount - 1) * ANNOTATION_ROW_GAP
  );
}

/** The top offset of a chip in `row`, inside the lane. */
export function chipTopForRow(row) {
  return (
    ANNOTATION_LANE_PADDING +
    row * (ANNOTATION_CHIP_HEIGHT + ANNOTATION_ROW_GAP)
  );
}

/**
 * Lines and chips for already-placed annotations.
 *
 * @param placed        the result of `placeAnnotations`
 * @param labelWidths   `Map<label, naturalChipWidthPx>` — the measured natural
 *                      width of a chip carrying that label (padding included).
 *                      Until every placed label has a measurement, no chip is
 *                      laid out and the lane has zero height; the lines are
 *                      laid out regardless, because they need no measurement.
 * @param rangeWidth    the full width of the timeline range, in px
 * @returns `{ lines, chips, rowCount, laneHeight }`
 */
export function layoutTimelineAnnotations(placed, labelWidths, rangeWidth) {
  if (!placed || !placed.length) return EMPTY_ANNOTATION_LAYOUT;

  const groups = new Map();
  const lines = [];
  for (const item of placed) {
    const key = `${item.anchor}@${item.x}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, x: item.x, members: [] };
      groups.set(key, group);
      lines.push(group);
    }
    group.members.push(item);
  }
  const lineModels = lines.map((group) => {
    const stripes = group.members
      .slice(0, ANNOTATION_MAX_STRIPES)
      .map((member) => ({ id: member.id, css: member.css }));
    return {
      key: group.key,
      x: group.x,
      width: stripes.length * ANNOTATION_STRIPE_WIDTH,
      stripes,
      ids: group.members.map((member) => member.id),
    };
  });

  const measured =
    labelWidths instanceof Map &&
    placed.every((item) => labelWidths.has(item.label));
  if (!measured) {
    return { lines: lineModels, chips: [], rowCount: 0, laneHeight: 0 };
  }

  const range = Number.isFinite(rangeWidth) && rangeWidth > 0 ? rangeWidth : 0;
  const order = placed
    .map((item, index) => ({ item, index }))
    .sort((a, b) => a.item.x - b.item.x || a.index - b.index);

  const rows = [];
  const chips = [];
  for (const { item } of order) {
    const natural = labelWidths.get(item.label);
    const width = Math.min(
      ANNOTATION_CHIP_MAX_WIDTH,
      Math.max(0, Math.ceil(natural)),
    );
    let side;
    let left;
    if (item.labelPosition === 'center') {
      side = 'center';
      left = item.x - width / 2;
      if (left + width > range) left = range - width;
      if (left < 0) left = 0;
    } else {
      side = 'right';
      left = item.x + ANNOTATION_LINE_GAP;
      if (left + width > range) {
        side = 'left';
        left = item.x - ANNOTATION_LINE_GAP - width;
        if (left < 0) left = 0;
      }
    }
    const right = left + width;
    let row = 0;
    while (row < rows.length && overlaps(left, right, rows[row])) row += 1;
    if (row === rows.length) rows.push([]);
    rows[row].push([left, right]);
    chips.push({
      id: item.id,
      label: item.label,
      title: item.title,
      css: item.css,
      x: left,
      width,
      row,
      side,
      lineX: item.x,
      clipped: natural > ANNOTATION_CHIP_MAX_WIDTH,
    });
  }

  return {
    lines: lineModels,
    chips,
    rowCount: rows.length,
    laneHeight: laneHeightForRows(rows.length),
  };
}
