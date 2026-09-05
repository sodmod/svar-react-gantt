import { locate, getID } from '@svar-ui/lib-dom';

/*
 * SVAR-M14 (R4, SVAR Production Planner): the dragged row's own edges are no
 * longer part of this.
 *
 * Upstream measured two offsets here — the pointer's distance to the dragged
 * row's top and bottom — and the hit test below compared THOSE against the
 * target's midline to decide "before" or "after". Phase 3.3's manual
 * acceptance chose a fully CURSOR-BASED model instead (D-117 §AC), so the
 * offsets have no remaining reader and are gone rather than left to rot. What
 * stays is the clone's placement, which is a presentation offset and always
 * was.
 */
function getOffset(node, relative) {
  const box = node.getBoundingClientRect();
  const base = relative.querySelector('.wx-body').getBoundingClientRect();

  return {
    top: box.top - base.top,
    left: box.left - base.left,
  };
}

function checkSource(node) {
  return node && getID(node, 'data-context-id');
}

const SHIFT = 5;

/*
 * SVAR-M13 (SVAR Production Planner): how much of a row, at each end, still
 * means "beside this row" rather than "into it".
 *
 * 0.3 leaves the middle 40% as the child band. Small enough that dropping
 * between two rows stays easy, large enough that hitting it is not a matter of
 * luck at the 48px row heights this renderer is used at.
 *
 * MEASURED in real Chromium on the consuming product (48px rows): the three
 * bands come out 0..14.4 / 14.4..33.6 / 33.6..48 px, which is comfortably
 * larger than the pointer precision a person actually has.
 */
const CHILD_BAND_EDGE = 0.3;

/*
 * SVAR-M14 (R4, SVAR Production Planner): the boundary magnet.
 *
 * Rows are contiguous — one row's bottom edge IS the next row's top edge — so
 * a single visible separator can be expressed two ways: "after the row above"
 * or "before the row below". A pointer resting on the separator flickers
 * between the two rows as it jitters by a pixel, and where those two
 * expressions do NOT mean the same canonical placement (the last row of a
 * group followed by a root-level row, say) the RESULT flickers with it.
 *
 * Within this many pixels of a separator the two expressions are collapsed
 * into one: the consumer is asked to re-express a boundary hit as "before the
 * row below", which is what the other side of that same separator already
 * produces. One separator, one descriptor, from either side.
 *
 * It is deliberately SMALLER than the insertion band (8 against 14.4 px at the
 * product's row height), so aiming at a row's lower band still expresses "after
 * THIS row" — dropping as the last child of a group stays reachable — and only
 * the last few pixels before the separator are canonicalized. `snapFor` clamps
 * it so it can never swallow the band on a shorter row.
 */
const BOUNDARY_SNAP_PX = 8;

function snapFor(height) {
  return Math.min(BOUNDARY_SNAP_PX, height * CHILD_BAND_EDGE * 0.6);
}

/**
 * Which of the three zones the POINTER is in, and nothing else (SVAR-M14, R4).
 *
 * The whole hit test, in one pure function of the pointer and the target's own
 * box. No dragged-row geometry, no DOM adjacency, no previous pointer position,
 * no time: the same coordinate over the same row is the same answer, always,
 * whatever route the pointer took to get there and however fast it moved.
 */
function pointerZone(box, clientY) {
  if (!(box.height > 0)) return 'child';
  const fromTop = clientY - box.top;
  const fromBottom = box.bottom - clientY;
  const band = box.height * CHILD_BAND_EDGE;
  if (fromTop < band) return 'before';
  if (fromBottom < band) return 'after';
  return 'child';
}

