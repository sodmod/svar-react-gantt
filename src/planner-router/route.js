/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M32).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The deterministic template router for dependency-link geometry (project
 * DECISIONS.md D-166, TECH_SPEC.md §6.10.1). Pure pixel geometry: every
 * function here takes bar rectangles ({x, y, w, h} in the chart's own pixel
 * space), a row height and, where relevant, a small set of sibling links
 * sharing an endpoint. Nothing here reads a date, a calendar, a duration or
 * `DomainState` — the boundary this file may not cross belongs to the
 * consuming product, not to this package, and is enforced there.
 *
 * One geometry situation maps to one stable route class:
 *
 *   tight entry       gap too small for a clean standard "L" -> enter the
 *                      target from its top (successor below) or bottom
 *                      (successor above), never from a compressed side L
 *   standard          enough horizontal room -> exit right, one vertical
 *                      segment, enter left; the vertical is pushed clear of
 *                      any bar it would otherwise cross (the "blocking-bar
 *                      corridor"), and if no clean corridor exists the line
 *                      is simply drawn behind the blocking bar (z-order
 *                      alone provides this — see Links.jsx)
 *   reverse bypass     the successor starts at or before the predecessor's
 *                      own end -> route out and around through the free
 *                      strip near the target's row edge, never a staircase
 *
 * No generic obstacle/pathfinding search is implemented deliberately (D-166
 * §C): a bounded, deterministic decision tree over the situations above is
 * the whole of it, matching every case in TECH_SPEC.md §6.10.1 without a
 * global search over the scene.
 */

export const LINK_TOKENS = Object.freeze({
  clearance: 12,
  radius: 12,
  minRun: 10,
  channelStep: 7,
  // R1-2/R1-3 (Pavel manual acceptance remediation): 1.5x the Phase 4.1C
  // starting values (stroke 1.4 -> 2.1, arrow 7x6.8 -> 10.5x10.2).
  // `link.hitArea` is untouched — no hit-testing regression was found.
  stroke: 2.1,
  arrowLength: 10.5,
  arrowWidth: 10.2,
  hitArea: 10,
});

/*
 * SVAR-M41 (R3-1, Pavel manual acceptance remediation — "Не исправлено.jpg").
 *
 * The horizontal room a SIDE entry needs at the target end before it reads
 * as a dependency arriving, rather than as a line that simply stops. It is
 * the sum of the three things that actually occupy that run, in the order
 * the stroke travels them:
 *
 *   radius       the last corner's own curve, which consumes exactly
 *                `radius` of the run it turns INTO
 *   minRun       the token that already means "a genuinely visible straight
 *                run", now applied where the run is actually looked at
 *   arrowLength  the filled triangle, which is drawn over the last
 *                `arrowLength` px of that same run
 *
 * The retired floor was `minRun` alone (10px), chosen when the arrow was
 * 7x6.8px and never revisited when R1-3 enlarged it to 10.5x10.2 — so the
 * floor became SMALLER than the arrow it has to leave room for, and smaller
 * than the corner radius as well. MEASURED on the screenshot's own geometry
 * (a 10px final run): `buildRoundedPath` clamped the last corner to
 * `minRun / 2` = 5px, `trimForArrow` pulled the endpoint back by
 * `arrowLength - 1` = 9.5px to 0.5px from that corner, and `dedupePoints`
 * (which drops any point within 0.5px of the previous one) then deleted the
 * endpoint outright: the emitted path ENDED AT THE CORNER, with no final
 * run drawn at all and the arrowhead left sitting on the bend. That is
 * exactly the broken last turn Pavel photographed.
 *
 * Every route class that enters from the side is measured against this, and
 * `routeLink` refuses to emit a side entry that cannot meet it (D-166 §E's
 * own rule: the tight-entry family, not a compressed side L, is what a
 * geometry too tight for a proper side approach is drawn as).
 */
export function sideEntryRun(tokens) {
  return tokens.radius + tokens.minRun + tokens.arrowLength;
}

/*
 * The minimum forward gap a standard "L" needs: `clearance` off the source
 * before it may turn, plus a target-end approach that satisfies
 * `sideEntryRun` above. A gap tighter than this cannot render a standard L
 * without looking compressed, so it is drawn as a tight entry instead. This
 * is derived from the router's own already-adopted tokens, not a value
 * copied from the reference prototype (D-166 §E; the prototype's own
 * `gap >= clearance + 10px` threshold is explicitly rejected there because
 * it is smaller than a real one-day gap at the product's default day-cell
 * width and would misclassify it as a standard L).
 *
 * SVAR-M41: this used to read `2 * clearance + minRun`, which counted the
 * target-end room as `clearance + minRun` = 22px — below the 32.5px a side
 * entry actually occupies, so gaps between the two produced a standard L
 * whose final approach was already too short before any corridor push made
 * it worse. Raising it moves those cases into the tight-entry family, which
 * is where D-166 §E already says a joint too tight for a clean L belongs.
 */
function tightGapLimit(tokens) {
  return tokens.clearance + sideEntryRun(tokens);
}

function midY(rect) {
  return rect.y + rect.h / 2;
}

/*
 * SVAR-M54 (Phase 4.1G R8, D-171): the visual bundle each raw segment of a
 * route belongs to, stated by the router that built it.
 *
 * Two kinds of line exist in every route class below, and the router is the
 * only place that knows which is which:
 *
 *   a PORT line   a run whose position is fixed by ONE endpoint's own
 *                 rectangle alone — the horizontal leaving a source at its
 *                 mid-row, the final approach into a target at its mid-row,
 *                 a reverse bypass's corridor on the target's row boundary
 *                 and its return vertical. Every route through that port is
 *                 drawn on the SAME line there: it is one line on screen.
 *   a CHANNEL     the principal vertical, placed at a base coordinate plus
 *                 `channelOffset * channelStep` (`assignChannels`, D-166
 *                 §G). Routes the channel allocation deliberately separated
 *                 around one base are one bundle of parallel lines exactly
 *                 `channelStep` apart; the base, not the drawn x, is what
 *                 they share.
 *
 * The key is the line's own axis and coordinate — the base BEFORE the
 * channel offset for a channel — normalised to a thousandth of a pixel so
 * two equal coordinates computed along two different float paths compare
 * equal. That normalisation is float hygiene, not a visual tolerance: it
 * is three orders of magnitude below a device pixel, and nothing here ever
 * treats two DIFFERENT lines as one because they are close.
 *
 * The router does not decide what a key MEANS for a chip; it only says
 * which line a segment is. `offscreenChips.js` groups the candidates of one
 * endpoint by it (D-171).
 */
function lineKey(axis, coordinate) {
  return `${axis}@${Math.round(coordinate * 1000) / 1000}`;
}

function distance(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/* ------------------------------------------------------------------------ *
 * Port resolution
 * ------------------------------------------------------------------------ */

/*
 * `type` is the store's own four-letter link type (`e2s`/`s2s`/`e2e`/`s2e`):
 * first letter is the source port, third letter the target port, `e` = the
 * bar's right/end edge, `s` = its left/start edge. The product creates only
 * `e2s` (D-166 §A/§B: FS only, standard circular markers), which this router
 * treats as its canonical, fully specified shape. Any other value cannot be
 * created through the product UI; it still gets a route (never a crash), but
 * a plain clearance-only orthogonal one rather than the full route-class
 * taxonomy below, which is deliberately scoped to the shape the product
 * actually produces.
 */
export function isCanonicalForwardType(type) {
  return !type || type === 'e2s';
}

function sourceExitX(rect, type) {
  return type && type[0] === 's' ? rect.x : rect.x + rect.w;
}
function targetEntryX(rect, type) {
  return type && type[2] === 'e' ? rect.x + rect.w : rect.x;
}

/* ------------------------------------------------------------------------ *
 * Route classes for the canonical e2s shape (source right edge -> target
 * left edge)
 * ------------------------------------------------------------------------ */

function tightEntryRoute({ sourceRect, targetRect, channelOffset, tokens }) {
  const sx = sourceRect.x + sourceRect.w;
  const sy = midY(sourceRect);
  const below = targetRect.y >= sourceRect.y;
  const entryY = below ? targetRect.y : targetRect.y + targetRect.h;

  // The vertical drop point: at least `clearance` clear of the source bar,
  // at least `minRun` inside the target's left edge so the arrow does not
  // land flush on the bar's own boundary, but never past the target's own
  // width — a very narrow target still gets a valid entry x (D-166 §F: no
  // separate "short target" route class).
  const inset = Math.min(tokens.minRun, targetRect.w / 2);
  let ex = Math.max(sx + tokens.clearance, targetRect.x + inset);
  ex = Math.min(ex, targetRect.x + Math.max(targetRect.w - inset, inset));
  // SVAR-M54: the channel's base, before this link's own offset.
  const base = ex;
  ex += channelOffset * tokens.channelStep;

  return {
    routeClass: 'tightEntry',
    points: [
      [sx, sy],
      [ex, sy],
      [ex, entryY],
    ],
    segmentBundles: [lineKey('h', sy), lineKey('v', base)],
    arrowDir: below ? 'down' : 'up',
  };
}

function standardRoute({
  sourceRect,
  targetRect,
  obstacles,
  channelOffset,
  tokens,
}) {
  const sx = sourceRect.x + sourceRect.w;
  const sy = midY(sourceRect);
  const tx = targetRect.x;
  const ty = midY(targetRect);

  // SVAR-M54: `base` follows `vx` through every rule below as the channel's
  // coordinate BEFORE this link's own offset, so routes the channel
  // allocation separated around one base can be told to share it.
  let base = sx + tokens.clearance;
  let vx = base + channelOffset * tokens.channelStep;

  // Blocking-bar corridor (D-166 §C "blocking-bar corridor" / TECH_SPEC
  // §6.10.1): a bar strictly between the source and target rows that the
  // candidate vertical would cross pushes the vertical to clear of the
  // furthest-right such bar, ONE global push rather than a per-row search —
  // that is what keeps this a single principal vertical instead of a
  // staircase.
  const rowLo = Math.min(sourceRect.y, targetRect.y);
  const rowHi = Math.max(sourceRect.y, targetRect.y);
  const blockers = obstacles.filter(
    (o) =>
      o.y > rowLo &&
      o.y < rowHi &&
      o.x - tokens.clearance < vx &&
      o.x + o.w + tokens.clearance > vx,
  );
  if (blockers.length) {
    base = Math.max(...blockers.map((o) => o.x + o.w)) + tokens.clearance;
    vx = base + channelOffset * tokens.channelStep;
  }

  /*
   * If clearing every blocker would push the vertical past the target
   * itself, there is no clean corridor: cap it short of the target and let
   * the line pass visually behind whatever bar remains in the way (Links.jsx
   * paints links below bars, so this is the "behind-bar occlusion fallback"
   * of D-166 §C / TECH_SPEC §6.10.1 — z-order alone, no extra geometry).
   *
   * SVAR-M41 (R3-1): the cap is `sideEntryRun`, not `minRun`. This is the
   * line that actually produced "Не исправлено.jpg": the product's GROUP
   * rows are summary bars spanning the whole project width, so ANY link
   * crossing a collapsed or expanded group's row finds a blocker whose own
   * right edge is off past the end of the timeline — the push always
   * overshoots, this cap always fires, and with `minRun` it always landed
   * the vertical exactly 10px from the target's left edge. Ten pixels is
   * less than the corner radius alone, so every such link got the collapsed
   * final run and the stranded arrowhead. Capping at the room a side entry
   * really needs keeps the accepted occlusion fallback and gives it a final
   * approach that reads.
   *
   * The channel offset is subtracted rather than added once the cap binds:
   * a fan-in whose members all cap would otherwise collapse onto one
   * vertical x, which is the shared trunk D-166 §G forbids. Stepping them
   * back to the LEFT keeps them `channelStep` apart and keeps every one of
   * them at or beyond the floor.
   *
   * The final `Math.max` is the floor's own guarantee: `routeLink` only
   * reaches this route class when `gap > clearance + sideEntryRun`, so
   * `sx + clearance` is always left of the cap and the resulting final run
   * is always at least `sideEntryRun` — with a channel offset it is the gap
   * minus the clearance, which is larger still.
   */
  const cap = tx - sideEntryRun(tokens) - channelOffset * tokens.channelStep;
  if (vx > cap) {
    vx = cap;
    base = tx - sideEntryRun(tokens);
  }
  const floor = sx + tokens.clearance;
  if (vx < floor) {
    // The floor carries no channel offset at all: the vertical IS the
    // floor line, so that is its bundle.
    vx = floor;
    base = floor;
  }

  return {
    routeClass: 'standard',
    points: [
      [sx, sy],
      [vx, sy],
      [vx, ty],
      [tx, ty],
    ],
    segmentBundles: [lineKey('h', sy), lineKey('v', base), lineKey('h', ty)],
    arrowDir: 'right',
  };
}

function reverseBypassRoute({
  sourceRect,
  targetRect,
  rowHeight,
  channelOffset,
  tokens,
}) {
  const sx = sourceRect.x + sourceRect.w;
  const sy = midY(sourceRect);
  const tx = targetRect.x;
  const ty = midY(targetRect);
  const below = targetRect.y >= sourceRect.y;

  // The free strip near the TARGET row's own edge (top edge if the source is
  // below it, bottom edge if the source is above). `rowHeight` (not the
  // bar's own possibly-inset height) is what stays constant across
  // Day/Week/Month scale modes, so this corridor does not jump when the
  // consumer changes timeline density.
  const rowCenter = targetRect.y + targetRect.h / 2;
  const rowTop = rowCenter - rowHeight / 2;
  const rowBottom = rowCenter + rowHeight / 2;

  // SVAR-M34 (visual-review correction to D-166 §D, "плохо реализовано.jpg";
  // R1 correction to the first cut of this same fix, which pulled the
  // corridor back from the boundary by up to `clearance / 2` even when the
  // bar left no such room, landing it a few px ABOVE the real separator
  // instead of ON it). The row boundary itself — not some inset measured
  // off it — IS the corridor: every bar the chart draws already keeps some
  // padding inside its own row (the theme reserves it; a bar is never as
  // tall as its row), so the exact line between two rows is the one point
  // guaranteed clear of BOTH the row above's bar and the row below's,
  // without measuring either. The margin is still measured, but only as a
  // guard for a bar that leaves none at all (a theme/config this router has
  // never actually seen) — pull back the smallest step that clears it,
  // never further.
  const topMargin = targetRect.y - rowTop;
  const bottomMargin = rowBottom - (targetRect.y + targetRect.h);
  const cy = below
    ? topMargin > 0
      ? rowTop
      : rowTop + 1
    : bottomMargin > 0
      ? rowBottom
      : rowBottom - 1;

  // SVAR-M36 (visual-review correction: the corner where this corridor
  // turns to exit the source bar, and the one where it turns to enter the
  // target bar, both sit right next to a bar — exactly where a smooth,
  // full-radius curve reads best. `clearance` (the minimum gap off a bar)
  // is shorter than `2 * radius`, so a corner built on a `clearance`-long
  // run could only ever curve at HALF the token's own radius (D-166 §I:
  // "clamped to half of whichever adjacent segment is shorter" — correct
  // rounding of a short run, but the run itself was shorter than it needed
  // to be). `entryRun` is the longer of the two, so both corners get the
  // FULL `radius` whenever there is room for it, matching the corridor's
  // own already-smooth corners instead of reading tighter than them.
  /*
   * SVAR-M41 (R3-1): `sideEntryRun` joins the two terms already here. The
   * corridor's return run (`returnX -> tx`) IS a side entry — same corner,
   * same straight run, same arrowhead as a standard L's — so it needs the
   * same room, and `radius * 2` (24px) left it only 12px of stroke after
   * the corner for a 10.5px arrowhead. The source-exit run is given the
   * same value for the same reason SVAR-M36 gave it `radius * 2`: the two
   * corners sit next to bars, where reading tighter than the corridor's own
   * corners is exactly the defect that fix addressed.
   */
  const entryRun = Math.max(
    tokens.clearance,
    tokens.radius * 2,
    sideEntryRun(tokens),
  );
  /*
   * R2-2/R2-8 (Pavel manual acceptance remediation, live findings): the
   * swing-out point used to be `Math.max(sx, targetRect.x + targetRect.w)`
   * — clearing the target's own FAR right edge before turning back, on the
   * theory that the corridor needed to go "around" the target bar's whole
   * width. Every geometry this router had actual test coverage for keeps
   * `sx` the larger of the two (an ordinary bar is never wider than the
   * gap that put it in reverse-bypass to begin with), so that theory was
   * never actually exercised — until a collapsed GROUP's own summary bar
   * became a real target: `AggregateLinks.jsx` routes to a representative
   * whose rect can be hundreds of pixels wide (the group's own full date
   * span), and clearing ITS far edge sent the corridor most of the way
   * across the visible chart before it turned back, a detour with no
   * relationship to where either bar actually is ("Неправильно проложенный
   * маршрут.jpg", and a second, live-reported case literally captioned
   * "какой должен быть путь" with an arrow at a fraction of that length).
   *
   * The corridor's own two horizontal runs (`[sx,hx]` at the source row,
   * `[hx,returnX]` at the row BOUNDARY `cy`) never enter the target bar's
   * own vertical span regardless of how far `hx` reaches — `cy` sits at
   * the row's outer edge specifically so it clears the bar without having
   * to out-run its width (SVAR-M34's own finding, reused here, not
   * re-derived). Nothing here needed the target's far edge at all: `hx`
   * only ever has to clear the SOURCE's own bar, which is what it does
   * now. A wide target's row-boundary run simply travels alongside its own
   * top or bottom edge for however much of its width the corridor's path
   * crosses — visually hugging the bar it used to swing wide around.
   */
  const hx = sx + entryRun + channelOffset * tokens.channelStep;
  const returnX = tx - entryRun;

  return {
    routeClass: 'reverseBypass',
    points: [
      [sx, sy],
      [hx, sy],
      [hx, cy],
      [returnX, cy],
      [returnX, ty],
      [tx, ty],
    ],
    // SVAR-M54: the swing-out vertical is the one channel here (its base is
    // `sx + entryRun`); the corridor at `cy`, the return vertical and the
    // final run are all fixed by the target's own row, with no offset.
    segmentBundles: [
      lineKey('h', sy),
      lineKey('v', sx + entryRun),
      lineKey('h', cy),
      lineKey('v', returnX),
      lineKey('h', ty),
    ],
    arrowDir: 'right',
  };
}

function genericRoute({ sourceRect, targetRect, type, tokens }) {
  const sx = sourceExitX(sourceRect, type);
  const tx = targetEntryX(targetRect, type);
  const sy = midY(sourceRect);
  const ty = midY(targetRect);
  const exitDir = type && type[0] === 's' ? -1 : 1;
  const entryDir = type && type[2] === 'e' ? 1 : -1;
  const vx = sx + exitDir * tokens.clearance;
  const approachX = tx + entryDir * tokens.clearance;
  return {
    routeClass: 'generic',
    points: [
      [sx, sy],
      [vx, sy],
      [vx, ty],
      [approachX, ty],
      [tx, ty],
    ],
    // SVAR-M54: no channel is ever assigned to this shape's vertical, so
    // every segment is a plain line fixed by one end.
    segmentBundles: [
      lineKey('h', sy),
      lineKey('v', vx),
      lineKey('h', ty),
      lineKey('h', ty),
    ],
    arrowDir: entryDir > 0 ? 'left' : 'right',
  };
}

/*
 * Classify one link and build its route, given the rectangles already
 * resolved for its source/target bar, the OTHER bars that may block a
 * corridor, the current row height and a deterministic channel offset (see
 * `assignChannels` below).
 */
/*
 * SVAR-M41 (R3-1): the length of the run the arrowhead is drawn on — the
 * route's own last segment, before rounding and before the arrow trim.
 */
function finalRunLength(points) {
  if (points.length < 2) return 0;
  return distance(points[points.length - 2], points[points.length - 1]);
}

/*
 * SVAR-M41 (R3-1), the invariant itself, stated once for every route class
 * that enters from the side.
 *
 * A side entry is only allowed to be EMITTED when the geometry can actually
 * host one: the last corner's radius, a visible straight run, and the
 * arrowhead. The three route builders above each keep their own end of this
 * by construction, so in practice this never fires for them — it is here
 * because "never emit a degenerate side entry" is the product rule, and a
 * rule that lives only inside three separate formulas is a rule that the
 * next change to any one of them can lose. When it does fire, the answer is
 * NOT a compressed side L drawn anyway: it is the tight-entry family, the
 * accepted fallback D-166 §E/§F already names for a joint with no room for
 * a clean side approach (and the reason the product has `tightEntry` at
 * all).
 *
 * Scoped to the canonical forward shape. A `generic` route (a link type the
 * product cannot create — see `isCanonicalForwardType`) deliberately gets a
 * plain clearance-only orthogonal path and no route-class taxonomy, and
 * rewriting it into a family built for `e2s` would be inventing behaviour
 * for a shape nothing produces.
 */
function isSideEntry(route) {
  return route.arrowDir === 'right' || route.arrowDir === 'left';
}

export function routeLink({
  sourceRect,
  targetRect,
  type = 'e2s',
  channelOffset = 0,
  obstacles = [],
  rowHeight,
  tokens = LINK_TOKENS,
}) {
  if (!isCanonicalForwardType(type)) {
    return genericRoute({ sourceRect, targetRect, type, tokens });
  }

  const sx = sourceRect.x + sourceRect.w;
  const tx = targetRect.x;
  const gap = tx - sx;
  // A small forward tolerance: a target starting a couple of px before the
  // source's own end is not a genuine backward-time arrangement, it is
  // ordinary pixel/rounding noise.
  const fwd = gap >= -2;

  if (fwd && gap <= tightGapLimit(tokens)) {
    return tightEntryRoute({ sourceRect, targetRect, channelOffset, tokens });
  }

  const route = fwd
    ? standardRoute({
        sourceRect,
        targetRect,
        obstacles,
        channelOffset,
        tokens,
      })
    : reverseBypassRoute({
        sourceRect,
        targetRect,
        rowHeight,
        channelOffset,
        tokens,
      });

  if (
    isSideEntry(route) &&
    finalRunLength(route.points) + 0.5 < sideEntryRun(tokens)
  ) {
    return tightEntryRoute({ sourceRect, targetRect, channelOffset, tokens });
  }
  return route;
}

/* ------------------------------------------------------------------------ *
 * Deterministic channel allocation (D-166 §G/§H — visible links never share
 * a trunk; TECH_SPEC §6.10.1)
 * ------------------------------------------------------------------------ */

/*
 * `links`: [{ id, sourceId, sourceSide, targetId, targetSide }]. Two links
 * "collide" here when they share the same source exit point or the same
 * target entry point — the fan-out / fan-in cases D-166 §G names. Within
 * each colliding group the channel index is assigned by sorting on the
 * link's own stable `id`, never by array/iteration order, so an unrelated
 * change elsewhere cannot make an existing link's route jump between
 * renders (D-166 §G "deterministic ordering").
 */
export function assignChannels(links) {
  const bySourceExit = new Map();
  const byTargetEntry = new Map();
  for (const link of links) {
    const sk = `${link.sourceId}:${link.sourceSide}`;
    const tk = `${link.targetId}:${link.targetSide}`;
    if (!bySourceExit.has(sk)) bySourceExit.set(sk, []);
    if (!byTargetEntry.has(tk)) byTargetEntry.set(tk, []);
    bySourceExit.get(sk).push(link);
    byTargetEntry.get(tk).push(link);
  }

  const channelOf = new Map();
  const assignFrom = (groups) => {
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const ordered = [...group].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      );
      ordered.forEach((link, index) => {
        const current = channelOf.get(link.id) ?? 0;
        channelOf.set(link.id, Math.max(current, index));
      });
    }
  };
  assignFrom(bySourceExit);
  assignFrom(byTargetEntry);

  for (const link of links) {
    if (!channelOf.has(link.id)) channelOf.set(link.id, 0);
  }
  return channelOf;
}

