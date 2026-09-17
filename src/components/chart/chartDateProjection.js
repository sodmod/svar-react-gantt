/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M31).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The chart's horizontal axis as a projection: DATE -> x and x -> DATE, in one
 * module, over ONE origin.
 *
 * ## Why the package owns this at all
 *
 * Because nothing outside it can ask the question. `@svar-ui/gantt-store`
 * publishes `_scaleDate` — the date under the scroll position — but computes it
 * from the CLAMPED scroll value, so a consumer can only ever learn the dates of
 * pixels in `[0, scaleWidth - chartWidth]`. The centre of the viewport is at
 * `scrollLeft + chartWidth / 2`, which is past that ceiling for the last half a
 * screen of any timeline and for the WHOLE of a timeline that fits its window —
 * measured on the Planner's own product: at a month scale the entire
 * seven-month plan is 854 px against an 848 px chart, so every pixel a consumer
 * could ask about is the first six.
 *
 * ## The origin, which is the whole reason this is a module
 *
 * Pixel 0 of the chart is NOT the configured `_start`. The store lays the scale
 * out from the beginning of the `minUnit` CELL that contains `_start`, and
 * publishes that date as `_scales.start`; every bar is positioned from it
 * (`diff(task.start, _scales.start, lengthUnit) * cellWidth`), every header cell
 * begins there, and so does every marker. With a `minUnit` of `month` and a
 * project starting on the 10th, `_start` and the rendered origin are nine days
 * apart.
 *
 * The store's own `scroll-chart { date }` measures the requested date from the
 * RAW `_start` while drawing from `_scales.start`, and the first shape of
 * SVAR-M31 copied that asymmetry: it read the centre date from the rendered
 * origin and wrote the new scroll from the raw one. Read and write were
 * therefore not inverses of each other, and every scale change in a
 * month-grained mode moved the chart by the difference — cumulatively, once per
 * change (independent review, Phase 3.8 R2, finding M-1).
 *
 * So the origin is named once, here, and both directions go through it. It is
 * not a calculation and re-derives nothing: `_scales.start` is the value the
 * store itself laid the scale out from.
 *
 * ## What this module is NOT
 *
 * It is not a calendar and holds no calendar rule. `diff` is the scale's own
 * differ — the very function the store's `scroll-chart` applies to a requested
 * date — and `getAdder` is a public export of the same package. Nothing here
 * knows what a date MEANS, what a working day is, or that a consumer has scale
 * modes at all. It is arithmetic over a scale the store has already built.
 *
 * ## The second half of M-1: the store's own READ is not its own DRAWING
 *
 * `_scaleDate` converts a pixel back into a date with `lengthUnitWidth / 24` —
 * `cellWidth` over a NOMINAL thirty-day month — while the store DRAWS every bar
 * at `diff(date, _scales.start, lengthUnit) * cellWidth`, which places a date
 * inside the cell it really falls in. On a day-grained scale the two are the
 * same number. On a month-grained one they part company: measured on a
 * seven-month plan at 120 px a month, 2026-03-03 is drawn at 248 px and read
 * back from 244, and 2026-06-22 at 684 against 688 — a day out in each
 * direction, and a day of it in a mode where a day is four pixels.
 *
 * Correcting only the origin would have left that: a mode change reads the
 * centre date through one of these and writes it through the other. So the
 * projection here has ONE direction — the one the chart is drawn with — and
 * `dateAtChartPixel` is its inverse rather than a second opinion about it.
 *
 * BOUNDARY (project rule D-091 §10.1): the average above is still where the
 * inverse STARTS, so this module follows `lengthUnitWidth` in that sense. What
 * it no longer does is trust it as the answer.
 */
import { getAdder } from '@svar-ui/gantt-store';

/**
 * SVAR-M31: the date at x = 0 of the chart's axis — the start of the `minUnit`
 * cell the scale actually begins with.
 *
 * The ONE answer to "what date is pixel 0", asked by every direction below.
 */
export function renderedScaleOrigin(scales) {
  return scales.start;
}

