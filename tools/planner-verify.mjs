#!/usr/bin/env node
/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Fork-local checks. Run: `node tools/planner-verify.mjs`
 *
 * Four small questions, asked of this repository alone, so that a future commit
 * cannot casually lose provenance or drift across the Community/PRO boundary
 * before the artefact ever reaches the Planner:
 *
 *   1  UPSTREAM BASE   the recorded upstream tag is still an ancestor of HEAD,
 *                      and still names the recorded commit
 *   2  LICENCE         the committed license.txt blob at HEAD is byte-identical
 *                      to the upstream base blob, and no staged or unstaged
 *                      tracked modification exists against it
 *   3  OWNED DIFF      every upstream file this project changed is declared
 *                      here, with a reason; every other changed path is a file
 *                      this project added
 *   4  PRO DRIFT       no EXECUTABLE line this project ADDED mentions any
 *                      identifier of the Community/PRO reset — this file
 *                      excepted, since it is where that reset is written down
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1).
 *
 * Check 1 proves an ancestry relationship between commits. It says nothing
 * about what the commits contain.
 *
 * Check 2 proves the licence file was not edited. It is not a legal opinion.
 *
 * Check 3 proves that the set of upstream files touched is the declared set. It
 * does NOT prove the changes inside them are correct, small or wise; that is
 * what reading `git diff` and the Planner's own regression suite are for.
 *
 * Check 4 is a BOUNDED SYNTACTIC TRIPWIRE and nothing more. It proves that no
 * EXECUTABLE line added by this project spells one of the PRO identifier
 * names. It does NOT prove the absence of a hand-written function that is
 * semantically equivalent to a PRO capability under a different name; only
 * independent review catches that, and under the project's rules it is a
 * Blocker even when every automated check here is green. It also says nothing
 * about the built artefact: the Planner runs the complementary differential
 * check there, comparing a pristine upstream build against the fork build
 * token by token.
 *
 * ### The word "executable", and why check 4 says it (R7, review finding F-2)
 *
 * Until R7 check 4 scanned every added line of every added path, and it was
 * red on 22 of them without a single PRO API anywhere in the fork. All 22 were
 * the same collision: `summary`, `calendar`, `rollups` and `splitTasks` are
 * PRO STORE PROPERTIES *and* ordinary English words *and* — for `summary` —
 * the vendor's own public Community task type. A fork whose newest owned
 * modification is literally about summary-bar geometry (SVAR-M10) cannot
 * describe itself without the word, so a check that reads prose was going to
 * stay red for as long as the documentation stayed honest, and a red check
 * proves nothing.
 *
 * So the scan was narrowed to the lines where a PRO capability could actually
 * be USED, along two boundaries that are provable rather than convenient:
 *
 *   source kind      only `.js` / `.jsx` / `.mjs` / `.cjs` / `.ts` / `.tsx`.
 *                    A markdown paragraph and a `package.json` script name are
 *                    not executed by anything; no PRO call can be reached from
 *                    them. Adding a PRO-carrying DEPENDENCY would still be
 *                    caught — by check 3, which declares every changed path,
 *                    and by the Planner's differential token check on the
 *                    built artefact.
 *
 *   line kind        within those files, not a WHOLE-LINE comment (`//…`, and
 *                    a line whose first non-space character is `*` or `/*`).
 *                    A whole-line comment is never executable JavaScript. A
 *                    line with any code before its `//` still is, and is still
 *                    scanned.
 *
 * NOTHING ELSE was relaxed: no identifier was removed from the list, no source
 * directory was excluded, and no occurrence is allowlisted individually. A PRO
 * identifier in real code — in any owned upstream file, in any file this
 * project added, in a string, in a JSX prop — is still a failure. The
 * counterexample kept for exactly this claim is recorded in `PLANNER_FORK.md`:
 * the check was re-run with a PRO use injected into ordinary code and went
 * red, twice, before this narrowing shipped.
 *
 * Deliberately NOT checked here: that the built artefact matches a recorded
 * hash. That belongs to the consumer, which is the only place that knows which
 * commit it actually installed.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

/* ------------------------------------------------------------------------ *
 * The only authored configuration in this file.
 * ------------------------------------------------------------------------ */

