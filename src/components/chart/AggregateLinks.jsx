import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import storeContext from '../../context';
import { useStore, useStoreWithCounter } from '@svar-ui/lib-react';
import { setID } from '@svar-ui/lib-dom';
import {
  assignChannels,
  buildLink,
  LINK_TOKENS,
} from '../../planner-router/route.js';
import { clampPopoverRect } from '../../planner-router/overlayViewport.js';
import { useScreenViewportCorrection } from './useScreenViewportCorrection.js';
import {
  buildAggregates,
  pickBadgeAnchor,
  collapsedAncestorsToOpen,
} from '../../planner-router/aggregate.js';
import './AggregateLinks.css';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M37).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Collapsed-group link aggregation, presentation-only (project DECISIONS.md
 * D-166 §K/§L, TECH_SPEC.md §6.10.1, Phase 4.1C checkpoint C3). The pure
 * grouping/geometry lives in `src/planner-router/aggregate.js`; this
 * component only wires it to the real store and draws it — same split
 * `Links.jsx`/`route.js` already use.
 *
 * Deliberately reads `_links`/`_tasks` and `api.getTask` itself, exactly as
 * `Links.jsx` and SVAR-M10's own ancestor-bar geometry already do: nothing
 * here needs a new prop from the consumer, because a hidden task's
 * ancestor chain is already fully readable through the store's own public
 * `getTask`. It also never stores an aggregate as an `ITask`/`TaskLink` of
 * its own — clicking a badge only ever calls the store's existing
 * `open-task`/`scroll-chart` commands and the SAME `onSelectLink` callback
 * `Links.jsx` already uses, the exact seams Pan and the offscreen chip
 * (SVAR-M35) already use for their own, unrelated presentation state.
 */

const DEFAULT_PRESENTATION = { lineStyle: 'solid', arrowhead: true };
const BADGE_SIZE = 18;
// R1-6: a generous guess for the ONE render before the popover's own real
// size is measured (a title row plus a couple of link rows) — never the
// value the clamp below actually trusts once `popoverSize` is set.
const POPOVER_FALLBACK_SIZE = { width: 220, height: 70 };

function rectOf(task) {
  return { x: task.$x, y: task.$y, w: task.$w, h: task.$h };
}

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
 * in a `useEffect`, which runs AFTER commit, so the bar is always there by
 * the time it looks; that effect's result is state, so its one necessarily
 * late correction is a normal extra render, not a permanent fallback.
 */
