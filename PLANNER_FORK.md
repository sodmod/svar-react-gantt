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
   `tools/planner-verify.mjs` (fork-local provenance and boundary checks), and
   this file. No renderer behaviour.
2. **Renderer behaviour** — currently exactly one change, `SVAR-M2`, in
   `src/components/chart/Bars.jsx`: the drag-activation pixel threshold.

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
