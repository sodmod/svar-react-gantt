/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M10).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * A summary bar that CANNOT COLLAPSE while one of its descendants is dragged.
 *
 * ## The upstream behaviour this repairs, measured rather than assumed
 *
 * While a bar is dragged, `@svar-ui/gantt-store` keeps every ANCESTOR summary
 * on screen in step with it: on each `drag-task` it re-derives that summary's
 * transient `$x`/`$w` from the extents of its own descendants. A milestone
 * contributes its DATE to those extents, not its diamond — the store trims
 * half the diamond off each side, which is right, because a milestone is a
 * point in time and its diamond is only how that point is drawn.
 *
 * The consequence is exact, and it is a defect: a summary whose descendants
 * are ONE milestone (or several milestones sharing one date) has a single
 * point for an extent, so `xMax - xMin` is ZERO and the store writes `$w = 0`.
 * The bar keeps its DOM element and loses all of its width — on screen the
 * group simply vanishes for as long as the pointer is held, and comes back
 * only when the drop re-projects the data. Measured on the pinned build with
 * a real mouse: dragging the single milestone of such a group takes its
 * container's inline style from `width: 34px` to `width: 0px` on the first
 * accepted step, and every ancestor above it goes the same way.
 *
 * Nothing about that is the consumer's to fix: the span it supplies is a real
 * one, and the store overwrites it transiently. `@svar-ui/gantt-store` is not
 * forked (project decision D-102 §B), so the repair belongs where the bar is
 * actually DRAWN — here, in the renderer, as presentation and nothing else.
 *
 * ## The rule
 *
 * When a summary's live transient width is not a positive number, it is drawn
 * at the geometry it had before the gesture that collapsed it, TRANSLATED by
 * that gesture's own pixel displacement — the very displacement the store
 * applies to the bar under the pointer. The group therefore travels with the
 * drag, keeps its size, and keeps the position it holds relative to its
 * content: a group ending on its milestone still ends on it, at every step.
 *
 * Only that case is touched. A summary whose descendants still span a real
 * interval keeps the store's own live extent — an ordinary container really
 * does reshape while one of its children moves, and that behaviour is
 * accepted and unchanged.
 *
 * ## What this module does NOT do
 *
 * It writes nothing to the store, mutates no task, converts no pixel into a
 * date, and knows no calendar. It reads two numbers that already exist and
 * returns two numbers to put in a `style`. The dragged bar itself is never
 * its subject; nor is any bar outside the dragged bar's own ancestor chain,
 * because no other bar's transient geometry is re-derived at all.
 */

/**
 * The pre-gesture bar geometry of every ancestor of `task`.
 *
 * `getTask` is the caller's task accessor (`IApi.getTask`); the walk is up the
 * plain `parent` chain and stops at the root, so it costs the tree's depth and
 * reads nothing else. Only ancestors that HAVE a positive width are recorded:
 * a bar with no width to preserve has nothing this module could restore.
 *
 * @returns `Map<id, { x, w }>`, empty when the task has no ancestors.
 */
export function collectAncestorBarGeometry(getTask, task) {
  const geometry = new Map();
  if (!task) return geometry;
  let parentId = task.parent;
  const seen = new Set();
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const ancestor = getTask(parentId);
    if (!ancestor) break;
    if (Number.isFinite(ancestor.$x) && ancestor.$w > 0) {
      geometry.set(ancestor.id, { x: ancestor.$x, w: ancestor.$w });
    }
    parentId = ancestor.parent;
  }
  return geometry;
}

/**
 * Where a bar whose live transient width collapsed should be drawn instead,
 * or `null` — the answer for every other bar, at every other moment.
 *
 * @param task      the bar being drawn, with the store's live `$x`/`$w`
 * @param geometry  the `collectAncestorBarGeometry` map of the gesture in
 *                  flight, or the last one taken; `null`/absent means there is
 *                  nothing to restore and this function answers `null`
 * @param dx        the pixel displacement of that gesture right now. `0` once
 *                  the pointer is up, which is what puts a bar back exactly
 *                  where it started after a gesture that committed nothing
 */
export function resolveCollapsedSummaryGeometry(task, geometry, dx) {
  if (!geometry || !task) return null;
  if (task.$w > 0) return null;
  const before = geometry.get(task.id);
  if (before === undefined) return null;
  return { x: before.x + (Number.isFinite(dx) ? dx : 0), w: before.w };
}
