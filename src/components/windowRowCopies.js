/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M58).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The copies a virtual row window hands to its rows, kept across a pure
 * window shift.
 *
 * ## Why this exists
 *
 * `chart/Bars.jsx` and `grid/Grid.jsx` give every row of the visible window
 * a shallow copy of its store object (`{ ...task }`), and upstream made those
 * copies again for EVERY row on every change of the window. The store's
 * objects are not a usable change signal on their own: `@svar-ui/gantt-store`
 * recomputes a task's `$x`/`$y`/`$w`/`$h` IN PLACE (`updateTask`), and a
 * `drag-task` step mutates them in place and re-publishes the SAME `_tasks`
 * array. A fresh copy is how a row learns about either.
 *
 * But a vertical Pan, a wheel step or a reveal moves the window by one row
 * every row height of travel, and then nineteen of the twenty visible rows
 * are the very same rows, unchanged: re-copying them gave each a new object,
 * so every bar template, every grid row and every cell rendered again — two
 * commits of ~200 and ~160 components for one row entering and one leaving,
 * measured in the consuming application
 * (`docs/evidence/clean-pan-plan-microstutter-r1/` there).
 *
 * ## The rule
 *
 * A row gets back the copy it had in the previous window ONLY when both hold:
 *
 * 1. the caller's `version` is the one the previous copies were made under —
 *    the caller passes the store's own change signal for its rows (Bars: the
 *    `_tasks` publication counter, which moves on every publication including
 *    the in-place `drag-task` ones; Grid: the `_tasks` array itself, plus its
 *    own dragged row). Any change of the rows themselves therefore copies
 *    every row afresh, exactly as upstream;
 * 2. that copy is still a shallow snapshot of its source: same keys, every
 *    value identical. A source mutated in place without a new version is
 *    copied afresh as well.
 *
 * So a copy is reused only across a change of the WINDOW, and only for a row
 * whose content provably did not change. Rows that enter the window, and the
 * second occurrence of an object listed twice, always get a fresh copy.
 *
 * The state is one closure per component instance (a `useRef`), holding the
 * copies of the last window only: bounded by the window, gone with the
 * component. It is not a cache of the store and owns no task data — it never
 * answers anything the store did not just hand it.
 */

/**
 * @template T
 * @param {T} source
 * @param {T} copy
 * @returns {boolean}
 */
export function isShallowSnapshotOf(source, copy) {
  const sourceKeys = Object.keys(source);
  if (sourceKeys.length !== Object.keys(copy).length) return false;
  for (let i = 0; i < sourceKeys.length; i++) {
    const key = sourceKeys[i];
    if (!Object.prototype.hasOwnProperty.call(copy, key)) return false;
    if (!Object.is(source[key], copy[key])) return false;
  }
  return true;
}

/**
 * Creates one window's copier.
 *
 * The returned function takes the rows of the current window, in order, and
 * the caller's version of them, and returns one shallow copy per row.
 *
 * @returns {<T extends object>(rows: readonly T[], version: unknown) => T[]}
 */
export function createWindowRowCopies() {
  let lastVersion;
  let hasVersion = false;
  /** @type {Map<object, object>} source object -> its copy, previous window only */
  let previous = new Map();

  return function windowRowCopies(rows, version) {
    const sameVersion = hasVersion && Object.is(version, lastVersion);
    const next = new Map();
    const out = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const source = rows[i];
      if (next.has(source)) {
        // The same object twice in one window: its own copy, as upstream.
        out[i] = { ...source };
        continue;
      }
      const kept = sameVersion ? previous.get(source) : undefined;
      const copy =
        kept !== undefined && isShallowSnapshotOf(source, kept)
          ? kept
          : { ...source };
      next.set(source, copy);
      out[i] = copy;
    }
    lastVersion = version;
    hasVersion = true;
    previous = next;
    return out;
  };
}
