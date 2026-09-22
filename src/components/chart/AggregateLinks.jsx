import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useStore } from '@svar-ui/lib-react';
import { setID } from '@svar-ui/lib-dom';
import { LINK_TOKENS } from '../../planner-router/route.js';
import { clampPopoverRect } from '../../planner-router/overlayViewport.js';
import { useScreenViewportCorrection } from './useScreenViewportCorrection.js';
import { pickBadgeAnchor } from '../../planner-router/aggregate.js';
import { useRoutedAggregates } from './useRoutedAggregates.js';
import { useCanonicalReveal } from './useCanonicalReveal.js';
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

/*
 * SVAR-M48 (R5-4): the grouping, the ribbon read and the routing of the
 * aggregates live in `useRoutedAggregates.js` now, so that the offscreen
 * endpoint chip reads the SAME aggregate routes this component draws
 * instead of routing the same links a second time with fewer inputs — the
 * split `useRoutedLinks.js` already made for canonical links in R4.
 * Nothing about what is drawn changed; the visibility culling, the badge,
 * the popover and the reveal are still this component's own, below.
 *
 * SVAR-M49 (R6-4, R6-5): a popover row now reveals the hidden endpoint
 * (the source when both are hidden) through the consumer's own reveal owner
 * — `onRevealPartner`, the seam the offscreen chip already uses — opening
 * only that endpoint's collapsed ancestors and selecting that task. See
 * `onRevealMember` and `revealNow`.
 */

