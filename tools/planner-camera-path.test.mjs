/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M56).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the Pan camera path (`src/components/chart/cameraPath.js`).
 * Run: `npm run test:planner` (plain `node --test`, no extra dependency).
 *
 * The store these run against is a REAL `@svar-ui/gantt-store` DataStore,
 * driven through the same three members the components use (`getState`,
 * `getReactiveState`, `exec` on its input bus). That matters here more than
 * anywhere: the properties under test — the order of one update, re-entrancy
 * when `render-data` is dispatched from inside a `scroll-chart` subscriber,
 * the store's own clamping — are properties of how the camera meets THAT
 * store, and a mocked store would be the module's assumptions restated.
 *
 * The DOM is faked: three plain objects stand for `.wx-chart`, the outer
 * pseudo-scroller and the grid body. Each records every write in one shared
 * log, so the order of writes across elements is observable, and each can be
 * scrolled "natively" — the value changes without a camera write, as a wheel
 * or a scrollbar would change it.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the camera's decisions: what it writes, in which order, when it
 * writes nothing, and what it forwards to the store. It proves NOTHING about
 * what a browser paints — whether the frame of the input really shows its
 * position, whether the grid and the bars land in one painted frame, how
 * fast any of it is. Only the Planner's real-Chromium measurements and suites
 * can observe that.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DataStore } from '@svar-ui/gantt-store';

import {
  createCameraPath,
  gridBodyTop,
  rowWindowFor,
  ROW_WINDOW_EXTRA_ROWS,
  sameCellWindow,
  sameRowWindow,
} from '../src/components/chart/cameraPath.js';

const CELL_HEIGHT = 36;
const SCALE_HEIGHT = 36;
const CHART_WIDTH = 800;
const CHART_HEIGHT = 400;

/**
 * Upstream's `dataRequest` (`src/components/chart/Chart.jsx` at the fork base
 * `f448c04`, unchanged from upstream 2.7.1), restated verbatim apart from
 * taking its three inputs as arguments. The camera path claims to request
 * exactly this window; this is what that claim is checked against.
 */
function upstreamDataRequest(rScrollTop, chartHeight, cellHeight) {
  const extraRows = 1;
  const clientHeightLocal = chartHeight || 0;
  const num = Math.ceil(clientHeightLocal / (cellHeight || 1)) + 1;
  const pos = Math.floor((rScrollTop || 0) / (cellHeight || 1));
  const start = Math.max(0, pos - extraRows);
  const end = pos + num + extraRows;
  const from = start * (cellHeight || 0);
  return { start, end, from };
}

/** Upstream's body offset (`grid/Grid.jsx` at `f448c04`, SVAR-M6 lane term). */
function upstreamBodyOffset(scrollDelta, scrollTopVal, laneBelowHeader) {
  return (scrollDelta ?? 0) - (scrollTopVal ?? 0) + laneBelowHeader;
}

// ---------------------------------------------------------------------------
// The pure arithmetic
// ---------------------------------------------------------------------------

test('rowWindowFor is upstream dataRequest, over every input shape it meets', () => {
  assert.equal(ROW_WINDOW_EXTRA_ROWS, 1);
  for (const cellHeight of [undefined, 0, 1, 32, 36, 37.5]) {
    for (const height of [undefined, 0, 1, 399, 400, 401, 1079]) {
      for (let top = 0; top <= 4000; top += 13) {
        assert.deepEqual(
          rowWindowFor(top, height, cellHeight),
          upstreamDataRequest(top, height, cellHeight),
          `top=${top} height=${height} cellHeight=${cellHeight}`,
        );
      }
      assert.deepEqual(
        rowWindowFor(undefined, height, cellHeight),
        upstreamDataRequest(undefined, height, cellHeight),
      );
    }
  }
});

test('gridBodyTop is upstream body offset with the committed window as scrollDelta', () => {
  for (const from of [undefined, 0, 36, 684]) {
    for (const top of [undefined, 0, 17, 720]) {
      for (const lane of [0, 24]) {
        assert.equal(
          gridBodyTop(from, top, lane),
          upstreamBodyOffset(from, top, lane),
        );
      }
    }
  }
});

