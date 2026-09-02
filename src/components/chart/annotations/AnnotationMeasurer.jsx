/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M4).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Measures the natural width of one chip per DISTINCT label, in a hidden
 * zero-height container that carries the same `.wx-annotation-chip` styling
 * the lane's chips get, and reports the widths through `onMeasured`.
 *
 * Measurement happens in a layout effect — before paint — and only when the
 * set of labels changes or the document's fonts finish loading. It never runs
 * per scroll frame, per task row or per pointer move: N distinct labels cost N
 * layout reads once, and zero thereafter.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import './AnnotationLane.css';

const LABEL_ATTRIBUTE = 'data-annotation-label';

function distinctLabels(annotations) {
  const labels = [];
  const seen = new Set();
  for (const annotation of annotations || []) {
    const label =
      !annotation || annotation.label == null ? '' : String(annotation.label);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function AnnotationMeasurer(props) {
  const { annotations, onMeasured } = props;
  const nodeRef = useRef(null);
  const labels = useMemo(() => distinctLabels(annotations), [annotations]);
  const labelsKey = labels.join('\n');
  const [fontsVersion, setFontsVersion] = useState(0);

  // Web fonts may finish loading after the first paint and change every
  // width; re-measure exactly once when they do.
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const fonts = document.fonts;
    if (!fonts || !fonts.ready || typeof fonts.ready.then !== 'function') {
      return undefined;
    }
    let alive = true;
    fonts.ready.then(() => {
      if (alive) setFontsVersion((version) => version + 1);
    });
    return () => {
      alive = false;
    };
  }, []);

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) {
      if (labels.length === 0) onMeasured(new Map());
      return;
    }
    const widths = new Map();
    for (const child of node.children) {
      widths.set(
        child.getAttribute(LABEL_ATTRIBUTE),
        child.getBoundingClientRect().width,
      );
    }
    onMeasured(widths);
  }, [labelsKey, fontsVersion, onMeasured]);

  if (labels.length === 0) return null;

  return (
    <div className="wx-annotation-measure" aria-hidden="true" ref={nodeRef}>
      {labels.map((label) => (
        <span
          key={label}
          className="wx-annotation-chip"
          {...{ [LABEL_ATTRIBUTE]: label }}
        >
          <span className="wx-annotation-chip-text">{label}</span>
        </span>
      ))}
    </div>
  );
}

export default AnnotationMeasurer;
