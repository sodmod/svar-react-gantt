/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M37).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Collapsed-group link aggregation, presentation-only (project DECISIONS.md
 * D-166 §K/§L, TECH_SPEC.md §6.10.1, Phase 4.1C checkpoint C3).
 *
 * The whole feature turns on one fact about the store this renderer already
 * sits on: a task hidden by a collapsed ancestor is not IN `_tasks` with
 * stale geometry — it is simply ABSENT from it (SVAR-M10's own ancestor-bar
 * geometry already had to work around exactly this, using `getTask` for the
 * full tree rather than the visibility-filtered `_tasks` array). A task
 * absent from the tree the store currently holds at ALL (which is what a
 * consumer's own filter does, by handing the store a smaller `tasks` array
 * to begin with — D-161) resolves to no representative below, and the link
 * is silently skipped: nothing here distinguishes "hidden by a collapsed
 * ancestor" from "hidden by a filter" by name, because it does not need to
 * — a filter-hidden task's tree entry is gone, `getTask` returns nothing for
 * it, and the walk below stops with no representative, which is exactly the
 * E-2 firebreak (D-166 §N) asks for: filter-hidden endpoints never enter
 * aggregation, without a second code path that has to remember to exclude
 * them.
 *
 * Nothing here reads a date, a calendar, `mode`'s own vocabulary beyond
 * treating it as an opaque grouping key, or `DomainState`.
 */

/*
 * Walks from `taskId` up through `parent` (root's own parent is `0`, per the
 * store's own convention) until it finds an id present in `visibleIds` — the
 * task's own row if it is already visible, otherwise the nearest ancestor
 * that is. Returns `null` when the id has no tree entry at all (filtered out
 * entirely, or genuinely unknown) or the walk reaches the root without ever
 * finding a visible id (defensive; the root is expected to always be
 * visible in practice).
 *
 * `getTask(id)` reads the FULL tree, unfiltered by disclosure — the same
 * primitive SVAR-M10's own ancestor-bar geometry already uses for the same
 * reason: `_tasks` alone cannot resolve the walk's own starting point when
 * that point is itself hidden.
 */
export function findVisibleRepresentative(taskId, getTask, visibleIds) {
  let current = getTask(taskId);
  const seen = new Set();
  while (current) {
    if (visibleIds.has(current.id)) return current.id;
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    const parentId = current.parent;
    if (parentId === undefined || parentId === null || parentId === 0) {
      return null;
    }
    current = getTask(parentId);
  }
  return null;
}

/*
 * SVAR-M50 (SVAR Production Planner, Pavel manual acceptance, Phase 4.1G R1
 * second follow-up): what a bucket may NOT mix.
 *
 * `presentationKeyOf`, when given, is a `(link) => string` the CALLER
 * builds from its own `linkPresentation` prop — the same closed `{lineStyle,
 * arrowhead}` dictionary `Links.jsx`/`AggregateLinks.jsx` already resolve a
 * REAL link's presentation through. This module still touches nothing but
 * that closed shape: it never reads `lineStyle`/`arrowhead` itself, never
 * asks what `mode` means, and does not gain a second opinion about either —
 * it is handed one opaque string per link and uses it exactly the way it
 * already used the `mode ?? 'soft'` fallback below, as one more component of
 * the grouping key.
 *
 * `presentationOf` below (this file's one caller inside `AggregateLinks.jsx`,
 * `useRoutedAggregates.js`) already assumed every member of one aggregate
 * "shares the same mode by construction" — true only when this module's own
 * key genuinely could not mix two links a consumer means to tell apart. The
 * ORIGINAL key could not deliver that promise for a consumer whose links
 * never carry `.mode` at all (D-116, this project's own `TaskLink.mode`
 * deliberately never crosses into the renderer's `ILink` vocabulary): EVERY
 * link then fell back to the literal string `'soft'`, so two links with
 * completely different real modes — and therefore different presentation —
 * merged into one aggregate whenever their (representative source,
 * representative target) pair matched. The shared line then drew whichever
 * member `memberLinkIds[0]` happened to be, and the other member's own
 * distinct chip and line silently vanished into the merged badge. MEASURED:
 * a collapsed group with two children, one `soft`-moded and one
 * `informational`-moded, both linking the same outside partner, aggregated
 * into one `count: 2` badge instead of two separate `count: 1` aggregates.
 *
 * `presentationKeyOf` closes that gap without this module learning what
 * `mode` is: two links the caller's OWN presentation resolver disagrees
 * about can no longer land in the same bucket, however the mode fallback
 * above reads. Two links that resolve to the SAME presentation (including
 * two consumers that both leave `.mode` unset, or two links a consumer
 * genuinely wants to read as visually identical) still aggregate exactly as
 * before — this is strictly a widening of what counts as "the same group",
 * never a narrowing that could split an already-correct aggregate. Omitting
 * the argument keeps the original mode-only key, so an upstream consumer
 * that never adopts this parameter is unaffected.
 */