const UPSTREAM_TAG = 'v2.7.1';
const UPSTREAM_COMMIT = '0c5788a8ffda80c8f0cb5a61d5113fb036eedebb';

/**
 * Upstream files this project deliberately changes, each with the reason.
 * A new renderer feature adds its file here in the same commit that changes it:
 * that is the point of the check, and it is why the list is short by design.
 */
const OWNED_UPSTREAM_FILES = {
  'package.json':
    '`prepare` builds the package: a git dependency has no publish step; ' +
    '`test:planner` runs the pure unit tests of SVAR-M4 (annotation layout), ' +
    'SVAR-M10 (ancestor bar geometry), SVAR-M11 (bar-drag preview gate), ' +
    'SVAR-M31 (the chart axis\' date <-> pixel projection), ' +
    'SVAR-M32 (the deterministic link router) and ' +
    'SVAR-M34 (the reverse-bypass corridor\'s own bar-margin clamp)',
  'readme.md':
    'says in its first lines that this is a project-owned fork (MIT attribution)',
  'src/index.js':
    'SVAR-M19 — exports the ThemeScope component; the package\'s export list is where a new public component becomes public',
  'src/components/chart/Bars.jsx':
    'SVAR-M2 — the drag-activation pixel threshold; ' +
    'SVAR-M5 — reports each accepted step of a bar drag through the new onDragPreview callback; ' +
    'SVAR-M10 — draws an ancestor summary whose transient width the store collapsed to zero at its pre-gesture size, translated by the gesture; ' +
    'SVAR-M30 — the new barGesturesDisabled prop withholds every direct bar gesture and the affordances that advertise them, and nothing else, and the bars wearing the resize cursor give it back on the render that withholds them (R2, B-1); ' +
    'SVAR-M32 — renders <Links> with the linkPresentation pass-through; ' +
    'SVAR-M33 — Esc cancels a pending link-create draft: a keydown listener attached only while one is pending, calling the existing removeLinkMarker and nothing else',
  'src/components/Gantt.jsx':
    'SVAR-M3 — new `scaleCellAriaLabel` prop, threaded through to TimeScale.jsx; ' +
    'SVAR-M28 — new `onScaleCellContextMenu` prop, threaded through to TimeScale.jsx beside it; ' +
    'SVAR-M4 — new `timelineAnnotations` prop, threaded through to Layout.jsx; ' +
    'SVAR-M5 — new `onTimelineDragPreview` prop, threaded through to Layout.jsx; ' +
    'SVAR-M12 — new `gridActionSlot` prop, threaded through to Layout.jsx; ' +
    'SVAR-M17 — new `gridActionSlotMinHeight` prop, threaded through to Layout.jsx; ' +
    'SVAR-M18 — new `consumerOwnsColumnWidths` prop, threaded through to Layout.jsx; ' +
    'SVAR-M20 — new `columnMinWidth` prop, threaded through to Layout.jsx; ' +
    'SVAR-M25 — new `gridMaxWidth`/`gridMinWidth` props and the `onGridWidthLimit` report, threaded through to Layout.jsx; ' +
    'SVAR-M26 — new `columnMaxWidth` prop, threaded through to Layout.jsx; ' +
    'SVAR-M30 — new `barGesturesDisabled` prop, threaded through to Layout.jsx; ' +
    'SVAR-M31 — a scale change re-centres the chart on the date that was under the middle of its viewport instead of keeping the pixel, through the one date <-> pixel projection in chart/chartDateProjection.js, which also normalizes a date-based scroll-chart request to a left before the store converts it from the wrong origin (R2, M-1); ' +
    'SVAR-M32 — new `linkPresentation` prop, threaded through to Layout.jsx',
  'src/components/Layout.jsx':
    'SVAR-M3 — `scaleCellAriaLabel` prop pass-through; ' +
    'SVAR-M28 — `onScaleCellContextMenu` prop pass-through, unread; ' +
    'SVAR-M4 — owns the annotation layout (useTimelineAnnotationLayout + AnnotationMeasurer) and adds the lane height to the scroll/height math; ' +
    'SVAR-M5 — owns the transient bar-drag preview state; SVAR-M6 — hands the RESOLVED lane height to Grid.jsx; ' +
    'SVAR-M11 — asks barDragPreviewGate.js whether a given drag step has to be written into that state at all; ' +
    'SVAR-M12 — carries the consumer\'s grid action slot to Grid.jsx and decides, for BOTH halves, whether the top scale row stays blank without a lane; ' +
    'SVAR-M17 — resolves the slot\'s declared minimum ONCE (dropped unless a slot was passed), hands the same number to both halves, and adds the resulting reserve to the scroll travel and to the chart height published to the store; ' +
    'SVAR-M18 — passes `consumerOwnsColumnWidths` through to the grid, unread; ' +
    'SVAR-M20 — passes `columnMinWidth` through to the grid, unread; ' +
    'SVAR-M22 — hands the theme value down so the lattice can be redrawn when it changes; ' +
    'SVAR-M25 — owns the width limit this layout\'s own geometry allows (a different number once the chart has been hidden on purpose), reports it through `onGridWidthLimit`, and resolves the consumer\'s ceiling and floor against it for the splitter gesture; the floor is the one bound geometry may not narrow; ' +
    'SVAR-M26 — passes `columnMaxWidth` through to the grid, unread; ' +
    'SVAR-M30 — passes `barGesturesDisabled` through to the chart half only, unread; ' +
    'SVAR-M32 — passes `linkPresentation` through to the chart half only, unread',
  'src/components/chart/Chart.jsx':
    'SVAR-M3 — `scaleCellAriaLabel` prop pass-through; ' +
    'SVAR-M28 — `onScaleCellContextMenu` prop pass-through; ' +
    'SVAR-M4 — renders <TimelineLines> inside .wx-area and passes the annotation layout to TimeScale.jsx; ' +
    'SVAR-M5 — carries onBarDragPreview down to Bars.jsx; ' +
    'SVAR-M12 — carries reserveTopScaleRow down to TimeScale.jsx; ' +
    'SVAR-M17 — carries the resolved gridActionSlotMinHeight down to TimeScale.jsx; ' +
    'SVAR-M30 — carries barGesturesDisabled down to Bars.jsx, unread; ' +
    'SVAR-M32 — carries linkPresentation down to Bars.jsx, unread',
  'src/components/chart/TimeScale.jsx':
    'SVAR-M3 — applies `scaleCellAriaLabel(date, unit, value)` as each scale cell\'s aria-label; ' +
    'SVAR-M28 — each rendered scale cell reports a right click through `onScaleCellContextMenu({ event, date, unit })`, preventing nothing; ' +
    'SVAR-M4 — renders <AnnotationLane> inside the sticky .wx-scale; ' +
    'SVAR-M8 — renders the lane BETWEEN the top scale row and the lower ones, and the lower-row band of the annotation lines; ' +
    'SVAR-M9 — keeps a body-only line out of that lower-row band; ' +
    'SVAR-M12 — asks the split owner with the same reserveTopScaleRow the grid is given; ' +
    'SVAR-M17 — renders the blank reserve band between the top scale row and the lane, and starts the lower-row line band below it; ' +
    'SVAR-M29 — that reserve band renders the day-column separators from the same owner the lane asks (annotations/ScaleColumnGrid.jsx), and is a positioning context so they fill it',
  'types/index.d.ts':
    'SVAR-M3 — type declaration for the new `scaleCellAriaLabel` prop; ' +
    'SVAR-M28 — `IScaleCellContextMenu` and the `onScaleCellContextMenu` prop; ' +
    'SVAR-M4 — `ITimelineAnnotation` and the `timelineAnnotations` prop; ' +
    'SVAR-M5 — `ITimelineDragPreview`, the `onTimelineDragPreview` prop and the `followsTaskId`/`previewDate` annotation fields; ' +
    'SVAR-M9 — the `lineExtent` and `stripeWidth` annotation fields; ' +
    'SVAR-M12 — the `gridActionSlot` prop; ' +
    'SVAR-M17 — the `gridActionSlotMinHeight` prop; ' +
    'SVAR-M18 — the `consumerOwnsColumnWidths` prop; ' +
    'SVAR-M19 — the `ThemeScope` component; ' +
    'SVAR-M20 — the `columnMinWidth` prop; ' +
    'SVAR-M23 — `IHeaderCellConfig` and the header descriptor\'s `align`; ' +
    'SVAR-M25 — the `gridMaxWidth`/`gridMinWidth` props and the `onGridWidthLimit` report; ' +
    'SVAR-M26 — the `columnMaxWidth` prop; ' +
    'SVAR-M32 — `ILinkIdentity`, `ILinkPresentation` and the `linkPresentation` prop',
  'src/components/chart/Links.jsx':
    'SVAR-M32 — the deterministic link router (src/planner-router/route.js) replaces the store-computed `link.$p` entirely: reads `_links` (not `_visibleLinks`, whose culling rectangle is computed from the store\'s OWN route) and the full unsliced `_tasks` for source/target rectangles, assigns deterministic per-link channels so visible fan-in/fan-out never shares a trunk, draws a rounded SVG path plus a separate filled arrowhead polygon, and applies the new `linkPresentation` prop\'s `lineStyle` as a stroke-dasharray (never on the arrowhead); ' +
    'SVAR-M34 — the router\'s reverseBypassRoute (src/planner-router/route.js) measures its corridor from the target bar\'s own edge instead of a fixed rowHeight fraction, so the corridor cannot land inside a bar that nearly fills its row',
  'src/components/chart/Links.css':
    'SVAR-M32 — draws the router\'s `<path>` output (was a `<polyline>`), the dash patterns `linkPresentation` selects, and the arrowhead polygon\'s fill, matching the line\'s own colour/hover/critical/selected states',
  'src/themes/Willow.css':
    'SVAR-M32 — a dedicated light-theme `--wx-gantt-link-color`, distinct from the dark theme\'s (D-166 §J): the pale grey shared between both themes read as barely visible against a light background',
  'src/themes/WillowDark.css':
    'SVAR-M32 — a dedicated dark-theme `--wx-gantt-link-color`, distinct from the light theme\'s and kept clearly dimmer than task-title text (D-166 §J)',
  'src/components/Resizer.jsx':
    'SVAR-M25 — the splitter gesture answers to the consumer\'s own range: `RESIZER_RIGHT_THRESHOLD` and `RESIZER_SIZE` become named exports so the layout can read the two numbers instead of spelling them again, `maxWidth`/`minWidth` clamp the ONE position the store write, the display-mode branch and the drawn splitter all read, and a consumer that declares a range also takes over which side is shown, so a drag can no longer collapse either half into a state where this component refuses the resize cursor and pointerdown',
  'src/components/chart/CellGrid.jsx':
    'SVAR-M22 — the working-area lattice follows the theme it is being shown in: the colour is read from the live `--wx-gantt-border` whenever the theme context changes, not once at mount, because the lattice is a canvas image and the colour is baked into it when it is drawn',
  'src/themes/ThemeScope.jsx':
    'SVAR-M19 — one theme element whose identity does not depend on which theme it shows: the theme is a prop, not a choice of component, so changing it remounts nothing',
  'src/themes/Willow.jsx':
    'fonts={false} to core: this package ships its own fonts and icons, so core must not add the CDN <link>s',
  'src/themes/WillowDark.jsx':
    'fonts={false} to core: this package ships its own fonts and icons, so core must not add the CDN <link>s',
  'src/themes/Material.jsx':
    'fonts={false} to core: this package ships its own fonts and icons, so core must not add the CDN <link>s',
  'vite.config.js':
    'sourcemapPathTransform makes dist/index.es.js.map sources deterministic and package-relative — an ' +
    'ephemeral install-time clone directory path was otherwise leaking into them (SVAR-LOCAL-ASSETS)',
  'src/components/grid/Grid.jsx':
    'SVAR-M6 — reserves the RESOLVED annotation-lane height as a blank spacer, and shifts the grid body by the same amount, so grid and chart rows share one y; ' +
    'SVAR-M8 — puts that reservation ABOVE the column-header block, whose own height becomes the lower scale rows\' band; ' +
    'SVAR-M12 — renders the consumer\'s action slot in that same reserved band; ' +
    'SVAR-M13 — maps the reorder helper\'s new `child` zone onto move-task mode "child"; ' +
    'SVAR-M14 (R3) — the two adjacency corrections become `resolveDrop`, a pure resolution the reorder helper asks for BEFORE it marks anything, so the marker and the dispatched move-task are one descriptor; ' +
    'SVAR-M14 (R4) — `resolveDrop` becomes the cursor model\'s meaning layer: the open-container rewrite is unconditional, a hit ON a separator is re-expressed as "before the row below" so one boundary has one descriptor, and the direction-inverting adjacency correction is gone' +
    'SVAR-M15 (R5) — a dragged container keeps its expanded state: the unconditional collapse `startReorder` used to dispatch is removed and nothing replaces it, so a drag writes no presentation state of its own; ' +
    'SVAR-M17 — the slot\'s reserve band enters the same header offset, and the lane spacer sits below it; ' +
    'SVAR-M18 — with the consumer owning the widths, a column resize is reported at every accepted step and no column is handed another column\'s flexgrow; ' +
    'SVAR-M20 — the resize gesture never proposes a width below the consumer\'s declared minimum, clamped before the store writes it; ' +
    'SVAR-M23 — a column may align its header label independently of its cells, through a header descriptor the store copies as it is; ' +
    'SVAR-M24 — a grid row carries `wx-row-<type>` from the kind the consumer put on it, so a stylesheet can reach what the diagram already says; ' +
    'SVAR-M26 — and never above the consumer\'s declared maximum for one column, clamped at the same seam and for the same reason; ' +
    'SVAR-M27 — the action slot renders one level deeper, inside a new sticky anchor wrapper, so its position resolves against the grid\'s own horizontal scrollport rather than the scrolled column content',
  'src/helpers/reorder.js':
    'SVAR-M13 — a row\'s middle band means "into this row": the drag can now report a `child` zone, which `move-task` has always accepted; ' +
    'SVAR-M14 — the row a drop would land at carries `data-wx-drop-zone`; ' +
    'SVAR-M14 (R3) — one live resolved drop descriptor is marked, dispatched and dropped, so the indicator cannot describe a different result from the drop; ' +
    'SVAR-M14 (R4) — the hit test is FULLY CURSOR-BASED: `pointerZone` is a pure function of the pointer and the target box, the dragged row\'s own edges are gone, and a boundary magnet collapses each separator to one descriptor; ' +
    'SVAR-M14 (R6) — the gesture ALWAYS terminates: `pointerup`/`pointercancel`/`blur` join `mouseup` as terminators (Chromium does not always deliver the compatibility `mouseup`), and the listeners are removed from the target they were added to; ' +
    'SVAR-M16 — `pointercancel` and `blur` terminate through a SEPARATE handler, `handleCancel`, which calls `up()` with no event at all, so a genuine `pointercancel`\'s own `clientX`/`clientY` — which real Chromium DOES populate, on the exact target a legitimate drop would land on — can never reach `releasedOnRows` and be misread as a release worth committing',
  'src/components/grid/Grid.css':
    'SVAR-M6 — the blank marker-lane spacer, and the containing block it is positioned against; ' +
    'SVAR-M8 — the blank top-scale-row band and the header offset that puts both bands above the column headers; ' +
    'SVAR-M12 — the action slot inside that band, bottom-aligned and pointer-taking; ' +
    'SVAR-M27 — the sticky anchor wrapper the action slot now resolves its position against, so it reads the grid\'s own viewport instead of its scrolled column content; ' +
    'SVAR-M27 (R7.2) — that wrapper is the whole action band\'s outermost stacking context, so its layer is 11: above the chart timescale (5) and the splitter (10), not merely above the grid\'s own sticky header (3)',
  'src/components/chart/TimeScale.css':
    'SVAR-M8 — the lower-scale-row band of the annotation lines, and the stacking rule that keeps every scale label above them',
  '.gitignore':
    'ignores licenses/, generated by tools/planner-fonts.mjs the same way dist-full/ is (SVAR-LOCAL-ASSETS)',
};

