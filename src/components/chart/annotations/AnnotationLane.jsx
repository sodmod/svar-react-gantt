/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M4).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The annotation lane: a band rendered inside `.wx-scale`, between the top
 * scale row and the lower ones (SVAR-M8), that carries one chip per
 * annotation (its label) and, behind the chips, the lane segment of each
 * annotation's vertical line. Because it lives inside the sticky `.wx-scale`
 * element it stays fixed with the header under vertical scroll and scrolls
 * with the timeline under horizontal scroll, with no code of its own for
 * either.
 *
 * Rows, sides, lane height and each line's lane-segment top (`laneTop`) come
 * from `timelineAnnotationLayout.js`; this component renders what it is
 * handed and decides nothing.
 *
 * SVAR-M8: the lane also carries the ordinary timeline column separators, so
 * a chip reads as belonging to a date column instead of floating in an
 * isolated band. `columns` is the LOWEST rendered scale row exactly as
 * `TimeScale.jsx` already sliced it for its own rows — the same cells, the
 * same widths, the same virtualisation offset. Whatever the active scale
 * exposes as a column (a day, a week, a month) is what continues through the
 * lane; this component derives no column and computes no date.
 *
 * Accessibility: the lane is a list; each chip is a list item whose accessible
 * name is the annotation's full title, so a screen reader hears the full name
 * even when the visible text is clipped with an ellipsis. The chips are
 * focusable for the same reason; the decorative lines carry no accessible
 * content of their own. The native `title` shows the full name on hover.
 */
import { memo } from 'react';
import {
  ANNOTATION_CHIP_HEIGHT,
  chipTopForRow,
} from './timelineAnnotationLayout.js';
import './AnnotationLane.css';

function AnnotationLane(props) {
  const { layout, columns } = props;
  if (!layout || !layout.laneHeight) return null;
  const { lines, chips, rowCount, laneHeight } = layout;
  const columnCells = columns && columns.slice ? columns.slice : null;

  return (
    <div
      className="wx-annotation-lane"
      role="list"
      data-annotation-rows={rowCount}
      style={{ height: `${laneHeight}px` }}
    >
      {/* SVAR-M8: FIRST, so every line and every chip paints over it. The
          same subdued `--wx-timescale-border` the scale rows draw their own
          cell separators with — one treatment, not a second grid style. */}
      {columnCells && columnCells.length ? (
        <div
          className="wx-annotation-lane-grid"
          data-annotation-lane-grid="true"
          aria-hidden="true"
          style={{ paddingLeft: `${columns.from}px` }}
        >
          {columnCells.map((cell, cellIdx) => (
            <div
              key={cellIdx}
              className="wx-annotation-lane-grid-cell"
              style={{ width: `${cell.width}px` }}
            />
          ))}
        </div>
      ) : null}
      {lines.map((line) => (
        <div
          key={line.key}
          className="wx-annotation-lane-line"
          data-timeline-line={line.key}
          data-annotation-ids={line.ids.join(' ')}
          data-annotation-count={line.ids.length}
          data-annotation-dragged={line.dragged ? 'true' : 'false'}
          aria-hidden="true"
          style={{
            left: `${line.x - line.width / 2}px`,
            width: `${line.width}px`,
            // Every ordinary line still spans the lane's full height via the
            // stylesheet's `top: 0`. A bottom-anchored (Today) line overrides
            // it: its lane segment starts at its own chip's bottom edge, not
            // the lane's top — no line drawn above or behind that chip.
            ...(line.bottomAnchored ? { top: `${line.laneTop}px` } : null),
          }}
        >
          {line.stripes.map((stripe) => (
            <div
              key={stripe.id}
              className={'wx-timeline-line-stripe ' + stripe.css}
              data-annotation-id={stripe.id}
            />
          ))}
        </div>
      ))}
      {chips.map((chip) => (
        <div
          key={chip.id}
          role="listitem"
          tabIndex={0}
          className={'wx-annotation-chip ' + chip.css}
          title={chip.title}
          aria-label={chip.title}
          data-annotation-id={chip.id}
          data-annotation-row={chip.row}
          data-annotation-side={chip.side}
          data-annotation-dragged={chip.dragged ? 'true' : 'false'}
          data-annotation-clipped={chip.clipped ? 'true' : 'false'}
          style={{
            left: `${chip.x}px`,
            width: `${chip.width}px`,
            top: `${chipTopForRow(chip.row)}px`,
            height: `${ANNOTATION_CHIP_HEIGHT}px`,
          }}
        >
          <span className="wx-annotation-chip-text">{chip.label}</span>
        </div>
      ))}
    </div>
  );
}

export default memo(AnnotationLane);
