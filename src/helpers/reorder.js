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

/*
 * SVAR-M14 (R7): how close to an edge of the scrolling pane counts as "carry
 * on past here", and how fast that goes.
 *
 * A row reorder can only reach rows that are on screen, because the only way
 * to name a target is to put the pointer on it. With a list longer than the
 * pane that makes whole regions unreachable in one gesture: the pointer
 * arrives at the bottom edge, there is nowhere further to go, and the button
 * has to be released and the drag started again — repeatedly, for a list a few
 * screens long.
 *
 * So the last band at each end means "keep going". The zone is a little larger
 * than one row at the heights this renderer is used at, which is enough to aim
 * at deliberately and small enough that the middle of the pane — where most
 * drops are aimed — never scrolls by accident. It is clamped to a quarter of
 * the pane so a short pane cannot end up with two overlapping zones and no
 * neutral middle.
 *
 * The speed is expressed per SECOND and multiplied by the real frame interval,
 * so it is the same movement on a 60Hz and a 144Hz display, and it rises
 * QUADRATICALLY from the inner boundary to the edge: resting just inside the
 * zone creeps, which is what precise work near the current view needs, and
 * pushing to the very edge covers a long list quickly. Both numbers, and the
 * curve, are reversible interaction detail.
 */
const EDGE_ZONE_PX = 56;
const EDGE_MIN_SPEED = 140;
const EDGE_MAX_SPEED = 1500;

function edgeSpeed(t) {
  return EDGE_MIN_SPEED + (EDGE_MAX_SPEED - EDGE_MIN_SPEED) * t * t;
}

/**
 * The pane this grid scrolls vertically in, or `null` if it does not scroll.
 *
 * Found by measurement rather than named by selector: the nearest ancestor
 * that both declares a vertical overflow and actually has more content than
 * room. That keeps this helper free of any knowledge of the component tree
 * above it — it is installed on a node and asks the document what that node
 * lives in.
 */