test('sameRowWindow compares the three fields of a row window and nothing else', () => {
  const a = { start: 3, end: 17, from: 108 };
  assert.equal(sameRowWindow(a, { ...a }), true);
  assert.equal(sameRowWindow(a, { ...a, start: 4 }), false);
  assert.equal(sameRowWindow(a, { ...a, end: 18 }), false);
  assert.equal(sameRowWindow(a, { ...a, from: 109 }), false);
  assert.equal(sameRowWindow(a, null), false);
  assert.equal(sameRowWindow(undefined, a), false);
});

test('sameCellWindow treats a rebuilt xArea with the same cells as the same window', () => {
  const a = { start: 10, end: 40, from: 400, to: 1600 };
  assert.equal(sameCellWindow(a, a), true);
  assert.equal(sameCellWindow(a, { ...a }), true);
  for (const key of ['start', 'end', 'from', 'to']) {
    assert.equal(sameCellWindow(a, { ...a, [key]: a[key] + 1 }), false, key);
  }
  assert.equal(sameCellWindow(a, null), false);
  assert.equal(sameCellWindow(null, null), true);
});

// ---------------------------------------------------------------------------
// The controller, against a real store and a faked DOM
// ---------------------------------------------------------------------------

function makeStore(taskCount = 300) {
  const store = new DataStore(null);
  store.init({
    tasks: Array.from({ length: taskCount }, (unused, index) => ({
      id: index + 1,
      text: `task ${index + 1}`,
      start: new Date(2026, 0, 1 + (index % 60)),
      end: new Date(2026, 0, 4 + (index % 60)),
      type: 'task',
    })),
    links: [],
    start: new Date(2026, 0, 1),
    end: new Date(2026, 11, 31),
    scales: [
      { unit: 'month', step: 1, format: '%F' },
      { unit: 'day', step: 1, format: '%d' },
    ],
    columns: [{ id: 'text', header: 'Task' }],
    cellWidth: 40,
    cellHeight: CELL_HEIGHT,
    scaleHeight: SCALE_HEIGHT,
    lengthUnit: 'day',
  });
  return store;
}

/** The component-facing API, with every `exec` the camera makes logged. */
function storeApi(store, log) {
  const exec = store.in.exec.bind(store.in);
  return {
    getState: store.getState.bind(store),
    getReactiveState: store.getReactive.bind(store),
    exec(name, ev) {
      if (name === 'render-data') {
        log.push(`render-data ${ev.start}..${ev.end} from ${ev.from}`);
      } else if (name === 'scroll-chart') {
        log.push(`scroll-chart ${JSON.stringify(ev)}`);
      }
      return exec(name, ev);
    },
  };
}

/**
 * A scrollable element. A camera write is logged and clamped like a browser
 * clamps it; `nativeScroll` moves it the way a wheel or a scrollbar does, with
 * no write logged. Reads of the offsets are counted: the camera must not read
 * layout back on the input path.
 */
function fakeScroller(log, name, max = {}) {
  const maxLeft = max.left ?? Infinity;
  const maxTop = max.top ?? Infinity;
  let left = 0;
  let top = 0;
  const reads = { count: 0 };
  return {
    reads,
    get scrollLeft() {
      reads.count += 1;
      return left;
    },
    set scrollLeft(value) {
      log.push(`${name}.scrollLeft=${value}`);
      left = Math.max(0, Math.min(value, maxLeft));
    },
    get scrollTop() {
      reads.count += 1;
      return top;
    },
    set scrollTop(value) {
      log.push(`${name}.scrollTop=${value}`);
      top = Math.max(0, Math.min(value, maxTop));
    },
    nativeScroll(next) {
      if (next.left !== undefined) left = next.left;
      if (next.top !== undefined) top = next.top;
    },
    peek() {
      return { left, top };
    },
  };
}

/** The grid body: `style.top` can be written, and must never be read back. */
function fakeGridBody(log) {
  let top;
  let writes = 0;
  const style = {};
  Object.defineProperty(style, 'top', {
    get() {
      throw new Error('the camera read the grid body offset back');
    },
    set(value) {
      writes += 1;
      top = value;
      log.push(`grid.top=${value}`);
    },
  });
  return {
    style,
    isConnected: true,
    peekTop: () => top,
    writes: () => writes,
  };
}

