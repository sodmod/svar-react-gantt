import { useCallback, useContext, useMemo, useRef } from 'react';
import storeContext from '../../context';
import { useStore, useStoreWithCounter } from '@svar-ui/lib-react';
import { routeLink, LINK_TOKENS } from '../../planner-router/route.js';
import { clampChipRect } from '../../planner-router/overlayViewport.js';
import { useScreenViewportCorrection } from './useScreenViewportCorrection.js';
import './OffscreenLinkChips.css';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M35).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The offscreen link partner chip (D-166 §M, TECH_SPEC.md §6.10.1, Phase
 * 4.1C checkpoint C2): for a task row that IS in the current vertical
 * viewport, if a link's OTHER endpoint (its "partner") sits outside the
 * current HORIZONTAL viewport, a small chip appears at the corresponding
 * edge of the chart, naming the partner and, on click, scrolling it into
 * view. Presentation only: this component reads task/link pixel geometry
 * (`$x/$y/$w/$h`, `xArea`, `area`) and dispatches the store's own existing
 * `scroll-chart` command (the same one Pan uses) — it creates no link, no
 * task, no history step and reads no `mode`/canonical identity beyond a
 * task's own `id`/`text`.
 *
 * Keyed by `(taskId, direction)`, not by link: several links from the same
 * row pointing off the same edge collapse into ONE chip (the nearest
 * partner, by link id) rather than stacking — counting how many collapsed
 * this way is a collapsed-GROUP concern (checkpoint C3), not this one's.
 */

const CHIP_WIDTH = 168;
// R1-5 (Pavel manual acceptance remediation): matches this file's own
// OffscreenLinkChips.css `height: 22px` — a fixed, known size, so the
// viewport clamp below is exact pure-function geometry, not a post-render
// DOM measurement.
const CHIP_HEIGHT = 22;
const EDGE_INSET = 6;

function taskRect(task) {
  return { x: task.$x, y: task.$y, w: task.$w, h: task.$h };
}

function midY(task) {
  return task.$y + task.$h / 2;
}

/*
 * R1-5 remediation (R2, Pavel's own "он должен быть прямо над связью" —
 * screenshot annotation of the "Chip source"/"Chip target" scenario): the
 * chip's anchor Y was the LOCAL task's own row centre, which is only correct
 * for the 'left'-direction chip (local IS the route's own target there).
 * For a 'right'-direction chip (local IS the route's source, the offscreen
 * partner is its target) the standard/tightEntry route classes in
 * `route.js` jog to the TARGET's row height only `clearance` px past the
 * source's own exit — the long horizontal run that actually crosses the
 * viewport edge sits at the FAR endpoint's row, not the local one's. The
 * only geometry that is correct for every route class (standard, tight
 * entry, reverse bypass) is the real routed polyline itself, so this reads
 * the height the router already committed to at the exact edge X the chip
 * sits at, instead of re-deriving it from a direction-specific rule that
 * does not hold for reverse-time links.
 */
function edgeCrossingY(points, edgeX) {
  let y = null;
  for (let i = 0; i < points.length - 1; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[i + 1];
    if (y1 !== y2) continue; // vertical segment: no single Y at a given X
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    if (edgeX >= lo - 0.5 && edgeX <= hi + 0.5) y = y1;
  }
  return y;
}

/*
 * R1-5's own render, split out so `useScreenViewportCorrection` can own one
 * DOM ref per chip: `basePosition` is the canvas-space placement
 * `clampChipRect` already computed (correct on the axis its own bounds can
 * see); this hook catches the remainder against the chart's REAL rendered
 * edges (the virtualization window `xArea`/`area` cannot see — see that
 * hook's own note).
 */
