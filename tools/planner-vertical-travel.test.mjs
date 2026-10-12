/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M60).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the chart's vertical travel. Run: `npm run test:planner`
 * (plain `node --test`, no extra dependency).
 *
 * The store these run against is a REAL one: `DataStore.init` builds the rows
 * and the scale, `resize-chart` publishes the rows band exactly as `Layout.jsx`
 * does, and `scroll-chart` goes through the store's own handler, with the
 * module wired in front of it by an interceptor exactly as `Gantt.jsx` wires
 * it. Nothing here mocks the store's clamp: the thing under test is the gap
 * between that clamp and the travel the chart can show.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the store alone accepts a position past the last row, by its own scale
 * height, and that the interceptor holds every request to the travel. It
 * proves NOTHING about what a browser draws: that the two halves of the split
 * surface then stay on one line is the Planner's real-Chromium suite
 * (`e2e/phase-6-cp7-f1-row-geometry.spec.ts`, `e2e/server/cp7-f1-*`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DataStore } from '@svar-ui/gantt-store';

import {
  chartVerticalTravel,
  clampChartTop,
} from '../src/components/chart/verticalTravel.js';

const DAY_SCALES = [
  { unit: 'month', step: 1, format: '%F %Y' },
  { unit: 'day', step: 1, format: '%d' },
];
const CELL_HEIGHT = 48;
const ROWS = 504;
/** The Planner's rows band in День at 1440x900 (measured, CP-7 F1). */
const BAND = 764;

function store({ rows = ROWS, intercept = true } = {}) {
  const s = new DataStore(null);
  const tasks = Array.from({ length: rows }, (_, index) => ({
    id: index + 1,
    text: `row ${index + 1}`,
    start: new Date(2026, 0, 12),
    end: new Date(2026, 0, 20),
    type: 'task',
  }));
  s.init({
    tasks,
    links: [],
    start: new Date(2026, 0, 1),
    end: new Date(2026, 6, 31),
    scales: DAY_SCALES,
    cellWidth: 34,
    cellHeight: CELL_HEIGHT,
    // The Planner's own scale row height; the store's header is two of them.
    scaleHeight: 36,
    // Set by the zoom normalisation in Gantt.jsx; the header's row count.
    _headerLength: DAY_SCALES.length,
    lengthUnit: 'day',
  });
  if (intercept) {
    // Exactly the Gantt.jsx wiring.
    s.in.intercept('scroll-chart', (ev) => {
      if (!ev || typeof ev.top !== 'number') return;
      ev.top = clampChartTop(s.getState(), ev.top);
    });
  }
  return s;
}

function publishBand(s, height, scrollSize = 0) {
  s.in.exec('resize-chart', { width: 848, height, scrollSize });
}

test('negative control: the store alone accepts a position one scale header past the last row', () => {
  const s = store({ intercept: false });
  publishBand(s, BAND);
  s.in.exec('scroll-chart', { top: 1e9 });
  const { scrollTop, _scales } = s.getState();
  assert.ok(_scales.height > 0, 'the scale has a height');
  assert.equal(scrollTop, ROWS * CELL_HEIGHT - BAND + _scales.height);
  assert.ok(
    scrollTop > chartVerticalTravel(s.getState()),
    'past the travel the chart can show',
  );
});

test('the travel is the rows less the rows band', () => {
  const s = store();
  publishBand(s, BAND);
  assert.equal(chartVerticalTravel(s.getState()), ROWS * CELL_HEIGHT - BAND);
});

test('the travel includes the room reserved for a horizontal scrollbar', () => {
  const s = store();
  publishBand(s, BAND, 15);
  assert.equal(
    chartVerticalTravel(s.getState()),
    ROWS * CELL_HEIGHT - BAND + 15,
  );
});

test('a request past the end lands on the travel, never past it', () => {
  const s = store();
  publishBand(s, BAND);
  const travel = ROWS * CELL_HEIGHT - BAND;
  for (const asked of [
    travel + 1,
    travel + 11,
    travel + 36,
    travel + 500,
    1e9,
  ]) {
    s.in.exec('scroll-chart', { top: asked });
    assert.equal(s.getState().scrollTop, travel, `asked ${asked}`);
  }
});

test('a request inside the travel is untouched, both ends included', () => {
  const s = store();
  publishBand(s, BAND);
  const travel = ROWS * CELL_HEIGHT - BAND;
  for (const asked of [0, 1, 4800, travel - 1, travel]) {
    s.in.exec('scroll-chart', { top: asked });
    assert.equal(s.getState().scrollTop, asked, `asked ${asked}`);
  }
  s.in.exec('scroll-chart', { top: -20 });
  assert.equal(s.getState().scrollTop, 0);
});

test('a taller band (a shorter header) shortens the travel by the same amount', () => {
  const s = store();
  publishBand(s, BAND);
  publishBand(s, BAND + 36);
  s.in.exec('scroll-chart', { top: 1e9 });
  assert.equal(s.getState().scrollTop, ROWS * CELL_HEIGHT - BAND - 36);
});

test('fewer rows than the band: there is no travel at all', () => {
  const s = store({ rows: 10 });
  publishBand(s, BAND);
  assert.equal(chartVerticalTravel(s.getState()), 0);
  s.in.exec('scroll-chart', { top: 200 });
  assert.equal(s.getState().scrollTop, 0);
});

test('the horizontal axis is not touched', () => {
  const s = store();
  publishBand(s, BAND);
  s.in.exec('scroll-chart', { left: 340 });
  assert.equal(s.getState().scrollLeft, 340);
  s.in.exec('scroll-chart', { left: 120, top: 1e9 });
  assert.equal(s.getState().scrollLeft, 120);
  assert.equal(s.getState().scrollTop, ROWS * CELL_HEIGHT - BAND);
});

test('before the layout publishes a band the request is left alone', () => {
  const s = store();
  assert.equal(chartVerticalTravel(s.getState()), null);
  assert.equal(clampChartTop(s.getState(), 1e9), 1e9);
  assert.equal(clampChartTop(null, 25), 25);
  assert.equal(clampChartTop({ _chartHeight: BAND }, 25), 25);
});

test('a request with no numeric top is returned as it came', () => {
  const s = store();
  publishBand(s, BAND);
  assert.equal(clampChartTop(s.getState(), undefined), undefined);
  assert.ok(Number.isNaN(clampChartTop(s.getState(), NaN)));
});