/** Path prefixes of files this project ADDED (they have no upstream version). */
const PROJECT_ADDED = [
	'tools/planner-',
	'planner-assets/',
	'PLANNER_FORK.md',
	'.gitattributes',
	// SVAR-M4: the annotation components, their stylesheets and the pure layout owner.
	'src/components/chart/annotations/',
	// SVAR-M10: the pure summary-drag geometry owner.
	'src/components/chart/summaryDragGeometry.js',
	// SVAR-M31: the pure owner of the chart axis' date <-> pixel projection.
	'src/components/chart/chartDateProjection.js',
	// SVAR-M32: the deterministic link router.
	'src/planner-router/',
];

/**
 * The Community/PRO reset exactly as `DataStore.init()` in
 * `@svar-ui/gantt-store` states it about itself. Kept as the SENTENCE, not as a
 * hand-typed list of names, and the names below are split out of it
 * mechanically — an independent review of the Planner already caught a
 * hand-typed second copy that had silently lost five identifiers. Where
 * `@svar-ui/gantt-store` is installed here, check 4 additionally asserts this
 * text still appears verbatim in it, so the sentence cannot rot unnoticed.
 */
const PRO_DISABLE_SENTINEL =
  'unscheduledTasks=!1,t.baselines=!1,t.markers=[],t._markers=[],t.undo=!1,' +
  't.schedule={},t.criticalPath=null,t.splitTasks=!1,t.summary={},' +
  't.rollups=!1,t._rollups={},t.slack=!1,t.resources=null,t._resources=[],' +
  't.assignments=[],t.calendar=null,t.calendars=[],t._calendar=null,' +
  't._calendars={},t.groupBy=null,t.wbs=null;';

