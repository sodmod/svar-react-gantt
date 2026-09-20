import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { useStore } from '@svar-ui/lib-react';
import { setID } from '@svar-ui/lib-dom';
import { assignChannels, buildLink } from '../../planner-router/route.js';
import { buildAggregates } from '../../planner-router/aggregate.js';
import { useRoutedLinks } from './useRoutedLinks.js';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M48).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The ONE place a collapsed group's aggregate becomes a route: the grouping
 * (`aggregate.js`, SVAR-M37), the ribbon read that moves a container
 * endpoint onto the stripe the app actually paints (SVAR-M46), the channel
 * assignment and `buildLink` — exactly as `AggregateLinks.jsx` has built
 * them since Phase 4.1C C3, moved here unchanged so that a second consumer
 * can read the SAME aggregate routes rather than route them a second time.
 *
 * That second consumer is the offscreen endpoint chip (R5-4): a collapsed
 * group's external links are presented by aggregate routes, and a chip is
 * the continuation of a route on screen, so it has to be derived from the
 * route the chart draws and no other (R4 §17). The same split
 * `useRoutedLinks.js` made for canonical links in R4.
 *
 * Both consumers call this hook; each gets its own memo over the same store
 * values, its own ribbon read of the same DOM, and `buildLink` is a pure
 * function of them, so the two answers are identical by construction.
 */

/*
 * A collapsed group's representative endpoint is often a CONTAINER
 * (`task.type === 'summary'`), and a container's own painted body does not
 * fill the box `$x/$y/$w/$h` describes: the consuming product's own CSS
 * (`src/web/index.css`'s container-bar styling, Pavel's manual passes
 * R3-R5) repaints it as a thin ribbon near the bar's BOTTOM edge, not the
 * vendor's plain full-height bar this router otherwise assumes for a leaf.
 * Reading `$x/$y/$w/$h` alone for such an endpoint would exit/enter at the
 * box's own vertical centre — inside the taller, now mostly UNPAINTED box
 * around the ribbon, not on the ribbon itself.
 *
 * This reads the ribbon's geometry from the ACTUAL rendered `::before` —
 * the same CSS the app already painted, never a number copied from it — so
 * the connector lands on whatever stripe is really on screen, and a build
 * with no such override (a bare upstream theme, or a future pass that
 * changes the ribbon's own numbers) is followed exactly, not assumed.
 *
 * Reading it is split from applying it. The router runs inside a render-
 * phase `useMemo`, and on the render that FIRST paints a given bar the
 * `.wx-bar` element this needs does not exist yet — React renders every
 * component before it commits any of their DOM, so a read taken here would
 * see last commit's DOM, which on a first paint is no DOM at all. `bandOf`
 * (below) stays a pure function of already-read data for exactly that
 * reason: the actual `document.querySelector`/`getComputedStyle` calls live
 * in a `useLayoutEffect`, which runs AFTER commit, so the bar is always
 * there by the time it looks; that effect's result is state, and because
 * the phase is the LAYOUT one, React flushes that state before the browser
 * paints, so the correction is never a frame the person can see (SVAR-M46,
 * R3-7).
 */
function bandOf(rect, band) {
  if (!rect || !band) return rect;
  return {
    x: rect.x,
    w: rect.w,
    y: rect.y + rect.h - band.bottom - band.height,
    h: band.height,
  };
}

/*
 * SVAR-M46 (R3-7): the whole of what the layout effect below does, as ONE
 * named call.
 *
 * Hoisted out of the effect body deliberately, and for a reason that is
 * about evidence rather than tidiness. This modification's claim is "the
 * ribbon read happens in the LAYOUT phase", which the provenance manifest
 * checks by reading back which React hook wraps the seam — so the seam has
 * to be the effect's FIRST statement, it has to be unique in the artefact,
 * and it has to carry no whitespace (the production build and the served
 * Vite dev pre-bundle indent the same source differently, so a
 * whitespace-bearing anchor cannot match both — SVAR-M40's own note records
 * the same hazard). An inline body gave a first statement of `const x = new
 * Map();`, which is three other things in this same bundle. One named call
 * is one statement, distinctive, and on one line in both builds.
 *
 * WHEN it runs matters as much as which phase it runs in, and that is the
 * other half of R3-7's "intermittent". The effect below is keyed on
 * `taskRects` and `area` TOGETHER: `taskRects` is the set of tasks that have
 * geometry, but `area` is what decides which of them `Bars.jsx` has actually
 * DRAWN, and this function can only measure a bar that exists. MEASURED: on
 * mount the store's `area` is `{from: 0, start: 0, end: 0}` — zero rows — so
 * the first commit renders no `.wx-bar` at all and this read finds nothing.
 * `area` then gains its real height from the chart's own resize, the bars
 * appear, and `_tasks` may or may not change again depending on what the
 * project contains. Where it did, the band was re-read and the connector
 * landed on the ribbon; where it did not, the band map stayed empty for the
 * rest of the session and every aggregate route left from the container's
 * full-height BOX centre — about 10px above the stripe, permanently, on that
 * load. Two fixtures differing only in their row content disagreed about it,
 * which is exactly what "sometimes it does not line up" looks like from
 * outside ("нестыкуется.jpg").
 */