/*
 * SVAR-M14 (SVAR Production Planner): the attribute that says where the drop
 * would land, put on the row it would land at.
 *
 * The zone is already computed here on every pointer move — it is what decides
 * the `move-task` mode — but until now it existed only long enough to be sent
 * and was never visible. A user could not tell "insert between these two rows"
 * from "put it inside this one" until after letting go.
 *
 * This marks the row and stops there. WHAT the marker looks like is the
 * consumer's, in its own stylesheet, because a drop indicator has to match the
 * product's theme; and WHETHER the drop is legal is the consumer's too, which
 * is why this attribute describes the RESOLVED gesture rather than promising
 * that the consumer's domain will accept it.
 *
 * ## R3 remediation: the marker and the dispatch are ONE descriptor
 *
 * The first cut of SVAR-M14 marked the row from the RAW zone this helper
 * computes, while `Grid.jsx` went on to REWRITE that zone before dispatching
 * it — "after T" becomes "before T" when the dragged row already sits directly
 * under T, and becomes "before T's first child" when T is an open container.
 * The line was therefore drawn on T's bottom edge while the drop it described
 * was going to land above T, or inside it. The Planner's manual acceptance
 * found exactly that (R3-P4), together with the two effects of the same split:
 * a dispatch that lagged the marker by one pointer move (R3-P5) and a drop
 * whose result depended on which move happened to be the last one (R3-P6).
 *
 * There is one descriptor now. This helper does the GEOMETRY — which row the
 * pointer is over, and which of the three zones it fell in — and hands it to
 * `config.resolve`, which owns the adjacency corrections because it is the
 * side that knows the task list. What comes back is the FINAL `{ mode, target }`
 * the drop will be dispatched as, and it is the one thing that is marked, the
 * one thing sent to `config.move`, and the one thing sent to `config.end`.
 *
 * The geometry itself is deliberately UNCHANGED: the two edge tests still
 * compare the dragged row's own edges to the target's midline and the middle
 * band is still measured from the pointer. Replacing pointer-based hit testing
 * with a dragged-body model is a different interaction and an open product
 * question, not part of making this one truthful.
 */
const DROP_ZONE_ATTRIBUTE = 'data-wx-drop-zone';

/**
 * Puts the marker on `row`/`zone`, or clears it when `row` is null.
 *
 * Scoped to the grid `node` it was installed on, and it sweeps every other
 * marked row rather than only the one it put the attribute on last: the rows
 * are React's, and a re-render during the drag may hand the same DOM element
 * to a different task. Sweeping is what keeps "exactly one row is marked" a
 * fact rather than a hope, and the query is over one grid's rendered rows.
 */
function markDropZone(node, row, zone) {
  const marked = node.querySelectorAll(`[${DROP_ZONE_ATTRIBUTE}]`);
  for (let i = 0; i < marked.length; i++) {
    if (marked[i] !== row) marked[i].removeAttribute(DROP_ZONE_ATTRIBUTE);
  }
  if (row) row.setAttribute(DROP_ZONE_ATTRIBUTE, zone);
}