/**
 * A camera attached the way the components attach it, in the order React
 * runs their layout effects on mount (children first): the grid body, then
 * `.wx-chart` and its height, then — in `Layout.jsx` — the pseudo-scroller,
 * the committed extent and the subscription.
 */
function mountCamera({
  taskCount = 300,
  lane = 0,
  chartMax,
  outerMax,
  beforeStart,
} = {}) {
  const store = makeStore(taskCount);
  const log = [];
  const api = storeApi(store, log);
  api.exec('resize-chart', { width: CHART_WIDTH, height: CHART_HEIGHT });
  const camera = createCameraPath(api);
  const chart = fakeScroller(log, 'chart', chartMax);
  const outer = fakeScroller(log, 'outer', outerMax);
  const body = fakeGridBody(log);
  const getBody = () => body;
  const grid = { renderedFrom: api.getState().area?.from ?? 0, lane };
  camera.setGrid(getBody, grid.renderedFrom, grid.lane);
  camera.attachChart(chart);
  camera.setViewportHeight(CHART_HEIGHT);
  camera.attachOuter(outer);
  const state = api.getState();
  camera.commitExtent(state._scales, state._tasks, state.cellHeight);
  if (beforeStart) beforeStart(api);
  const stop = camera.start();
  /** The grid's commit of whatever window the store now holds. */
  const commitGrid = () => {
    grid.renderedFrom = api.getState().area.from;
    camera.setGrid(getBody, grid.renderedFrom, grid.lane);
  };
  log.length = 0;
  return {
    store,
    api,
    camera,
    chart,
    outer,
    body,
    getBody,
    log,
    stop,
    commitGrid,
  };
}

test('a Pan step lands in the DOM in the same task as the store write', () => {
  const { api, chart, outer, body } = mountCamera();

  api.exec('scroll-chart', { left: 640, top: 500 });

  // Synchronously — no await, no frame, no React render in between.
  assert.deepEqual(chart.peek(), { left: 640, top: 500 });
  assert.equal(outer.peek().top, 500);
  assert.equal(body.peekTop(), `${gridBodyTop(0, 500, 0)}px`);
});

test('one update runs in the documented order: DOM camera, then the row window', () => {
  const { api, log } = mountCamera();

  api.exec('scroll-chart', { top: 500 });

  const expected = rowWindowFor(500, CHART_HEIGHT, CELL_HEIGHT);
  assert.deepEqual(log, [
    'scroll-chart {"top":500}',
    'chart.scrollTop=500',
    'outer.scrollTop=500',
    `grid.top=${gridBodyTop(0, 500, 0)}px`,
    `render-data ${expected.start}..${expected.end} from ${expected.from}`,
  ]);
  assert.deepEqual(api.getState().area, expected);
});

test('a two-axis step is complete in the DOM when its scroll-chart returns, each axis written once', () => {
  const { api, chart, outer, log } = mountCamera();

  // The store announces `scrollLeft`, then `scrollTop`: two camera calls.
  api.exec('scroll-chart', { left: 320, top: 720 });

  assert.deepEqual(chart.peek(), { left: 320, top: 720 });
  assert.equal(outer.peek().top, 720);
  assert.deepEqual(
    log.filter((entry) => /^(chart|outer)\./.test(entry)),
    ['chart.scrollLeft=320', 'chart.scrollTop=720', 'outer.scrollTop=720'],
  );
});

test('subscriber order: a consumer that hears the store first and moves it again leaves the DOM at the final state', () => {
  for (const consumerFirst of [true, false]) {
    let nudged = false;
    const consumer = (api) =>
      api.getReactiveState().scrollTop.subscribe((top) => {
        if (!nudged && top >= 700) {
          nudged = true;
          api.exec('scroll-chart', { left: 999 });
        }
      });
    const mounted = mountCamera({
      beforeStart: consumerFirst ? consumer : undefined,
    });
    if (!consumerFirst) consumer(mounted.api);

    mounted.api.exec('scroll-chart', { top: 720 });

    assert.equal(nudged, true);
    assert.deepEqual(
      mounted.chart.peek(),
      { left: 999, top: 720 },
      `consumerFirst=${consumerFirst}`,
    );
    assert.equal(mounted.outer.peek().top, 720);
    assert.deepEqual(mounted.camera.getPosition(), { left: 999, top: 720 });
  }
});

