/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M37).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Collapsed-group link aggregation, presentation-only (project DECISIONS.md
 * D-166 §K/§L, TECH_SPEC.md §6.10.1, Phase 4.1C checkpoint C3).
 *
 * The whole feature turns on one fact about the store this renderer already
 * sits on: a task hidden by a collapsed ancestor is not IN `_tasks` with
 * stale geometry — it is simply ABSENT from it (SVAR-M10's own ancestor-bar
 * geometry already had to work around exactly this, using `getTask` for the
 * full tree rather than the visibility-filtered `_tasks` array). A task
 * absent from the tree the store currently holds at ALL (which is what a
 * consumer's own filter does, by handing the store a smaller `tasks` array
 * to begin with — D-161) resolves to no representative below, and the link
 * is silently skipped: nothing here distinguishes "hidden by a collapsed
 * ancestor" from "hidden by a filter" by name, because it does not need to
 * — a filter-hidden task's tree entry is gone, `getTask` returns nothing for
 * it, and the walk below stops with no representative, which is exactly the
 * E-2 firebreak (D-166 §N) asks for: filter-hidden endpoints never enter
 * aggregation, without a second code path that has to remember to exclude
 * them.
 *
 * Nothing here reads a date, a calendar, `mode`'s own vocabulary beyond
 * treating it as an opaque grouping key, or `DomainState`.
 */

/*
 * Walks from `taskId` up through `parent` (root's own parent is `0`, per the
 * store's own convention) until it finds an id present in `visibleIds` — the
 * task's own row if it is already visible, otherwise the nearest ancestor
 * that is. Returns `null` when the id has no tree entry at all (filtered out
 * entirely, or genuinely unknown) or the walk reaches the root without ever
 * finding a visible id (defensive; the root is expected to always be
 * visible in practice).
 *
 * `getTask(id)` reads the FULL tree, unfiltered by disclosure — the same
 * primitive SVAR-M10's own ancestor-bar geometry already uses for the same
 * reason: `_tasks` alone cannot resolve the walk's own starting point when
 * that point is itself hidden.
 */
export function findVisibleRepresentative(taskId, getTask, visibleIds) {
  let current = getTask(taskId);
  const seen = new Set();
  while (current) {
    if (visibleIds.has(current.id)) return current.id;
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    const parentId = current.parent;
    if (parentId === undefined || parentId === null || parentId === 0) {
      return null;
    }
    current = getTask(parentId);
  }
  return null;
}

/*
 * Groups links whose resolved endpoints are not both the link's own real
 * endpoints into aggregates, one per (representative source, representative
 * target, mode) — D-166 §K's "endpoint + direction + mode" key, where
 * direction is the ordered (source, target) pair itself: the store's own
 * links are already always forward (D-166 §A, FS only), so swapping the
 * pair is a genuinely different direction, never the same aggregate.
 *
 * A link whose BOTH endpoints already resolve to themselves is a real,
 * fully visible link — D-166 §G already gives it its own channel and this
 * aggregation must never re-draw it a second time, so it is excluded here,
 * not merely left un-badged.
 */
export function buildAggregates(links, getTask, visibleIds) {
  const groups = new Map();
  for (const link of links) {
    const repSource = findVisibleRepresentative(
      link.source,
      getTask,
      visibleIds,
    );
    const repTarget = findVisibleRepresentative(
      link.target,
      getTask,
      visibleIds,
    );
    if (repSource === null || repTarget === null) continue;
    if (repSource === link.source && repTarget === link.target) continue;

    const mode = link.mode ?? 'soft';
    const key = `${repSource}\u0000${repTarget}\u0000${mode}`;
    let group = groups.get(key);
    if (!group) {
      group = { repSource, repTarget, mode, members: [] };
      groups.set(key, group);
    }
    group.members.push(link);
  }

  return Array.from(groups.values()).map((group) => ({
    id: `aggregate:${group.repSource}:${group.repTarget}:${group.mode}`,
    source: group.repSource,
    target: group.repTarget,
    mode: group.mode,
    count: group.members.length,
    memberLinkIds: group.members.map((link) => link.id),
  }));
}

/*
 * Clips a polyline to the vertical strip `[xFrom, xTo]` (D-166 §L's
 * viewport-aware badge anchor), returning every contiguous run of points
 * that falls inside it, each run's own points already interpolated at the
 * strip's edges so no returned point sits outside `[xFrom, xTo]`.
 */
function clipPolylineToXRange(points, xFrom, xTo) {
  const runs = [];
  let current = [];
  const inside = (x) => x >= xFrom && x <= xTo;
  const clampPoint = (a, b) => {
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    if (dx === 0) return null;
    const targets = [xFrom, xTo].filter(
      (x) => (x - ax) * (x - bx) <= 0 && x !== ax,
    );
    return targets.map((x) => {
      const t = (x - ax) / dx;
      return [x, ay + (by - ay) * t];
    });
  };

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const pointInside = inside(point[0]);
    if (i > 0) {
      const prev = points[i - 1];
      const crossings = clampPoint(prev, point) || [];
      for (const crossing of crossings) current.push(crossing);
    }
    if (pointInside) {
      current.push(point);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs.filter((run) => run.length >= 1);
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  }
  return total;
}

function pointAtFraction(points, fraction) {
  const total = polylineLength(points);
  if (total === 0) return points[0];
  const target = total * fraction;
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
    if (travelled + segLen >= target) {
      const t = segLen === 0 ? 0 : (target - travelled) / segLen;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    }
    travelled += segLen;
  }
  return points[points.length - 1];
}

/*
 * The reveal gesture's own geometry (D-166 §K: "клик по строке раскрывает
 * минимальную цепочку свёрнутых предков"): every ancestor of `taskId`,
 * walking up from its immediate parent, that is not ALREADY open — stopping
 * the moment one is, since everything above an already-open ancestor is,
 * by definition, not what is hiding `taskId`. Returns ids in TOP-DOWN order
 * (furthest ancestor first) so a caller opening them in this order gets the
 * same cascade a person expanding one row at a time would produce; the
 * store's own `open-task` handler does not actually require this order (it
 * reads the full tree by id, not the current visible slice), but nothing
 * is lost by giving it anyway.
 */
export function collapsedAncestorsToOpen(taskId, getTask) {
  const toOpen = [];
  let current = getTask(taskId);
  const seen = new Set();
  while (current) {
    const parentId = current.parent;
    if (parentId === undefined || parentId === null || parentId === 0) break;
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = getTask(parentId);
    if (!parent) break;
    if (parent.open === true) break;
    toOpen.push(parent.id);
    current = parent;
  }
  return toOpen.reverse();
}

/*
 * D-166 §L: a single rule that produces every one of the spec's named
 * cases without branching on which one applies. The longest run of the
 * route's own polyline that survives clipping to the current horizontal
 * viewport is the "safe visible segment" the spec asks for in every case —
 * a route with both ends on screen clips to (almost) its own full length,
 * so the midpoint IS the midpoint; a route with only one end on screen
 * clips to the run near that end; a route crossing the viewport with both
 * ends off screen clips to the crossing segment; a route that never enters
 * the viewport clips to nothing, and `null` is the contract for "no badge"
 * (D-166's own Blocker: no floating badge without a visible route
 * segment).
 */
export function pickBadgeAnchor(points, xArea) {
  if (!xArea || points.length < 2) return null;
  const runs = clipPolylineToXRange(points, xArea.from, xArea.to);
  if (!runs.length) return null;
  const longest = runs.reduce((best, run) =>
    polylineLength(run) > polylineLength(best) ? run : best,
  );
  return pointAtFraction(longest, 0.5);
}
