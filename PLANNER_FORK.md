# Project-owned fork of `svar-widgets/react-gantt`

**This repository is not the upstream SVAR project.** It is a project-owned fork
maintained by the SVAR Production Planner project.

| | |
| --- | --- |
| Upstream project | https://github.com/svar-widgets/react-gantt |
| Upstream tag this fork branches from | `v2.7.1` |
| Upstream commit | `0c5788a8ffda80c8f0cb5a61d5113fb036eedebb` |
| Package name | `@svar-ui/react-gantt` (unchanged) |
| Package version | `2.7.1` (unchanged) |
| Upstream licence | MIT, Copyright (c) 2025 XB Software Sp. z o.o — see `license.txt` |
| Project authority | D-100, D-102 of the SVAR Production Planner project |

## Licence and attribution

The upstream code in this repository is the work of XB Software Sp. z o.o and is
used under the MIT licence. `license.txt` is upstream's own file and is kept
unchanged, in place, with its original copyright notice; it is shipped in the
published package. Nothing here relicenses, re-attributes or reassigns upstream
authorship.

Files added by this project carry a header saying so. Changes this project makes
inside upstream files are marked in place with a `SVAR-` identifier.

## Branches

```text
upstream   https://github.com/svar-widgets/react-gantt.git   read-only
origin     the project-owned repository

main       exact upstream lineage. Never edited by this project. It exists so
           that `git fetch upstream` stays an ordinary operation and upstream
           tags stay reachable.
planner    the project's renderer line. Based on the exact upstream tag above.
```

Upstream ancestry is preserved, never rewritten. `git rebase` of upstream
commits is forbidden: it destroys the merge-base, which is the thing that proves
where this code came from.

### Fresh clone / bootstrap

A plain `git clone` of this repository creates `origin` only — it has no
`upstream` remote yet. `git fetch upstream --tags`, used above and needed by
`tools/planner-verify.mjs` (check 1 resolves `v2.7.1` against `upstream`'s
tags), fails on a fresh clone until `upstream` is added.

After cloning, run once — safe to re-run, since it only adds `upstream` when
it is not already there:

```bash
git remote get-url upstream >/dev/null 2>&1 || \
  git remote add upstream https://github.com/svar-widgets/react-gantt.git
git fetch upstream --tags
```

After that, `node tools/planner-verify.mjs` runs with no further setup. A
`node_modules` install (`npm install` / `npm ci`) is also needed before the
package build step (`prepare`) runs, exactly as for any other consumer of
this package — that is ordinary npm behaviour, not fork-specific.

## What this project owns here

```bash
git log --oneline v2.7.1..planner     # every commit this project added
git diff v2.7.1..planner              # every line this project changed
```

Two kinds of change, deliberately kept in separate commits:

1. **Build/delivery tooling** — `tools/planner-build.mjs` (`prepare` builds the
   package, because a git dependency has no publish step),
   `tools/planner-verify.mjs` (fork-local provenance and boundary checks),
   `tools/planner-fonts.mjs` + `planner-assets/fonts/` (the web fonts are served
   from the package instead of a third-party CDN — see below),
   `tools/planner-icons.mjs` + `planner-assets/icons/` (this project's own SVG
   icons, replacing the CDN icon font — see below), and this file.
   No renderer behaviour.