function Chip({ chip, basePosition, onReveal }) {
  const ref = useRef(null);
  const { left, top } = useScreenViewportCorrection(ref, basePosition, [
    basePosition.left,
    basePosition.top,
  ]);
  return (
    <button
      ref={ref}
      type="button"
      className={`wx-4kNpQzTa wx-offscreen-link-chip wx-offscreen-link-chip-${chip.direction}`}
      style={{
        top: `${top}px`,
        left: `${left}px`,
        width: `${CHIP_WIDTH}px`,
      }}
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

export default function OffscreenLinkChips() {
  const api = useContext(storeContext);
  const [linksValue, linksCounter] = useStoreWithCounter(api, '_links');
  const [tasksValue, tasksCounter] = useStoreWithCounter(api, '_tasks');
  const area = useStore(api, 'area');
  const xArea = useStore(api, 'xArea');
  const scrollTop = useStore(api, 'scrollTop');
  const cellHeight = useStore(api, 'cellHeight');

  const taskById = useMemo(() => {
    const map = new Map();
    for (const task of tasksValue || []) map.set(task.id, task);
    return map;
  }, [tasksCounter]);

  // `area.to` is not a field the store publishes; its own row-space end
  // (`area.end`, a row COUNT) must be scaled to pixels the same way
  // Links.jsx's own vertical-viewport check already does. Read here, not
  // only inside the memo below, because the R1-5 viewport clamp at render
  // time needs the SAME vertical bounds the chip's own visibility check
  // already used.
  const vFrom = area?.from ?? 0;
  const vTo = area?.to ?? (area?.end ?? 0) * (cellHeight || 0);

  const chips = useMemo(() => {
    if (!xArea || !area || !linksValue) return [];
    const byKey = new Map();

    const consider = (localId, partnerId, linkId, route) => {
      const local = taskById.get(localId);
      const partner = taskById.get(partnerId);
      if (!local || typeof local.$y !== 'number') return;
      if (!partner || typeof partner.$x !== 'number') return;
      const rowVisible = local.$y + local.$h >= vFrom && local.$y <= vTo;
      if (!rowVisible) return;
      const offLeft = partner.$x + partner.$w < xArea.from;
      const offRight = partner.$x > xArea.to;
      if (!offLeft && !offRight) return;
      const direction = offLeft ? 'left' : 'right';
      const edgeX = offLeft ? xArea.from : xArea.to;
      // R1-5 R2: the router's own committed height at the edge, falling
      // back to the local row's own centre only when the route geometry
      // genuinely never crosses this edge (defensive — should not happen
      // for a partner this function already proved is offscreen past it).
      const y = (route && edgeCrossingY(route.points, edgeX)) ?? midY(local);
      const key = `${localId}:${direction}`;
      const existing = byKey.get(key);
      // Deterministic: the lowest link id wins, never array/iteration order
      // (same rule D-166 §G already sets for channel assignment).
      if (existing && String(existing.linkId) <= String(linkId)) return;
      byKey.set(key, {
        key,
        partnerTaskId: partnerId,
        direction,
        partnerName: partner.text,
        y,
        linkId,
      });
    };

    for (const link of linksValue) {
      const sourceTask = taskById.get(link.source);
      const targetTask = taskById.get(link.target);
      const route =
        sourceTask &&
        targetTask &&
        typeof sourceTask.$x === 'number' &&
        typeof targetTask.$x === 'number'
          ? routeLink({
              sourceRect: taskRect(sourceTask),
              targetRect: taskRect(targetTask),
              type: link.type,
              rowHeight: cellHeight,
              tokens: LINK_TOKENS,
            })
          : null;
      consider(link.source, link.target, link.id, route);
      consider(link.target, link.source, link.id, route);
    }
    return Array.from(byKey.values());
  }, [linksCounter, taskById, xArea, area, cellHeight, vFrom, vTo]);

  const onReveal = useCallback(
    (chip) => {
      const partner = taskById.get(chip.partnerTaskId);
      if (!partner || typeof partner.$x !== 'number' || !xArea) return;
      const viewportWidth = xArea.to - xArea.from;
      const left =
        chip.direction === 'left'
          ? Math.max(0, partner.$x - EDGE_INSET * 4)
          : partner.$x + partner.$w - viewportWidth + EDGE_INSET * 4;
      api.exec('scroll-chart', { left: Math.max(0, left), top: scrollTop });
    },
    [taskById, xArea, api, scrollTop],
  );

  if (!chips.length || !xArea) return null;

  // R1-5: the chip hangs ABOVE the visible route segment it names by
  // default (flipping below only when the chart viewport genuinely has no
  // room above it), and is clamped so its own edges never cross the
  // viewport's — the "Подсказка за границей.jpg" defect. The viewport this
  // clamps against is expressed in the SAME canvas-pixel space `xArea`/
  // `$x`/`$y` already are (not a real screen `getBoundingClientRect`),
  // which is exact because every size fed into it is a fixed, known
  // constant (`CHIP_WIDTH`/`CHIP_HEIGHT`), not measured content.
  const viewport = { left: xArea.from, top: vFrom, right: xArea.to, bottom: vTo };

  return (
    <>
      {/* SVAR-M35 */}
      {chips.map((chip) => {
        const edgeCenterX =
          chip.direction === 'left'
            ? xArea.from + EDGE_INSET + CHIP_WIDTH / 2
            : xArea.to - EDGE_INSET - CHIP_WIDTH / 2;
        const basePosition = clampChipRect(
          { x: edgeCenterX, y: chip.y },
          { width: CHIP_WIDTH, height: CHIP_HEIGHT },
          viewport,
        );
        return (
          <Chip
            key={chip.key}
            chip={chip}
            basePosition={basePosition}
            onReveal={onReveal}
          />
        );
      })}
    </>
  );
}
