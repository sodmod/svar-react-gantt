#!/usr/bin/env node
/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * WHY THIS FILE EXISTS
 *
 * Upstream publishes this package by running `build` and `build:full-css` by
 * hand before `npm publish`; its own `prepare` script is `husky`, i.e. git-hook
 * setup for contributors, not a build. A git dependency has no "publish" step:
 * npm clones the repository, installs its devDependencies and runs `prepare`.
 * With the upstream `prepare`, a git dependency would therefore install with no
 * `dist/` at all. This script is what `prepare` runs instead, so that a git
 * dependency produces exactly the two artefact sets a consumer resolves:
 *
 *   `vite build`                     -> dist/index.es.js, dist/index.cjs, dist/index.css
 *   BUILD_FULL_CSS=true `vite build` -> dist-full/index.css
 *
 * WHY NOT A ONE-LINER IN package.json
 *
 * `npm run` uses cmd.exe on Windows, where `BUILD_FULL_CSS=true vite build` is
 * not valid syntax. This project builds on Windows workstations and in Linux
 * cloud containers from the same commit, so the variable is set on the process
 * rather than by a shell.
 *
 * WHY VITE'S JS API AND NOT ITS CLI
 *
 * `vite`'s package.json `exports` does not expose `./bin/vite.js`, so the CLI
 * entry cannot be resolved by module resolution at all, and spelling a path into
 * `node_modules` by hand would be exactly the kind of brittle assumption this
 * project does not want in its delivery path. `build()` is vite's documented
 * programmatic entry, it reads the very same `vite.config.js` from the package
 * root, and it is reached through the package's own public export.
 *
 * PROVEN, NOT ASSUMED: building the pristine upstream tag with this script
 * reproduces the artefacts of `npm run build` + `npm run build:full-css`
 * byte for byte, which is in turn byte-identical to the published npm package's
 * executable artefacts. If a future vite changes that, the consumer's recorded
 * artefact hashes fail and the delivery stops rather than drifting silently.
 *
 * Adds no dependency: `vite` is already a devDependency of this package.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const { build } = await import('vite');

const steps = [
  { label: 'build', fullCss: false },
  { label: 'build:full-css', fullCss: true },
];

for (const step of steps) {
  // The package's own vite.config.js branches on this variable, exactly as
  // upstream's `build:full-css` script sets it.
  if (step.fullCss) {
    process.env.BUILD_FULL_CSS = 'true';
  } else {
    delete process.env.BUILD_FULL_CSS;
  }

  try {
    await build({ root: packageRoot });
  } catch (error) {
    console.error(`planner-build: ${step.label} failed`);
    console.error(error);
    process.exit(1);
  }
}

/*
 * The full-CSS artefact inlines `@svar-ui/react-core`'s stylesheet, which
 * declares this renderer's web fonts against `https://cdn.svar.dev/fonts/...`.
 * Serving them from the consumer's own origin instead is part of producing the
 * artefact, not a separate thing a consumer could forget to do, so it runs here
 * — after `build:full-css` has written `dist-full/index.css` and before the
 * package is packed. `tools/planner-fonts.mjs` is fail-closed: it exits
 * non-zero rather than rewriting a stylesheet whose font rules it does not
 * recognise.
 */
await import('./planner-fonts.mjs');
