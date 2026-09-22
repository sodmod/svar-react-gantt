import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import storeContext from '../../context';
import { useStore } from '@svar-ui/lib-react';
import { setID } from '@svar-ui/lib-dom';
import {
  clampDelta,
  SCROLLBAR_GUTTER_PX,
} from '../../planner-router/overlayViewport.js';
import {
  CHIP_SIZE,
  CHIP_EDGE_INSET,
  classifyEndpoint,
  deriveEndpointChips,
  layoutChips,
} from '../../planner-router/offscreenChips.js';
import { useCanonicalReveal } from './useCanonicalReveal.js';
import { useRoutedAggregates } from './useRoutedAggregates.js';
import './OffscreenLinkChips.css';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M35).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The offscreen endpoint chip (D-166 §M, TECH_SPEC.md §6.10.1, Phase 4.1C
 * checkpoint C2, R4, R5): a small chip at the point where a presentation
 * route leaves the usable chart viewport on its way to an endpoint that is
 * outside it, naming that endpoint and, on click, revealing it.
 * Presentation only: this component reads the routes `Links.jsx` and
 * `AggregateLinks.jsx` draw and the store's own scroll/viewport state, and
 * either hands the click to the consumer's `onRevealPartner` (SVAR-M40) or
 * dispatches the store's own existing `scroll-chart` — it creates no link,
 * no task, no history step and reads no `mode`/canonical identity beyond a
 * task's own `id`/`text`.
 *
 * SVAR-M47 (Phase 4.1C R4, product-scale stabilization). The chip is
 * DERIVED, each render, from three current things and nothing else:
 *
 *   the presentation routes  the SAME routes `Links.jsx` and
 *                            `AggregateLinks.jsx` draw, from `useRoutedLinks`
 *                            / `useRoutedAggregates` — obstacles, channels,
 *                            ribbon endpoints and all
 *   the usable viewport      `[scrollLeft, scrollLeft + _chartWidth]` by
 *                            `[scrollTop, scrollTop + _chartHeight]`, in the
 *                            canvas pixels `$x/$y` are in — never `xArea` or
 *                            `area`, the render windows that are padded past
 *                            the visible band on both axes
 *   each endpoint's own rect which decides "offscreen", in any direction
 *
 * SVAR-M48 (Phase 4.1C R5): the derivation is ENDPOINT-SYMMETRIC and covers
 * aggregate routes. `offscreenChips.js` answers, per route and per END,
 * whether that route has a meaningful visible run at all and where that run
 * leaves the viewport towards that end. One chip per (route, offscreen
 * endpoint): a route whose two ends are both off screen while its middle is
 * visible gets two, one at each end; a collapsed group's aggregate route
 * gets chips for its presentation endpoints (the representative, the outside
 * task) exactly as a canonical link does; and a route with no visible run
 * gets none, however far its ends are. The R5 findings this closes are
 * recorded at the top of `offscreenChips.js`.
 *
 * SVAR-M49 (Phase 4.1C R6, R6-1): the derivation then MERGES the candidates
 * that name one presentation endpoint into one chip. Several routes to one
 * offscreen task (four links into `Infra migration`, Pavel's screenshot)
 * used to be several identical chips stacked at the edge; now they are one
 * chip, on the representative route's exit, carrying every route and link
 * it stands for and a small count. The click still reveals that one task.
 * The R6 findings are recorded at the top of `offscreenChips.js`.
 *
 * Phase 4.1G R3 removed that merge (SVAR-M52, the retired D-168) and R4 put
 * it back, unchanged, on Pavel's re-confirmation — the history, and why an
 * accepted decision was reversed by mistake, is at the top of
 * `offscreenChips.js`. `data-link-count`, which existed only to carry
 * D-168's replacement count, is gone with it.
 *
 * SVAR-M53 (Phase 4.1G R4): a chip's CLICK resolves the presentation
 * endpoint to the canonical task behind it and opens that task's own
 * collapsed ancestors before landing — see `onReveal` below for the
 * finding and for the one case it deliberately leaves to the product.
 *
 * Every chip carries its provenance in the DOM (`data-route-id`,
 * `data-route-ids`, `data-route-count`, `data-route-kind`,
 * `data-endpoint-role`, `data-endpoint-id`, `data-endpoint-canonical-ids`,
 * `data-link-ids`, plus the R4 names `data-link-id`, `data-partner-id`,
 * `data-local-id`, `data-direction`, `data-exit-edge`, `data-anchor-x/y`) so
 * the product's own evidence suite can build the endpoint/chip table R5 §12
 * asks for from real rendered geometry, rather than from a second copy of
 * this logic. Nothing here reads them back.
 */

/*
 * SVAR-M47 (R4-7): the chip is placed by `layoutChips` alone and carries NO
 * post-layout DOM correction any more.
 *
 * The second, real-screen pass (`useScreenViewportCorrection`, SVAR-M38/M43)
 * existed because the chip's first pass clamped against `xArea`/`area`, the
 * render windows, which are wider and taller than what is visible; it stays
 * exactly as it is for the aggregate popover, whose first pass still is. For
 * the chip the first pass is now the usable viewport on both axes, so there
 * is nothing left for a second pass to see — and on the product-scale stand
 * it was actively harmful. MEASURED: React runs a child's layout effect
 * before its parent's, and `Chart.jsx` is the parent that applies the
 * store's `scrollTop` to the chart's own DOM in ITS layout effect; so on the
 * render caused by a vertical scroll the pass measured the chip against the
 * chart as it was BEFORE the scroll, computed a correction of exactly the
 * scroll delta (-260px for a 260px scroll, -212.5px for the next chip), and
 * kept it — its dependencies were the canvas position, which a scroll does
 * not change — until the chip's own anchor moved. That is a chip that sits
 * a full row-band away from its own route and follows the viewport instead
 * of the line: "Чипса оторвана от связи.jpg" from a second cause.
 *
 * A chip derived purely from current geometry (R4 §10) is placed once, in
 * canvas space, from numbers the store already publishes; the real screen
 * edges are the same numbers by construction (`_chartWidth`/`_chartHeight`
 * are what `Layout.jsx` measures off the real DOM and hands the store).
 */
const ARROWS = Object.freeze({ left: '‹', right: '›', top: '↑', bottom: '↓' });

function Chip({ chip, basePosition, onReveal }) {
  const { left, top } = basePosition;
  const arrow = ARROWS[chip.direction] ?? '›';
  const before = chip.direction === 'left' || chip.direction === 'top';
  /*
   * SVAR-M49 (R6-1): one chip per presentation endpoint. `data-route-id`,
   * `data-endpoint-role`, `data-local-id`, `data-exit-edge` and the anchor
   * are the REPRESENTATIVE route's (the one the chip sits on);
   * `data-route-ids` and `data-link-ids` list every route and canonical
   * link merged into it, and `data-route-count` how many. The count is
   * shown only when it is more than one — a plain chip reads exactly as
   * before.
   *
   * Phase 4.1G R4: `data-link-count`, R3's replacement for
   * `data-route-count` under the retired D-168, is gone with the rest of
   * D-168. It is not kept "as extra evidence": two count attributes on one
   * chip is precisely the ambiguity that let an accepted assertion be
   * re-pointed at a different number without anyone noticing.
   */
  const count = chip.routeCount ?? 1;
  return (
    <button
      type="button"
      className={`wx-4kNpQzTa wx-offscreen-link-chip wx-offscreen-link-chip-${chip.direction} wx-offscreen-link-chip-exit-${chip.exitEdge}`}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${CHIP_SIZE.width}px`,
      }}
      data-chip-id={chip.key}
      data-route-id={setID(chip.routeId)}
      data-route-ids={chip.routes.map((r) => setID(r.routeId)).join(',')}
      data-route-count={count}
      data-route-kind={chip.kind}
      data-endpoint-role={chip.role}
      data-endpoint-id={setID(chip.partnerId)}
      data-link-ids={chip.canonicalLinkIds.map((id) => setID(id)).join(',')}
      /* SVAR-M53 (Phase 4.1G R4): the REAL task(s) behind the presentation
         endpoint, and therefore what a click actually lands on. One id for
         every chip the product has measured; more than one only for a
         collapsed representative that stands for two different hidden
         tasks at once, which is the case the click deliberately does not
         guess at (see `onReveal`). */
      data-endpoint-canonical-ids={chip.partnerCanonicalIds
        .map((id) => setID(id))
        .join(',')}
      data-link-id={setID(chip.routeId)}
      data-partner-id={setID(chip.partnerId)}
      data-local-id={setID(chip.localId)}
      data-direction={chip.direction}
      data-exit-edge={chip.exitEdge}
      data-anchor-x={chip.anchor[0]}
      data-anchor-y={chip.anchor[1]}
      onClick={() => onReveal(chip)}
      title={chip.partnerName}
    >
      {before ? (
        <span className="wx-4kNpQzTa wx-offscreen-link-chip-arrow">
          {arrow}
        </span>
      ) : null}
      <span className="wx-4kNpQzTa wx-offscreen-link-chip-label">
        {chip.partnerName}
      </span>
      {count > 1 ? (
        <span
          className="wx-4kNpQzTa wx-offscreen-link-chip-count"
          title={`${count} links`}
        >
          {count}
        </span>
      ) : null}
      {!before ? (
        <span className="wx-4kNpQzTa wx-offscreen-link-chip-arrow">
          {arrow}
        </span>
      ) : null}
    </button>
  );
}

export default function OffscreenLinkChips({
  onRevealPartner,
  // SVAR-M50 (Pavel manual acceptance, Phase 4.1G R1 second follow-up):
  // threaded straight to `useRoutedAggregates` (see that hook's
  // own comment) so this component groups a collapsed group's crossing
  // links into the SAME aggregates `AggregateLinks.jsx` draws — the two
  // consumers of `useRoutedAggregates` must read identical grouping, since
  // this one's own chip is "the continuation of a route on screen" for the
  // aggregate the other one drew (see this file's own module comment).
  linkPresentation,
} = {}) {
  const api = useContext(storeContext);
  // SVAR-M40 (R2-5): `onRevealPartner` is consumed by `onReveal` below.
  const {
    routedLinks,
    routedAggregates,
    taskRects,
    tasksValue,
    tasksCounter,
    getTask,
  } = useRoutedAggregates(linkPresentation);
  const xArea = useStore(api, 'xArea');
  const scrollTop = useStore(api, 'scrollTop');
  const scrollLeft = useStore(api, 'scrollLeft');
  /*
   * SVAR-M42 (R3-3) / SVAR-M47 (R4-7): the chart's usable size, read from
   * the store and kept CURRENT.
   *
   * `_chartWidth`, `_chartHeight` and `_scrollSize` are ordinary store
   * state, not published reactive values (`useStore` would warn and answer
   * `undefined`). R3 read `_chartWidth` through `getState()` keyed on
   * `xArea`, which the store derives from it, so that read cannot go stale.
   * `_chartHeight` has no such derived value: `area` (the row window
   * `Chart.jsx` requests) only changes when the number of rendered rows
   * does, and a resize by less than a row leaves it as it was — measured on
   * the product stand as a chip clamped 24px short of its run after the
   * window shrank. So all three are mirrored from the one action that
   * writes them, `Layout.jsx`'s own `resize-chart`, seeded from the store
   * on mount; the width keeps its R3 reading as a fallback for the first
   * render.
   *
   * `_chartHeight` is `ganttHeight - scalesHeight`, which still counts the
   * chart's HORIZONTAL scrollbar along its bottom edge; `_scrollSize` is
   * that scrollbar's thickness, the same number Layout already subtracts
   * from `_chartWidth` for the vertical one.
   */
  const [chartSize, setChartSize] = useState(() => {
    const state = api.getState() || {};
    return {
      width: state._chartWidth,
      height: state._chartHeight,
      scrollSize: state._scrollSize,
    };
  });
  useEffect(() => {
    const off = api.on('resize-chart', (ev) => {
      setChartSize((current) =>
        current.width === ev.width &&
        current.height === ev.height &&
        current.scrollSize === ev.scrollSize
          ? current
          : { width: ev.width, height: ev.height, scrollSize: ev.scrollSize },
      );
    });
    return typeof off === 'function' ? off : undefined;
  }, [api]);
  const chartWidth = useMemo(
    () => chartSize.width ?? api.getState()?._chartWidth,
    [api, xArea, scrollLeft, chartSize],
  );
  const chartHeight = chartSize.height;
  const scrollSize = chartSize.scrollSize;

  const taskById = useMemo(() => {
    const map = new Map();
    for (const task of tasksValue || []) map.set(task.id, task);
    return map;
  }, [tasksCounter]);

  /*
   * SVAR-M42 (R3-3) / SVAR-M47 (R4-1, R4-7): THE USABLE viewport, both axes,
   * in the canvas pixel space `$x`/`$y` are in.
   *
   * `xArea` is the store's own horizontal VIRTUALIZATION window — the real
   * viewport snapped out to whole cells and padded by one more on each side
   * (up to 68px past each real edge at the default day cell) — and `area`
   * is its vertical twin, one buffer row past each end of the visible band.
   * Measured against either, a chip could exist for a partner in the dead
   * band just past the edge (R3-3) or be placed in the hidden buffer row
   * above the band and clipped by the chart's own top (R4). `_chartWidth`
   * (`ganttWidth - columnsWidth - scrollSize - 4`, Layout.jsx) and
   * `_chartHeight` are the usable extents by construction: the scrollbar
   * and the resizer are already out of them.
   */
  const viewport = useMemo(() => {
    // SVAR-M42 / SVAR-M47: the usable extents, never the render windows.
    if (!Number.isFinite(scrollLeft) || !(chartWidth > 0)) return null;
    const top = Number.isFinite(scrollTop) ? scrollTop : 0;
    const gutter = scrollSize > 0 ? scrollSize : 0;
    const height = chartHeight > gutter ? chartHeight - gutter : 0;
    return {
      left: scrollLeft,
      right: scrollLeft + chartWidth,
      top,
      bottom: top + height,
    };
  }, [scrollLeft, chartWidth, scrollTop, chartHeight, scrollSize]);

  /*
   * SVAR-M48 (R5 §3.1, §3.4): the PRESENTATION routes, both kinds, in the
   * one shape the derivation reads. A canonical link's endpoints are its
   * two tasks with the renderer's own rectangles; an aggregate's endpoints
   * are its two representatives with the rectangles the aggregate was
   * routed AGAINST (the ribbon-adjusted ones for a container), and it
   * carries every canonical link it stands for. Nothing is routed here.
   */
  const routes = useMemo(() => {
    const nameOf = (id) => taskById.get(id)?.text;
    const out = [];
    for (const { link, route } of routedLinks) {
      const sourceRect = taskRects.get(link.source);
      const targetRect = taskRects.get(link.target);
      if (!sourceRect || !targetRect || !route?.points) continue;
      out.push({
        routeId: link.id,
        kind: 'link',
        points: route.points,
        canonicalLinkIds: [link.id],
        source: {
          id: link.source,
          rect: sourceRect,
          name: nameOf(link.source),
          // SVAR-M53: a canonical link's presentation endpoint IS its task.
          canonicalIds: [link.source],
        },
        target: {
          id: link.target,
          rect: targetRect,
          name: nameOf(link.target),
          canonicalIds: [link.target],
        },
      });
    }
    for (const {
      aggregate,
      route,
      sourceRect,
      targetRect,
    } of routedAggregates) {
      if (!sourceRect || !targetRect || !route?.points) continue;
      out.push({
        routeId: aggregate.id,
        kind: 'aggregate',
        points: route.points,
        canonicalLinkIds: aggregate.memberLinkIds,
        source: {
          id: aggregate.source,
          rect: sourceRect,
          name: nameOf(aggregate.source),
          // SVAR-M53: the real member tasks this representative stands in
          // for, from the module that resolved the representative
          // (`aggregate.js`). For an already-visible side these ARE the
          // representative, so nothing downstream needs to know which side
          // was the collapsed one.
          canonicalIds: aggregate.sourceCanonicalIds,
        },
        target: {
          id: aggregate.target,
          rect: targetRect,
          name: nameOf(aggregate.target),
          canonicalIds: aggregate.targetCanonicalIds,
        },
      });
    }
    return out;
  }, [routedLinks, routedAggregates, taskRects, taskById]);

  const chips = useMemo(() => {
    if (!viewport || viewport.bottom <= viewport.top) return [];
    return deriveEndpointChips(routes, viewport);
  }, [routes, viewport]);

  const positions = useMemo(
    () =>
      viewport
        ? layoutChips(chips, viewport, {
            clampDelta,
            rightGutter: SCROLLBAR_GUTTER_PX,
          })
        : new Map(),
    [chips, viewport],
  );

  /*
   * R2-5 (SVAR-M40): when the consumer supplies `onRevealPartner`, the whole
   * landing is its — no `scroll-chart` is dispatched here at all, so two
   * owners never answer "where should the chart end up" for one click. The
   * arithmetic below is the fallback for a consumer that supplies none, and
   * since R4 it reveals BOTH axes (R4-5); since R5 it lands the endpoint's
   * row in the MIDDLE of the rows band (R5-6), the same policy the Planner
   * asks its own reveal owner for.
   *
   * SVAR-M53 (Phase 4.1G R4): answers `false` when the row is not on the
   * chart yet, which is what lets the ancestor cascade below retry it. The
   * check is `taskRects`, the same render truth `AggregateLinks.jsx`'s own
   * landing uses — a task hidden inside a collapsed ancestor is simply
   * absent from it, so there is no second definition of "hidden" here.
   *
   * The fallback's own horizontal choice now asks `classifyEndpoint` for
   * the task it is landing on, rather than reading the CHIP's `direction`.
   * They are the same answer whenever the chip names the task directly, and
   * for a chip resolved through a collapsed representative the chip's
   * direction describes the REPRESENTATIVE's bar, which is not the bar
   * being scrolled to. One question, asked of the thing it is about.
   */
  const land = useCallback(
    (taskId) => {
      const rect = taskRects.get(taskId);
      if (!rect) return false;
      if (onRevealPartner) {
        onRevealPartner(taskId);
        return true;
      }
      const partner = taskById.get(taskId);
      if (!partner || typeof partner.$x !== 'number' || !viewport) return false;
      const viewportWidth = viewport.right - viewport.left;
      if (!(viewportWidth > 0)) return false;
      const direction = classifyEndpoint(rect, viewport);
      const left =
        direction === 'left'
          ? Math.max(0, partner.$x - CHIP_EDGE_INSET * 4)
          : direction === 'right'
            ? partner.$x + partner.$w - viewportWidth + CHIP_EDGE_INSET * 4
            : viewport.left;
      let top = viewport.top;
      const viewportHeight = viewport.bottom - viewport.top;
      if (typeof partner.$y === 'number' && viewportHeight > 0) {
        const rowHeight = partner.$h || 0;
        top = partner.$y - (viewportHeight - rowHeight) / 2;
      }
      api.exec('scroll-chart', {
        left: Math.max(0, left),
        top: Math.max(0, Math.round(top)),
      });
      return true;
    },
    [onRevealPartner, taskById, taskRects, viewport, api],
  );

  const { openCollapsedAncestors, landOnceVisible } = useCanonicalReveal({
    api,
    getTask,
    taskRects,
    land,
  });

  /*
   * SVAR-M53 (Phase 4.1G R4, Pavel manual acceptance finding B): the chip
   * lands on the TASK IT NAMES, even when that task is inside a collapsed
   * group.
   *
   * Before R4 this handed `chip.partnerId` straight to the consumer's
   * reveal. For an ordinary link that is the task and the behaviour was
   * right; for a collapsed group's aggregate route `partnerId` is the
   * group's visible REPRESENTATIVE, so clicking a chip that is pointing at
   * a hidden task selected the whole group, left it closed, and never
   * selected the task — MEASURED by Pavel on the Phase 4.1G candidate, and
   * true of the accepted Phase 4.1C candidate too: the collapsed-group
   * POPOVER ROW already opened ancestors and landed on the real task
   * (SVAR-M49 R6-4), the chip never did. Pavel decided at R4 that the chip
   * must behave like the row.
   *
   * So: resolve the presentation endpoint to the canonical task behind it
   * (`partnerCanonicalIds`, SVAR-M53), open ONLY that task's own closed
   * ancestors, and land on it — all three through the one owner
   * `useCanonicalReveal.js`, the same one the popover row uses.
   *
   * THE ONE CASE THIS DOES NOT DECIDE. A merged chip whose presentation
   * endpoint hides SEVERAL DIFFERENT canonical tasks (routes into one
   * collapsed group whose members are two different tasks) names one
   * representative and could reasonably mean either of them. There is no
   * accepted product answer for which one a click should pick, and
   * inventing one here would be this renderer deciding a product question.
   * It keeps the accepted behaviour instead — reveal the representative,
   * exactly as before R4 — which is a landing the person can always follow
   * with the group's own popover. `data-endpoint-canonical-ids` makes the
   * case visible from the DOM, so the product can be asked about it rather
   * than guessed at.
   */
  const onReveal = useCallback(
    (chip) => {
      const canonical = chip.partnerCanonicalIds ?? [chip.partnerId];
      const revealId = canonical.length === 1 ? canonical[0] : chip.partnerId;
      const ancestors = openCollapsedAncestors(revealId);
      landOnceVisible(revealId, ancestors.length > 0);
    },
    [openCollapsedAncestors, landOnceVisible],
  );

  if (!chips.length || !viewport) return null;

  return (
    <>
      {/* SVAR-M35 */}
      {chips.map((chip) => (
        <Chip
          key={chip.key}
          chip={chip}
          basePosition={positions.get(chip.key) ?? { left: 0, top: 0 }}
          onReveal={onReveal}
        />
      ))}
    </>
  );
}