const PRO_TOKENS = PRO_DISABLE_SENTINEL.replace(/;\s*$/, '')
  .split(',')
  .map((pair) => pair.trim().replace(/^t\./, '').split('=')[0])
  .filter((name) => name.length > 0);

/* ------------------------------------------------------------------------ */

const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trimEnd();

const failures = [];
const note = (line) => console.log(line);
const fail = (line) => {
  failures.push(line);
  console.log(`FAIL  ${line}`);
};

/* 1 -- UPSTREAM BASE ------------------------------------------------------ */

/*
 * The base is the recorded COMMIT, and the tag only corroborates it.
 *
 * This used to be the other way round, and a fresh clone could not run this
 * file at all: `git clone` fetches tags, but this repository's origin carries
 * none, so `v2.7.1` resolved nowhere and four checks failed as
 * "prerequisite failures" — on a clone whose objects were completely intact.
 * The upstream commit itself is reachable from every branch here, so the clone
 * always had what the checks actually need.
 *
 * A 40-hex commit is immutable and is the stronger identifier of the two: a tag
 * can be moved, and the recorded SHA cannot. So the commit decides whether the
 * base is usable, and the tag — when a clone happens to have it — is checked
 * for AGREEMENT, because a tag that points somewhere else is a real provenance
 * violation and still fails.
 */

