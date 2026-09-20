/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M47, SVAR-M48).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The offscreen ENDPOINT chip, derived — every time, from nothing but the
 * CURRENT presentation routes and the CURRENT usable viewport (D-166 §M,
 * TECH_SPEC.md §6.10.1, Phase 4.1C R4 and R5).
 *
 * R4 (SVAR-M47) made the chip a function of the ROUTE rather than of the
 * row: a chip exists only where a drawn route leaves the usable viewport on
 * its way to a partner that is not on it. R5 (SVAR-M48) corrects what "not on
 * it" meant and what a route is:
 *
 *   1. R4 classified a partner as offscreen HORIZONTALLY only (its bar
 *      entirely left or right of the viewport). MEASURED on the product
 *      stand: `Concept sketches` (12..30 Jan) with the chart at 28 Jan..8 Feb
 *      and its row scrolled above the band overlaps the viewport's x-range,
 *      so R4 called it "inside" and gave its end no chip, while the LONGER
 *      `Concept refinement -> Press kit assembly` route, whose source bar
 *      lies entirely left of the same window, got both chips. Pavel read
 *      that as "depends on the route's length" ("Две связи но одна чипса",
 *      "Пример обе чипсы"); the actual discriminator was whether the bar's
 *      x-range happened to overlap the window while its ROW was off it.
 *      Now an endpoint is offscreen when its rectangle does not intersect
 *      the usable viewport at all, in any of the four directions, and every
 *      endpoint of every visible route is decided on its own (R5 §3.1, §5).
 *   2. Only canonical links were routes. A collapsed group's aggregate
 *      route (SVAR-M37) is drawn by the same router and can leave the
 *      viewport exactly the same way, but had no chip at all (R5-4,
 *      "group collapsed, external task offscreen => chip is missing").
 *      Now a route is either kind; an aggregate's endpoints are its two
 *      PRESENTATION endpoints — the visible representative of the collapsed
 *      side and the real task (or other representative) of the other side —
 *      never a hidden child (R5 §3.4).
 *
 * The model, stated once (R5 §3.1): for each route with a meaningful visible
 * run, each endpoint that is off the usable viewport gets exactly one chip,
 * anchored where that route leaves the viewport towards that endpoint. One
 * offscreen end: one chip. Both offscreen with a visible run: two chips.
 * Nothing visible: none. A target's chip never suppresses a source's, and
 * nothing is deduplicated by task, by direction or by label — two routes
 * that need a chip for the same task get two chips, and `layoutChips` stacks
 * them (R5 §3.2).
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
/**
 * SVAR-M48 (R5 §3.1): the least visible run of a route that counts as "a
 * meaningful segment of this route is visible". Below it a route is treated
 * as not on screen at all, so neither of its ends gets a chip: a one-pixel
 * sliver at an edge is not a line a person can follow to a chip. The
 * product's evidence suite states the same bound when it decides, from the
 * DOM, which endpoints EXPECT a chip.
 */
export const MIN_VISIBLE_RUN = 6;

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
 * How much of the polyline `points` lies inside `rect`, in pixels.
 *
 * SVAR-M48: the one definition of "a meaningful segment of this route is
 * visible" (R5 §3.1). Summed over every segment's clipped part, so a route
 * that dips in and out counts every visible piece, and a route whose only
 * visible part is a vertical counts that vertical exactly as it would a
 * horizontal (R5 §3.3).
 */
export function visibleRunLength(points, rect) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const span = clipSegment(a, b, rect);
    if (span === null) continue;
    const [t0, t1] = span;
    if (t1 <= t0) continue;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]) * (t1 - t0);
  }
  return total;
}

/**
 * Where the polyline `points` (walked in order, i.e. from the far end
 * towards the endpoint the chip is for) last leaves `rect` on its way out.
 * `null` when no part of the polyline is inside `rect` at all, or when it
 * never leaves it again after its last visible run (the walked-to end is
 * itself inside).
 *
 * "Last" run, not first: a route whose far end is off one side, that
 * crosses the whole viewport and leaves through the other side towards this
 * endpoint, has exactly one visible run and its exit is the far side. A
 * route that dips in and out more than once still attaches its chip to the
 * run nearest the endpoint, because that is the run the chip continues.
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
 * Where an endpoint's rectangle is, relative to the usable viewport.
 *
 * SVAR-M48 (R5-1, R5-2): the one definition of "offscreen" for a
 * presentation endpoint. An endpoint is VISIBLE as soon as any part of its
 * rectangle lies inside the viewport; otherwise it is off to one side, and
 * the horizontal sides are named first because a bar that is both past the
 * right edge and below the bottom one is, to the person, "further along the
 * timeline" before it is "further down the list". R4 named only the two
 * horizontal sides and called every other rectangle visible — which is the
 * whole of R5-1.
 *
 * @param {{ x: number, y: number, w: number, h: number }} rect
 * @param {{ left: number, top: number, right: number, bottom: number }} viewport
 * @returns {'visible' | 'left' | 'right' | 'top' | 'bottom'}
 */
