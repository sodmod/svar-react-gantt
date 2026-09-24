/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M55).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Gesture companions: the OTHER bars a bar gesture carries with it.
 *
 * ## What the renderer knows, and what it does not
 *
 * A consumer may say, once per gesture, "when this bar moves, these bars move
 * with it" (`barGestureCompanions`, Gantt.jsx). The renderer asks at the
 * moment the gesture ACTIVATES — the first accepted pointer step, before
 * anything is drawn moved — and never again for that gesture. From then on it
 * translates every companion by the SAME pixel `dx` the grabbed bar's moving
 * edge travels: the whole bar for a move, the left edge for a `start` resize,
 * the right edge for an `end` resize.
 *
 * It is told ids and nothing else. It does not know why those bars travel,
 * what a date is, what a working day is, or whether the consumer will accept
 * the drop: pixels here, meaning there — the same split SVAR-M5 made for the
 * annotation markers.
 *
 * ## Why through `drag-task`, the grabbed bar's own action
 *
 * A companion is moved with exactly the transient action the grabbed bar is:
 * `drag-task` with `inProgress: true`, which writes the bar's `$x`/`$w` into
 * the store and nothing else. So every consumer of the store's geometry — the
 * routed links, the offscreen chips, the collapsed aggregates, an ancestor
 * summary's live span — follows a companion by the same path it follows the
 * grabbed bar, and no second geometry model exists for "a bar that is being
 * carried". The store is not changed (D-102 §B): this is a public action it
 * already has.
 *
 * ## The end of a gesture
 *
 * ```text
 * no whole-unit change   every companion goes back to its base, exactly as
 *                        the grabbed bar does
 * a committing drop      companions are left where the gesture put them; the
 *                        consumer that asked for them owns the drop and
 *                        re-seeds the chart from its own state (the same
 *                        contract the grabbed bar's `update-task` has)
 * a cancelled gesture    every companion AND the grabbed bar go back to base
 * ```
 *
 * These three functions are the pure half of that, unit-tested by
 * `tools/planner-bar-gesture-companions.test.mjs`.
 */

/**
 * The pre-gesture geometry of each companion, read ONCE, when the gesture
 * activates.
 *
 * Drops the grabbed bar itself, duplicates, ids the store does not know, and
 * bars with no drawn geometry (a task not on screen has nothing to carry).
 * Order is the order the consumer gave, first occurrence wins.
 */
export function collectCompanionBases(ids, grabbedId, getTask) {
  const bases = new Map();
  if (!ids || typeof ids[Symbol.iterator] !== 'function') return bases;
  for (const id of ids) {
    if (id === grabbedId || bases.has(id)) continue;
    const task = getTask(id);
    if (!task) continue;
    const { $x: l, $w: w } = task;
    if (!Number.isFinite(l) || !Number.isFinite(w)) continue;
    bases.set(id, { l, w });
  }
  return bases;
}

/** One pointer step: every companion translated by the same `dx`. */
export function companionStep(bases, dx) {
  const steps = [];
  if (!bases) return steps;
  for (const [id, { l, w }] of bases) {
    steps.push({ id, left: l + dx, width: w });
  }
  return steps;
}

/** Back to where each companion was before the gesture. */
export function companionReset(bases) {
  return companionStep(bases, 0);
}
