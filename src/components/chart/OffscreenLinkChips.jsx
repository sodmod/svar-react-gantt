import { useCallback, useContext, useMemo } from 'react';
import storeContext from '../../context';
import { useStore, useStoreWithCounter } from '@svar-ui/lib-react';
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
const EDGE_INSET = 6;

function taskRect(task) {
  return { x: task.$x, y: task.$y, w: task.$w, h: task.$h };
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

  const chips = useMemo(() => {
    if (!xArea || !area || !linksValue) return [];
    // `area.to` is not a field the store publishes; its own row-space end
    // (`area.end`, a row COUNT) must be scaled to pixels the same way
    // Links.jsx's own vertical-viewport check already does.
    const vFrom = area.from ?? 0;
    const vTo = area.to ?? (area.end ?? 0) * (cellHeight || 0);
    const byKey = new Map();

    const consider = (localId, partnerId, linkId) => {
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
        y: taskRect(local).y + taskRect(local).h / 2,
        linkId,
      });
    };

    for (const link of linksValue) {
      consider(link.source, link.target, link.id);
      consider(link.target, link.source, link.id);
    }
    return Array.from(byKey.values());
  }, [linksCounter, taskById, xArea, area, cellHeight]);

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

  if (!chips.length) return null;

  return (
    <>
      {/* SVAR-M35 */}
      {chips.map((chip) => (
        <button
          type="button"
          key={chip.key}
          className={`wx-4kNpQzTa wx-offscreen-link-chip wx-offscreen-link-chip-${chip.direction}`}
          style={{
            top: `${chip.y}px`,
            left:
              chip.direction === 'left'
                ? `${xArea.from + EDGE_INSET}px`
                : `${xArea.to - EDGE_INSET - CHIP_WIDTH}px`,
            width: `${CHIP_WIDTH}px`,
          }}
          onClick={() => onReveal(chip)}
          title={chip.partnerName}
        >
          {chip.direction === 'left' ? (
            <span className="wx-4kNpQzTa wx-offscreen-link-chip-arrow">
              ‹
            </span>
          ) : null}
          <span className="wx-4kNpQzTa wx-offscreen-link-chip-label">
            {chip.partnerName}
          </span>
          {chip.direction === 'right' ? (
            <span className="wx-4kNpQzTa wx-offscreen-link-chip-arrow">
              ›
            </span>
          ) : null}
        </button>
      ))}
    </>
  );
}
