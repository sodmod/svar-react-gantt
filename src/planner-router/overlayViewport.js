/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M38).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The one presentation-level "keep this overlay inside the viewport" rule
 * (R1-5/R1-6, Pavel manual acceptance remediation), shared by the offscreen
 * partner chip and the collapsed-group aggregate popover rather than
 * duplicated between them. Pure geometry: this file reads no task, no
 * link, no `DomainState` and dispatches nothing — it only maps rectangles
 * in screen pixels to a position, and a caller applies it as its own
 * `left`/`top`.
 */

/**
 * R2-4 (Pavel manual acceptance remediation): the width this module always
 * holds clear along `viewport`'s own RIGHT edge, on top of the ordinary
 * `margin` — a real vertical scrollbar for whatever ancestor scrolls the
 * chart ("Все еще обрезает чипсину.jpg"). A CLASSIC scrollbar reserves its
 * own layout space no element's `getBoundingClientRect()` includes (the
 * element simply measures narrower, invisibly to a naive read of its own
 * rect); an OVERLAY one reserves none at all but still PAINTS on top of
 * whatever is underneath it, which no DOM geometry API exposes either — a
 * scrollbar that renders without ever appearing in any element's box model
 * cannot be measured away by reading rects more carefully, only planned
 * around. `useScreenViewportCorrection.js` still does the real-screen
 * correction pass this module always needed (R1-6); this is the one
 * additional fact neither that pass nor a wider `margin` on every edge can
 * recover, because it is not a measurement gap, it is a measurement blind
 * spot — so it is a constant, not a reading.
 */
export const SCROLLBAR_GUTTER_PX = 16;

/**
 * How far `rect` would need to move, in screen pixels, to sit fully inside
 * `viewport` with at least `margin` clearance on every side it would
 * otherwise cross, and at least `margin + rightGutter` clear of the
 * viewport's own right edge specifically (R2-4: `rightGutter` is where a
 * vertical scrollbar the viewport's own geometry cannot see may still
 * paint). `0` on any axis `rect` already clears.
 *
 * @param {{left:number, top:number, right:number, bottom:number}} rect
 * @param {{left:number, top:number, right:number, bottom:number}} viewport
 * @param {number} margin
 * @param {number} rightGutter
 * @returns {{dx:number, dy:number}}
 */
export function clampDelta(rect, viewport, margin = 8, rightGutter = 0) {
  let dx = 0;
  if (rect.right > viewport.right - margin - rightGutter) {
    dx = viewport.right - margin - rightGutter - rect.right;
  }
  if (rect.left + dx < viewport.left + margin) {
    dx = viewport.left + margin - rect.left;
  }

  let dy = 0;
  if (rect.bottom > viewport.bottom - margin) {
    dy = viewport.bottom - margin - rect.bottom;
  }
  if (rect.top + dy < viewport.top + margin) {
    dy = viewport.top + margin - rect.top;
  }

  return { dx, dy };
}

/**
 * R1-5's own shape: a chip that hangs ABOVE the route segment it names by
 * default (`anchor` is a point ON that segment), flipping BELOW only when
 * there is genuinely no room above the chart viewport, and clamped
 * horizontally so its own right/left edge never crosses the viewport's —
 * the defect Pavel's "Подсказка за границей.jpg" screenshot named directly.
 *
 * @param {{x:number, y:number}} anchor a point on the visible route segment
 * @param {{width:number, height:number}} size the chip's own measured size
 * @param {{left:number, top:number, right:number, bottom:number}} viewport
 * @param {{gap?: number, margin?: number}} [opts]
 */
export function clampChipRect(anchor, size, viewport, opts = {}) {
  const gap = opts.gap ?? 7;
  const margin = opts.margin ?? 8;
  const rightGutter = opts.rightGutter ?? SCROLLBAR_GUTTER_PX;

  const above = anchor.y - gap - size.height;
  const fitsAbove = above >= viewport.top + margin;
  const top = fitsAbove ? above : anchor.y + gap;

  // Anchored to the SAME point horizontally on either side; only the
  // horizontal clamp below may still move it off that centring.
  const left = anchor.x - size.width / 2;
  const rect = { left, top, right: left + size.width, bottom: top + size.height };
  const { dx } = clampDelta(rect, viewport, margin, rightGutter);
  return { left: left + dx, top };
}

/**
 * R1-6's own shape: a popover anchored just BELOW a fixed point (the badge
 * or chip it opened from), preferring to hang down and to the right, but
 * flipping to hang UP and/or to the LEFT whenever its measured size would
 * not otherwise fit inside `viewport` — independently on each axis, so a
 * popover near the bottom-right corner can flip both at once.
 *
 * @param {{x:number, y:number}} anchor the point the popover opens FROM
 * @param {{width:number, height:number}} size
 * @param {{left:number, top:number, right:number, bottom:number}} viewport
 * @param {{gap?: number, margin?: number}} [opts]
 */
export function clampPopoverRect(anchor, size, viewport, opts = {}) {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;
  const rightGutter = opts.rightGutter ?? SCROLLBAR_GUTTER_PX;

  const fitsBelow = anchor.y + gap + size.height <= viewport.bottom - margin;
  const top = fitsBelow ? anchor.y + gap : anchor.y - gap - size.height;

  const fitsRight = anchor.x + size.width <= viewport.right - margin - rightGutter;
  const left = fitsRight ? anchor.x : anchor.x - size.width;

  const rect = {
    left,
    top,
    right: left + size.width,
    bottom: top + size.height,
  };
  const { dx, dy } = clampDelta(rect, viewport, margin, rightGutter);
  return { left: left + dx, top: top + dy };
}
