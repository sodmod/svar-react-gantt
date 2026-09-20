/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M47).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The offscreen link partner chip, derived — every time, from nothing but the
 * CURRENT routed links and the CURRENT usable viewport (D-166 §M,
 * TECH_SPEC.md §6.10.1, Phase 4.1C R4).
 *
 * R4 is the round in which the chip's own model was found wrong on the
 * product-scale stand, four ways at once ("Чипса оторвана от связи.jpg",
 * "Чипсы набор без связи.jpg", "Только одна.jpg", "Чипса без связи.jpg"):
 *
 *   1. a chip existed whenever the LOCAL row was in the vertical band and the
 *      partner was horizontally past an edge — with no requirement that any
 *      part of the route be on screen. MEASURED on the product fixture: with
 *      the chart at scroll 0 and both `Detail foliage` and `Season one
 *      content plan` past the RIGHT edge, a chip naming the latter sat at the
 *      bottom-right corner while the route itself was not drawn at all;
 *      scrolled to April, seven such chips lined the left edge with no line
 *      anywhere near them;
 *   2. chips were keyed `(localRow, direction)`, so three links out of
 *      `Store page copy` to three offscreen partners produced ONE chip, and
 *      the two hidden ones had no representation at all;
 *   3. the anchor was "the Y of the horizontal segment crossing the edge", and
 *      when the only visible part of a route was its VERTICAL (partner far to
 *      the right AND far below, the horizontal to it off the bottom of the
 *      chart) the chip fell back to the local row and was then clamped into
 *      the corner — a chip several hundred pixels from its own line;
 *   4. the vertical bounds used were the RENDER window (`area`), one buffer
 *      row taller than the visible band, so a chip could sit in that hidden
 *      row and be clipped by the chart's own top edge (measured: a chip at
 *      y = -10..12 with the chart's box starting at 0).
 *
 * The model here is the one R4 §10 states: a chip is the continuation of ONE
 * presentation link past the point where that link's route LEAVES the usable
 * viewport on its way to a partner that is horizontally outside it. Nothing is
 * remembered between renders; a chip that cannot be attached to a visible run
 * of its own route is simply not produced.
 *
 * Pure geometry: canvas-space rectangles and polylines in, chip descriptors
 * out. Nothing here reads a date, a calendar, `mode`, or `DomainState`, and
 * the routes themselves are the router's — they arrive already built by
 * `route.js` and are never re-derived here (R4 §17: routing formulas have one
 * owner).
 */

export const CHIP_SIZE = Object.freeze({ width: 168, height: 22 });
/** How far a chip's own edge sits in from the viewport edge it hugs. */
export const CHIP_EDGE_INSET = 6;
/** Vertical clearance between a chip and the horizontal run it hangs above. */
export const CHIP_GAP = 7;
/** Space between two chips that had to be stacked on one anchor. */
export const CHIP_STACK_GAP = 2;

const EPSILON = 0.5;

function inside(p, rect) {
  return (
    p[0] >= rect.left - EPSILON &&
    p[0] <= rect.right + EPSILON &&
    p[1] >= rect.top - EPSILON &&
    p[1] <= rect.bottom + EPSILON
  );
}

/*
 * Liang–Barsky: the part of segment `a -> b` inside `rect`, as the parameter
 * interval `[t0, t1]` of the segment, or `null` when none of it is inside.
 */
function clipSegment(a, b, rect) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-dx, a[0] - rect.left],
    [dx, rect.right - a[0]],
    [-dy, a[1] - rect.top],
    [dy, rect.bottom - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < -EPSILON) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [t0, t1];
}

