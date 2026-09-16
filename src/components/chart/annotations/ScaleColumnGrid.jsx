/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M29).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The timeline's day-column separators, as a band can carry them.
 *
 * SVAR-M8 gave the annotation lane the ordinary column separators so a chip
 * reads as belonging to a date column instead of floating in an isolated band.
 * SVAR-M17 then added a second band to the same header — the blank reserve that
 * answers a consumer slot's declared minimum height — and that one had no
 * separators, so the columns visibly restarted below it: the date grid stopped
 * at the top scale row and began again at the lane.
 *
 * This is that markup, extracted unchanged, so both bands ask ONE owner for
 * "what the column separators of a band look like". Neither band derives a
 * column and neither computes a date: `columns` is the LOWEST rendered scale
 * row exactly as `TimeScale.jsx` already sliced it for its own rows — the same
 * cells, the same widths, the same virtualisation offset. Whatever the active
 * scale exposes as a column (a day, a week, a month) is what continues through
 * every band that renders this.
 *
 * The class names are the ones SVAR-M8 introduced, deliberately unchanged: it
 * is the same grid, and a second set of names for one treatment is exactly the
 * duplication this extraction removes.
 */
import { memo } from 'react';

function ScaleColumnGrid(props) {
  const { columns } = props;
  const cells = columns && columns.slice ? columns.slice : null;
  if (!cells || !cells.length) return null;

  return (
    <div
      className="wx-annotation-lane-grid"
      data-annotation-lane-grid="true"
      aria-hidden="true"
      style={{ paddingLeft: `${columns.from}px` }}
    >
      {cells.map((cell, cellIdx) => (
        <div
          key={cellIdx}
          className="wx-annotation-lane-grid-cell"
          style={{ width: `${cell.width}px` }}
        />
      ))}
    </div>
  );
}

export default memo(ScaleColumnGrid);
