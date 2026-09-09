import { useMemo } from 'react';
import { useStore } from '@svar-ui/lib-react';
import AnnotationLane from './annotations/AnnotationLane.jsx';
import TimelineLines from './annotations/TimelineLines.jsx';
import { splitScaleHeaderForLane } from './annotations/timelineAnnotationLayout.js';
import './TimeScale.css';

// Upper-row cells span multiple lowest-row cells. Walk widths so a span
// whose left edge has scrolled off is still rendered while its body is visible.
function mapRow(row, xFrom, xEnd) {
  const cells = row.cells;
  let from = 0;
  let start = cells.length;
  let acc = 0;
  for (let i = 0; i < cells.length; i++) {
    if (acc + cells[i].width > xFrom) {
      start = i;
      from = acc;
      break;
    }
    acc += cells[i].width;
  }
  let end = start;
  while (end < cells.length && acc < xEnd) {
    acc += cells[end].width;
    end++;
  }
  return { from, slice: cells.slice(start, end) };
}

function TimeScale(props) {
  // SVAR-M3 (SVAR Production Planner): `scaleCellAriaLabel`, a plain React
  // prop (not store state, unlike `highlightTime` below) — see `Gantt.jsx`
  // for what it is and why. `undefined` by default: nothing below changes
  // for a consumer that never passes it.
  // SVAR-M4 (SVAR Production Planner): `annotationLayout` — the lane rendered
  // inside this sticky element, so it stays fixed with the header and scrolls
  // with the timeline for free. Absent, or with no rows to show, nothing is
  // rendered and the header is what it always was.
  // SVAR-M12 (SVAR Production Planner): `reserveTopScaleRow` — the same value
  // `Grid.jsx` is handed, so this header and the grid's blank reservation stay
  // one arrangement. With no lane it changes nothing visible here: the rows
  // keep their order and heights, and `AnnotationLane` renders nothing.
  // SVAR-M17 (SVAR Production Planner): `gridActionSlotMinHeight` — the same
  // resolved number `Grid.jsx` is handed. It can add ONE blank band to this
  // header, between the top scale row and the lane, and it changes nothing
  // else: no row moves inside the header, no row changes height, and the lane
  // is laid out exactly as it was.
  const {
    api,
    scaleCellAriaLabel,
    annotationLayout,
    reserveTopScaleRow,
    gridActionSlotMinHeight,
  } = props;

  const scales = useStore(api, '_scales');
  const xArea = useStore(api, 'xArea');
  const highlightTime = useStore(api, 'highlightTime');

  const renderedRows = useMemo(() => {
    const rows = scales.rows;
    const lastIndex = rows.length - 1;

    return rows.map((row, ri) => {
      if (ri === lastIndex) {
        return {
          height: row.height,
          from: xArea.from,
          slice: row.cells.slice(xArea.start, xArea.end),
        };
      }
      return {
        height: row.height,
        ...mapRow(row, xArea.from, xArea.to),
      };
    });
  }, [scales, xArea]);

  /*
   * SVAR-M8 (SVAR Production Planner): where the lane sits, and what it
   * leaves below itself.
   *
   * The ONE owner of that rule is `splitScaleHeaderForLane` — the same pure
   * function `Grid.jsx` asks, so the grid's blank reservation and this
   * header's own composition can never disagree. Nothing here counts rows,
   * measures a chip or knows what a scale row means.
   */
  const laneHeight = annotationLayout ? annotationLayout.laneHeight : 0;
  const headerSplit = useMemo(
    () =>
      splitScaleHeaderForLane(
        scales,
        laneHeight,
        reserveTopScaleRow,
        gridActionSlotMinHeight,
      ),
    [scales, laneHeight, reserveTopScaleRow, gridActionSlotMinHeight],
  );
  /**
   * SVAR-M17: the blank reserve band, in px. Zero — and therefore no element
   * at all — whenever the header's own rows and the lane already give the
   * consumer's slot the room it asked for, which is what keeps the ordinary
   * marker states pixel-identical to what they were.
   */
  const slotReserveHeight = headerSplit.slotReserveExtraHeight;

  // SVAR-M8: the header half of every annotation's vertical line — the band
  // the LOWER scale rows occupy, between the lane's bottom edge and the chart
  // body. `TimelineLines` is the very component the chart body renders (one
  // owner of what a line looks like); this only says which band to fill.
  // It paints above the rows' own cell backgrounds and BELOW their text,
  // which the stylesheet lifts — see TimeScale.css.
  const lowerRowLinesStyle = useMemo(
    () => ({
      // SVAR-M17: + the reserve band, because it sits between the top row and
      // the lane, so the lower rows begin that much further down.
      top: `${headerSplit.heightAboveLane + headerSplit.slotReserveExtraHeight + headerSplit.laneHeight}px`,
      height: `${headerSplit.heightBelowLane}px`,
    }),
    [headerSplit],
  );

  // SVAR-M9: and only the lines that reach the header at all. A consumer can
  // ask for one drawn in the chart body ALONE (`lineExtent: 'body'`), and
  // such a line has no segment anywhere in this header — not across these
  // rows, and not in the lane above them (`AnnotationLane.jsx`).
  const lowerRowLines = useMemo(
    () =>
      annotationLayout
        ? annotationLayout.lines.filter((line) => !line.bodyOnly)
        : [],
    [annotationLayout],
  );

  const renderRow = (r, rowIdx) => (
    <div
      className="wx-ZkvhDKir wx-row"
      style={{ height: `${r.height}px`, paddingLeft: `${r.from}px` }}
      key={rowIdx}
    >
      {r.slice.map((cell, cellIdx) => {
        const extraClass = highlightTime
          ? highlightTime(cell.date, cell.unit)
          : '';
        const className =
          'wx-cell ' + (cell.css || '') + ' ' + (extraClass || '');
        // SVAR-M3 (SVAR Production Planner): the only line this change
        // adds inside the cell itself. `scaleCellAriaLabel` is called
        // with exactly the two values `highlightTime` above already
        // reads off the same `cell` — this component never inspects,
        // stores or interprets the string it gets back, it only forwards
        // it to the DOM. `undefined`/`''` leaves `aria-label` off, same
        // as today.
        const ariaLabel = scaleCellAriaLabel
          ? scaleCellAriaLabel(cell.date, cell.unit, cell.value)
          : undefined;
        return (
          <div
            className={'wx-ZkvhDKir ' + className}
            style={{ width: `${cell.width}px` }}
            aria-label={ariaLabel || undefined}
            key={cellIdx}
          >
            <span
              className={
                'wx-ZkvhDKir' + (cell.width > 100 ? ' wx-cell-value' : '')
              }
            >
              {cell.value}
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="wx-ZkvhDKir wx-scale" style={{ width: scales.width }}>
      {/* SVAR-M8 (SVAR Production Planner): FIRST child on purpose. It is
          absolutely positioned, so it paints where its inline style says;
          being first keeps the LAST `.wx-row` the stylesheet's `:last-child`
          and therefore keeps the row borders exactly as they were. */}
      {headerSplit.laneSplitsHeader && lowerRowLines.length ? (
        <TimelineLines
          lines={lowerRowLines}
          layerClassName="wx-scale-row-lines"
          lineClassName="wx-scale-row-line"
          style={lowerRowLinesStyle}
        />
      ) : null}

      {renderedRows
        .slice(0, headerSplit.rowsAboveLane)
        .map((r, i) => renderRow(r, i))}

      {/* SVAR-M17 (SVAR Production Planner): the blank reserve band.

          It exists only when the consumer's own slot declared a minimum the
          header could not meet on its own, and then it is EXACTLY the
          shortfall — the one number the split owner reports, the very number
          `Grid.jsx` adds to its header offset, so the two panes stay on one
          line by construction rather than by two agreeing calculations.

          Deliberately none of the things it could be mistaken for: not a
          marker row, not a lane (the lane below is laid out from the same
          `annotationLayout` it always was, and renders nothing when there is
          nothing in it), not extra height on any scale row, and not an
          overlay. It is in flow, so `.wx-scale` grows by exactly this much and
          the chart body below it moves down by the same amount. It is not a
          `.wx-row`, so the stylesheet's `:last-child` row-border rule sees the
          same last row it saw before. */}
      {slotReserveHeight > 0 ? (
        <div
          className="wx-ZkvhDKir wx-scale-slot-reserve"
          data-scale-slot-reserve="true"
          aria-hidden="true"
          style={{ height: `${slotReserveHeight}px` }}
        />
      ) : null}

      {/* SVAR-M4 (SVAR Production Planner): the annotation lane. SVAR-M8
          moved it from under the last scale row to under the FIRST one, so
          the rows that carry the dates stay next to the chart body. It is
          handed the lowest rendered scale row purely so the ordinary column
          separators continue through it — the lane invents no column of its
          own and does no date arithmetic of any kind. */}
      <AnnotationLane
        layout={annotationLayout}
        columns={renderedRows[renderedRows.length - 1]}
      />

      {renderedRows
        .slice(headerSplit.rowsAboveLane)
        .map((r, i) => renderRow(r, headerSplit.rowsAboveLane + i))}
    </div>
  );
}

export default TimeScale;