function lerp(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/*
 * Which edge of `rect` the point `p` lies on. `along` is the direction the
 * route is travelling as it leaves, and decides a corner: a route leaving
 * horizontally through a corner leaves through the side, one leaving
 * vertically leaves through the top or bottom.
 */
function edgeOf(p, rect, along) {
  const onLeft = Math.abs(p[0] - rect.left) <= EPSILON;
  const onRight = Math.abs(p[0] - rect.right) <= EPSILON;
  const onTop = Math.abs(p[1] - rect.top) <= EPSILON;
  const onBottom = Math.abs(p[1] - rect.bottom) <= EPSILON;
  const horizontal = Math.abs(along[0]) >= Math.abs(along[1]);
  if (horizontal) {
    if (onLeft && along[0] < 0) return 'left';
    if (onRight && along[0] > 0) return 'right';
  } else {
    if (onTop && along[1] < 0) return 'top';
    if (onBottom && along[1] > 0) return 'bottom';
  }
  if (onLeft) return 'left';
  if (onRight) return 'right';
  if (onTop) return 'top';
  if (onBottom) return 'bottom';
  return null;
}

/**
 * Where the polyline `points` (walked in order, i.e. from the LOCAL end
 * towards the partner) last leaves `rect` on its way out. `null` when no part
 * of the polyline is inside `rect` at all, or when it never leaves it again
 * after its last visible run (the far end is itself inside).
 *
 * "Last" run, not first: a route whose local end is off one side, that
 * crosses the whole viewport and leaves through the other side towards its
 * partner, has exactly one visible run and its exit is the far side. A route
 * that dips in and out more than once still attaches its chip to the run
 * nearest the partner, because that is the run the chip continues.
 *
 * @returns {{ point: [number, number], edge: 'left'|'right'|'top'|'bottom', segmentIndex: number } | null}
 */
export function routeExitPoint(points, rect) {
  let exit = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const span = clipSegment(a, b, rect);
    if (span === null) continue;
    const [, t1] = span;
    const leaves = !inside(b, rect);
    if (!leaves) {
      // The run continues in the next segment (or ends inside); whatever
      // exit was recorded before belongs to an earlier run and is superseded
      // only if a later segment leaves again.
      exit = null;
      continue;
    }
    const point = lerp(a, b, t1);
    const along = [b[0] - a[0], b[1] - a[1]];
    const edge = edgeOf(point, rect, along);
    if (edge === null) continue;
    // Snap the crossing coordinate onto the edge it was found on, so a
    // consumer comparing it to the viewport bound reads an exact value
    // rather than the parameterization's last floating-point bit.
    if (edge === 'left') point[0] = rect.left;
    else if (edge === 'right') point[0] = rect.right;
    else if (edge === 'top') point[1] = rect.top;
    else point[1] = rect.bottom;
    exit = { point, edge, segmentIndex: i };
  }
  return exit;
}

/**
 * The chip descriptors for one settled frame.
 *
 * @param {Array<{ link: { id: unknown, source: unknown, target: unknown }, route: { points: Array<[number, number]> } }>} routedLinks
 *   the SAME routed links `Links.jsx` draws (`useRoutedLinks`), never a
 *   second routing pass
 * @param {Map<unknown, { id: unknown, text?: string, $x: number, $y: number, $w: number, $h: number }>} taskById
 *   the store's own full `_tasks`, by id
 * @param {{ left: number, top: number, right: number, bottom: number }} viewport
 *   the USABLE viewport in canvas pixels: `[scrollLeft, scrollLeft +
 *   _chartWidth] x [scrollTop, scrollTop + _chartHeight]` — never `xArea` or
 *   `area`, which are render windows padded past the visible band
 * @returns {Array<ChipDescriptor>} one per (link, offscreen partner) that has
 *   a visible run to attach to; both ends of one link may qualify at once
 *   when the route crosses the viewport between two offscreen endpoints
 */
export function deriveOffscreenChips(routedLinks, taskById, viewport) {
  // SVAR-M47: one pass over the routed links, both ends of each considered.
  const chips = [];
  for (const { link, route } of routedLinks) {
    if (!route || !Array.isArray(route.points) || route.points.length < 2) {
      continue;
    }
    const source = taskById.get(link.source);
    const target = taskById.get(link.target);
    if (!source || !target) continue;
    consider(chips, link, route.points, source, target, viewport, false);
    consider(chips, link, route.points, target, source, viewport, true);
  }
  return chips;
}

function consider(out, link, points, local, partner, viewport, reversed) {
  if (typeof partner.$x !== 'number' || typeof partner.$w !== 'number') return;
  const offLeft = partner.$x + partner.$w < viewport.left;
  const offRight = partner.$x > viewport.right;
  if (!offLeft && !offRight) return;
  const walk = reversed ? [...points].reverse() : points;
  const exit = routeExitPoint(walk, viewport);
  if (exit === null) return;
  const direction = offLeft ? 'left' : 'right';
  out.push({
    key: `${String(link.id)}:${String(partner.id)}`,
    linkId: link.id,
    localId: local.id,
    partnerId: partner.id,
    partnerName: partner.text,
    direction,
    exitEdge: exit.edge,
    anchor: exit.point,
  });
}

function intersects(a, b) {
  return (
    a.left < b.right - EPSILON &&
    b.left < a.right - EPSILON &&
    a.top < b.bottom - EPSILON &&
    b.top < a.bottom - EPSILON
  );
}

