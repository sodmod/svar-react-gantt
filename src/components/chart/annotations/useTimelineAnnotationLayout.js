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
 * geometry (`_scales`), `cellWidth`, a measured width, or the live drag
 * preview (SVAR-M5). Scroll position is not an input, so a pan re-renders
 * nothing here and reads no layout.
 *
 * `dragPreview` DOES change once per pointer step of a bar drag, and that is
 * the point: the marker of the dragged bar has to travel with it. What that
 * costs is arithmetic over the annotations alone — the chip MEASUREMENTS
 * (`AnnotationMeasurer`, the only DOM reads in this feature) are keyed by
 * LABEL, and a drag changes no label, so a gesture adds exactly zero layout
 * reads however far the pointer travels.
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

export function useTimelineAnnotationLayout(
  annotations,
  scales,
  cellWidth,
  dragPreview,
) {
  const [labelWidths, setLabelWidths] = useState(EMPTY_WIDTHS);

  const layout = useMemo(() => {
    if (!annotations || !annotations.length) return EMPTY_ANNOTATION_LAYOUT;
    const placed = placeAnnotations(
      annotations,
      scales,
      cellWidth,
      dragPreview,
    );
    return layoutTimelineAnnotations(
      placed,
      labelWidths,
      scales ? scales.width : 0,
    );
  }, [annotations, scales, cellWidth, labelWidths, dragPreview]);

  // Keeps the previous Map when nothing changed, so an unchanged measurement
  // does not re-run the layout above.
  const onMeasured = useCallback((next) => {
    setLabelWidths((previous) =>
      sameWidths(previous, next) ? previous : next,
    );
  }, []);

  return { layout, onMeasured };
}