function defaultPresentationKeyOf() {
  return '';
}

/*
 * Groups links whose resolved endpoints are not both the link's own real
 * endpoints into aggregates, one per (representative source, representative
 * target, mode, presentation) — D-166 §K's "endpoint + direction + mode" key
 * plus the presentation signature above, where direction is the ordered
 * (source, target) pair itself: the store's own links are already always
 * forward (D-166 §A, FS only), so swapping the pair is a genuinely
 * different direction, never the same aggregate.
 *
 * A link whose BOTH endpoints already resolve to themselves is a real,
 * fully visible link — D-166 §G already gives it its own channel and this
 * aggregation must never re-draw it a second time, so it is excluded here,
 * not merely left un-badged.
 *
 * A link whose two endpoints resolve to the SAME representative (R1-1: both
 * real endpoints sit inside the one collapsed subtree the same visible row
 * stands for) is excluded too, and for a different reason than the case
 * above: there is no SECOND visible row for it to reach. Routing it back to
 * the row it already started from would draw a synthetic loop around a
 * single representative — not an aggregate of anything, since an aggregate
 * is a stand-in for a relationship the collapse hides ONE side of. It is an
 * internal relationship of content the person chose to hide, in full, and
 * this presentation owes it nothing to show: no loop, no badge, no chip.
 */
export function buildAggregates(
  links,
  getTask,
  visibleIds,
  presentationKeyOf = defaultPresentationKeyOf,
) {
  const groups = new Map();
  for (const link of links) {
    const repSource = findVisibleRepresentative(
      link.source,
      getTask,
      visibleIds,
    );
    const repTarget = findVisibleRepresentative(
      link.target,
      getTask,
      visibleIds,
    );
    if (repSource === null || repTarget === null) continue;
    if (repSource === link.source && repTarget === link.target) continue;
    if (repSource === repTarget) continue;

    const mode = link.mode ?? 'soft';
    const presentationKey = presentationKeyOf(link) ?? '';
    const key = `${repSource}\u0000${repTarget}\u0000${mode}\u0000${presentationKey}`;
    let group = groups.get(key);
    if (!group) {
      group = { repSource, repTarget, mode, presentationKey, members: [] };
      groups.set(key, group);
    }
    group.members.push(link);
  }

  return Array.from(groups.values()).map((group) => ({
    // A DETERMINISTIC digest of `presentationKey`, not the group's position
    // in this `Map` — position depends on `links`' own iteration order,
    // which is not guaranteed stable across renders (a reorder that leaves
    // every grouping decision unchanged would still shuffle `Array.from`'s
    // output). This id is read back as REACT KEYS and as the identity a
    // popover's own open/closed state is keyed on
    // (`AggregateLinks.jsx`'s `openAggregateId`) — an id that could change
    // for a bucket whose membership did not would silently close an open
    // popover or misattribute one. Two groups whose (source, target, mode)
    // already matched only split further when their presentation genuinely
    // differs, so the id shape stays "aggregate:<source>:<target>:<mode>"
    // plus this one deterministic suffix, never a third independent field —
    // a caller (this project's own `resolveAggregateLinkId`) already treats
    // everything past the third `:` as opaque, so widening the id this way
    // changes nothing for it.
    id: `aggregate:${group.repSource}:${group.repTarget}:${group.mode}:${presentationDigest(group.presentationKey)}`,
    source: group.repSource,
    target: group.repTarget,
    mode: group.mode,
    count: group.members.length,
    memberLinkIds: group.members.map((link) => link.id),
    // SVAR-M53 (Phase 4.1G R4): which REAL tasks each of the two
    // representatives is standing in for, in this bucket. Recorded here
    // because this is the module that resolved the representatives in the
    // first place — anyone else answering it would be walking `parent` a
    // second time, with a second chance to disagree about what "hidden"
    // means (the whole reason `findVisibleRepresentative` is one function).
    //
    // A side whose endpoints are already visible lists those endpoints, so
    // the list is never empty and never needs a "was this side collapsed"
    // flag: the caller compares it to the representative if it cares. Both
    // are deduplicated and in first-seen member order, so the value is
    // deterministic for a deterministic `links` order and two links from
    // one hidden task do not name it twice.
    sourceCanonicalIds: distinctIds(group.members.map((link) => link.source)),
    targetCanonicalIds: distinctIds(group.members.map((link) => link.target)),
  }));
}

