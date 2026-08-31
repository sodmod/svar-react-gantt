import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname, relative, sep } from 'path';
import { realpathSync } from 'node:fs';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * WHY THIS EXISTS
 *
 * A git dependency builds inside npm's own ephemeral clone directory (see
 * tools/planner-build.mjs), and on at least one real installation environment
 * measured for this project, that directory's path resolves to two different
 * strings depending on which internal step of the toolchain asks for it — one
 * for the file Vite was told to build (the "entry"), a different, longer one
 * for every file reached by resolving an `import` from it. Rollup computes
 * each `sources` entry in the emitted sourcemap as a path relative to the
 * sourcemap's own location using whichever string it was handed, so the two
 * families of files end up expressed against two different bases in the same
 * map. Measured directly: two `npm ci` runs of the exact same commit on the
 * exact same machine produced two different sha256 for `dist/index.es.js.map`
 * — not because the source changed, but because npm's per-install ephemeral
 * clone directory name changed, and that name is what leaked into `sources`.
 *
 * `dist/index.es.js` itself does not have this problem — Rollup does not
 * write source PATHS into the executable code, only into the accompanying
 * map — so this is scoped to the map alone; nothing here touches what ships
 * as behaviour.
 *
 * THE FIX
 *
 * `sourcemapPathTransform` gets the (possibly inconsistent) relative path
 * Rollup computed and the sourcemap file's own absolute path; resolving the
 * former against the latter recovers the file's true absolute location
 * regardless of which of the two bases produced it. Re-deriving both that
 * location and the sourcemap's own directory through `fs.realpathSync.native`
 * before taking the relative path between them collapses whatever alternate
 * spelling either one arrived under back to one canonical form, so the same
 * commit built twice — on this machine, or on any other — now emits the same
 * `sources` entries. The result is still an ordinary relative path from the
 * map to the real file (`../src/...`), so it keeps resolving exactly as a
 * source map is supposed to; nothing is stripped, summarised or filtered out.
 */
const canonical = (path) => {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
};

const sourcemapPathTransform = (relativeSourcePath, sourcemapPath) => {
  const mapDir = dirname(sourcemapPath);
  const absoluteSource = resolve(mapDir, relativeSourcePath);
  const canonicalRelative = relative(canonical(mapDir), canonical(absoluteSource));
  return canonicalRelative.split(sep).join('/');
};

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // Check if we're building demos
  const isDemoBuild = process.env.BUILD_DEMOS === 'true';
  // Check if we're building full CSS
  const isFullCssBuild = process.env.BUILD_FULL_CSS === 'true';

  if (isDemoBuild) {
    // Demo build configuration - includes all dependencies
    return {
      plugins: [react()],
      base: './',
      build: {
        outDir: 'dist-demos',
        rollupOptions: {
          input: {
            main: resolve(__dirname, 'index.html'),
          },
        },
      },
    };
  }

  const rollupOptions = {
    output: {
      assetFileNames: 'index.css',
      sourcemapPathTransform,
    },
    external: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
    ],
  };

  const rollupOptionsStrict = {
    ...rollupOptions,
    external: [
      ...rollupOptions.external,
      /^@wx\//, // matches all modules starting with "@wx/"
      /^@svar-ui\//, // matches all modules starting with "@wx/"
    ],
  };

  if (isFullCssBuild) {
    // Full CSS build configuration - includes base styles and component styles
    return {
      plugins: [react()],
      build: {
        outDir: 'dist-full',
        lib: {
          entry: resolve(__dirname, 'src/full-css.js'),
          fileName: 'index',
          formats: ['es'],
        },
        rollupOptions,
      },
    };
  }

  // Library build configuration (original)
  return {
    plugins: [react()],
    build: {
      sourcemap: true,
      lib: {
        //eslint-disable-next-line no-undef
        entry: resolve(__dirname, 'src/index.js'),
        fileName: (format) => (format === 'cjs' ? 'index.cjs' : 'index.es.js'),
        formats: ['es', 'cjs'],
      },
      rollupOptions: rollupOptionsStrict,
    },
  };
});
