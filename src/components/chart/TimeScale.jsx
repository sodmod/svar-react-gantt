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
  const { api, scaleCellAriaLabel, annotationLayout } = props;

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
    () => splitScaleHeaderForLane(scales, laneHeight),
    [scales, laneHeight],
  );

  // SVAR-M8: the header half of every annotation's vertical line — the band
  // the LOWER scale rows occupy, between the lane's bottom edge and the chart
  // body. `TimelineLines` is the very component the chart body renders (one
  // owner of what a line looks like); this only says which band to fill.
  // It paints above the rows' own cell backgrounds and BELOW their text,
  // which the stylesheet lifts — see TimeScale.css.
  const lowerRowLinesStyle = useMemo(
    () => ({
      top: `${headerSplit.heightAboveLane + headerSplit.laneHeight}px`,
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