/**
 * SVAR-M31: THE projection — the x of `date` on the chart's axis.
 *
 * The same expression the store lays every bar out with — `diff` against the
 * scale's own start, times `cellWidth` — with `hour` for its unit so a date
 * inside a cell lands inside that cell rather than on its edge. The store's own
 * `scroll-chart { date }` is this expression with `_start` in place of the
 * rendered origin, and that difference is the whole of finding M-1.
 *
 * `null` when the scale cannot answer yet, so a caller's fallback is the
 * behaviour there was before it asked.
 */
export function chartPixelForDate(state, date) {
  const scales = state._scales;
  if (!scales || !date) return null;
  const x = Math.round(
    scales.diff(date, renderedScaleOrigin(scales), 'hour') * state.cellWidth,
  );
  return Number.isFinite(x) ? x : null;
}

/**
 * The pixels one HOUR of the axis is worth, on average.
 *
 * The store's own estimate, and an estimate is all it is: `lengthUnitWidth` is
 * `cellWidth` over a NOMINAL unit count (a month is thirty days to it), while
 * the projection above places a date inside the cell it really falls in, whose
 * length is the calendar's. On a day-grained scale the two are the same number;
 * on a month-grained one they part company by up to a day over a few months.
 * So this starts the search below and never finishes it.
 */
function pixelsPerHour(scales) {
  return scales.lengthUnit === 'day'
    ? scales.lengthUnitWidth / 24
    : scales.lengthUnitWidth;
}

/**
 * The inverse of `chartPixelForDate`: the date drawn at `x`.
 *
 * ## Why it is a search and not a formula
 *
 * Because the projection is piecewise linear, with a slope that changes at
 * every `minUnit` cell boundary — a month cell is the same width whether the
 * month is 28 days or 31 — and inverting that in closed form would mean
 * re-deriving the lengths of calendar units here. That is exactly the second
 * calendar owner this package must not become, so the inverse ASKS the
 * projection instead: the store's average is the first guess, and each step
 * corrects it by whatever pixels are still unaccounted for.
 *
 * It converges in two steps or so — the guess is never more than a few percent
 * out, which is the widest a calendar month is from a nominal one — and the
 * loop is bounded regardless, because a bounded wrong answer is better than an
 * unbounded right one on a scale nobody has built yet.
 *
 * `Math.floor` throughout, so the answer is the date the pixel is INSIDE,
 * which is also what the store's own `_scaleDate` does with its estimate.
 */
export function dateAtChartPixel(state, x) {
  const scales = state._scales;
  if (!scales || !Number.isFinite(x)) return null;
  const perHour = pixelsPerHour(scales);
  if (!(perHour > 0)) return null;

  const origin = renderedScaleOrigin(scales);
  const addHours = getAdder('hour');
  let hours = Math.floor(x / perHour);
  let date = addHours(origin, hours);

  for (let step = 0; step < 4; step += 1) {
    const at = chartPixelForDate(state, date);
    if (at === null) return null;
    const correction = Math.floor((x - at) / perHour);
    if (correction === 0) break;
    hours += correction;
    date = addHours(origin, hours);
  }
  return date;
}

/** The date under the middle of the chart's own viewport. */
export function dateAtChartCentre(state) {
  const chartWidth = state._chartWidth;
  const scrollLeft = state.scrollLeft;
  if (!state._scales || !chartWidth || !(chartWidth > 0)) return null;
  if (!Number.isFinite(scrollLeft)) return null;
  return dateAtChartPixel(state, scrollLeft + chartWidth / 2);
}

/**
 * The scroll offset that puts `date` back under the middle of the viewport —
 * the inverse of `dateAtChartCentre` over the same origin and the same
 * projection, subject only to the hour the date is floored to and the clamping
 * the store applies to the result.
 */
export function chartScrollPuttingDateAtCentre(state, date) {
  const chartWidth = state._chartWidth;
  if (!state._scales || !chartWidth || !(chartWidth > 0)) return null;
  const x = chartPixelForDate(state, date);
  if (x === null) return null;
  return Math.round(x - chartWidth / 2);
}