let upstreamBase = '';
try {
  upstreamBase = git('rev-parse', `${UPSTREAM_COMMIT}^{commit}`);
} catch {
  fail(
    `the recorded upstream base commit ${UPSTREAM_COMMIT} is not present in ` +
      `this clone — without it there is nothing to compare against`,
  );
}

let tagCommit = '';
try {
  tagCommit = git('rev-parse', `${UPSTREAM_TAG}^{commit}`);
} catch {
  note(
    `note  upstream tag ${UPSTREAM_TAG} is not in this clone, so it could not ` +
      `corroborate the recorded base; the commit itself is what is verified`,
  );
}

if (tagCommit && tagCommit !== UPSTREAM_COMMIT) {
  fail(
    `upstream tag ${UPSTREAM_TAG} resolves to ${tagCommit}, ` +
      `not the recorded ${UPSTREAM_COMMIT}`,
  );
}

if (upstreamBase === UPSTREAM_COMMIT) {
  try {
    git('merge-base', '--is-ancestor', UPSTREAM_COMMIT, 'HEAD');
    note(
      `ok    upstream base ${UPSTREAM_COMMIT} is an ancestor of HEAD` +
        (tagCommit ? ` (tag ${UPSTREAM_TAG} agrees)` : ''),
    );
  } catch {
    fail(
      `upstream base ${UPSTREAM_COMMIT} is NOT an ancestor of ` +
        `HEAD — upstream ancestry was rewritten, which destroys the only proof ` +
        `of where this code came from`,
    );
  }
}