export function reorder(node, config) {
  let source, clone, sid;
  let x, y, base;
  let touched, touchTimer;

  /*
   * SVAR-M14 (R3): THE current drop intent, resolved, or `null` for "this
   * gesture would do nothing where it is".
   *
   * One value. It is what the marker is painted from, what `config.move`
   * dispatches, and what `config.end` drops. It is rewritten on every pointer
   * move — including to `null` — so it can never describe a position the
   * pointer has already left, which is what made a drop near a row boundary
   * depend on which move happened to be the last one.
   */
  let current = null;

  /** The descriptor last handed to `config.move`, to avoid re-dispatching it. */
  let dispatched = null;

  function sameDrop(a, b) {
    if (a === null || b === null) return a === b;
    return a.mode === b.mode && a.target === b.target;
  }

  /**
   * The rendered row for a task id, or `null` when it is not on screen.
   *
   * A RESOLVED target is not always the row the pointer is over: dropping on
   * the bottom edge of an open container resolves to "before its first child",
   * and that is the row the line has to be drawn at. The dragged row's own
   * slot and the clone that follows the pointer both carry the source's id and
   * are skipped, so a resolved target can never mark the thing being dragged.
   */
  function findRow(id) {
    if (id === null || id === undefined) return null;
    const rows = node.querySelectorAll('[data-context-id]');
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (row === source || row === clone) continue;
      if (getID(row) === id) return row;
    }
    return null;
  }

  /** Publishes `next` as the current intent: marker first, then dispatch. */
  function publishDrop(next) {
    current = next;
    markDropZone(node, next ? findRow(next.target) : null, next?.mode);
  }

  function clearDropZone() {
    publishDrop(null);
    dispatched = null;
  }

  function down(event) {
    x = event.clientX;
    y = event.clientY;
    base = {
      ...getOffset(source, node),
      y: config.getTask(sid).$y,
    };

    document.body.style.userSelect = 'none';
  }

  function handleTouchstart(event) {
    if (config.isDisabled?.()) return;
    source = locate(event);
    if (!checkSource(source)) return;

    sid = getID(source);

    touchTimer = setTimeout(() => {
      touched = true;
      if (config && config.touchStart) config.touchStart();
      down(event.touches[0]);
    }, 500);

    node.addEventListener('touchmove', handleTouchmove);
    node.addEventListener('contextmenu', handleContext);
    window.addEventListener('touchend', handleTouchend);
    // SVAR-M14 (R6): touch gets the same terminators, and `pointercancel` is
    // exactly the case a touch gesture is most likely to end on — the platform
    // deciding the pointer is now a scroll.
    armTerminators();
  }

  function handleContext(event) {
    if (touched || touchTimer) {
      event.preventDefault();
      return false;
    }
  }

  function handleMousedown(event) {
    if (config.isDisabled?.() || event.which !== 1) return;

    source = locate(event);
    if (!checkSource(source)) return;

    sid = getID(source);

    node.addEventListener('mousemove', handleMousemove);
    armTerminators();

    down(event);
  }

  /*
   * SVAR-M14 (R6): a gesture that ALWAYS terminates.
   *
   * Upstream ended a mouse reorder on one event, `mouseup`, and Chromium is
   * not obliged to deliver it. Measured in real Chromium on the consuming
   * product: press on a grid row, drag onto the utility strip above the grid,
   * release. `pointerdown`, `mousedown` and `pointerup` all fire; `mouseup` is
   * never dispatched — not on the target, not on the document, not at window
   * capture. The compatibility mouse event is simply not produced for that
   * pointer, so the ONE path that removed the clone, restored the source row's
   * visibility, cleared the drop marker and told the consumer the gesture was
   * over never ran. The floating clone stayed on screen, the source row stayed
   * hidden, and the drag state stayed live until the page was reloaded.
   *
   * So the terminators are the POINTER events, which are always delivered:
   *
   * ```text
   * pointerup      the release, whatever the release landed on
   * pointercancel  the platform taking the pointer away
   * mouseup        kept, because a device or browser without pointer events
   *                still has to end the gesture
   * blur           the window losing focus mid-gesture
   * ```
   *
   * `up()` is idempotent — it nulls the gesture and everything it does is
   * guarded on what it nulls — so several terminators firing for one gesture
   * cost one cleanup and one `config.end`, which is what makes listening to
   * all four safe rather than merely thorough.
   */
  function armTerminators() {
    window.addEventListener('pointerup', handleMouseup);
    window.addEventListener('pointercancel', handleMouseup);
    window.addEventListener('mouseup', handleMouseup);
    window.addEventListener('blur', handleMouseup);
  }

  function end(full) {
    node.removeEventListener('mousemove', handleMousemove);
    node.removeEventListener('touchmove', handleTouchmove);
    /*
     * SVAR-M14 (R6): removed from the target they were ADDED to.
     *
     * Upstream removed `mouseup` and `touchend` from `document.body` while
     * adding them to `window`, so neither was ever detached: one live listener
     * per helper survived every gesture, and every subsequent release ran the
     * handler again. Harmless only because `up()` happens to be idempotent —
     * which is not a thing to rely on by accident.
     */
    window.removeEventListener('pointerup', handleMouseup);
    window.removeEventListener('pointercancel', handleMouseup);
    window.removeEventListener('mouseup', handleMouseup);
    window.removeEventListener('blur', handleMouseup);
    window.removeEventListener('touchend', handleTouchend);
    document.body.style.userSelect = '';

    if (full) {
      node.removeEventListener('mousedown', handleMousedown);
      node.removeEventListener('touchstart', handleTouchstart);
    }
  }

  function move(event) {
    const dx = event.clientX - x;
    const dy = event.clientY - y;
    if (!clone) {
      if (Math.abs(dx) < SHIFT && Math.abs(dy) < SHIFT) return;
      if (config && config.start) {
        if (config.start({ id: sid, e: event }) === false) return;
      }

      clone = source.cloneNode(true);
      clone.style.pointerEvents = 'none';
      clone.classList.add('wx-reorder-task');
      clone.style.position = 'absolute';
      clone.style.left = base.left + 'px';
      clone.style.top = base.top + 'px';

      source.style.visibility = 'hidden';
      source.parentNode.insertBefore(clone, source);
    }

    if (clone) {
      const top = Math.round(Math.max(0, base.top + dy));

      /*
       * SVAR-M14 (R3): the hit test runs BEFORE the dispatch, not after it.
       *
       * Upstream computed the zone at the END of this function and handed
       * `config.move` whatever the PREVIOUS pointer move had left behind, so
       * every dispatched intent — and, on release, the drop itself — trailed
       * the marker by one move. Resolving first and dispatching the result in
       * the same tick is what removes that lag; nothing about the geometry
       * below changed, only when it is asked.
       */
      resolveDropAt(event);

      /*
       * The DISPATCH is still deduplicated — re-sending an identical
       * `move-task` would reorder the renderer's preview into the position it
       * is already in — but the deduplication no longer touches `current`.
       * Upstream cleared the pending detail to achieve the same thing, which
       * meant the value the drop was read from disappeared on every other
       * move; that is one half of why the same pointer position could produce
       * two different results.
       */
      const changed = !sameDrop(current, dispatched);
      if (config && config.move) {
        const proceed = config.move({
          id: sid,
          top,
          detail: changed ? current : null,
        });
        if (proceed === false) return;
        dispatched = current;
      }

      const task = config.getTask(sid);
      const y = task.$y;
      //dnd may be blocked
      if (!base.start && base.y === y) return up();

      base.start = true;
      base.y = task.$y - 4;
      clone.style.top = top + 'px'; //task.$y - scroll
    }
  }

  /**
   * Recomputes `current` from where the pointer is now (SVAR-M14, R4).
   *
   * Three steps, in this order, and nothing else:
   *
   * ```text
   * 1  which ROW   `elementFromPoint` — the row the cursor is over
   * 2  which ZONE  `pointerZone` — the cursor's position inside that row
   * 3  what it MEANS  `config.resolve` — the consumer, which owns the task
   *                   list and therefore the adjacency and boundary rules
   * ```
   *
   * The result of step 3 is the one descriptor that is marked, dispatched and
   * dropped. Nothing here reads the dragged row's geometry, the previous
   * pointer position, or a clock.
   */
  function resolveDropAt(event) {
    const targetNode = document.elementFromPoint(event.clientX, event.clientY);
    const target = locate(targetNode);

    if (!target || target === source) {
      // Over nothing droppable — the pointer left the rows, or is over the
      // dragged row itself. Nothing is going to happen here, and the marker
      // has to say so, and so must the intent: releasing here drops nothing
      // rather than dropping where the pointer used to be.
      publishDrop(null);
      return;
    }

    const box = target.getBoundingClientRect();
    const zone = pointerZone(box, event.clientY);

    /*
     * Is the pointer ON the separator this zone names? The consumer needs to
     * know, because collapsing a boundary to one descriptor means naming the
     * row on the other side of it, and only the consumer knows which row that
     * is in the CURRENT list.
     */
    const snap = snapFor(box.height);
    const atBoundary =
      zone === 'before'
        ? event.clientY - box.top <= snap
        : zone === 'after'
          ? box.bottom - event.clientY <= snap
          : false;

    const raw = { id: sid, mode: zone, target: getID(target), atBoundary };
    const resolved = config.resolve ? config.resolve(raw) : raw;
    publishDrop(
      resolved === null || resolved === undefined
        ? null
        : { id: sid, mode: resolved.mode, target: resolved.target },
    );
  }

  function handleMousemove(event) {
    move(event);
  }

  function handleTouchmove(event) {
    if (touched) {
      event.preventDefault();
      move(event.touches[0]);
    } else if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
  }

  function handleTouchend() {
    touched = null;
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
    up();
  }

  function handleMouseup() {
    up();
  }

  function up() {
    /*
     * SVAR-M14 (R3): the drop is the descriptor that was on screen.
     *
     * Upstream dropped whatever the last DISPATCHED in-progress step had left
     * in a ref, which is a different thing from what the marker was showing
     * whenever the last pointer move crossed a zone boundary — and how many
     * moves the browser coalesced after that crossing is not something a user
     * controls. Reading the same `current` the marker was painted from is what
     * makes the same pointer position give the same result every time.
     */
    const drop = current;

    // Drop, cancel, or a gesture that never started — the marker goes in every
    // one of those cases, because it describes a drag in progress.
    clearDropZone();

    if (source) {
      source.style.visibility = '';
    }
    if (clone) {
      clone.parentNode.removeChild(clone);
      if (config && config.end) config.end({ id: sid, top: base.top, drop });
    }

    sid = source = clone = base = null;
    current = dispatched = null;
    end();
  }

  if (node.style.position !== 'absolute') node.style.position = 'relative';

  node.addEventListener('mousedown', handleMousedown);
  node.addEventListener('touchstart', handleTouchstart);

  return {
    destroy() {
      end(true);
    },
  };
}