2. **Renderer behaviour** — `SVAR-M2` in `src/components/chart/Bars.jsx`
   (the drag-activation pixel threshold); `SVAR-M3`, the `scaleCellAriaLabel`
   prop threaded `Gantt.jsx -> Layout.jsx -> Chart.jsx -> TimeScale.jsx`
   (an accessible name for scale cells, supplied by the consumer); and
   `SVAR-M4`, the `timelineAnnotations` prop threaded
   `Gantt.jsx -> Layout.jsx -> Chart.jsx -> TimeScale.jsx` with the new
   `src/components/chart/annotations/` components: a vertical line at each
   consumer-supplied date in the chart body (`TimelineLines.jsx`, inside
   `.wx-area`, before the bars), a labelled chip for each in an annotation
   lane rendered under the scale rows inside the sticky `.wx-scale`
   (`AnnotationLane.jsx`), annotations sharing one consumer-supplied technical
   date — the semantic group, never the rounded pixel — merged into one
   striped line, chips laid out into as many rows as it takes for none to
   overlap (`timelineAnnotationLayout.js`, pure; unit-tested by
   `npm run test:planner`), and the lane's height entering `Layout.jsx`'s
   scroll/height math. The renderer knows a date, a label and a pixel; what
   an annotation means is the consumer's business. This is the project's own
   implementation; the PRO edition's vertical-line feature is not used, not
   copied and not referenced, and `tools/planner-verify.mjs`'s PRO-identifier
   tripwire covers every added line.

   `SVAR-M5` extends the same feature in two directions, and adds no owner:

   - **the marker travels with the bar.** `Bars.jsx` reports every accepted
     step of a bar drag through the new `onTimelineDragPreview` prop
     (`Gantt.jsx -> Layout.jsx -> Chart.jsx -> Bars.jsx`), carrying `dx` (the
     pixels travelled) and `diff` (those pixels as whole scale units, by the
     one expression that also produces the committing `update-task` `diff`).
     An annotation naming that bar in `followsTaskId` is drawn `dx` px from
     its own date, so its line and chip stay on the diamond under the pointer
     instead of waiting on the drop; a consumer that owns dates answers with
     `previewDate`, which decides ONLY which annotations share a composite
     line while the gesture is in flight. Pixels here, dates there — the
     split is the point, and it is why a compressed scale still cannot merge
     two different dates;
   - **the grid reserves the same lane.** `Layout.jsx` hands `Grid.jsx` the
     RESOLVED lane height it already computed, and the grid renders a blank
     opaque spacer of exactly that height under its header, shifting its body
     by the same amount. The grid measures nothing, resolves no collision and
     counts no marker: it receives a number. Without it the chart's rows sat
     one lane lower than the grid's.
3. **Asset delivery inside upstream components** — the three theme wrappers
   (`src/themes/Willow.jsx`, `WillowDark.jsx`, `Material.jsx`) pass
   `fonts={false}` to `@svar-ui/react-core`, so core no longer injects the CDN
   `<link>`s. Nothing else about them changes.

### Local web fonts instead of `cdn.svar.dev`

`dist-full/index.css` (the `./all.css` export) inlines `@svar-ui/react-core`'s
stylesheet, and upstream declares this renderer's text faces against a
third-party host:

```text
Open Sans 400 / 500 / 600 / 700      https://cdn.svar.dev/fonts/open-sans/…
Roboto    400 / 500                  https://cdn.svar.dev/fonts/roboto/…
```

Six `@font-face` rules, twelve URLs. In a firewalled or offline deployment every
one of them fails and the theme falls back to whatever sans-serif the browser
happens to have. `tools/planner-fonts.mjs` rewrites exactly those six rules to
name font files shipped inside this package (`dist-full/fonts/`), leaving every
other rule in the stylesheet byte-identical — 915 non-`@font-face` rules,
measured. Families, styles and weights are unchanged; only where the bytes come
from changes.

`package.json`'s `files` gains `dist-full/fonts` beside the stylesheet it
already published. It deliberately does NOT publish all of `dist-full`:
`dist-full/index.js` is a by-product of the full-CSS build that nothing can
import (`exports` maps `./all.css` to the stylesheet alone), and shipping it
would put a bundled copy of `@svar-ui/react-core` — icon-CDN URLs and all —
into every consumer's `node_modules` for no reason.

