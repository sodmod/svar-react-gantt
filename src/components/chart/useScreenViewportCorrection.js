import { useLayoutEffect, useState } from 'react';
import {
  clampDelta,
  SCROLLBAR_GUTTER_PX,
} from '../../planner-router/overlayViewport.js';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M38).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * R1-5/R1-6 (Pavel manual acceptance remediation), the part `overlayViewport
 * .js`'s pure geometry cannot own: `xArea`/the vertical `area` fields are the
 * store's own VIRTUALIZATION window, measured wider than the chart's real
 * visible viewport is (the pre-render buffer smooth scrolling needs) — a
 * chip or popover clamped only against those canvas-space bounds can still
 * overflow the real `.wx-chart` element's own edges. Measured directly:
 * the offscreen chip in "Подсказка за границей.jpg" clamped fine against
 * `xArea` and still crossed the true screen edge by exactly that buffer.
 *
 * This hook is the second, real-screen-pixel pass: it renders at whatever
 * `basePosition` the caller already computed (canvas-space, correct on
 * every axis THAT bound can vouch for), then measures the element's own
 * `getBoundingClientRect()` against the nearest `.wx-chart` ancestor's —
 * both real, both already correct for the current scroll position — and
 * corrects only the remainder. `{dx: 0, dy: 0}` on every render that needs
 * no correction, so this never fights the canvas-space placement; it only
 * catches what that placement could not see.
 */
export function useScreenViewportCorrection(ref, basePosition, deps) {
  const [delta, setDelta] = useState({ dx: 0, dy: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const viewportEl = el.closest('.wx-chart');
    if (!viewportEl) return;
    const rect = el.getBoundingClientRect();
    const v = viewportEl.getBoundingClientRect();
    /*
     * R2-4 (Pavel manual acceptance remediation): this second pass measures
     * `.wx-chart`'s own real screen rect, which is correct for every axis
     * it can see — but a vertical scrollbar belonging to an ANCESTOR that
     * scrolls the chart (the grid+chart pane the chart itself is inside)
     * never appears in `.wx-chart`'s own box model, classic or overlay
     * alike (`overlayViewport.js`'s own note on `SCROLLBAR_GUTTER_PX`).
     * Without this, a real re-measurement here would pull a chip the
     * canvas-space pass already kept clear of that scrollbar back toward
     * the true edge, undoing the one gutter neither pass can measure away.
     */
    const next = clampDelta(
      { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      { left: v.left, top: v.top, right: v.right, bottom: v.bottom },
      8,
      SCROLLBAR_GUTTER_PX,
    );
    setDelta((current) =>
      current.dx === next.dx && current.dy === next.dy ? current : next,
    );
  }, deps);

  return {
    left: basePosition.left + delta.dx,
    top: basePosition.top + delta.dy,
  };
}
