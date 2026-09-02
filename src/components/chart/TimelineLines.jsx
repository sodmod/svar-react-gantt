/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M4, Phase 3.2A spike).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Full-height vertical lines on the chart body, one per date the consumer
 * asks for — the Planner's own Today line and its per-milestone line.
 *
 * WHAT THIS COMPONENT DECIDES, AND WHAT IT DOES NOT
 *
 * It decides exactly one presentation question: given a `Date`, where on the
 * already-laid-out timeline does that date's column sit. It answers with the
 * same expression the store already uses to place every bar's left edge
 * (`Math.round(diff(date, start, lengthUnit) * cellWidth)`), read from the
 * same `_scales`/`cellWidth` state the bars are placed from, so a line and a
 * bar that name the same date land on the same pixel — on the day scale and
 * on every wider scale, because the store's `diff` already expresses the
 * answer in cells of whatever the minimum unit currently is.
 *
 * It does NOT decide what a line MEANS. It has no notion of "today", no clock,
 * no working-day rule, no date business rule and no colour of its own worth
 * the name: the consumer supplies the date, an `anchor` ('unit-start' puts the
 * line on the column's left edge — the coordinate a diamond is centred on;
 * 'unit-center' puts it on the column's centre), and a `css` class its own
 * stylesheet colours. A date outside the rendered range simply gets no line.
 *
 * WHY IT LIVES INSIDE `.wx-area`
 *
 * `.wx-area` is the horizontally scrolled, full-height chart body: it starts
 * below the sticky scale header and the browser moves it as one piece on
 * either axis. A child positioned inside it therefore stays on its date under
 * horizontal scroll and stays below the header under vertical scroll with no
 * listener, no measurement and no per-frame work here at all. It is rendered
 * before `<Bars>` so bars paint above it, and it takes no pointer events, so
 * every gesture underneath it (bar move/resize, link handles, the Planner's
 * own pan) reaches exactly the element it reached before.
 *
 * This is the project's OWN implementation of the idea "a vertical line at a
 * date". The PRO edition's vertical-line feature is not used, not copied and
 * not referenced: that feature's state stays reset by the Community store,
 * and this component neither reads nor writes it.
 */
import { memo, useContext, useMemo } from 'react';
import { useStore } from '@svar-ui/lib-react';
import storeContext from '../../context';
import './TimelineLines.css';

const EMPTY = [];

function TimelineLines(props) {
  const { lines } = props;

  const api = useContext(storeContext);
  const scales = useStore(api, '_scales');
  const cellWidth = useStore(api, 'cellWidth');

  const placed = useMemo(() => {
    if (!lines || !lines.length || !scales || !scales.diff) return EMPTY;
    const { start, end, lengthUnit, lengthUnitWidth, diff, width } = scales;
    const result = [];
    for (const line of lines) {
      const date = line && line.date;
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) continue;
      // No column exists for a date outside the rendered range.
      if (date < start || date >= end) continue;
      // The bar rule, verbatim: the column's left edge for this date.
      const unitStart = Math.round(diff(date, start, lengthUnit) * cellWidth);
      const x =
        line.anchor === 'unit-center'
          ? unitStart + lengthUnitWidth / 2
          : unitStart;
      if (!Number.isFinite(x) || x < 0 || x > width) continue;
      result.push({ id: line.id, x, css: line.css || '' });
    }
    return result;
  }, [lines, scales, cellWidth]);

  if (!placed.length) return null;

  return (
    <div className="wx-timeline-lines" aria-hidden="true">
      {placed.map((line) => (
        <div
          key={line.id}
          className={'wx-timeline-line ' + line.css}
          style={{ left: `${line.x}px` }}
          data-timeline-line={line.id}
        />
      ))}
    </div>
  );
}

export default memo(TimelineLines);