/*
 * SVAR-M53: first-seen order, no duplicates, compared as strings for the
 * same reason every other id comparison in this file is — a consumer's ids
 * are opaque and may be numbers or strings, and the original values are
 * what is answered, never the stringified key.
 */
function distinctIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(id);
  }
  return out;
}

/*
 * A short, stable, DOM-attribute-safe digest (FNV-1a, base36) — not
 * cryptographic, just deterministic and collision-unlikely for the small
 * number of distinct presentation dictionaries any one project actually has
 * (a handful of `{lineStyle, arrowhead}` combinations). Every group fed the
 * SAME `presentationKey` (including the empty string
 * `defaultPresentationKeyOf` returns, for an upstream caller that never
 * adopts this parameter) digests to the SAME suffix, which is the only
 * property this id's callers (React's own key diffing, `AggregateLinks.jsx`'s
 * `openAggregateId`) actually need.
 */
function presentationDigest(key) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/*
 * Clips a polyline to the vertical strip `[xFrom, xTo]` (D-166 §L's
 * viewport-aware badge anchor), returning every contiguous run of points
 * that falls inside it, each run's own points already interpolated at the
 * strip's edges so no returned point sits outside `[xFrom, xTo]`.
 */
function clipPolylineToXRange(points, xFrom, xTo) {
  const runs = [];
  let current = [];
  const inside = (x) => x >= xFrom && x <= xTo;
  const clampPoint = (a, b) => {
    const [ax, ay] = a;
    const [bx, by] = b;
    const dx = bx - ax;
    if (dx === 0) return null;
    const targets = [xFrom, xTo].filter(
      (x) => (x - ax) * (x - bx) <= 0 && x !== ax,
    );
    return targets.map((x) => {
      const t = (x - ax) / dx;
      return [x, ay + (by - ay) * t];
    });
  };

  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    const pointInside = inside(point[0]);
    if (i > 0) {
      const prev = points[i - 1];
      const crossings = clampPoint(prev, point) || [];
      for (const crossing of crossings) current.push(crossing);
    }
    if (pointInside) {
      current.push(point);
    } else if (current.length) {
      runs.push(current);
      current = [];
    }
  }
  if (current.length) runs.push(current);
  return runs.filter((run) => run.length >= 1);
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
  }
  return total;
}