function scrollportFor(node) {
  let el = node.parentNode;
  while (el && el.nodeType === 1) {
    const overflow = getComputedStyle(el).overflowY;
    if (
      (overflow === 'auto' || overflow === 'scroll') &&
      el.scrollHeight > el.clientHeight + 1
    ) {
      return el;
    }
    el = el.parentNode;
  }
  return null;
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

  /*
   * SVAR-M14 (R7): where the pointer last actually was, the pane the rows
   * scroll in, and the ONE animation frame that scrolls it.
   *
   * The pointer position is kept because the rows can now move underneath a
   * pointer that is not moving — the wheel, and the edge auto-scroll below —
   * and every one of those cases has to re-answer "what is under the cursor
   * now" from a position no fresh event is going to supply.
   *
   * `frame` is a single id, never a set: there is one gesture, so there is one
   * loop. It is started where the clone is created and stopped in `end()`,
   * which every terminator already goes through.
   */
  let pointer = null;
  let port = null;
  let frame = null;
  let scrollAt = 0;
  let lastBodyTop = null;
  let lastScroll = null;

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
      /*
       * SVAR-M14 (R7): WHERE IN THE ROW the row was picked up.
       *
       * The clone used to be placed from the pointer's total travel since
       * mousedown, `base.top + dy`, which is only the same thing as "under the
       * cursor" while nothing else moves. It moves now — the wheel scrolls the
       * pane mid-gesture, and so does edge auto-scroll — and every one of
       * those shifts the coordinate space `base.top` was measured in, so the
       * held row slid away from the cursor by exactly the distance scrolled.
       *
       * This offset is a property of the GRAB and never changes, so placing
       * the clone at `pointer − grab` against the body's CURRENT box is
       * correct at any scroll position without the helper having to know
       * anything about how the pane scrolls or how the rows are windowed. With
       * nothing scrolling it is arithmetically the same placement as before.
       */
      grabY: event.clientY - source.getBoundingClientRect().top,
    };

    pointer = { clientX: event.clientX, clientY: event.clientY };
    port = scrollportFor(node);

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
    window.addEventListener('pointercancel', handleCancel);
    window.addEventListener('mouseup', handleMouseup);
    window.addEventListener('blur', handleCancel);
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
    window.removeEventListener('pointercancel', handleCancel);
    window.removeEventListener('mouseup', handleMouseup);
    window.removeEventListener('blur', handleCancel);
    window.removeEventListener('touchend', handleTouchend);
    // SVAR-M14 (R7): the two things a drag can leave RUNNING rather than
    // merely listening. Both are detached here, on the one path every
    // terminator already goes through, so auto-scroll and the pane
    // subscription cannot outlive the gesture that started them.
    stopDragFrames();
    port = null;
    pointer = null;
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
      // There is something to hold now, so the loop that keeps holding it can
      // start. Before this point a gesture is only a press.
      startDragFrames();
    }

    if (clone) {
      // SVAR-M14 (R7): measured against the body as it is NOW, so a pane that
      // scrolled mid-gesture does not drag the held row out from under the
      // cursor. See `base.grabY`.
      const bodyTop = node
        .querySelector('.wx-body')
        .getBoundingClientRect().top;
      const top = Math.round(Math.max(0, event.clientY - base.grabY - bodyTop));

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

  /**
   * How fast, and which way, the pane should be scrolling right now
   * (SVAR-M14, R7).
   *
   * Signed pixels per second: negative is up, positive is down, 0 is "the
   * pointer is not near either end, leave the pane alone". A pointer that has
   * gone PAST an edge counts as being at that edge rather than as having left
   * the zone, so dragging out of the pane keeps scrolling instead of stopping
   * dead at the boundary the user is trying to cross.
   */
  function edgeVelocity() {
    if (!port || !pointer) return 0;
    const box = port.getBoundingClientRect();

    /*
     * The zone is measured against the ROWS, not against the pane.
     *
     * The column header is sticky and sits inside the same scrolling pane, and
     * at the product's sizes it is taller than the zone — so a zone measured
     * from the pane's own top edge would lie entirely ON the header, where
     * there is no row to drop on. Scrolling up would then work only from a
     * position where the user cannot see, or aim at, what they are scrolling
     * towards. Starting the zone at the header's lower edge puts it on the
     * first rows instead, which is where someone reaching for the row above
     * actually points.
     */
    const header = node.querySelector('.wx-header');
    const top = header
      ? Math.max(box.top, header.getBoundingClientRect().bottom)
      : box.top;
    const zone = Math.min(EDGE_ZONE_PX, (box.bottom - top) / 4);
    if (!(zone > 0)) return 0;

    const fromTop = pointer.clientY - top;
    if (fromTop < zone) {
      return -edgeSpeed(Math.min(1, (zone - fromTop) / zone));
    }
    const fromBottom = box.bottom - pointer.clientY;
    if (fromBottom < zone) {
      return edgeSpeed(Math.min(1, (zone - fromBottom) / zone));
    }
    return 0;
  }

  /**
   * How far down the page the row body currently starts.
   *
   * The clone lives inside the body, and the body MOVES: the renderer offsets
   * it by the difference between the top of its virtual window and the scroll
   * position, and recomputes that on its own schedule after a scroll. So the
   * coordinate the clone is placed in is not stable during a gesture, and this
   * is the value that says where it is right now.
   */
  function bodyTop() {
    const body = node.querySelector('.wx-body');
    return body ? body.getBoundingClientRect().top : 0;
  }

  /**
   * One scroll step, or nothing (SVAR-M14, R7).
   *
   * Writes to the pane only when the write can actually move it: the target is
   * clamped to the pane's own range first and compared, so resting against the
   * top or the bottom of the list issues no scroll at all rather than issuing
   * one that does nothing, every frame, until the button is released.
   */
  function autoScrollStep(now) {
    if (!port) return;
    const velocity = edgeVelocity();
    if (velocity === 0) {
      scrollAt = 0;
      return;
    }
    // Real elapsed time, capped so a stalled tab cannot resume with one huge
    // jump. The first frame of a run has no previous timestamp to measure
    // against and is charged one nominal interval.
    const elapsed = scrollAt === 0 ? 16 : Math.min(64, now - scrollAt);
    scrollAt = now;

    const limit = port.scrollHeight - port.clientHeight;
    const next = Math.max(
      0,
      Math.min(limit, port.scrollTop + (velocity * elapsed) / 1000),
    );
    if (next === port.scrollTop) {
      scrollAt = 0;
      return;
    }
    port.scrollTop = next;
  }

  /**
   * THE frame loop of a hierarchy drag (SVAR-M14, R7). One per gesture.
   *
   * It does two things, and they are the same thing: scroll the pane when the
   * pointer is against an edge, and — however the rows came to move — put the
   * held row back under the cursor and re-answer what the cursor is now over.
   *
   * "However they came to move" is the reason this is a loop rather than a
   * scroll handler. Three different things move the rows under a pointer that
   * is not moving, and only one of them is this helper's own auto-scroll: the
   * wheel scrolls the pane directly, and the renderer re-offsets the body a
   * commit LATER when its virtual window re-slices. A scroll listener sees the
   * first two and runs before the third, so it corrected the clone against a
   * body position that was about to change again — measured as the held row
   * jumping a row away from the cursor on every wheel notch.
   *
   * Comparing the two values that actually decide what is on screen — where
   * the body is, and where the pane is scrolled to — catches all three, one
   * frame after the fact and therefore before the next paint. When neither has
   * changed this costs one rect read and nothing else: no dispatch, no
   * re-resolve, no store write.
   */
  function dragFrame(now) {
    frame = null;
    if (!clone || !pointer) return;

    autoScrollStep(now);

    const top = bodyTop();
    const scrolled = port ? port.scrollTop : 0;
    if (top !== lastBodyTop || scrolled !== lastScroll) {
      lastBodyTop = top;
      lastScroll = scrolled;
      // The same move path a real pointer move takes, so there is no second
      // idea of where the drop would land — only a second reason to ask.
      move(pointer);
    }

    frame = requestAnimationFrame(dragFrame);
  }

  function startDragFrames() {
    if (frame !== null) return;
    lastBodyTop = bodyTop();
    lastScroll = port ? port.scrollTop : 0;
    scrollAt = 0;
    frame = requestAnimationFrame(dragFrame);
  }

  function stopDragFrames() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    scrollAt = 0;
    lastBodyTop = null;
    lastScroll = null;
  }

  function handleMousemove(event) {
    pointer = { clientX: event.clientX, clientY: event.clientY };
    move(event);
  }

  function handleTouchmove(event) {
    if (touched) {
      event.preventDefault();
      const touch = event.touches[0];
      pointer = { clientX: touch.clientX, clientY: touch.clientY };
      move(touch);
    } else if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
  }

  function handleTouchend(event) {
    touched = null;
    if (touchTimer) {
      clearTimeout(touchTimer);
      touchTimer = null;
    }
    // SVAR-M14 (R8): a touch release has a position too — it is in
    // `changedTouches`, because the touch that ended is by then no longer in
    // `touches`. Without it every touch drop would read as a release on
    // nothing and cancel.
    up(event?.changedTouches?.[0]);
  }

  function handleMouseup(event) {
    up(event);
  }

  /**
   * `pointercancel` / `blur` (SVAR-M14, R11, Planner Phase 3.3 R11 M-2
   * remediation): the platform taking the pointer away, or the window losing
   * focus mid-gesture. Neither is a release ON anything — see `up`'s own
   * comment for why this is the one caller `releasedOnRows` must never see a
   * real event from — so this calls `up()` with no argument at all rather
   * than forwarding the terminating event, unconditionally: no coordinates a
   * `pointercancel` happens to carry can turn it into a drop.
   */
  function handleCancel() {
    up();
  }

  /**
   * Is the RELEASE happening on a row of this grid (SVAR-M14, R8)?
   *
   * The move listener is on the grid, so once the pointer leaves it sideways
   * no further move is delivered and `current` keeps describing the last row
   * the grid saw — which is off screen, or behind the timeline, or under the
   * toolbar. Releasing there used to commit that stale position: the consuming
   * product's manual acceptance reported it as a task jumping somewhere nobody
   * pointed at.
   *
   * This asks only WHERE the button came up. It is COORDINATE geometry only —
   * whatever `event` is handed a real position for is asked "is that position
   * over a droppable row" — and it answers that question honestly whenever it
   * is asked, `pointercancel` included.
   *
   * SVAR-M14 (R11, Planner Phase 3.3 R11 M-2 remediation): that is exactly why
   * this function must never be asked about a `pointercancel` or a `blur`.
   * Measured in real Chromium on the consuming product: a genuine
   * `pointercancel` dispatched over a legitimate drop target CARRIES that
   * target's `clientX`/`clientY` — the prior claim that it "carries no
   * position" was not true of the real event, only of the coincidental cases
   * this file had been exercised against, and asking this function about such
   * an event answered "yes, drop it" for a gesture the platform was actively
   * taking away from the user. Terminal-reason discipline is owned by the two
   * callers below, `handleMouseup` and `handleCancel`, not by this function:
   * one release-worthy terminator asks this function with the real event, the
   * other forces the cancel unconditionally and never lets this function see
   * the event at all — so a `pointercancel`'s coordinates, real or not, cannot
   * reach here to be asked about in the first place.
   *
   * It deliberately does NOT re-resolve the drop. The descriptor the insertion
   * line was painted from is the descriptor that drops; this decides whether
   * there is a drop at all, and nothing else.
   */
  function releasedOnRows(event) {
    if (!event || typeof event.clientX !== 'number') return false;
    if (typeof event.clientY !== 'number') return false;
    const under = document.elementFromPoint(event.clientX, event.clientY);
    if (!under || !node.contains(under)) return false;
    const row = locate(under);
    return !!row && checkSource(row) && row !== clone;
  }

  function up(event) {
    /*
     * SVAR-M14 (R3): the drop is the descriptor that was on screen.
     *
     * Upstream dropped whatever the last DISPATCHED in-progress step had left
     * in a ref, which is a different thing from what the marker was showing
     * whenever the last pointer move crossed a zone boundary — and how many
     * moves the browser coalesced after that crossing is not something a user
     * controls. Reading the same `current` the marker was painted from is what
     * makes the same pointer position give the same result every time.
     *
     * SVAR-M14 (R8): and only when the button came up ON the rows. Leaving the
     * grid does not cancel — coming back makes a drop available again, because
     * re-entering resumes the move events that keep `current` truthful — but
     * the RELEASE decides, and a release anywhere else is a cancel.
     *
     * SVAR-M14 (R11, M-2): `event` here is never a real `pointercancel` or
     * `blur` — see `releasedOnRows` and `handleCancel` — so `undefined` is
     * exactly what a forced cancel passes, and `releasedOnRows(undefined)`
     * answers `false` on its very first guard without reading anything a
     * cancelled platform event might otherwise have populated.
     */
    const drop = releasedOnRows(event) ? current : null;

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
      /*
       * SVAR-M14 (R7): teardown ENDS the gesture rather than only unsubscribing
       * from it.
       *
       * `end(true)` detaches listeners and nothing else, so a teardown while
       * the button was still down used to leave the floating clone in the DOM,
       * the source row permanently invisible and the drop marker painted on a
       * row nothing was going to be dropped on. That is not a hypothetical: it
       * is what a scroll-driven re-install did on every wheel gesture until R7
       * (see `Grid.jsx`), and it is the shape any future unmount mid-drag
       * would take.
       *
       * `up()` is the one terminal path and is idempotent — with no gesture in
       * progress every step is a no-op — so calling it here costs nothing when
       * there is nothing to end, and restores everything when there is.
       */
      up();
      end(true);
    },
  };
}
