/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M4).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The annotation lane: a band rendered inside `.wx-scale`, directly under the
 * scale rows, that carries one chip per annotation (its label) and, behind the
 * chips, the lane segment of each annotation's vertical line. Because it lives
 * inside the sticky `.wx-scale` element it stays fixed with the header under
 * vertical scroll and scrolls with the timeline under horizontal scroll, with
 * no code of its own for either.
 *
 * Rows, sides and lane height come from `timelineAnnotationLayout.js`; this
 * component renders what it is handed and decides nothing.
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
  const { layout } = props;
  if (!layout || !layout.laneHeight) return null;
  const { lines, chips, rowCount, laneHeight } = layout;

  return (
    <div
      className="wx-annotation-lane"
      role="list"
      data-annotation-rows={rowCount}
      style={{ height: `${laneHeight}px` }}
    >
      {lines.map((line) => (
        <div
          key={line.key}
          className="wx-annotation-lane-line"
          data-timeline-line={line.key}
          data-annotation-ids={line.ids.join(' ')}
          data-annotation-count={line.ids.length}
          aria-hidden="true"
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
