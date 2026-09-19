import { useLayoutEffect, useRef, useState } from 'react';
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
  /*
   * SVAR-M43 (R3-3): the delta currently BAKED INTO what the element
   * renders at, mirrored where the layout effect can read it without
   * listing `delta` among the caller-supplied `deps`. This effect is the
   * only writer of `delta`, so the two never diverge.
   */
  const appliedRef = useRef({ dx: 0, dy: 0 });

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
    /*
     * SVAR-M43 (R3-3, Pavel manual acceptance remediation): the correction
     * is computed from where the element would be with NO correction at
     * all, not from where it currently renders.
     *
     * `rect` is the element as it is rendered RIGHT NOW, which is
     * `basePosition + delta` — the previous correction is already inside
     * the measurement. `clampDelta` answers "how far must THIS rect move",
     * so measuring `rect` directly and storing the answer as the new delta
     * threw away exactly the old delta's worth of correction on every
     * render where `basePosition` changed and this effect re-ran: that is,
     * on every pan.
     *
     * MEASURED, real Chromium at 1440x900 with the chart's own right edge
     * at 1440: panning in equal 90px steps walked the chip's left edge
     * around 1250 / 1262 / 1272 / 1276 / 1250 ... instead of holding still,
     * and let its right edge reach 1442 and 1444 — past the very edge this
     * pass exists to keep it inside of. Both are the same arithmetic error,
     * a delta applied to the wrong origin, and both are what Pavel sees as
     * a chip that shifts and clips with small pans.
     *
     * Subtracting the applied delta first makes the answer ABSOLUTE, and
     * exact in one pass: the rect translates one-for-one with the delta, so
     * the uncorrected rect is `rect - applied` and the correction that rect
     * needs is the whole correction, freshly. It also lets the delta shrink
     * back to zero on its own — the arithmetically equivalent "add the
     * residual" form would keep an old shift forever once the overlay moved
     * somewhere that needs none, since a rect already inside the viewport
     * reports a residual of zero either way.
     */
    const applied = appliedRef.current;
    const next = clampDelta(
      {
        left: rect.left - applied.dx,
        top: rect.top - applied.dy,
        right: rect.right - applied.dx,
        bottom: rect.bottom - applied.dy,
      },
      { left: v.left, top: v.top, right: v.right, bottom: v.bottom },
      8,
      SCROLLBAR_GUTTER_PX,
    );
    appliedRef.current = next;
    setDelta((current) =>
      current.dx === next.dx && current.dy === next.dy ? current : next,
    );
  }, deps);

  return {
    left: basePosition.left + delta.dx,
    top: basePosition.top + delta.dy,
  };
}
