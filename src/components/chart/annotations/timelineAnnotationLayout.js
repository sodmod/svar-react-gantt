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
 *   - annotations sharing one composite line are grouped by their SEMANTIC
 *     identity — the consumer-supplied technical `date` (an exact millisecond
 *     instant, one owner's deterministic projection of a canonical LocalDate,
 *     D-108) plus the anchor kind — never by the rendered/rounded pixel `x`.
 *     Two annotations at different technical dates stay two distinct lines
 *     even when a compressed scale rounds both to the same pixel; they may
 *     then overlap on screen, which is acceptable (no artificial displacement
 *     is introduced to keep them apart). Annotations that DO share one
 *     identity merge into ONE striped line: one 2 px stripe per annotation, at
 *     most three stripes, in input order — the fourth and later annotations
 *     keep their chips but add no stripe;
 *   - the lane is as tall as the rows it needs; there is no row cap.
 *
 * TRANSIENT DRAG PREVIEW (SVAR-M5)
 *
 * While a bar is being dragged, the consumer's marker for that bar has to
 * travel WITH the bar instead of waiting on its old date until the gesture
 * commits. Two independent inputs carry that, and they are deliberately not
 * the same thing:
 *
 *   - `dragPreview = { id, dx }` — the live pixel displacement of the dragged
 *     bar, reported by `Bars.jsx`. An annotation that names that bar in its
 *     own `followsTaskId` is drawn `dx` px from where its `date` puts it,
 *     which is exactly where the bar itself now stands. PIXELS ONLY: no date
 *     is derived from it here, and `date` itself is never rewritten;
 *   - `previewDate` — an OPTIONAL second date on the annotation, supplied by
 *     the consumer, meaning "the date this annotation will have once the
 *     gesture commits". It is used for ONE thing: deciding which annotations
 *     share a composite line (below). It never moves a pixel.
 *
 * That split is what keeps D-108 true during a gesture as well as after it:
 * grouping stays a question about DATES, answered by the one owner that knows
 * what a date means, while this module keeps answering only the question about
 * pixels. A group that contains the dragged annotation is drawn at the dragged
 * annotation's own (displaced) x, so the composite line stays centred on the
 * diamond the user is holding rather than jumping to the destination day ahead
 * of the drop.
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
 * `dragPreview` is the optional `{ id, dx }` of the bar currently under the
 * pointer. Whether an annotation is in or out of range, and where its column
 * is, are decided from its own `date` alone; `dx` is added afterwards, so a
 * gesture can neither drop a line out of the layout nor change which column
 * it belongs to.
 *
 * @returns an array in INPUT ORDER of `{ id, x, anchor, dateTime, dragged,
 *   label, title, labelPosition, css }`.
 */
export function placeAnnotations(annotations, scales, cellWidth, dragPreview) {
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
  const draggedId =
    dragPreview && dragPreview.id != null ? String(dragPreview.id) : null;
  const draggedDx =
    draggedId !== null && Number.isFinite(dragPreview.dx) ? dragPreview.dx : 0;
  const placed = [];
  for (const annotation of annotations) {
    const date = annotation && annotation.date;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
    if (date < start || date > end) continue;
    // The bar rule, verbatim: the column's left edge for this date.
    const unitStart = Math.round(diff(date, start, lengthUnit) * cellWidth);
    const anchor =
      annotation.anchor === 'unit-center' ? 'unit-center' : 'unit-start';
    const baseX =
      anchor === 'unit-center' ? unitStart + lengthUnitWidth / 2 : unitStart;
    if (!Number.isFinite(baseX) || baseX < 0 || baseX > width) continue;
    // SVAR-M5: the live pixel displacement of the bar this annotation follows,
    // and nothing else. `date` above already decided the column; this only
    // slides the drawn line and chip onto the bar the user is holding.
    const dragged =
      draggedId !== null &&
      annotation.followsTaskId != null &&
      String(annotation.followsTaskId) === draggedId;
    const x = dragged ? baseX + draggedDx : baseX;
    const label = annotation.label == null ? '' : String(annotation.label);
    const title =
      annotation.title == null || annotation.title === ''
        ? label
        : String(annotation.title);
    // The composite-line grouping identity (D-108): the exact technical
    // instant BEFORE pixel projection/rounding, not the rounded `x` above.
    // Two different canonical dates never collapse into one group merely
    // because a compressed scale rounds them to the same pixel. During a
    // gesture the consumer's `previewDate` — the date this annotation will
    // have when the gesture commits — takes its place, so the composite line
    // it belongs to is right while the pointer is still moving (SVAR-M5).
    const identity =
      annotation.previewDate instanceof Date &&
      !Number.isNaN(annotation.previewDate.getTime())
        ? annotation.previewDate.getTime()
        : date.getTime();
    placed.push({
      id: annotation.id,
      x,
      anchor,
      dateTime: identity,
      dragged,
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
 * @param placed        the result of `placeAnnotations` (already carrying any
 *                      transient drag displacement in its `x`)
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
    // D-108: group by semantic identity (technical date + anchor kind), NOT
    // by the rendered/rounded `x`. Different canonical dates that happen to
    // round to the same pixel at a compressed scale must stay distinct lines.
    const key = `${item.anchor}@${item.dateTime}`;
    let group = groups.get(key);
    if (group === undefined) {
      group = { key, x: item.x, members: [], dragged: item.dragged === true };
      groups.set(key, group);
      lines.push(group);
    } else if (item.dragged === true && group.dragged !== true) {
      // SVAR-M5: at most one bar is dragged at a time, so a group holds at
      // most one displaced member — and when it does, the whole composite
      // line follows it, staying centred on the diamond under the pointer.
      group.x = item.x;
      group.dragged = true;
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
      dragged: group.dragged === true,
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
      dragged: item.dragged === true,
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
