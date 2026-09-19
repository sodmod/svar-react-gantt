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

  const revealNow = useCallback(
    (taskId, linkId) => {
      const rect = taskRects.get(taskId);
      if (!rect) return false;
      /*
       * SVAR-M45 (R3-6): the USABLE chart width, the same one
       * `OffscreenLinkChips.jsx` now decides its own geometry with
       * (SVAR-M42's own note). `xArea.to - xArea.from` is the store's
       * VIRTUALIZATION window — wider than the chart by its pre-render
       * buffer on each side — so centring on it put the revealed task
       * visibly left of the middle, by half that buffer, every time.
       */
      const viewportWidth = usableWidth;
      if (!(viewportWidth > 0)) return false;
      const left = Math.max(0, rect.x + rect.w / 2 - viewportWidth / 2);
      api.exec('scroll-chart', { left, top: scrollTop });
      if (!readonly) onSelectLink(linkId);
      return true;
    },
    [taskRects, usableWidth, api, scrollTop, readonly, onSelectLink],
  );

  useEffect(() => {
    const pending = pendingRevealRef.current;
    if (!pending) return;
    if (revealNow(pending.taskId, pending.linkId)) {
      pendingRevealRef.current = null;
      setOpenAggregateId(null);
      return;
    }
    /*
     * SVAR-M45 (R3-6): a pending reveal that cannot resolve gives up
     * instead of waiting forever. Before SVAR-M44 an unresolvable one was
     * the NORMAL outcome for two rows out of three, and it stayed in the
     * ref indefinitely — so the next unrelated `_tasks` change (another
     * collapse, a drag, a new task) could fire that stale scroll long after
     * the click, which is its own surprise. A small bounded number of
     * attempts covers the legitimate case (one commit per `open-task`
     * cascade) and nothing beyond it.
     */
    pending.attemptsLeft -= 1;
    if (pending.attemptsLeft <= 0) pendingRevealRef.current = null;
  }, [taskRects, revealNow]);

  const onRevealMember = useCallback(
    (link) => {
      /*
       * SVAR-M45 (R3-6): the endpoint this row is FOR. A row names a real
       * canonical link whose own hidden side is what the aggregate stands
       * in for, and scrolling to the side that was already on screen is not
       * a reveal of anything. `taskRects` is the render truth here — a task
       * hidden inside a collapsed ancestor is simply absent from `_tasks`
       * (`aggregate.js`'s own opening note), so "not in `taskRects`" IS
       * "hidden", with no second definition of hidden to drift from the
       * first. Both hidden (a link between two collapsed groups) reveals
       * the TARGET, the end the arrow points at; neither hidden keeps the
       * previous behaviour exactly.
       */
      const revealId = !taskRects.has(link.target)
        ? link.target
        : !taskRects.has(link.source)
          ? link.source
          : link.target;

      // Both chains, because a link between two collapsed groups hides both
      // of its ends and showing only one of them is not showing the link.
      const ancestors = [
        ...collapsedAncestorsToOpen(link.source, getTask),
        ...collapsedAncestorsToOpen(link.target, getTask),
      ];
      for (const id of ancestors) {
        api.exec('open-task', { id, mode: true });
      }
      if (ancestors.length === 0) {
        if (revealNow(revealId, link.id)) setOpenAggregateId(null);
      } else {
        /*
         * SVAR-M45 (R3-6): the disclosure the `open-task` calls above just
         * asked for has not produced new rows yet, so the scroll waits for
         * the `taskRects` that carries them (the effect right above). The
         * generation counter is what stops a reveal that can never succeed
         * from sitting in the ref and firing later, against an unrelated
         * `taskRects` change, as a scroll the person did not ask for.
         */
        pendingRevealRef.current = {
          taskId: revealId,
          linkId: link.id,
          attemptsLeft: 4,
        };
      }
    },
    [api, getTask, revealNow, taskRects],
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