/* 2 -- LICENCE ------------------------------------------------------------ */

/*
 * Git-aware by design, not a raw byte comparison of the worktree file:
 *
 *   (a) the committed blob at HEAD is compared to the committed blob at the
 *       upstream base commit, via git's own content-addressed blob identity
 *       (`git rev-parse <rev>:<path>`) — this is immune to how the working
 *       tree happens to be materialised (LF, or CRLF under a normal Windows
 *       `core.autocrlf=true` checkout), because it never reads worktree
 *       bytes at all;
 *
 *   (b) `git status --porcelain` on the path proves there is no staged or
 *       unstaged tracked modification, using the same attribute-aware
 *       comparison git already applies for `git diff` — so a real edit
 *       (a changed character, added trailing whitespace, an added trailing
 *       line, or a staged-only change) still fails, while a CRLF checkout
 *       that git itself considers clean still passes.
 *
 * A previous version compared `readFileSync(...).trimEnd()` against
 * `git show`, which both false-failed on an ordinary CRLF checkout (the
 * comparison never went through git's own line-ending handling) and
 * false-passed a real trailing-whitespace or trailing-newline edit (trimEnd
 * silently discards exactly the bytes that would have caught it).
 */

const LICENSE_PATH = 'license.txt';
const licensePath = resolve(repoRoot, LICENSE_PATH);

