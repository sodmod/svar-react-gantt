import { locate, getID } from '@svar-ui/lib-dom';

function getOffset(node, relative, ev) {
  const box = node.getBoundingClientRect();
  const base = relative.querySelector('.wx-body').getBoundingClientRect();

  return {
    top: box.top - base.top,
    left: box.left - base.left,
    dt: box.bottom - ev.clientY,
    db: ev.clientY - box.top,
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
 */
const CHILD_BAND_EDGE = 0.3;

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
      ...getOffset(source, node, event),
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
    window.addEventListener('mouseup', handleMouseup);

    down(event);
  }

  function end(full) {
    node.removeEventListener('mousemove', handleMousemove);
    node.removeEventListener('touchmove', handleTouchmove);
    document.body.removeEventListener('mouseup', handleMouseup);
    document.body.removeEventListener('touchend', handleTouchend);
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

  /** Recomputes `current` from where the pointer is now. */
  function resolveDropAt(event) {
    {
      const targetNode = document.elementFromPoint(
        event.clientX,
        event.clientY,
      );
      const target = locate(targetNode);

      if (target && target !== source) {
        const tid = getID(target);
        const box = target.getBoundingClientRect();
        const line = box.top + box.height / 2;

        const after =
          event.clientY + base.db > line &&
          target.nextElementSibling !== source;
        const before =
          event.clientY - base.dt < line &&
          target.previousElementSibling !== source;

        /*
         * SVAR-M13 (SVAR Production Planner): the row's middle band means
         * "into this row", not "next to it".
         *
         * Before this, a row was split in two and a drag could only ever
         * express a position in an existing sibling list. Making one task the
         * parent of another was therefore impossible by direct manipulation,
         * even though `move-task` has always accepted `mode: 'child'` and the
         * store has always implemented it — `indent-task` is written in terms
         * of exactly that call.
         *
         * The band is measured from the POINTER against the target's own box,
         * unlike the two edge tests above, which compare the dragged row's
         * edges to the target's midline. That difference is deliberate: an
         * edge test asks "which side is the row falling on", and there is no
         * third side; "am I over the middle of that row" is a question about
         * where the user is pointing.
         */
        const middleTop = box.top + box.height * CHILD_BAND_EDGE;
        const middleBottom = box.bottom - box.height * CHILD_BAND_EDGE;
        const onto = event.clientY > middleTop && event.clientY < middleBottom;

        const zone = onto
          ? 'child'
          : after
            ? 'after'
            : before
              ? 'before'
              : null;

        /*
         * SVAR-M14 (R3): the RAW zone is a statement about the pointer; the
         * drop is what the consumer resolves it to.
         *
         * `config.resolve` owns the two adjacency corrections, because they
         * need the task list and this helper only has the DOM. Whatever it
         * returns is the whole truth of this gesture from here on: it is
         * marked, it is dispatched, and it is dropped. A consumer that does
         * not supply one gets the raw zone, unchanged.
         */
        const raw = zone === null ? null : { id: sid, mode: zone, target: tid };
        const resolved =
          raw === null ? null : config.resolve ? config.resolve(raw) : raw;
        publishDrop(
          resolved === null || resolved === undefined
            ? null
            : { id: sid, mode: resolved.mode, target: resolved.target },
        );
      } else {
        // SVAR-M14: over nothing droppable — the pointer left the rows, or is
        // over the dragged row itself. Nothing is going to happen here, and the
        // marker has to say so — and so must the intent, or a release here
        // would drop where the pointer used to be.
        publishDrop(null);
      }
    }
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