test('row-window de-duplication: a step inside the rendered window publishes no render-data', () => {
  const { api, log } = mountCamera();
  api.exec('scroll-chart', { top: 504 }); // row 14
  log.length = 0;

  api.exec('scroll-chart', { top: 505 }); // still row 14
  api.exec('scroll-chart', { top: 539 }); // still row 14 (14 * 36 = 504 .. 539)
  api.exec('scroll-chart', { left: 900 }); // horizontal only

  assert.equal(
    log.filter((entry) => entry.startsWith('render-data')).length,
    0,
    log.join('\n'),
  );

  api.exec('scroll-chart', { top: 540 }); // row 15: a new window
  assert.equal(
    log.filter((entry) => entry.startsWith('render-data')).length,
    1,
  );
});

test('row-window de-duplication compares with the store: an equal window already there is not republished, whoever published it', () => {
  const { api, camera, log } = mountCamera();
  api.exec('scroll-chart', { top: 1000 });
  // The same window as a NEW object, from somewhere else.
  api.exec('render-data', { ...rowWindowFor(1000, CHART_HEIGHT, CELL_HEIGHT) });
  log.length = 0;

  camera.apply();

  assert.deepEqual(log, []);
});

test('a row window replaced behind the camera\u2019s back is requested again on its next application', () => {
  const { api, camera, log } = mountCamera();
  api.exec('scroll-chart', { top: 1000 });
  api.exec('render-data', { start: 0, end: 14, from: 0 });
  log.length = 0;

  camera.apply(); // e.g. from the grid's next commit

  const expected = rowWindowFor(1000, CHART_HEIGHT, CELL_HEIGHT);
  assert.deepEqual(log, [
    `render-data ${expected.start}..${expected.end} from ${expected.from}`,
  ]);
});

test('the grid body follows the window the grid has COMMITTED, never the one just requested (SVAR-M1)', () => {
  const { api, body, commitGrid } = mountCamera();
  api.exec('scroll-chart', { top: 720 });

  // The store already holds the new window; the grid has not rendered it yet.
  // The rows on screen are still the old window's, and they must sit exactly
  // where their bars are: committed `from` (0) minus the position.
  assert.equal(
    api.getState().area.from,
    rowWindowFor(720, CHART_HEIGHT, CELL_HEIGHT).from,
  );
  assert.equal(body.peekTop(), `${gridBodyTop(0, 720, 0)}px`);

  // React commits the new window: the grid reports its `from` from the same
  // commit, and the offset moves with the rows.
  commitGrid();
  assert.equal(
    body.peekTop(),
    `${gridBodyTop(api.getState().area.from, 720, 0)}px`,
  );
});

test('the grid offset carries the lane term below the header (SVAR-M6)', () => {
  const { api, body } = mountCamera({ lane: 24 });
  api.exec('scroll-chart', { top: 100 });
  assert.equal(body.peekTop(), `${gridBodyTop(0, 100, 24)}px`);
});

test('the grid offset is written only when it changes and is never read back', () => {
  const { api, camera, body, getBody } = mountCamera();
  const before = body.writes();

  api.exec('scroll-chart', { left: 1200 }); // horizontal: no vertical change
  camera.setGrid(getBody, 0, 0); // a grid render that changed nothing
  camera.apply();
  assert.equal(body.writes(), before);

  api.exec('scroll-chart', { top: 37 });
  assert.equal(body.writes(), before + 1);
  // The fake throws on any read of `style.top`; reaching here proves none.
});

test('the input path reads no scroll offset back from the DOM', () => {
  const { api, chart, outer } = mountCamera();
  chart.reads.count = 0;
  outer.reads.count = 0;

  for (let step = 1; step <= 50; step += 1) {
    api.exec('scroll-chart', { left: step * 17, top: step * 11 });
  }

  assert.equal(chart.reads.count, 0);
  assert.equal(outer.reads.count, 0);
});