if (!existsSync(licensePath)) {
  fail(`${LICENSE_PATH} is missing from the working tree`);
} else if (!upstreamBase) {
  fail(
    `${LICENSE_PATH} could not be verified: the upstream base commit is not ` +
      `resolvable in this clone (see check 1) — this is a prerequisite failure, ` +
      `not a pass`,
  );
} else {
  let headBlob = '';
  let baseBlob = '';
  try {
    headBlob = git('rev-parse', `HEAD:${LICENSE_PATH}`);
  } catch {
    fail(`${LICENSE_PATH} is not a tracked file at HEAD`);
  }
  try {
    baseBlob = git('rev-parse', `${UPSTREAM_COMMIT}:${LICENSE_PATH}`);
  } catch {
    fail(`the upstream base commit does not contain ${LICENSE_PATH}`);
  }

  const identityOk = Boolean(headBlob) && headBlob === baseBlob;
  if (headBlob && baseBlob && !identityOk) {
    fail(
      `${LICENSE_PATH} at HEAD (blob ${headBlob}) is not byte-identical to the ` +
        `upstream base blob (${baseBlob}) — it must stay untouched`,
    );
  }

  const dirty = git('status', '--porcelain', '--', LICENSE_PATH);
  if (dirty) {
    fail(
      `${LICENSE_PATH} has a staged and/or unstaged tracked modification ` +
        `against HEAD — it must stay untouched:\n         ` +
        dirty.split('\n').join('\n         '),
    );
  }

  if (identityOk && !dirty) {
    const committedContent = git('show', `HEAD:${LICENSE_PATH}`);
    if (!/MIT/.test(committedContent) || !/XB Software/.test(committedContent)) {
      fail(
        `${LICENSE_PATH} no longer carries the upstream MIT notice and copyright`,
      );
    } else {
      note(
        `ok    ${LICENSE_PATH} at HEAD is byte-identical to the upstream base ` +
          `blob, with no staged or unstaged tracked modification`,
      );
    }
  }
}

/* 3 -- OWNED DIFF --------------------------------------------------------- */

const changed = upstreamBase
  ? git('diff', '--name-only', `${UPSTREAM_COMMIT}..HEAD`)
      .split('\n')
      .filter(Boolean)
  : [];

const isProjectAdded = (file) => PROJECT_ADDED.some((p) => file.startsWith(p));
const undeclared = changed.filter(
  (file) => !isProjectAdded(file) && !(file in OWNED_UPSTREAM_FILES),
);

if (!upstreamBase) {
  fail(
    'owned-diff could not be checked: the upstream base commit is not ' +
      'resolvable in this clone (see check 1) — this is a prerequisite ' +
      'failure, not a pass',
  );
} else if (undeclared.length > 0) {
  for (const file of undeclared) {
    fail(
      `${file} is changed against the upstream base but is not declared in ` +
        `OWNED_UPSTREAM_FILES — declare it with its reason, in the commit that ` +
        `changes it`,
    );
  }
} else {
  note(`ok    ${changed.length} changed path(s), all declared:`);
  for (const file of changed) {
    const why = isProjectAdded(file)
      ? 'added by this project'
      : OWNED_UPSTREAM_FILES[file];
    note(`         ${file} — ${why}`);
  }
}