function bandOf(rect, band) {
  if (!rect || !band) return rect;
  return { x: rect.x, w: rect.w, y: rect.y + rect.h - band.bottom - band.height, h: band.height };
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

export default function AggregateLinks({
  onSelectLink,
  selectedLink,
  readonly,
  linkPresentation,
}) {
  const api = useContext(storeContext);
  const getTask = useCallback((id) => api.getTask(id), [api]);
  const [linksValue, linksCounter] = useStoreWithCounter(api, '_links');
  const [tasksValue, tasksCounter] = useStoreWithCounter(api, '_tasks');
  const cellHeight = useStore(api, 'cellHeight');
  const area = useStore(api, 'area');
  const xArea = useStore(api, 'xArea');
  const scrollTop = useStore(api, 'scrollTop');

  const [openAggregateId, setOpenAggregateId] = useState(null);
  const pendingRevealRef = useRef(null);
  const popoverRef = useRef(null);
  // R1-6: the popover's real rendered size, measured after it (re)paints —
  // its row count and task-name lengths make it genuinely variable, unlike
  // the offscreen chip's own fixed size, so an arithmetic estimate would be
  // guessing rather than measuring. `null` on the very render that first
  // opens it; the clamp below falls back to a generous guess for that one
  // frame, then snaps to the exact measured size.
  const [popoverSize, setPopoverSize] = useState(null);

  const taskRects = useMemo(() => {
    const map = new Map();
    for (const task of tasksValue || []) {
      if (typeof task.$x === 'number') map.set(task.id, rectOf(task));
    }
    return map;
  }, [tasksCounter]);

  const [bandInfo, setBandInfo] = useState(new Map());

  useEffect(() => {
    const next = new Map();
    for (const id of taskRects.keys()) {
      const band = readVisualBand(id);
      if (band) next.set(id, band);
    }
    setBandInfo(next);
  }, [taskRects]);

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
      return { aggregate, route, badgeAnchor: null };
    });
  }, [aggregates, taskRects, cellHeight, bandInfo]);

  // R1-6 (Pavel manual acceptance remediation): pulled to component scope,
  // not only the memo below, so the popover's own viewport clamp reads the
  // SAME vertical bounds this aggregate's own visibility check already used.
  const vFrom = area?.from ?? 0;
  const vTo = area?.to ?? (area?.end ?? 0) * (cellHeight || 0);

  const visibleRoutedAggregates = useMemo(() => {
    if (!xArea) return [];
    return routedAggregates
      .filter(({ route }) => {
        const { bbox } = route;
        return (
          bbox.x2 >= xArea.from &&
          bbox.x1 <= xArea.to &&
          bbox.y2 >= vFrom &&
          bbox.y1 <= vTo
        );
      })
      .map((entry) => ({
        ...entry,
        badgeAnchor: pickBadgeAnchor(entry.route.points, xArea),
      }));
  }, [routedAggregates, xArea, area, cellHeight]);

  const presentationOf = useCallback(
    (aggregate) => {
      if (!linkPresentation) return DEFAULT_PRESENTATION;
      // The app's own callback resolves presentation by a REAL link id
      // (its closed mode -> {lineStyle, arrowhead} dictionary is keyed off
      // canonical `TaskLink`s, never a synthetic aggregate id). Every member
      // of one aggregate shares the same mode by construction (`aggregate.js`
      // groups by mode), so any one member's real id resolves the same
      // presentation the whole group is entitled to.
      const resolved = linkPresentation({
        id: aggregate.memberLinkIds[0],
        source: aggregate.source,
        target: aggregate.target,
        type: 'e2s',
      });
      return resolved || DEFAULT_PRESENTATION;
    },
    [linkPresentation],
  );

  const linkById = useMemo(() => {
    const map = new Map();
    for (const link of linksValue || []) map.set(String(link.id), link);
    return map;
  }, [linksValue]);

  const openAggregate = openAggregateId
    ? visibleRoutedAggregates.find(
        (entry) => entry.aggregate.id === openAggregateId,
      )
    : null;

  // R1-6 (Pavel manual acceptance remediation): `basePosition` is the
  // canvas-space placement `clampPopoverRect` computes from `xArea`/`area`
  // — correct on the axis those virtualization bounds can see. Hooks must
  // run unconditionally, so this is computed (and the correction hook
  // called) whether or not a popover is actually open; when it is not,
  // `popoverRef.current` is null and the hook is a no-op.
  const popoverBasePosition = openAggregate
    ? clampPopoverRect(
        {
          x: openAggregate.badgeAnchor[0],
          y: openAggregate.badgeAnchor[1] + BADGE_SIZE / 2,
        },
        popoverSize ?? POPOVER_FALLBACK_SIZE,
        {
          left: xArea?.from ?? 0,
          top: vFrom,
          right: xArea?.to ?? 0,
          bottom: vTo,
        },
      )
    : { left: 0, top: 0 };
  const popoverPosition = useScreenViewportCorrection(
    popoverRef,
    popoverBasePosition,
    [popoverBasePosition.left, popoverBasePosition.top, popoverSize],
  );

  const revealNow = useCallback(
    (taskId, linkId) => {
      const rect = taskRects.get(taskId);
      if (!rect || !xArea) return false;
      const viewportWidth = xArea.to - xArea.from;
      const left = Math.max(0, rect.x + rect.w / 2 - viewportWidth / 2);
      api.exec('scroll-chart', { left, top: scrollTop });
      if (!readonly) onSelectLink(linkId);
      return true;
    },
    [taskRects, xArea, api, scrollTop, readonly, onSelectLink],
  );

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    if (revealNow(pending.taskId, pending.linkId)) {
      pendingRevealRef.current = null;
      setOpenAggregateId(null);
    }
  }, [taskRects, revealNow]);

  const onRevealMember = useCallback(
    (link) => {
      const sourceAncestors = collapsedAncestorsToOpen(link.source, getTask);
      const targetAncestors = collapsedAncestorsToOpen(link.target, getTask);
      for (const id of sourceAncestors) {
        api.exec('open-task', { id, mode: true });
      }
      for (const id of targetAncestors) {
        api.exec('open-task', { id, mode: true });
      }
      if (sourceAncestors.length === 0 && targetAncestors.length === 0) {
        if (revealNow(link.target, link.id)) setOpenAggregateId(null);
      } else {
        pendingRevealRef.current = { taskId: link.target, linkId: link.id };
      }
    },
    [api, getTask, revealNow],
  );

  useLayoutEffect(() => {
    if (!openAggregateId) {
      setPopoverSize(null);
      return;
    }
    const el = popoverRef.current;
    if (!el) return;
    setPopoverSize({ width: el.offsetWidth, height: el.offsetHeight });
    // Re-measures whenever the open aggregate or its own member count
    // changes the popover's content, not on every unrelated re-render.
  }, [openAggregateId, openAggregate?.aggregate.count]);

  useEffect(() => {
    if (!openAggregateId) return;
    const handler = (event) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target)) {
        setOpenAggregateId(null);
      }
    };
    document.addEventListener('click', handler);
    return () => {
      document.removeEventListener('click', handler);
    };
  }, [openAggregateId]);

  // D-166 §K: the badge itself is shown only when there is more than one
  // hidden link to count — a single hidden link still gets its own aggregate
  // line (and, via the line's own onClick below, its own popover), just no
  // badge to read a count off of.
  const badged = visibleRoutedAggregates.filter(
    (entry) => entry.badgeAnchor && entry.aggregate.count > 1,
  );

  if (!visibleRoutedAggregates.length) return null;

  return (
    <>
      <svg
        className="wx-4kNpQzTa wx-aggregate-links"
        style={{ '--wx-gantt-link-stroke-width': `${LINK_TOKENS.stroke}px` }}
      >
        {visibleRoutedAggregates.map(({ aggregate, route }) => {
          const presentation = presentationOf(aggregate);
          const dashClass =
            presentation.lineStyle && presentation.lineStyle !== 'solid'
              ? ` wx-line-${presentation.lineStyle}`
              : '';
          // R1-10: the same visual "this is the selected link" cue
          // `Links.jsx` gives a normal line, for the one aggregate shape
          // that IS a normal link underneath (`count === 1`).
          const soloSelected =
            aggregate.count === 1 &&
            selectedLink?.id === aggregate.memberLinkIds[0];
          return (
            <g
              className={`wx-4kNpQzTa wx-line wx-aggregate-line${dashClass}${soloSelected ? ' wx-aggregate-line-selected' : ''}`}
              key={aggregate.id}
              data-aggregate-id={setID(aggregate.id)}
              data-route-class={route.routeClass}
              data-aggregate-count={aggregate.count}
              onClick={(event) => {
                event.stopPropagation();
                /*
                 * R1-10 (Pavel manual acceptance remediation): a `count === 1`
                 * aggregate presents exactly one real `TaskLink` — the SAME
                 * relationship a plain `Links.jsx` line represents when
                 * neither endpoint is hidden. It gets the SAME click
                 * behaviour a normal line already has (`onSelectLink`
                 * straight away, D-166 §K's canonical identity is never
                 * synthetic here), not the popover a real aggregate (more
                 * than one hidden link) still needs.
                 */
                if (aggregate.count === 1) {
                  if (!readonly) onSelectLink(aggregate.memberLinkIds[0]);
                  return;
                }
                setOpenAggregateId((current) =>
                  current === aggregate.id ? null : aggregate.id,
                );
              }}
            >
              <path className="wx-4kNpQzTa wx-line-draw" d={route.d} />
              <path className="wx-4kNpQzTa wx-line-hitbox" d={route.d} />
              {presentation.arrowhead !== false ? (
                <polygon
                  className="wx-4kNpQzTa wx-line-arrow"
                  points={route.arrow}
                />
              ) : null}
            </g>
          );
        })}
      </svg>
      {/* SVAR-M37 */}
      {badged.map(({ aggregate, badgeAnchor }) => {
        const partnerNames = aggregate.memberLinkIds
          .map((id) => linkById.get(String(id)))
          .filter(Boolean)
          .map((link) => {
            const sourceHidden = link.source !== aggregate.source;
            const otherId = sourceHidden ? link.source : link.target;
            const other = getTask(otherId);
            return other?.text ?? String(otherId);
          });
        return (
          <button
            type="button"
            key={`badge:${aggregate.id}`}
            className="wx-4kNpQzTa wx-aggregate-badge"
            data-aggregate-badge={setID(aggregate.id)}
            style={{
              left: `${badgeAnchor[0] - BADGE_SIZE / 2}px`,
              top: `${badgeAnchor[1] - BADGE_SIZE / 2}px`,
              width: `${BADGE_SIZE}px`,
              height: `${BADGE_SIZE}px`,
            }}
            title={`${aggregate.count} hidden ${aggregate.mode} link${aggregate.count > 1 ? 's' : ''}: ${partnerNames.join(', ')}`}
            onClick={(event) => {
              event.stopPropagation();
              setOpenAggregateId((current) =>
                current === aggregate.id ? null : aggregate.id,
              );
            }}
          >
            {aggregate.count}
          </button>
        );
      })}
      {/*
       * R1-10 (Pavel manual acceptance remediation): the normal delete
       * affordance for a selected link lives on the TARGET task's own bar
       * edge (`Bars.jsx`), which does not exist while that endpoint is
       * hidden inside a collapsed group — exactly the gap Pavel found.
       * `count === 1` is the one aggregate shape with a real canonical link
       * to delete (never "delete the aggregate", D-166 §K — `count > 1`
       * gets none of this, only the existing popover's own per-row reveal).
       *
       * This calls `delete-link` itself rather than piggybacking on
       * `Bars.jsx`'s delegated click handler: reaching that handler needs a
       * `data-id` `locateID` can resolve, and giving this button one carrying
       * a LINK id broke a DIFFERENT consumer of that same default attribute
       * — `Bars.jsx`'s own hover/edge-detection reads it back through
       * `getTask`, which a link id does not resolve to, and crashed
       * (measured directly: hovering this button before the click). No
       * `data-id` here at all avoids both, and the `api` this component
       * already holds for `scroll-chart`/`open-task` is the same store the
       * bar-edge button's `delete-link` goes through.
       */}
      {visibleRoutedAggregates
        .filter(
          ({ aggregate }) =>
            aggregate.count === 1 &&
            selectedLink?.id === aggregate.memberLinkIds[0] &&
            !readonly,
        )
        .map(({ aggregate, badgeAnchor }) => (
          <button
            type="button"
            key={`delete:${aggregate.id}`}
            className="wx-4kNpQzTa wx-aggregate-delete-button"
            style={{
              left: `${badgeAnchor[0] - BADGE_SIZE / 2}px`,
              top: `${badgeAnchor[1] - BADGE_SIZE / 2}px`,
              width: `${BADGE_SIZE}px`,
              height: `${BADGE_SIZE}px`,
            }}
            title="Delete link"
            onClick={(event) => {
              event.stopPropagation();
              api.exec('delete-link', { id: aggregate.memberLinkIds[0] });
              onSelectLink(null);
            }}
          >
            <i className="wxi-close wx-delete-button-icon"></i>
          </button>
        ))}
      {openAggregate ? (
        <div
          ref={popoverRef}
          className="wx-4kNpQzTa wx-aggregate-popover"
          data-aggregate-popover={setID(openAggregate.aggregate.id)}
          style={{
            left: `${popoverPosition.left}px`,
            top: `${popoverPosition.top}px`,
          }}
        >
          <div className="wx-4kNpQzTa wx-aggregate-popover-title">
            {openAggregate.aggregate.count} link
            {openAggregate.aggregate.count > 1 ? 's' : ''} (
            {openAggregate.aggregate.mode})
          </div>
          {openAggregate.aggregate.memberLinkIds.map((linkId) => {
            const link = linkById.get(String(linkId));
            if (!link) return null;
            const sourceTask = getTask(link.source);
            const targetTask = getTask(link.target);
            return (
              <button
                type="button"
                key={String(linkId)}
                className="wx-4kNpQzTa wx-aggregate-popover-row"
                onClick={() => onRevealMember(link)}
              >
                {sourceTask?.text ?? link.source} →{' '}
                {targetTask?.text ?? link.target}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