function pointAtFraction(points, fraction) {
  const total = polylineLength(points);
  if (total === 0) return points[0];
  const target = total * fraction;
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const segLen = Math.hypot(
      points[i][0] - points[i - 1][0],
      points[i][1] - points[i - 1][1],
    );
    if (travelled + segLen >= target) {
      const t = segLen === 0 ? 0 : (target - travelled) / segLen;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    }
    travelled += segLen;
  }
  return points[points.length - 1];
}

/*
 * The reveal gesture's own geometry (D-166 §K: "клик по строке раскрывает
 * минимальную цепочку свёрнутых предков"): every ancestor of `taskId`,
 * walking up from its immediate parent to the root, that is not ALREADY
 * open. Returns ids in TOP-DOWN order (furthest ancestor first) so a caller
 * opening them in this order gets the same cascade a person expanding one
 * row at a time would produce; the store's own `open-task` handler does not
 * actually require this order (it reads the full tree by id, not the
 * current visible slice), but nothing is lost by giving it anyway.
 *
 * "Minimal" means the CLOSED ancestors only: an ancestor already open is
 * skipped, never re-opened, and no row outside this task's own chain is
 * ever touched. It does not mean "the closed ones nearest the task".
 *
 * SVAR-M44 (R3-6, Pavel manual acceptance remediation —
 * "не открываетгруппу.jpg"). This used to STOP at the first ancestor whose
 * own `open` was true, on the stated reasoning that "everything above an
 * already-open ancestor is, by definition, not what is hiding `taskId`".
 * That reasoning is false, and the product's own demo hierarchy is a
 * counterexample:
 *
 *   Engineering            CLOSED   <- the collapsed representative
 *     Infra migration               a direct child
 *     Tools              open:true  <- open, and hidden ANYWAY, because
 *       Level editor upgrade           its own parent is closed
 *       Build pipeline hardening
 *
 * An open subtree nested inside a closed one is still not on screen, so the
 * closed grandparent is still what hides the leaf. Walking up from
 * `Level editor upgrade` hit `Tools` (open), returned an EMPTY list, and the
 * caller — seeing nothing to open — went straight to scrolling to a task
 * that was still not rendered, which silently did nothing at all. MEASURED
 * against this exact tree: `Infra migration` returned `[Engineering]` and
 * worked; `Level editor upgrade` and `Build pipeline hardening` both
 * returned `[]` and did nothing. That is precisely the popover Pavel
 * photographed — row 1 revealing, rows 2 and 3 dead.
 *
 * The walk now runs to the root and collects every closed ancestor on the
 * way: the same answer for the case that already worked (a chain closed all
 * the way up), and the correct one for the case that did not.
 */
export function collapsedAncestorsToOpen(taskId, getTask) {
  const toOpen = [];
  let current = getTask(taskId);
  const seen = new Set();
  while (current) {
    const parentId = current.parent;
    if (parentId === undefined || parentId === null || parentId === 0) break;
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = getTask(parentId);
    if (!parent) break;
    if (parent.open !== true) toOpen.push(parent.id);
    current = parent;
  }
  return toOpen.reverse();
}

/*
 * D-166 §L: a single rule that produces every one of the spec's named
 * cases without branching on which one applies. The longest run of the
 * route's own polyline that survives clipping to the current horizontal
 * viewport is the "safe visible segment" the spec asks for in every case —
 * a route with both ends on screen clips to (almost) its own full length,
 * so the midpoint IS the midpoint; a route with only one end on screen
 * clips to the run near that end; a route crossing the viewport with both
 * ends off screen clips to the crossing segment; a route that never enters
 * the viewport clips to nothing, and `null` is the contract for "no badge"
 * (D-166's own Blocker: no floating badge without a visible route
 * segment).
 */
export function pickBadgeAnchor(points, xArea) {
  if (!xArea || points.length < 2) return null;
  const runs = clipPolylineToXRange(points, xArea.from, xArea.to);
  if (!runs.length) return null;
  const longest = runs.reduce((best, run) =>
    polylineLength(run) > polylineLength(best) ? run : best,
  );
  return pointAtFraction(longest, 0.5);
}