/* 4 -- PRO DRIFT ---------------------------------------------------------- */

const identifierHit = (line, name) =>
  new RegExp(
    `(?<![\\p{ID_Continue}$])${name}(?![\\p{ID_Continue}$])`,
    'u',
  ).test(line);

/** Paths whose lines a JavaScript runtime can actually execute. */
const EXECUTABLE_SOURCE = /\.(?:js|jsx|mjs|cjs|ts|tsx)$/;

/** `true` for a line that is entirely a comment, and so never executed. */
const isWholeLineComment = (text) => {
  const trimmed = text.trim();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*')
  );
};

// This file is excluded from its own scan: it carries the PRO reset sentence
// as the DEFINITION of the boundary, so every identifier necessarily appears
// in it. Excluding the definition keeps the check about uses. Every other path
// this project adds or changes is still scanned.
//
// The diff is read WITH its file headers, because check 4's scope is per file
// (see the header of this file): an added line is attributed to the path it
// was added to, and only executable paths are scanned.
const addedLines = [];
if (upstreamBase) {
  let path = null;
  const diff = git(
    'diff',
    '--unified=0',
    `${UPSTREAM_COMMIT}..HEAD`,
    '--',
    '.',
    ':(exclude)tools/planner-verify.mjs',
  );
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      path = line.slice('+++ b/'.length);
      continue;
    }
    if (line.startsWith('+++')) {
      path = null;
      continue;
    }
    if (line.startsWith('+')) addedLines.push({ path, text: line.slice(1) });
  }
}

const outsideExecutableSource = addedLines.filter(
  ({ path }) => path === null || !EXECUTABLE_SOURCE.test(path),
);
const wholeLineComments = addedLines.filter(
  ({ path, text }) =>
    path !== null && EXECUTABLE_SOURCE.test(path) && isWholeLineComment(text),
);
const executableLines = addedLines.filter(
  ({ path, text }) =>
    path !== null && EXECUTABLE_SOURCE.test(path) && !isWholeLineComment(text),
);

const drift = [];
for (const { path, text } of executableLines) {
  for (const name of PRO_TOKENS) {
    if (identifierHit(text, name)) drift.push({ name, path, text });
  }
}

if (!upstreamBase) {
  fail(
    'PRO drift could not be checked: the upstream base commit is not ' +
      'resolvable in this clone (see check 1) — this is a prerequisite ' +
      'failure, not a pass',
  );
} else if (drift.length > 0) {
  for (const hit of drift) {
    fail(
      `added executable line in ${hit.path} mentions PRO identifier ` +
        `"${hit.name}": ${hit.text.trim()}`,
    );
  }
} else {
  note(
    `ok    none of the ${executableLines.length} added executable line(s) ` +
      `mention any of the ${PRO_TOKENS.length} PRO identifiers`,
  );
  note(
    `         out of scope by construction: ` +
      `${outsideExecutableSource.length} added line(s) outside executable ` +
      `source, ${wholeLineComments.length} whole-line comment(s) — see this ` +
      `file's own header for why, and for what that does NOT relax`,
  );
}

const sentinelHost = resolve(
  repoRoot,
  'node_modules/@svar-ui/gantt-store/dist/index.js',
);
if (existsSync(sentinelHost)) {
  if (readFileSync(sentinelHost, 'utf8').includes(PRO_DISABLE_SENTINEL)) {
    note(
      'ok    the PRO reset is present verbatim in the installed gantt-store',
    );
  } else {
    fail(
      'the PRO reset sentence is no longer present verbatim in the installed ' +
        '@svar-ui/gantt-store — the identifier list above may no longer be the ' +
        'boundary it claims to be',
    );
  }
} else {
  note(
    'skip  @svar-ui/gantt-store is not installed here, so the PRO reset ' +
      'sentence could not be re-checked against it (the Planner does check it)',
  );
}

/* ------------------------------------------------------------------------ */

console.log('');
if (failures.length > 0) {
  console.error(`planner-verify: ${failures.length} check(s) FAILED`);
  process.exit(1);
}
console.log('planner-verify: all checks passed');