function applyVisualBands(taskRects, setBandInfo) {
  const next = new Map();
  for (const id of taskRects.keys()) {
    const band = readVisualBand(id);
    if (band) next.set(id, band);
  }
  setBandInfo((current) => (sameBands(current, next) ? current : next));
}

/*
 * SVAR-M46 (R3-7): two band maps hold the same answer. The read above runs
 * in a layout effect whose own state write would otherwise re-render on
 * every commit that touches `_tasks` — including the ones where nothing
 * about any ribbon moved — and each such render re-runs the router for
 * every aggregate. Comparing first keeps the identity stable, so the memo
 * below is not invalidated by a measurement that found no change.
 */
function sameBands(a, b) {
  if (a.size !== b.size) return false;
  for (const [id, band] of b) {
    const previous = a.get(id);
    if (
      !previous ||
      previous.bottom !== band.bottom ||
      previous.height !== band.height
    ) {
      return false;
    }
  }
  return true;
}

function readVisualBand(taskId) {
  if (typeof document === 'undefined') return null;
  const el = document.querySelector(`.wx-bar[data-id='${setID(taskId)}']`);
  if (!el) return null;
  // No class check here: `content: none` already answers "does this bar's
  // own `::before` paint anything at all", which is the only question this
  // needs asked — a leaf bar declares no such rule and reads `none` here.
  const before = getComputedStyle(el, '::before');
  if (before.content === 'none') return null;
  const bottom = parseFloat(before.bottom);
  const height = parseFloat(before.height);
  if (!Number.isFinite(bottom) || !Number.isFinite(height) || height <= 0) {
    return null;
  }
  return { bottom, height };
}

export function useRoutedAggregates() {
  const routed = useRoutedLinks();
  const { api, taskRects, linksValue, linksCounter, cellHeight } = routed;
  const getTask = useCallback((id) => api.getTask(id), [api]);
  const area = useStore(api, 'area');

  const [bandInfo, setBandInfo] = useState(new Map());

  /*
   * SVAR-M46 (R3-7, Pavel manual acceptance remediation — "нестыкуется.jpg",
   * reported as intermittent): `useLayoutEffect`, not `useEffect`.
   *
   * Both run AFTER commit, which is the whole reason the read lives outside
   * the render-phase memo (see `bandOf` above — the `.wx-bar` this queries
   * does not exist yet during the render that first paints it). The
   * difference is WHEN the state they set is flushed. A `useEffect` write
   * is flushed after the browser has already painted, so the frame between
   * commit and correction is a real, visible frame in which every aggregate
   * route is anchored to the container's own BOX centre instead of the
   * ribbon `::before` actually paints — the endpoint sitting ~15px above
   * the stripe it should touch, for exactly one frame, on every transition
   * that adds or re-measures a bar (collapse, expand, re-collapse, a scale
   * change). `useLayoutEffect` is flushed synchronously BEFORE paint, so
   * the corrected geometry is in the very first frame the person sees and
   * there is no wrong frame to catch.
   *
   * This is not a timing hack and adds no delay, retry or measurement loop:
   * it is the same single read, committed one phase earlier, which is the
   * phase React provides for a layout measurement that the paint depends
   * on. `cellHeight` joins the dependencies because a row-height change
   * moves the ribbon without necessarily changing `_tasks`.
   */
  useLayoutEffect(() => {
    applyVisualBands(taskRects, setBandInfo);
    // `area` is what decides WHICH bars are currently rendered — `Bars.jsx`
    // draws the vertically virtualized slice it describes — so it is a real
    // dependency of a measurement taken off those bars, not a proxy for one.
  }, [taskRects, cellHeight, area]);

  const aggregates = useMemo(() => {
    if (!linksValue) return [];
    return buildAggregates(
      linksValue,
      getTask,
      new Set(taskRects.keys()),
    ).filter(
      (aggregate) =>
        taskRects.has(aggregate.source) && taskRects.has(aggregate.target),
    );
  }, [linksCounter, getTask, taskRects]);

  const routedAggregates = useMemo(() => {
    const obstacles = Array.from(taskRects.values());
    const channelOf = assignChannels(
      aggregates.map((aggregate) => ({
        id: aggregate.id,
        sourceId: aggregate.source,
        sourceSide: 'end',
        targetId: aggregate.target,
        targetSide: 'start',
      })),
    );
    return aggregates.map((aggregate) => {
      const rawSourceRect = taskRects.get(aggregate.source);
      const rawTargetRect = taskRects.get(aggregate.target);
      const sourceRect = bandOf(rawSourceRect, bandInfo.get(aggregate.source));
      const targetRect = bandOf(rawTargetRect, bandInfo.get(aggregate.target));
      const route = buildLink({
        sourceRect,
        targetRect,
        type: 'e2s',
        channelOffset: channelOf.get(aggregate.id) ?? 0,
        obstacles: obstacles.filter(
          (rect) => rect !== rawSourceRect && rect !== rawTargetRect,
        ),
        rowHeight: cellHeight,
      });
      // SVAR-M48: the rectangles the route was built AGAINST travel with
      // it, so the chip decides an endpoint's visibility from the same
      // geometry the line is drawn to.
      return { aggregate, route, sourceRect, targetRect, badgeAnchor: null };
    });
  }, [aggregates, taskRects, cellHeight, bandInfo]);

  return { ...routed, getTask, area, bandInfo, aggregates, routedAggregates };
}
