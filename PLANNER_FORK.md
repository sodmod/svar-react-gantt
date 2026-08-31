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
   from the package instead of a third-party CDN — see below), and this file.
   No renderer behaviour.
2. **Renderer behaviour** — currently exactly one change, `SVAR-M2`, in
   `src/components/chart/Bars.jsx`: the drag-activation pixel threshold.

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

**Not covered here, deliberately.** `@svar-ui/react-core`'s theme components
also inject, at run time, `<link rel="stylesheet"
href="https://cdn.svar.dev/fonts/wxi/wx-icons.css">` — the **wxi icon font**.
That asset is published on that CDN only: it is in no npm package and in no
public SVAR repository, so no redistribution licence for it could be
established. Vendoring it would be a licence guess and dropping it would remove
icons the product currently shows, so this fork leaves it exactly as upstream
wrote it. Resolving it is a product decision of the Planner project, not a
build-tooling change.

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