test('a scroll event for the camera’s own write is not echoed back to the store', () => {
  const { api, camera, log } = mountCamera();
  api.exec('scroll-chart', { left: 900, top: 300 });
  log.length = 0;

  // The browser fires `scroll` for those writes a frame later.
  camera.onChartScroll();
  camera.onOuterScroll();

  assert.deepEqual(log, []);
});

test('LATENT TWO-SCROLLER DESYNC: two native scrolls in one task both reach the store and the DOM, in either order', () => {
  for (const order of ['chart-first', 'outer-first']) {
    const { api, camera, chart, outer, body } = mountCamera();
    // A trackpad moves `.wx-chart` horizontally and the pseudo-scroller
    // vertically in the same task. Upstream judged both scroll events
    // against ONE `isUserScrollRef`, so the second axis' store update was
    // never written into the other scroller (research §7.1).
    chart.nativeScroll({ left: 700 });
    outer.nativeScroll({ top: 300 });
    if (order === 'chart-first') {
      camera.onChartScroll();
      camera.onOuterScroll();
    } else {
      camera.onOuterScroll();
      camera.onChartScroll();
    }

    assert.equal(api.getState().scrollLeft, 700, order);
    assert.equal(api.getState().scrollTop, 300, order);
    // The vertical move reached `.wx-chart` and the grid body as well.
    assert.deepEqual(chart.peek(), { left: 700, top: 300 }, order);
    assert.equal(body.peekTop(), `${gridBodyTop(0, 300, 0)}px`, order);
    assert.equal(outer.peek().top, 300, order);
  }
});

test('a browser clamp of a camera write reaches the store once and converges', () => {
  const { api, camera, chart, log } = mountCamera({ chartMax: { left: 4000 } });
  api.exec('scroll-chart', { left: 5000 });
  assert.equal(chart.peek().left, 4000);
  log.length = 0;

  camera.onChartScroll(); // the browser reports the clamped offset

  assert.equal(api.getState().scrollLeft, 4000);
  assert.deepEqual(log, ['scroll-chart {"left":4000}']);
});

test('a native scroll the store clamps is not written back into the scroller that made it; the other targets follow the store', () => {
  // The store clamps `left` to `_scales.width - _chartWidth` and `top` to its
  // own content height minus `_chartHeight`; a client size one pixel smaller
  // than `_chartWidth` leaves the browser one pixel of travel past the
  // store's maximum (measured on the Planner: 3085 vs 3084).
  const { api, camera, chart, outer, body, log } = mountCamera();
  const state = api.getState();
  const maxLeft = state._scales.width - state._chartWidth;
  const maxTop =
    state._scales.height +
    state._tasks.length * state.cellHeight -
    state._chartHeight;
  log.length = 0;

  chart.nativeScroll({ left: maxLeft + 1 });
  camera.onChartScroll();

  assert.equal(api.getState().scrollLeft, maxLeft);
  assert.equal(
    chart.peek().left,
    maxLeft + 1,
    'the originating scroller keeps the browser position',
  );
  assert.equal(
    log.filter((entry) => entry.startsWith('chart.scrollLeft=')).length,
    0,
  );
  assert.deepEqual(camera.getPosition(), { left: maxLeft, top: 0 });

  log.length = 0;
  outer.nativeScroll({ top: maxTop + 3 });
  camera.onOuterScroll();

  assert.equal(api.getState().scrollTop, maxTop);
  assert.equal(
    outer.peek().top,
    maxTop + 3,
    'the originating scroller keeps the browser position',
  );
  assert.equal(
    log.filter((entry) => entry.startsWith('outer.scrollTop=')).length,
    0,
  );
  // ...while the chart and the grid body show what the store accepted.
  assert.equal(chart.peek().top, maxTop);
  assert.equal(body.peekTop(), `${gridBodyTop(0, maxTop, 0)}px`);

  // The next camera write reconciles the originating scrollers.
  api.exec('scroll-chart', { left: maxLeft - 50, top: maxTop - 50 });
  assert.deepEqual(chart.peek(), { left: maxLeft - 50, top: maxTop - 50 });
  assert.equal(outer.peek().top, maxTop - 50);
});