/**
 * Where each chip is drawn: a `{ left, top }` per descriptor, in the same
 * canvas pixels the anchors are in.
 *
 * A chip leaving through a SIDE hangs just above the run it continues, its
 * outer end hugging that side (the accepted R1-5 shape). A chip leaving
 * through the TOP or BOTTOM sits centred on the vertical it continues, just
 * inside that edge, so the line runs straight into it (R4-3). Every chip is
 * then kept inside the viewport by `clampDelta`, exactly as before.
 *
 * Two chips that would overlap — two links sharing one final run, or a
 * fan-out whose verticals are a `channelStep` apart — are stacked away from
 * the edge they hug, in a deterministic order (anchor position, then link
 * id), so each stays readable and each stays on its own route's column or
 * row; nothing is merged or dropped (R4 §5: no consolidation).
 *
 * @param {Array<ChipDescriptor>} chips
 * @param {{ left: number, top: number, right: number, bottom: number }} viewport
 * @param {{ clampDelta: Function, rightGutter?: number, margin?: number }} deps
 */
export function layoutChips(chips, viewport, deps) {
  const { clampDelta } = deps;
  const margin = deps.margin ?? 8;
  const rightGutter = deps.rightGutter ?? 0;
  const { width, height } = CHIP_SIZE;

  const ordered = [...chips].sort((a, b) => {
    if (a.exitEdge !== b.exitEdge) return a.exitEdge < b.exitEdge ? -1 : 1;
    const ka =
      a.exitEdge === 'top' || a.exitEdge === 'bottom'
        ? a.anchor[0]
        : a.anchor[1];
    const kb =
      b.exitEdge === 'top' || b.exitEdge === 'bottom'
        ? b.anchor[0]
        : b.anchor[1];
    if (ka !== kb) return ka - kb;
    const ia = String(a.linkId);
    const ib = String(b.linkId);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  });

  const placed = [];
  const positions = new Map();
  for (const chip of ordered) {
    const [ax, ay] = chip.anchor;
    let left;
    let top;
    let stackDir;
    switch (chip.exitEdge) {
      case 'left':
        left = viewport.left + CHIP_EDGE_INSET;
        top = ay - CHIP_GAP - height;
        stackDir = -1;
        break;
      case 'right':
        left = viewport.right - CHIP_EDGE_INSET - width;
        top = ay - CHIP_GAP - height;
        stackDir = -1;
        break;
      case 'top':
        left = ax - width / 2;
        top = viewport.top + CHIP_EDGE_INSET;
        stackDir = 1;
        break;
      case 'bottom':
      default:
        left = ax - width / 2;
        top = viewport.bottom - CHIP_EDGE_INSET - height;
        stackDir = -1;
        break;
    }
    // A side chip with no room above its run flips below it (R1-5).
    if (
      (chip.exitEdge === 'left' || chip.exitEdge === 'right') &&
      top < viewport.top + margin
    ) {
      top = ay + CHIP_GAP;
      stackDir = 1;
    }

    let rect = clampRect(
      left,
      top,
      width,
      height,
      viewport,
      margin,
      rightGutter,
      clampDelta,
    );
    for (let attempt = 0; attempt < chips.length; attempt++) {
      const hit = placed.find((other) => intersects(rect, other));
      if (!hit) break;
      const shifted = clampRect(
        rect.left,
        stackDir < 0
          ? hit.top - CHIP_STACK_GAP - height
          : hit.bottom + CHIP_STACK_GAP,
        width,
        height,
        viewport,
        margin,
        rightGutter,
        clampDelta,
      );
      if (shifted.top === rect.top && shifted.left === rect.left) break;
      rect = shifted;
    }
    placed.push(rect);
    positions.set(chip.key, { left: rect.left, top: rect.top });
  }
  return positions;
}

function clampRect(
  left,
  top,
  width,
  height,
  viewport,
  margin,
  rightGutter,
  clampDelta,
) {
  const rect = { left, top, right: left + width, bottom: top + height };
  const { dx, dy } = clampDelta(rect, viewport, margin, rightGutter);
  return {
    left: left + dx,
    top: top + dy,
    right: left + dx + width,
    bottom: top + dy + height,
  };
}

/**
 * @typedef {{
 *   key: string,
 *   linkId: unknown,
 *   localId: unknown,
 *   partnerId: unknown,
 *   partnerName: string | undefined,
 *   direction: 'left' | 'right',
 *   exitEdge: 'left' | 'right' | 'top' | 'bottom',
 *   anchor: [number, number],
 * }} ChipDescriptor
 */