export default function AggregateLinks({
  onSelectLink,
  selectedLink,
  readonly,
  linkPresentation,
  // SVAR-M49 (R6-4): the consumer's own reveal, the same `onRevealPartner`
  // the offscreen chip hands its click to (SVAR-M40). See `onRevealMember`.
  onRevealPartner,
}) {
  const {
    api,
    getTask,
    linksValue,
    taskRects,
    cellHeight,
    area,
    aggregates,
    routedAggregates,
    // SVAR-M50 (Pavel manual acceptance, Phase 4.1G R1 second follow-up):
    // `linkPresentation` now reaches the grouping key too — see
    // `useRoutedAggregates.js`'s own comment.
  } = useRoutedAggregates(linkPresentation);
  const xArea = useStore(api, 'xArea');
  const scrollTop = useStore(api, 'scrollTop');
  const scrollLeft = useStore(api, 'scrollLeft');
  /*
   * SVAR-M45 (R3-6): the chart's own usable width, which `Layout.jsx`
   * publishes as `ganttWidth - columnsWidth - scrollSize - 4` — the
   * scrollbar and the resizer are already out of it. Read through
   * `getState()` rather than `useStore`, for the reason SVAR-M42's own note
   * in `OffscreenLinkChips.jsx` records: `_chartWidth` is ordinary store
   * state, not a published reactive value, and it is an input to the store's
   * own `xArea` reaction — so keying the read on `xArea`/`scrollLeft` keeps
   * it fresh without asking for a Writable that does not exist.
   */
  const usableWidth = useMemo(
    () => api.getState()?._chartWidth,
    [api, xArea, scrollLeft],
  );

  const [openAggregateId, setOpenAggregateId] = useState(null);
  const popoverRef = useRef(null);
  // R1-6: the popover's real rendered size, measured after it (re)paints —
  // its row count and task-name lengths make it genuinely variable, unlike
  // the offscreen chip's own fixed size, so an arithmetic estimate would be
  // guessing rather than measuring. `null` on the very render that first
  // opens it; the clamp below falls back to a generous guess for that one
  // frame, then snaps to the exact measured size.
  const [popoverSize, setPopoverSize] = useState(null);

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

  /*
   * SVAR-M45 (R3-5): `badgeAnchor` is what the popover opens FROM, so an
   * aggregate whose route has no anchor (its polyline never enters the
   * current horizontal viewport — `pickBadgeAnchor`'s own `null` contract)
   * has nowhere to put one. The bbox filter above already makes that
   * practically unreachable; requiring it here means the placement below
   * never has to dereference a missing anchor, which matters more now that
   * a `count === 1` line opens a popover too and therefore reaches this
   * code on a path it never used to.
   */
  const openAggregate = openAggregateId
    ? (visibleRoutedAggregates.find(
        (entry) => entry.aggregate.id === openAggregateId,
      ) ?? null)
    : null;
  const openAnchor = openAggregate?.badgeAnchor ?? null;

  // R1-6 (Pavel manual acceptance remediation): `basePosition` is the
  // canvas-space placement `clampPopoverRect` computes from `xArea`/`area`
  // — correct on the axis those virtualization bounds can see. Hooks must
  // run unconditionally, so this is computed (and the correction hook
  // called) whether or not a popover is actually open; when it is not,
  // `popoverRef.current` is null and the hook is a no-op.
  const popoverBasePosition = openAnchor
    ? clampPopoverRect(
        {
          x: openAnchor[0],
          y: openAnchor[1] + BADGE_SIZE / 2,
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

  /*
   * SVAR-M49 (R6-4, R6-5): the reveal of ONE task, by the consumer's own
   * reveal owner when it supplies one (`onRevealPartner`, the same seam the
   * offscreen chip uses — in the Planner that is `revealTask` with the
   * accepted D-165 horizontal rule, the centred vertical landing and the
   * selection, in one coherent navigation). Before R6 this scrolled the
   * chart's own `scrollLeft` alone and selected the LINK: measured on the
   * product stand with `Community` collapsed and the chart at `Age rating
   * paperwork`, the row click moved the timeline to March and nothing else
   * — the rows stayed where they were, the hidden task's row was never on
   * screen, the previous task selection stayed — "экран смещается странно".
   *
   * The consumer-less fallback keeps the store's own commands: the task is
   * selected (`select-task`) and both axes are scrolled so its row lands in
   * the middle of the band and its bar start a third of the way in, the
   * same shape the chip's own fallback uses (SVAR-M48).
   */
  const revealNow = useCallback(
    (taskId) => {
      const rect = taskRects.get(taskId);
      if (!rect) return false;
      if (onRevealPartner) {
        onRevealPartner(taskId);
        return true;
      }
      const viewportWidth = usableWidth;
      if (!(viewportWidth > 0)) return false;
      const state = api.getState() || {};
      const viewportHeight = state._chartHeight - (state._scrollSize || 0);
      const left = Math.max(0, rect.x - viewportWidth / 3);
      const top =
        viewportHeight > 0
          ? Math.max(0, Math.round(rect.y - (viewportHeight - rect.h) / 2))
          : scrollTop;
      api.exec('select-task', { id: taskId, show: false });
      api.exec('scroll-chart', { left, top });
      return true;
    },
    [taskRects, usableWidth, api, scrollTop, onRevealPartner],
  );

  /*
   * SVAR-M53 (Phase 4.1G R4): the ancestor cascade and the bounded pending
   * landing (SVAR-M45 R3-6) moved to `useCanonicalReveal.js` unchanged, so
   * the offscreen chip can ask the same question the same way instead of
   * growing a second answer to it. `revealNow` — this component's own idea
   * of WHERE a task should end up — stayed here, which is the half that
   * genuinely differs between the two callers.
   */
  const { openCollapsedAncestors, landOnceVisible } = useCanonicalReveal({
    api,
    getTask,
    taskRects,
    land: revealNow,
  });

  const onRevealMember = useCallback(
    (link) => {
      /*
       * SVAR-M49 (R6-4, R6-5): the endpoint this row is FOR, and the whole
       * of what the click does, stated as the product decided it:
       *
       *   one end hidden     reveal THAT end — open only its own collapsed
       *                      ancestors, land on it, select it
       *   both ends hidden   reveal the SOURCE (R6-4 case B, R6-5) — open
       *                      only the source's ancestors, never both chains:
       *                      opening both and centring on the link's middle
       *                      showed the person two groups unfolding and no
       *                      task, which is what Pavel reproduced
       *   neither hidden     (unreachable for an aggregate row, kept for
       *                      completeness) land on the target
       *
       * `taskRects` is the render truth here — a task hidden inside a
       * collapsed ancestor is simply absent from `_tasks` (`aggregate.js`'s
       * own opening note), so "not in `taskRects`" IS "hidden", with no
       * second definition of hidden to drift from the first (SVAR-M45).
       *
       * The canonical link stays selected (R3-5's accepted delete
       * affordance for a link one can now see both ends of); the TASK
       * selection is the reveal owner's, which replaces whatever was
       * selected before. The popover closes at once: the click has been
       * answered, whether the landing is immediate or waits one commit for
       * the rows the `open-task` calls produce.
       */
      const sourceHidden = !taskRects.has(link.source);
      const targetHidden = !taskRects.has(link.target);
      const revealId = sourceHidden
        ? link.source
        : targetHidden
          ? link.target
          : link.target;

      const ancestors = openCollapsedAncestors(revealId);
      if (!readonly) onSelectLink(link.id);
      setOpenAggregateId(null);
      /*
       * SVAR-M45 (R3-6): when something was opened, the disclosure those
       * `open-task` calls asked for has not produced new rows yet, so the
       * landing waits for the `taskRects` that carries them, a bounded
       * number of attempts — see `useCanonicalReveal.js`.
       */
      landOnceVisible(revealId, ancestors.length > 0);
    },
    [
      openCollapsedAncestors,
      landOnceVisible,
      taskRects,
      readonly,
      onSelectLink,
    ],
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

  /*
   * SVAR-M45 (R3-5): Escape closes the popover, the same key `Bars.jsx`
   * already clears a selected link (and a pending link-create draft) with.
   * Needed here because a `count === 1` line now opens BOTH at once: with
   * only that handler, Escape would take the delete button away and leave
   * the popover it opened alongside it still on screen.
   */
  useEffect(() => {
    if (!openAggregateId) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpenAggregateId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [openAggregateId]);

  /*
   * R2-7 (Pavel manual acceptance remediation, mid-round finding): the same
   * click-outside-cancels contract `Links.jsx` already gives a normal
   * selected link's delete affordance, for the one aggregate shape that IS
   * a normal link underneath (`count === 1`, R1-10's own solo-select).
   * Reported live: clicking empty canvas did nothing to a collapsed-group
   * aggregate's delete button, because nothing here ever called
   * `onSelectLink(null)` for it — `Links.jsx`'s own listener only knows
   * about ITS OWN selected-line ref, never this component's.
   *
   * No exclusion check is needed here (unlike `Links.jsx`'s classList
   * check): both the line's own `onClick` and the delete button's `onClick`
   * below call `event.stopPropagation()` before this component does
   * anything else, so a click on either never reaches `document` at all —
   * every click this handler ever sees already IS "outside" by
   * construction.
   */
  useEffect(() => {
    if (readonly || !selectedLink) return;
    const soloSelected = aggregates.some(
      (aggregate) =>
        aggregate.count === 1 && aggregate.memberLinkIds[0] === selectedLink.id,
    );
    if (!soloSelected) return;
    const handler = () => onSelectLink(null);
    document.addEventListener('click', handler);
    return () => {
      document.removeEventListener('click', handler);
    };
  }, [readonly, selectedLink, aggregates, onSelectLink]);

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
          /*
           * SVAR-M51, second half (SVAR Production Planner, Pavel manual
           * acceptance, Phase 4.1G R2): the REAL canonical link ids this
           * one drawn line
           * stands for, published in the same `data-link-ids` vocabulary the
           * offscreen chip (SVAR-M49) already uses, for exactly the same
           * reason — a consumer needs to know WHICH relationships a merged
           * presentation represents before it may act on one of them.
           *
           * `data-aggregate-id` cannot answer that. It is a GROUPING key
           * (representative source, representative target, mode bucket,
           * presentation digest), so a consumer wanting member ids had to
           * re-derive them by walking its own model back through the
           * collapsed subtree and hoping the walk landed on the same set —
           * verifiable only when the answer is a single link, and silently
           * wrong if this id's internal shape ever changes (it already did
           * once, when SVAR-M50 added the digest segment). The member ids are
           * right here at render time, and the aggregate's whole contract
           * (D-166 §K) is that it is NOT a link of its own but a presentation
           * OF these links — this attribute states that contract in the DOM.
           *
           * Presentation only: nothing in this renderer reads it back, it
           * carries no mode and no state, and it is the same array
           * `data-aggregate-count` is already the length of.
           */
          const memberLinkIds = aggregate.memberLinkIds
            .map((id) => setID(id))
            .join(',');
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
              data-link-ids={memberLinkIds}
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
                 *
                 * R2-7 (Pavel manual acceptance remediation, mid-round
                 * finding): clicking the SAME already-selected line a
                 * second time now deselects it, matching the toggle the
                 * `count > 1` branch right below already gives its own
                 * popover — one more way out of the delete-affordance
                 * state, reported live as missing alongside Escape and
                 * click-outside (both fixed above).
                 *
                 * SVAR-M45 (R3-5, Pavel manual acceptance remediation —
                 * "где таблица?"): a `count === 1` line now opens the
                 * popover TOO, not instead. R1-10 replaced the popover with
                 * the direct selection because selection was what the
                 * delete affordance needed, and that traded away the only
                 * route this presentation has to its own hidden end: with
                 * no badge (D-166 §K gives none at count 1) and no popover,
                 * a single hidden link could be selected and deleted but
                 * never REVEALED — the row that expands the group and
                 * scrolls to the real task had simply disappeared from the
                 * product. Both now happen on the one click: the canonical
                 * link is selected (so the delete button appears, R1-10 and
                 * A37 unchanged) and the one-row popover opens beneath it
                 * (so the reveal is reachable again, A32/A36). The two do
                 * not collide on screen — the delete button occupies
                 * `BADGE_SIZE` centred on the anchor and the popover opens
                 * from `anchor + BADGE_SIZE / 2` downwards — and the same
                 * second click still closes both.
                 */
                const soloId =
                  aggregate.count === 1 ? aggregate.memberLinkIds[0] : null;
                if (soloId !== null && !readonly) {
                  onSelectLink(selectedLink?.id === soloId ? null : soloId);
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
      {openAggregate && openAnchor ? (
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
                /*
                 * SVAR-M45 (R3-5): the row handles its own click fully, so
                 * it stops there. Without this the same click also reaches
                 * the two document-level listeners this component installs
                 * — the popover's own click-outside and R2-7's
                 * solo-selection cancel — and a `count === 1` popover, which
                 * is now open at the same time as a selected link, would
                 * have its reveal's selection cleared out from under it by
                 * the second one.
                 */
                onClick={(event) => {
                  event.stopPropagation();
                  onRevealMember(link);
                }}
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
