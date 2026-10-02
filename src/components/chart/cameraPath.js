/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M56).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The Pan camera path: the ONE owner that turns the store's accepted scroll
 * position into pixels, in the same task as the store write.
 *
 * ## Why this exists
 *
 * Upstream kept the camera position in `@svar-ui/gantt-store` and copied it
 * into the DOM only through React: `Chart.jsx` wrote `.wx-chart.scrollTop/
 * scrollLeft` in a layout effect, `grid/Grid.jsx` re-rendered to recompute
 * an inline `--wx-body-offset`, and `Layout.jsx` synced the outer
 * pseudo-scroller in a passive effect. Measured in the Planner
 * (`docs/research/RENDERER_PAN_SMOOTHNESS_INVESTIGATION.md` §8-§26):
 *
 *   - the store is written synchronously in the input task, but React
 *     schedules its render as a separate task, so the frame of the input
 *     always painted the OLD position (one frame of latency, RC-2);
 *   - every Pan step re-rendered Layout, the whole left grid (twice, through
 *     react-grid's SVAR-M1 re-initialisation) and the Chart subtree just to
 *     move pixels that a scroll offset moves for free (RC-1, RC-3);
 *   - a late render repeated the old position for a frame and then jumped
 *     two steps: uneven motion without any "jump".
 *
 * Here the camera is applied from a store subscription instead, so the frame
 * that receives the input paints its position, and React renders only what
 * actually changed meaning: a new row window or cell window.
 *
 * ## The order of one update (explicit, never subscriber order)
 *
 * ```text
 * 1  the store's ACCEPTED scrollLeft / scrollTop     read from state: the store
 *                                                    has already clamped them
 * 2  the DOM camera                                  .wx-chart offsets, the outer
 *                                                    pseudo-scroller, the grid
 *                                                    body's own `top` — and only
 *                                                    into an extent React has
 *                                                    already committed (below)
 * 3  the visible row window                          evaluated from that position
 * 4  `render-data`                                   published only when the
 *                                                    window actually changed
 * 5  the camera position, to viewport-anchored       the offscreen chips, which
 *    overlays                                        render in this same frame
 * ```
 *
 * Every step runs inside one `apply()`, which is re-entrancy safe: a store
 * change that arrives WHILE it runs (the nested `render-data` of step 4, or a
 * consumer reacting to it) does not recurse — it marks the pass dirty, and
 * the running `apply()` runs once more after finishing, against the latest
 * state.
 *
 * The store sets and announces the keys of one update one after another
 * (lib-state's `setState`), so a step that moves both axes reaches the camera
 * as two calls — `scrollLeft`'s, then `scrollTop`'s — in the same task. Each
 * call applies everything the store has accepted by then and writes only what
 * differs from what this module last wrote, so nothing depends on which
 * subscriber runs first, and the whole step is in the DOM before the task
 * ends.
 *
 * ## The grid offset keeps SVAR-M1 by construction
 *
 * The grid body sits at `renderedFrom - scrollTop + laneBelowHeader`, where
 * `renderedFrom` is the `from` of the rows the grid has actually COMMITTED
 * (`grid/Grid.jsx` reports it from a layout effect), never the window just
 * requested. A camera step that runs ahead of React therefore moves the rows
 * that are on screen to exactly where their bars are; when React commits a
 * new window, the grid reports its new `from` in the same commit and the
 * offset follows before paint (react-grid publishes its rows from a layout
 * effect too — SVAR-M1). There is no frame in which the offset and the rows
 * describe two different windows.
 *
 * The offset is a direct `top` on the grid body. The inherited custom
 * property it replaces restyled the whole grid subtree on every write — the
 * largest remaining vertical cost once React stopped re-rendering per step
 * (research §23.1, proof O). Nothing here reads layout back: every write is
 * compared with the value this module last wrote, never with the DOM.
 *
 * ## Committed extent
 *
 * A scroll offset written into content that has not grown yet is silently
 * clamped by the browser, and the clamp then reaches the scroll handler as if
 * the user had scrolled — losing the position the store asked for (a scale
 * change keeps its centre date by a `scroll-chart` issued in the same task as
 * the new scale, SVAR-M31). So the DOM camera is written only while the
 * store's `_scales`, `_tasks` and `cellHeight` are the ones `Layout.jsx` has
 * committed; otherwise the write waits for that commit, which applies it from
 * its own layout effect, before paint — exactly when upstream's React path
 * wrote it.
 *
 * ## A native scroll keeps its own scroller
 *
 * A native scroll (a wheel, a trackpad, a scrollbar) is handed to the store
 * judged on its own axis against what this module wrote, so two scrollers
 * moving in one task can never cancel each other's update the way upstream's
 * one shared `isUserScrollRef` did (research §7.1). While that hand-over runs,
 * the scroller that originated it is not written back: the browser has
 * already put it where the user scrolled, and the store may accept a slightly
 * different value — it clamps against its own `_chartWidth` / `_chartHeight`,
 * which can differ from the element's client size by a pixel at the far edge.
 * Upstream never wrote that clamp back into the originating scroller either;
 * every other target follows the store as usual, and the next camera write
 * reconciles the originating one, as upstream's next render did.
 *
 * ## What this module does NOT own
 *
 * It owns no position: the store stays the only canonical viewport state
 * (`scroll-chart` remains the one way to move it, for Pan, wheel, reveal and
 * every programmatic caller alike). It decides no business meaning, reads no
 * date and changes nothing in `@svar-ui/gantt-store` (D-102 §B): it consumes
 * the same reactive values `useStore` already consumes.
 */

/**
 * Rows rendered beyond the viewport on each side. Upstream's own value
 * (`Chart.jsx` `extraRows`); the arithmetic below is upstream's `dataRequest`
 * unchanged.
 */
export const ROW_WINDOW_EXTRA_ROWS = 1;

/**
 * The row window upstream requests for a scroll position: the rows covering
 * `viewportHeight` from `scrollTop`, plus `extraRows` on each side.
 */
export function rowWindowFor(
  scrollTop,
  viewportHeight,
  cellHeight,
  extraRows = ROW_WINDOW_EXTRA_ROWS,
) {
  const rowHeight = cellHeight || 1;
  const num = Math.ceil((viewportHeight || 0) / rowHeight) + 1;
  const pos = Math.floor((scrollTop || 0) / rowHeight);
  const start = Math.max(0, pos - extraRows);
  const end = pos + num + extraRows;
  return { start, end, from: start * (cellHeight || 0) };
}

/** Two row windows describe the same rendered rows. */
export function sameRowWindow(a, b) {
  return (
    !!a && !!b && a.start === b.start && a.end === b.end && a.from === b.from
  );
}

/**
 * Two cell windows (`xArea`) describe the same rendered cells. The store
 * builds a NEW `xArea` object on every `scrollLeft` change; consumers that
 * compare it by value re-render only when the window actually moves.
 */
export function sameCellWindow(a, b) {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.start === b.start &&
      a.end === b.end &&
      a.from === b.from &&
      a.to === b.to)
  );
}

