/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M60).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The chart's vertical travel: the largest `scrollTop` at which the last row
 * is still drawn where its bar is, in BOTH halves of the split surface.
 *
 * ## Why this exists
 *
 * `@svar-ui/gantt-store` clamps a `scroll-chart { top }` to
 *
 *     _scales.height + _tasks.length * cellHeight - _chartHeight
 *
 * but `_chartHeight` is the height of the rows band ALONE: `Layout.jsx`
 * publishes it as the surface height LESS the header block (`resize-chart`,
 * `height: gh - sh`). The header is therefore counted twice, and the store
 * accepts a position up to one header height past the last row.
 *
 * Nothing in the DOM can show such a position, and the two halves disagree
 * about what to do with it. The camera path (`./cameraPath.js`) writes the
 * accepted position into both:
 *
 * ```text
 * .wx-chart          a native scroll offset: the browser clamps it to what the
 *                    content allows
 * the grid body      a plain `top` (`gridBodyTop`): nothing clamps it
 * ```
 *
 * so the list moves on and the timeline stops, and every row of the list
 * stands that many pixels off its bar. Measured in the Planner (Phase 6 CP-7
 * F1): 11 px after the Plan's vertical reveal asked for its safe inset below
 * the last row, 36 px after the renderer's own scroll-into-view of a row
 * selection — the first click of a double click, which moved the row out from
 * under the second click.
 *
 * The native scrollers never produce such a position: the outer
 * pseudo-scroller's own travel is exactly the value below (`Layout.jsx`
 * `scrollHeight` is the header block + the rows + `scrollSize`, its client
 * height is the surface height). Only a PROGRAMMATIC request could, and every
 * one of them goes through `scroll-chart`; this is the one range all of them
 * are now held to.
 *
 * ## The range
 *
 * ```text
 * rows       _tasks.length * cellHeight     the rows the layout draws
 * band       _chartHeight                   the rows band on screen
 * scrollSize _scrollSize                    the room upstream reserves under
 *                                           the band for a horizontal
 *                                           scrollbar (0 when none is drawn)
 * travel     max(0, rows - band + scrollSize)
 * ```
 *
 * It decides no business meaning, reads no date and changes nothing in
 * `@svar-ui/gantt-store` (D-102 §B): `Gantt.jsx` normalizes the request before
 * the store sees it, exactly as SVAR-M31 normalizes a `date`, and the store
 * keeps its own clamp, which this one is always inside of.
 */

/**
 * The largest `scrollTop` the chart can show, or `null` while the layout has
 * not published the rows band yet (upstream behaviour applies until then).
 */
export function chartVerticalTravel(state) {
  const band = state ? state._chartHeight : undefined;
  const rows = state ? state._tasks : undefined;
  const cellHeight = state ? state.cellHeight : undefined;
  if (!Number.isFinite(band) || !rows || !Number.isFinite(cellHeight)) {
    return null;
  }
  const scrollSize = Number.isFinite(state._scrollSize) ? state._scrollSize : 0;
  return Math.max(0, rows.length * cellHeight - band + scrollSize);
}

/**
 * A requested `top`, held to the chart's vertical travel. A request without a
 * numeric `top`, or a state that cannot answer yet, is returned unchanged.
 */
export function clampChartTop(state, top) {
  if (typeof top !== 'number' || Number.isNaN(top)) return top;
  const travel = chartVerticalTravel(state);
  if (travel === null) return top;
  return Math.max(0, Math.min(top, travel));
}