The binaries live in `planner-assets/fonts/`, committed, with their licences and
with the exact source URL and sha256 of each file in `fonts.json`. Both families
are **SIL Open Font License 1.1** with no Reserved Font Name, taken from Google
Fonts — their authoritative distributor. `OFL-OpenSans.txt` and `OFL-Roboto.txt`
are the upstream licence files, copied unchanged. Coverage is the `latin`,
`latin-ext`, `cyrillic` and `cyrillic-ext` subsets, because the product's
interface language is Russian and English.

The step is fail-closed in both directions: it refuses to rewrite a stylesheet
whose font rules it does not recognise (so a future upstream intake that changes
them stops the build instead of being absorbed silently), and it refuses to
finish if any `cdn.svar.dev` reference survives.

### Local SVG icons instead of the `wxi` icon font

The same `<link>`s carried a second asset: `wx-icons.css`, the **wxi icon
font**, which is what gave `.wxi-plus`, `.wxi-close` and the row toggle their
`content:"\eNNN"` glyphs. That font is published on `cdn.svar.dev` only — it
ships in no npm package and in no public SVAR repository — so no redistribution
licence for it could be established and it could not be vendored. Without it,
measured in a real browser, the controls are not merely unstyled but
**zero-sized**: the add-task icon is 0 px wide and the link-delete icon 0 px
tall.

The Planner project's owner decided that this fork should draw those icons
itself, as new original artwork, rather than reproduce the vendor's glyphs.
`planner-assets/icons/` holds five hand-written SVG files — the complete set
this renderer actually puts on screen, measured rather than guessed:

```text
wxi-menu-down    grid row toggle, expanded — activate to collapse
wxi-menu-right   grid row toggle, collapsed — activate to expand;
                 also the splitter handle that reveals the chart
wxi-menu-left    splitter handle that reveals the grid
wxi-plus         add a task
wxi-close        remove the selected dependency link
```

They are chevrons, a plus and a cross drawn from scratch on one 24-unit grid
with a single 2.5-unit round stroke. **No third-party path data, no icon
package, no font was used**, and none of the vendor's glyphs was traced;
`icons.json` records that alongside each icon's meaning, role and states.

`tools/planner-icons.mjs` inlines them into `dist-full/index.css` as `data:`
URIs on a `::before` pseudo-element, painted with
`background-color: currentColor` through `mask-image`. That is deliberate on
three counts: inlined bytes cannot 404 or be blocked, `currentColor` keeps
every existing colour rule working (`--wx-gantt-icon-color`, the disabled and
danger colours, `:hover{color:…}`) exactly as the font did, and a mask does not
collide with `.wx-button-expand-content i`, which paints its own
`background-color`. The step is fail-closed: a missing SVG, an SVG that
references anything external, a duplicate class, or a class the built renderer
no longer emits stops the build.

Sizing is stated per usage rather than in one blanket rule, so every box keeps
the height upstream gave it — 16 px for the grid toggle and the action icon,
14 px for the link delete button, 24 px for the splitter handle. The one
element that gains a size is `.wx-action-icon.wxi-plus`, which upstream never
gave a width because the font glyph's own advance supplied it; it is restored
to `1em`, centred.


## Community / PRO boundary

This fork contains **Community** renderer source only.

`@svar-ui/gantt-store` and `@svar-ui/grid-store` are **not** forked and not
modified. They stay ordinary upstream Community npm packages, and the
Community reset of PRO capabilities inside `gantt-store` stays exactly the
foreign, unmodified file it has always been. No PRO source, and no source
reconstructed from a PRO sourcemap, is used anywhere in this repository.

`tools/planner-verify.mjs` checks that this project's own diff introduces no new
reference to any PRO identifier. What that check does and does not prove is
stated in the script itself.

## Upstream updates

**Frozen by default.** A new upstream release creates no work here automatically
and is not merged on a cadence. Taking a new upstream version is an explicit,
separately reviewed checkpoint of the Planner project: merge (never rebase),
re-check this project's changes against the new code, rebuild, re-run the
regression suite, re-accept manually.
