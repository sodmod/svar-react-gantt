/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M4).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The React half of the annotation layout owner: turns the consumer's
 * `timelineAnnotations` plus the store's current scale geometry plus the
 * measured chip widths into ONE memoised layout object that `Layout.jsx`,
 * `Chart.jsx`, `TimeScale.jsx` and the annotation components all read.
 *
 * Recomputes only when one of its inputs changes — the annotations, the scale
 * geometry (`_scales`), `cellWidth` or a measured width. Scroll position is not
 * an input, so a pan re-renders nothing here and reads no layout.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  EMPTY_ANNOTATION_LAYOUT,
  layoutTimelineAnnotations,
  placeAnnotations,
} from './timelineAnnotationLayout.js';

const EMPTY_WIDTHS = new Map();

function sameWidths(previous, next) {
  if (previous === next) return true;
  if (previous.size !== next.size) return false;
  for (const [label, width] of next) {
    if (previous.get(label) !== width) return false;
  }
  return true;
}

export function useTimelineAnnotationLayout(annotations, scales, cellWidth) {
  const [labelWidths, setLabelWidths] = useState(EMPTY_WIDTHS);

  const layout = useMemo(() => {
    if (!annotations || !annotations.length) return EMPTY_ANNOTATION_LAYOUT;
    const placed = placeAnnotations(annotations, scales, cellWidth);
    return layoutTimelineAnnotations(
      placed,
      labelWidths,
      scales ? scales.width : 0,
    );
  }, [annotations, scales, cellWidth, labelWidths]);

  // Keeps the previous Map when nothing changed, so an unchanged measurement
  // does not re-run the layout above.
  const onMeasured = useCallback((next) => {
    setLabelWidths((previous) =>
      sameWidths(previous, next) ? previous : next,
    );
  }, []);

  return { layout, onMeasured };
}