test('committed extent: a write into a scale React has not committed yet waits for that commit (SVAR-M31)', () => {
  const { store, api, camera, chart } = mountCamera();
  api.exec('scroll-chart', { left: 1000 });
  const committedScales = api.getState()._scales;

  // A denser scale: the store already describes the wider chart, React has
  // not rendered it, and the store keeps the centre date with a scroll-chart
  // in the same task.
  store.setState({ cellWidth: 80 });
  assert.notEqual(api.getState()._scales, committedScales);
  api.exec('scroll-chart', { left: 2000 });

  // Written now, it would be clamped by the narrower DOM extent.
  assert.equal(chart.peek().left, 1000);
  assert.deepEqual(camera.getPosition(), { left: 1000, top: 0 });

  const state = api.getState();
  camera.commitExtent(state._scales, state._tasks, state.cellHeight);
  assert.equal(chart.peek().left, 2000);
  assert.deepEqual(camera.getPosition(), { left: 2000, top: 0 });
});

test('re-entrancy: a store change made from inside the camera’s own render-data is applied by the running pass, not by recursion', () => {
  const { api, chart, outer, body } = mountCamera();
  let nested = 0;
  // A consumer that answers a new row window with another scroll — the
  // shape of a reveal that reacts to the rows it can now see.
  const off = api.getReactiveState().area.subscribe((area) => {
    if (nested === 0 && area && area.start > 0) {
      nested += 1;
      api.exec('scroll-chart', { top: 1440 });
    }
  });

  api.exec('scroll-chart', { top: 720 });

  assert.equal(nested, 1);
  assert.deepEqual(chart.peek(), { left: 0, top: 1440 });
  assert.equal(outer.peek().top, 1440);
  assert.equal(body.peekTop(), `${gridBodyTop(0, 1440, 0)}px`);
  assert.deepEqual(
    api.getState().area,
    rowWindowFor(1440, CHART_HEIGHT, CELL_HEIGHT),
  );
  off();
});

test('re-entrancy is bounded: a consumer that keeps moving the store cannot hang the page', () => {
  const { api } = mountCamera();
  let moves = 0;
  const off = api.getReactiveState().area.subscribe((area) => {
    if (area && area.start > 0 && moves < 1000) {
      moves += 1;
      api.exec('scroll-chart', { top: api.getState().scrollTop + 360 });
    }
  });

  api.exec('scroll-chart', { top: 720 });

  // The pass loop stopped long before the consumer would have.
  assert.ok(moves > 0 && moves < 10, `moves=${moves}`);
  off();
});

test('viewport-anchored overlays never hear a position the DOM does not already show; a step that moves nothing is silent', () => {
  const { api, camera, chart } = mountCamera();
  const heard = [];
  const off = camera.subscribePosition(() => {
    heard.push({ position: camera.getPosition(), dom: chart.peek() });
  });

  api.exec('scroll-chart', { left: 410, top: 90 });

  // One call per announced axis, all inside this task (React renders the
  // `useSyncExternalStore` snapshot once, after the task).
  assert.ok(heard.length >= 1 && heard.length <= 2, `heard ${heard.length}`);
  for (const entry of heard) assert.deepEqual(entry.position, entry.dom);
  assert.deepEqual(heard.at(-1).position, { left: 410, top: 90 });

  const count = heard.length;
  const stable = camera.getPosition();
  camera.apply(); // nothing moved
  api.exec('scroll-chart', { left: 410 }); // nothing moved
  assert.equal(heard.length, count);
  // A stable snapshot between moves (useSyncExternalStore compares identity).
  assert.equal(camera.getPosition(), stable);
  off();
});

test('a newly attached .wx-chart receives the current position', () => {
  const { api, camera, log } = mountCamera();
  api.exec('scroll-chart', { left: 1300, top: 250 });
  const replacement = fakeScroller(log, 'chart2');

  camera.attachChart(replacement);

  assert.deepEqual(replacement.peek(), { left: 1300, top: 250 });
});

test('a detached grid body is written no more; a stopped camera writes nothing', () => {
  const { api, camera, chart, body, getBody, stop } = mountCamera();
  camera.detachGrid(getBody);
  const writes = body.writes();
  api.exec('scroll-chart', { top: 400 });
  assert.equal(body.writes(), writes);

  stop();
  api.exec('scroll-chart', { left: 777, top: 800 });
  assert.notEqual(chart.peek().left, 777);
});
