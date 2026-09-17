/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M31).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the chart axis' date <-> pixel projection. Run:
 * `npm run test:planner` (plain `node --test`, no extra dependency).
 *
 * The scale these run against is a REAL one: `DataStore.init` is given the same
 * shape of configuration the Planner gives `<Gantt>`, and the state it builds is
 * what the assertions read. Nothing here mocks a scale, because the thing under
 * test is exactly the relationship between the scale the store draws and the
 * pixels this project converts dates into — a mocked scale would be the
 * module's own assumptions restated.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the projection's two directions are inverses of each other, over the
 * origin the store laid the scale out from, on every start day and density
 * below; and that each of the two origins it replaces really does land days
 * away. It proves NOTHING about what a browser scrolls to: `scroll-chart`
 * clamps, the layout publishes `_chartWidth`, and only the Planner's own
 * real-Chromium suite can observe either.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DataStore, getUnitStart } from '@svar-ui/gantt-store';

import {
  chartPixelForDate,
  chartScrollPuttingDateAtCentre,
  dateAtChartCentre,
  dateAtChartPixel,
  renderedScaleOrigin,
} from '../src/components/chart/chartDateProjection.js';

/** `Месяц`: year over month, so `minUnit` is `month`. */
const MONTH_SCALES = [
  { unit: 'year', step: 1, format: '%Y' },
  { unit: 'month', step: 1, format: '%F' },
];
/** `День`: month over day, so `minUnit` is `day` — where the defect hides. */
const DAY_SCALES = [
  { unit: 'month', step: 1, format: '%F %Y' },
  { unit: 'day', step: 1, format: '%d' },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_WIDTH = 848;

/**
 * A store state built by the store itself, plus the two viewport values the
 * layout publishes into it at runtime.
 *
 * `start` is deliberately a parameter of every test below: the defect this
 * module exists to remove is invisible whenever the project happens to begin on
 * the first day of a `minUnit` cell, which is why it survived a whole phase.
 */
function chartState({ start, scales, cellWidth, scrollLeft = 0 }) {
  const store = new DataStore(null);
  store.init({
    tasks: [
      {
        id: 1,
        text: 'only task',
        start: new Date(2026, 0, 12),
        end: new Date(2026, 0, 20),
        type: 'task',
      },
    ],
    links: [],
    start,
    end: new Date(2026, 6, 31),
    scales,
    cellWidth,
    lengthUnit: 'day',
  });
  return { ...store.getState(), _chartWidth: CHART_WIDTH, scrollLeft };
}

const monthState = (startDay, cellWidth = 120) =>
  chartState({
    start: new Date(2026, 0, startDay),
    scales: MONTH_SCALES,
    cellWidth,
  });

const dayState = (startDay, cellWidth = 34) =>
  chartState({
    start: new Date(2026, 0, startDay),
    scales: DAY_SCALES,
    cellWidth,
  });

/** The raw-`_start` origin this module replaced — negative control one. */
function pixelFromRawStartOrigin(state, date) {
  return Math.round(
    state._scales.diff(date, state._start, 'hour') * state.cellWidth,
  );
}

/** The nominal-month READ quantum it replaced — negative control two. */
function dateFromNominalQuantum(state, x) {
  const scales = state._scales;
  const perHour =
    scales.lengthUnit === 'day'
      ? scales.lengthUnitWidth / 24
      : scales.lengthUnitWidth;
  const hours = Math.floor(x / perHour);
  return new Date(
    renderedScaleOrigin(scales).getTime() + hours * 60 * 60 * 1000,
  );
}

const EVERY_START_DAY = [1, 10, 17, 28];
/** Every day of the fixture's own range, so no single date can be lucky. */
const EVERY_DATE = Array.from(
  { length: 180 },
  (unused, index) => new Date(2026, 0, 1 + index),
);

test('pixel 0 is the start of the minUnit cell, not the configured start', () => {
  const state = monthState(10);

  assert.equal(
    renderedScaleOrigin(state._scales).getTime(),
    new Date(2026, 0, 1).getTime(),
  );
  // And it is the store's own answer rather than a second calculation of it:
  // the pixel -> date helper inside the store measures from exactly this.
  assert.equal(
    renderedScaleOrigin(state._scales).getTime(),
    getUnitStart(
      state._scales.minUnit,
      state._start,
      state._weekStart,
    ).getTime(),
  );
  // The configured start is therefore NOT at x = 0. It is nine days into a
  // 31-day January cell 120 px wide: 9 / 31 * 120, rounded.
  assert.equal(chartPixelForDate(state, state._start), 35);
  assert.equal(pixelFromRawStartOrigin(state, state._start), 0);
});

test('a day-grained scale has the same two origins, which is why this hid', () => {
  const state = dayState(10);

  assert.equal(
    renderedScaleOrigin(state._scales).getTime(),
    state._start.getTime(),
  );
  assert.equal(chartPixelForDate(state, state._start), 0);
  for (const date of EVERY_DATE) {
    assert.equal(
      pixelFromRawStartOrigin(state, date),
      chartPixelForDate(state, date),
      `day scale disagreed on ${date.toDateString()}`,
    );
  }
});

test('the projection is the one the store draws a bar with', () => {
  // The claim the whole module rests on, asked of the store rather than
  // asserted: a task starting on a date is drawn at that date's x.
  for (const startDay of EVERY_START_DAY) {
    const state = monthState(startDay);
    const task = state._tasks[0];
    assert.equal(
      task.$x,
      chartPixelForDate(state, task.start),
      `start day ${startDay}`,
    );
  }
});

test('the two directions are inverses, on every start day and every density', () => {
  let worst = 0;
  for (const startDay of EVERY_START_DAY) {
    for (const cellWidth of [90, 120, 360]) {
      const state = monthState(startDay, cellWidth);
      for (const wanted of EVERY_DATE) {
        const left = chartScrollPuttingDateAtCentre(state, wanted);
        const back = dateAtChartCentre({ ...state, scrollLeft: left });
        const drift = Math.abs(back.getTime() - wanted.getTime()) / DAY_MS;
        if (drift > worst) worst = drift;
        assert.ok(
          drift < 1,
          `start day ${startDay}, ${cellWidth} px: ${wanted.toDateString()} came back as ${back.toDateString()}`,
        );
      }
    }
  }
  // Well inside a day, not merely under it: the residue is the hour the pixel
  // is floored to, and nothing else.
  assert.ok(worst <= 0.5, `worst drift was ${worst} days`);
});

test('a date read at one scale and written at another survives the crossing', () => {
  // D-163 §I is about MODE changes, so the two scales are asked in turn: read
  // the centre at a month grain, put it back at a day grain, read it there.
  for (const startDay of EVERY_START_DAY) {
    const month = monthState(startDay);
    const day = dayState(startDay);
    for (const wanted of EVERY_DATE) {
      const inMonth = dateAtChartCentre({
        ...month,
        scrollLeft: chartScrollPuttingDateAtCentre(month, wanted),
      });
      const inDay = dateAtChartCentre({
        ...day,
        scrollLeft: chartScrollPuttingDateAtCentre(day, inMonth),
      });
      assert.ok(
        Math.abs(inDay.getTime() - wanted.getTime()) / DAY_MS < 1,
        `start day ${startDay}: ${wanted.toDateString()} crossed as ${inDay.toDateString()}`,
      );
    }
  }
});

test('NEGATIVE CONTROL 1: the raw-_start origin moves the chart by the distance to the cell start', () => {
  const state = monthState(10);
  const wanted = new Date(2026, 3, 15);

  const correct = chartPixelForDate(state, wanted);
  const raw = pixelFromRawStartOrigin(state, wanted);
  assert.equal(correct - raw, 35);

  // Read the correct way, written the old way: the date the reader was looking
  // at moves most of a fortnight, once per scale change.
  const landedOn = dateAtChartPixel(state, raw);
  assert.equal(Math.round((wanted.getTime() - landedOn.getTime()) / DAY_MS), 9);
});

test('NEGATIVE CONTROL 2: the nominal-month READ quantum is a day out where the real months are', () => {
  const state = monthState(10);
  const drifts = EVERY_DATE.map((date) => {
    const x = chartPixelForDate(state, date);
    return Math.abs(
      dateFromNominalQuantum(state, x).getTime() - date.getTime(),
    );
  });
  // It agrees on some dates, which is exactly why one fixture date could not
  // have found this, and it is a whole day out on others.
  assert.ok(Math.min(...drifts) === 0);
  assert.ok(
    Math.max(...drifts) >= DAY_MS,
    `the nominal quantum was never a day out: ${Math.max(...drifts) / DAY_MS}`,
  );
});

test('a scale that cannot answer yet says so, and says it the same way both ways', () => {
  const state = monthState(10);

  assert.equal(
    chartPixelForDate({ ...state, _scales: null }, new Date()),
    null,
  );
  assert.equal(chartPixelForDate(state, null), null);
  assert.equal(dateAtChartPixel(state, NaN), null);
  assert.equal(dateAtChartCentre({ ...state, _chartWidth: 0 }), null);
  assert.equal(dateAtChartCentre({ ...state, scrollLeft: NaN }), null);
  assert.equal(
    chartScrollPuttingDateAtCentre({ ...state, _chartWidth: 0 }, new Date()),
    null,
  );
});
