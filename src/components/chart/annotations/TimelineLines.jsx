/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M4).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The chart-body half of a timeline annotation's vertical line: one
 * full-height element per line, striped with one 2 px stripe per annotation
 * sharing that line's SEMANTIC identity — the consumer-supplied technical date,
 * never the rounded pixel the date projects to — at most three stripes,
 * rendered inside `.wx-area` after the cell grid and before the bars so it
 * paints above the grid and below every bar.
 *
 * WHY IT LIVES INSIDE `.wx-area`
 *
 * `.wx-area` is the horizontally scrolled, full-height chart body: it starts
 * below the sticky scale header (and therefore below the annotation lane the
 * header now carries) and the browser moves it as one piece on either axis. A
 * child positioned inside it stays on its date under horizontal scroll and
 * stays below the header under vertical scroll with no listener, no
 * measurement and no per-frame work here at all. The layer takes no pointer
 * events, so every gesture underneath it (bar move/resize, link handles, the
 * consumer's own pan) reaches exactly the element it reached before.
 *
 * Where each line stands is decided by `timelineAnnotationLayout.js`; this
 * component only renders what it is handed.
 *
 * This is the project's OWN implementation of "a vertical line at a date". The
 * PRO edition's vertical-line feature is not used, not copied and not
 * referenced; its state stays reset by the unmodified Community store.
 */
import { memo } from 'react';
import './TimelineLines.css';

/*
 * SVAR-M8 (SVAR Production Planner): the SAME layer is now drawn twice — once
 * in the chart body, and once across the LOWER scale rows, which the marker
 * lane no longer sits under. Both are "one full-height striped line per
 * annotation at its own x", so they are one component; only the class names
 * and the band differ, and each caller names its own so a test (and a
 * stylesheet) can address exactly one of them. Defaults are the chart-body
 * names, so `<TimelineLines lines={...} />` renders precisely what it always
 * rendered.
 *
 * SVAR-M9 (SVAR Production Planner): which lines reach a given band is the
 * CALLER's question, not this component's — it draws the list it is handed.
 * The lane and the lower-rows band filter out the lines whose consumer asked
 * for the chart body alone (`lineExtent: 'body'`); the chart body draws every
 * line, as it always did.
 */
function TimelineLines(props) {
  const {
    lines,
    layerClassName = 'wx-timeline-lines',
    lineClassName = 'wx-timeline-line',
    style,
  } = props;
  if (!lines || !lines.length) return null;

  return (
    <div className={layerClassName} style={style} aria-hidden="true">
      {lines.map((line) => (
        <div
          key={line.key}
          className={lineClassName}
          data-timeline-line={line.key}
          data-annotation-ids={line.ids.join(' ')}
          data-annotation-count={line.ids.length}
          data-annotation-dragged={line.dragged ? 'true' : 'false'}
          style={{
            left: `${line.x - line.width / 2}px`,
            width: `${line.width}px`,
          }}
        >
          {line.stripes.map((stripe) => (
            <div
              key={stripe.id}
              className={'wx-timeline-line-stripe ' + stripe.css}
              data-annotation-id={stripe.id}
              /* SVAR-M9: one annotation, one stripe, the width THAT
                 annotation asked for — the layout owner already summed them
                 into the line's own width above. */
              style={{
                flexBasis: `${stripe.width}px`,
                width: `${stripe.width}px`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default memo(TimelineLines);