/* ------------------------------------------------------------------------ *
 * Rendering helpers: rounded SVG path, arrowhead polygon, trimming
 * ------------------------------------------------------------------------ */

function dedupePoints(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    if (distance(out[out.length - 1], points[i]) > 0.5) out.push(points[i]);
  }
  return out;
}

function pointToward(from, to, dist) {
  const len = distance(from, to) || 1;
  const d = Math.min(dist, len);
  return [
    from[0] + ((to[0] - from[0]) / len) * d,
    from[1] + ((to[1] - from[1]) / len) * d,
  ];
}

/*
 * Rounded-corner path (D-166 §I `link.radius`): each interior corner is
 * rounded by a quadratic curve whose radius is clamped to half of whichever
 * adjacent segment is shorter, so a short segment is never over-rounded into
 * a shape bigger than the segment itself.
 */
export function buildRoundedPath(rawPoints, radius) {
  const points = dedupePoints(rawPoints);
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M${points[0][0]},${points[0][1]} L${points[1][0]},${points[1][1]}`;
  }
  const d = [`M${points[0][0]},${points[0][1]}`];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const next = points[i + 1];
    const d1 = distance(prev, cur);
    const d2 = distance(cur, next);
    const r = Math.max(0, Math.min(radius, d1 / 2, d2 / 2));
    if (r <= 0.01) {
      d.push(`L${cur[0]},${cur[1]}`);
      continue;
    }
    const p1 = pointToward(cur, prev, r);
    const p2 = pointToward(cur, next, r);
    d.push(`L${p1[0]},${p1[1]}`);
    d.push(`Q${cur[0]},${cur[1]} ${p2[0]},${p2[1]}`);
  }
  const last = points[points.length - 1];
  d.push(`L${last[0]},${last[1]}`);
  return d.join(' ');
}

/*
 * The filled arrowhead triangle (D-166 §I/§K "the arrowhead is a separate
 * filled shape from the stroked route"). `tip` is where the arrow points;
 * `direction` is the cardinal direction it points in.
 */
export function arrowPolygonPoints(tip, direction, tokens = LINK_TOKENS) {
  const length = tokens.arrowLength;
  const half = tokens.arrowWidth / 2;
  let back;
  let side;
  switch (direction) {
    case 'left':
      back = [tip[0] + length, tip[1]];
      side = [0, half];
      break;
    case 'up':
      back = [tip[0], tip[1] + length];
      side = [half, 0];
      break;
    case 'down':
      back = [tip[0], tip[1] - length];
      side = [half, 0];
      break;
    case 'right':
    default:
      back = [tip[0] - length, tip[1]];
      side = [0, half];
      break;
  }
  const p1 = [back[0] - side[0], back[1] - side[1]];
  const p2 = [back[0] + side[0], back[1] + side[1]];
  return `${tip[0]},${tip[1]} ${p1[0]},${p1[1]} ${p2[0]},${p2[1]}`;
}

/*
 * Shortens the route's final segment by the arrow's own length so the
 * rounded stroke does not poke through the filled triangle drawn on top of
 * it (D-166 §I/§K: the arrowhead is drawn as its own shape, independent of
 * the stroke, including when the stroke is dashed for an informational
 * link — the arrow itself always stays solid, decided by the caller's own
 * stroke-dasharray choice, not by this trim).
 */
export function trimForArrow(points, tokens = LINK_TOKENS) {
  if (points.length < 2) return points;
  const tip = points[points.length - 1];
  const prev = points[points.length - 2];
  const trimmed = pointToward(tip, prev, tokens.arrowLength - 1);
  return [...points.slice(0, -1), trimmed];
}

export function boundingBox(points) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return {
    x1: Math.min(...xs),
    x2: Math.max(...xs),
    y1: Math.min(...ys),
    y2: Math.max(...ys),
  };
}

/*
 * The one entry point Links.jsx calls per link: resolves the route class,
 * the rounded path `d`, the arrowhead polygon and a bounding box for the
 * renderer's own viewport culling (TECH_SPEC §6.10.1 — `_links`, not
 * `_visibleLinks`: the old store-computed culling rectangle is not a safe
 * bound for a route this router drew).
 */
export function buildLink({
  sourceRect,
  targetRect,
  type,
  channelOffset,
  obstacles,
  rowHeight,
  tokens = LINK_TOKENS,
}) {
  const { points, arrowDir, routeClass, segmentBundles } = routeLink({
    sourceRect,
    targetRect,
    type,
    channelOffset,
    obstacles,
    rowHeight,
    tokens,
  });
  const bbox = boundingBox(points);
  const tip = points[points.length - 1];
  const trimmed = trimForArrow(points, tokens);
  return {
    routeClass,
    d: buildRoundedPath(trimmed, tokens.radius),
    arrow: arrowPolygonPoints(tip, arrowDir, tokens),
    arrowDir,
    bbox,
    // The raw (pre-rounding, pre-arrow-trim) polyline: exact corners, not
    // an approximation recovered from the rounded `d` path string. Only a
    // consumer doing its OWN geometry on the route needs this (SVAR-M37's
    // viewport-aware badge anchor, D-166 §L) — Links.jsx itself never
    // reads it, only `d`/`arrow`/`bbox`.
    points,
    // SVAR-M54 (D-171): one bundle key per segment of `points`, for the
    // offscreen chip's grouping — see `lineKey` above. Links.jsx never
    // reads it either.
    segmentBundles,
  };
}
