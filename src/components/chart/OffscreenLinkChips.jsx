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
  deriveOffscreenChips,
  layoutChips,
} from '../../planner-router/offscreenChips.js';
import { useRoutedLinks } from './useRoutedLinks.js';
import './OffscreenLinkChips.css';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M35).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The offscreen link partner chip (D-166 §M, TECH_SPEC.md §6.10.1, Phase
 * 4.1C checkpoint C2): a small chip at the point where a link's route leaves
 * the usable chart viewport on its way to a partner task that is
 * horizontally outside it, naming that partner and, on click, revealing it.
 * Presentation only: this component reads the routes `Links.jsx` draws and
 * the store's own scroll/viewport state, and either hands the click to the
 * consumer's `onRevealPartner` (SVAR-M40) or dispatches the store's own
 * existing `scroll-chart` — it creates no link, no task, no history step and
 * reads no `mode`/canonical identity beyond a task's own `id`/`text`.
 *
 * SVAR-M47 (Phase 4.1C R4, product-scale stabilization). The chip is now
 * DERIVED, each render, from three current things and nothing else:
 *
 *   the routed link         the SAME route `Links.jsx` draws, from
 *                           `useRoutedLinks` — obstacles, channels and all
 *   the usable viewport     `[scrollLeft, scrollLeft + _chartWidth]` by
 *                           `[scrollTop, scrollTop + _chartHeight]`, in the
 *                           canvas pixels `$x/$y` are in — never `xArea` or
 *                           `area`, the render windows that are padded past
 *                           the visible band on both axes
 *   the partner's own rect  which decides "horizontally outside"
 *
 * from which `offscreenChips.js` answers, per link and per end, whether
 * that link has a visible run at all and where that run leaves the viewport
 * towards the partner. One chip per (link, offscreen partner) — a fan-out
 * of three gets three, a link crossing the viewport between two offscreen
 * ends gets one at each side — and NO chip for a link with no visible run,
 * however far offscreen its partner is. The four R4 findings this closes
 * are recorded at the top of `offscreenChips.js`.
 *
 * Every chip carries its identity in the DOM (`data-link-id`,
 * `data-partner-id`, `data-local-id`, `data-direction`, `data-exit-edge`,
 * `data-anchor-x/y`) so the product's own evidence suite can build the
 * chip/link table R4 §12 asks for from real rendered geometry, rather than
 * from a second copy of this logic. Nothing here reads them back.
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
function Chip({ chip, basePosition, onReveal }) {
  const { left, top } = basePosition;
  return (
    <button
      type="button"
      className={`wx-4kNpQzTa wx-offscreen-link-chip wx-offscreen-link-chip-${chip.direction} wx-offscreen-link-chip-exit-${chip.exitEdge}`}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${CHIP_SIZE.width}px`,
      }}
      data-link-id={setID(chip.linkId)}
      data-partner-id={setID(chip.partnerId)}
      data-local-id={setID(chip.localId)}
      data-direction={chip.direction}
      data-exit-edge={chip.exitEdge}
      data-anchor-x={chip.anchor[0]}
      data-anchor-y={chip.anchor[1]}
      onClick={() => onReveal(chip)}
      title={chip.partnerName}
    >
      {chip.direction === 'left' ? (
        <span className="wx-4kNpQzTa wx-offscreen-link-chip-arrow">‹</span>
      ) : null}
      <span className="wx-4kNpQzTa wx-offscreen-link-chip-label">
        {chip.partnerName}
      </span>
      {chip.direction === 'right' ? (
        <span className="wx-4kNpQzTa wx-offscreen-link-chip-arrow">›</span>
      ) : null}
    </button>
  );
}

export default function OffscreenLinkChips({ onRevealPartner } = {}) {
  const api = useContext(storeContext);
  // SVAR-M40 (R2-5): `onRevealPartner` is consumed by `onReveal` below.
  const { routedLinks, tasksValue, tasksCounter } = useRoutedLinks();
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

  const chips = useMemo(() => {
    if (!viewport || viewport.bottom <= viewport.top) return [];
    return deriveOffscreenChips(routedLinks, taskById, viewport);
  }, [routedLinks, taskById, viewport]);

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
   * reveal is its — no `scroll-chart` is dispatched here at all, so two
   * owners never answer "where should the chart end up" for one click. The
   * arithmetic below is the fallback for a consumer that supplies none, and
   * since R4 it reveals BOTH axes (R4-5): a chip's partner may be far below
   * or above as well as far to one side, and a horizontal-only fallback left
   * exactly the row the chip named off screen.
   */
  const onReveal = useCallback(
    (chip) => {
      if (onRevealPartner) {
        onRevealPartner(chip.partnerId);
        return;
      }
      const partner = taskById.get(chip.partnerId);
      if (!partner || typeof partner.$x !== 'number' || !viewport) return;
      const viewportWidth = viewport.right - viewport.left;
      if (!(viewportWidth > 0)) return;
      const left =
        chip.direction === 'left'
          ? Math.max(0, partner.$x - CHIP_EDGE_INSET * 4)
          : partner.$x + partner.$w - viewportWidth + CHIP_EDGE_INSET * 4;
      let top = viewport.top;
      const viewportHeight = viewport.bottom - viewport.top;
      if (typeof partner.$y === 'number' && viewportHeight > 0) {
        const rowTop = partner.$y;
        const rowBottom = partner.$y + (partner.$h || 0);
        if (rowTop < viewport.top) top = rowTop;
        else if (rowBottom > viewport.bottom) top = rowBottom - viewportHeight;
      }
      api.exec('scroll-chart', {
        left: Math.max(0, left),
        top: Math.max(0, top),
      });
    },
    [onRevealPartner, taskById, viewport, api],
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