/** Where the grid body sits for the rows it has committed. */
export function gridBodyTop(renderedFrom, scrollTop, laneBelowHeader) {
  return (renderedFrom || 0) - (scrollTop || 0) + (laneBelowHeader || 0);
}

/**
 * How many passes one `apply()` may take when store changes keep arriving
 * while it runs. Each pass reads the latest state, so in practice the second
 * pass finds nothing left to do; the bound only guarantees that a consumer
 * which keeps moving the store from inside the camera cannot hang the page —
 * the next store change applies whatever is left.
 */
const MAX_PASSES = 4;

/**
 * Creates the camera path of one chart.
 *
 * `api` is the component-facing store API (`getState`, `getReactiveState`,
 * `exec`). Everything else is attached by the components that own the DOM:
 * `Layout.jsx` (the outer pseudo-scroller and the committed extent),
 * `Chart.jsx` (`.wx-chart` and its viewport height) and `grid/Grid.jsx` (the
 * grid body and the window it has committed).
 */
export function createCameraPath(api) {
  const dom = { chart: null, outer: null };
  const grid = { getBody: null, renderedFrom: 0, laneBelowHeader: 0 };
  const rows = { viewportHeight: 0 };
  const committed = {
    scales: undefined,
    tasks: undefined,
    cellHeight: undefined,
  };
  // What this module last wrote into the DOM, compared instead of reading back.
  const written = {
    chartLeft: null,
    chartTop: null,
    outerTop: null,
    gridTop: null,
    gridBody: null,
  };

  let position = { left: 0, top: 0 };
  const listeners = new Set();

  let applying = false;
  let dirty = false;
  // The scroller whose native scroll is being handed to the store right now
  // ('chartLeft' or 'outerTop'), which the camera does not write back.
  let nativeOrigin = null;

  function extentCommitted(state) {
    return (
      state._scales === committed.scales &&
      state._tasks === committed.tasks &&
      state.cellHeight === committed.cellHeight
    );
  }

  function writeGridBody(scrollTop) {
    const body = grid.getBody ? grid.getBody() : null;
    if (!body) return;
    const top = gridBodyTop(grid.renderedFrom, scrollTop, grid.laneBelowHeader);
    if (top === written.gridTop && body === written.gridBody) return;
    body.style.top = `${top}px`;
    written.gridTop = top;
    written.gridBody = body;
  }

  function writeCamera(left, top) {
    const chart = dom.chart;
    if (chart) {
      if (
        nativeOrigin !== 'chartLeft' &&
        Number.isFinite(left) &&
        left !== written.chartLeft
      ) {
        written.chartLeft = left;
        chart.scrollLeft = left;
      }
      if (Number.isFinite(top) && top !== written.chartTop) {
        written.chartTop = top;
        chart.scrollTop = top;
      }
    }
    const outer = dom.outer;
    if (
      outer &&
      nativeOrigin !== 'outerTop' &&
      Number.isFinite(top) &&
      top !== written.outerTop
    ) {
      written.outerTop = top;
      outer.scrollTop = top;
    }
    if (Number.isFinite(top)) writeGridBody(top);
  }

  function publishPosition(left, top) {
    if (position.left === left && position.top === top) return;
    position = { left, top };
    listeners.forEach((listener) => listener());
  }

  function requestRowWindow(state) {
    const next = rowWindowFor(
      state.scrollTop,
      rows.viewportHeight,
      state.cellHeight,
    );
    // The store's own current window: nothing else publishes one, and
    // comparing with it (not with a private copy) keeps the decision true
    // after a store re-initialisation too.
    if (sameRowWindow(state.area, next)) return;
    api.exec('render-data', next);
  }

  function pass() {
    const state = api.getState();
    // 1. the accepted position
    const left = state.scrollLeft;
    const top = state.scrollTop;
    // 2. the DOM camera, only into a committed extent; 5. what it now shows
    if (extentCommitted(state)) {
      writeCamera(left, top);
      publishPosition(left, top);
    }
    // 3-4. the row window, from the same position
    requestRowWindow(state);
  }

  function handOver(origin, change) {
    nativeOrigin = origin;
    try {
      api.exec('scroll-chart', change);
    } finally {
      nativeOrigin = null;
    }
  }

  function apply() {
    if (applying) {
      dirty = true;
      return;
    }
    applying = true;
    try {
      let passes = 0;
      do {
        dirty = false;
        pass();
        passes += 1;
      } while (dirty && passes < MAX_PASSES);
    } finally {
      applying = false;
      dirty = false;
    }
  }

  return {
    apply,

    /** Subscribes to the store's scroll position. Returns the unsubscribe. */
    start() {
      const reactive = api.getReactiveState();
      // A new lib-state subscriber is called at once with the current value,
      // so the camera is applied here as well.
      const offs = [
        reactive.scrollLeft.subscribe(apply),
        reactive.scrollTop.subscribe(apply),
      ];
      return () => offs.forEach((off) => typeof off === 'function' && off());
    },

    /** `Layout.jsx`: the extent React has committed to the DOM. */
    commitExtent(scales, tasks, cellHeight) {
      committed.scales = scales;
      committed.tasks = tasks;
      committed.cellHeight = cellHeight;
      apply();
    },

    attachChart(element) {
      dom.chart = element;
      written.chartLeft = null;
      written.chartTop = null;
      apply();
      return () => {
        if (dom.chart === element) dom.chart = null;
      };
    },

    attachOuter(element) {
      dom.outer = element;
      written.outerTop = null;
      apply();
      return () => {
        if (dom.outer === element) dom.outer = null;
      };
    },

    /** `Chart.jsx`: the height the row window has to cover. */
    setViewportHeight(height) {
      if (rows.viewportHeight === height) return;
      rows.viewportHeight = height || 0;
      apply();
    },

    /**
     * `grid/Grid.jsx`: the body element, the `from` of the rows it has
     * committed and the lane height still reserved below its header.
     */
    setGrid(getBody, renderedFrom, laneBelowHeader) {
      grid.getBody = getBody;
      grid.renderedFrom = renderedFrom || 0;
      grid.laneBelowHeader = laneBelowHeader || 0;
      apply();
    },

    detachGrid(getBody) {
      if (grid.getBody === getBody) {
        grid.getBody = null;
        written.gridBody = null;
        written.gridTop = null;
      }
    },

    /**
     * A native scroll of `.wx-chart` (a horizontal wheel, a trackpad, the
     * scrollbar), handed to the store on its own axis (see "A native scroll
     * keeps its own scroller" above). The vertical axis of `.wx-chart` is
     * `overflow-y: hidden` and only ever moved by this module, exactly as
     * upstream treated it.
     */
    onChartScroll() {
      const chart = dom.chart;
      if (!chart) return;
      const left = chart.scrollLeft;
      if (left === written.chartLeft) return;
      written.chartLeft = left;
      handOver('chartLeft', { left });
    },

    /** A native scroll of the outer pseudo-scroller (the vertical wheel). */
    onOuterScroll() {
      const outer = dom.outer;
      if (!outer) return;
      const top = outer.scrollTop;
      if (top === written.outerTop) return;
      written.outerTop = top;
      handOver('outerTop', { top });
    },

    /** The `.wx-chart` element, for reads scoped to this chart. */
    chartElement() {
      return dom.chart;
    },

    /** The position the DOM camera shows (a stable object until it moves). */
    getPosition() {
      return position;
    },

    subscribePosition(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