export function classifyEndpoint(rect, viewport) {
  if (rect.x + rect.w < viewport.left - EPSILON) return 'left';
  if (rect.x > viewport.right + EPSILON) return 'right';
  if (rect.y + rect.h < viewport.top - EPSILON) return 'top';
  if (rect.y > viewport.bottom + EPSILON) return 'bottom';
  return 'visible';
}

/**
 * The chip descriptors for one settled frame.
 *
 * @param {Array<PresentationRoute>} routes
 *   every presentation route the chart is routing — canonical links from
 *   `useRoutedLinks` and collapsed-group aggregates from
 *   `useRoutedAggregates` — with the SAME polylines they are drawn from,
 *   never a second routing pass
 * @param {{ left: number, top: number, right: number, bottom: number }} viewport
 *   the USABLE viewport in canvas pixels: `[scrollLeft, scrollLeft +
 *   _chartWidth] x [scrollTop, scrollTop + _chartHeight - _scrollSize]` —
 *   never `xArea` or `area`, which are render windows padded past the
 *   visible band
 * @returns {Array<ChipDescriptor>} one per (route, offscreen endpoint) whose
 *   route has a visible run of at least `MIN_VISIBLE_RUN`; both endpoints of
 *   one route may qualify at once
 */
export function deriveEndpointChips(routes, viewport) {
  // SVAR-M47 / SVAR-M48: one pass over the presentation routes, BOTH ends
  // of each decided on their own.
  const chips = [];
  for (const route of routes) {
    const points = route.points;
    if (!Array.isArray(points) || points.length < 2) continue;
    if (!route.source?.rect || !route.target?.rect) continue;
    if (visibleRunLength(points, viewport) < MIN_VISIBLE_RUN) continue;
    considerEndpoint(chips, route, 'source', viewport);
    considerEndpoint(chips, route, 'target', viewport);
  }
  return chips;
}

function considerEndpoint(out, route, role, viewport) {
  const endpoint = role === 'source' ? route.source : route.target;
  const other = role === 'source' ? route.target : route.source;
  const direction = classifyEndpoint(endpoint.rect, viewport);
  if (direction === 'visible') return;
  // Walk the polyline TOWARDS this endpoint: the route's points run from
  // its source to its target, so the source's chip walks them reversed.
  const walk = role === 'target' ? route.points : [...route.points].reverse();
  const exit = routeExitPoint(walk, viewport);
  if (exit === null) return;
  out.push({
    key: `${String(route.routeId)}:${role}`,
    routeId: route.routeId,
    kind: route.kind,
    role,
    canonicalLinkIds: route.canonicalLinkIds,
    // `partnerId`/`localId`/`partnerName` keep the R4 vocabulary the
    // consumers and the product's own evidence read: the partner IS this
    // endpoint, the local end is the other one.
    partnerId: endpoint.id,
    localId: other.id,
    partnerName: endpoint.name,
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
 * Two chips that would overlap — two links sharing one final run, a fan-out
 * whose verticals are a `channelStep` apart, or two routes that both need a
 * chip for one task — are stacked away from the edge they hug, in a
 * deterministic order (edge, anchor position, then route id and role), so
 * each stays readable and each stays on its own route's column or row;
 * nothing is merged or dropped (R4 §5, R5 §3.2: no consolidation).
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
    const ia = String(a.key);
    const ib = String(b.key);
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
 *   id: unknown,
 *   rect: { x: number, y: number, w: number, h: number },
 *   name: string | undefined,
 * }} PresentationEndpoint
 *
 * @typedef {{
 *   routeId: unknown,
 *   kind: 'link' | 'aggregate',
 *   points: Array<[number, number]>,
 *   canonicalLinkIds: Array<unknown>,
 *   source: PresentationEndpoint,
 *   target: PresentationEndpoint,
 * }} PresentationRoute
 *
 * @typedef {{
 *   key: string,
 *   routeId: unknown,
 *   kind: 'link' | 'aggregate',
 *   role: 'source' | 'target',
 *   canonicalLinkIds: Array<unknown>,
 *   partnerId: unknown,
 *   localId: unknown,
 *   partnerName: string | undefined,
 *   direction: 'left' | 'right' | 'top' | 'bottom',
 *   exitEdge: 'left' | 'right' | 'top' | 'bottom',
 *   anchor: [number, number],
 * }} ChipDescriptor
 */
