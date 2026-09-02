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
 *   4  PRO DRIFT       no line this project ADDED mentions any identifier of
 *                      the Community/PRO reset — this file excepted, since it
 *                      is where that reset is written down
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
 * line added by this project spells one of the PRO identifier names. It does
 * NOT prove the absence of a hand-written function that is semantically
 * equivalent to a PRO capability under a different name; only independent
 * review catches that, and under the project's rules it is a Blocker even when
 * every automated check here is green. It also says nothing about the built
 * artefact: the Planner runs the complementary differential check there,
 * comparing a pristine upstream build against the fork build token by token.
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
    '`prepare` builds the package: a git dependency has no publish step',
  'readme.md':
    'says in its first lines that this is a project-owned fork (MIT attribution)',
  'src/components/chart/Bars.jsx':
    'SVAR-M2 — the drag-activation pixel threshold',
  'src/components/Gantt.jsx':
    'SVAR-M3 — new `scaleCellAriaLabel` prop, threaded through to TimeScale.jsx; ' +
    'SVAR-M4 — new `timelineLines` prop, threaded through to Chart.jsx',
  'src/components/Layout.jsx':
    'SVAR-M3 — `scaleCellAriaLabel` prop pass-through; SVAR-M4 — `timelineLines` prop pass-through',
  'src/components/chart/Chart.jsx':
    'SVAR-M3 — `scaleCellAriaLabel` prop pass-through; ' +
    'SVAR-M4 — renders <TimelineLines> from `timelineLines` inside .wx-area',
  'src/components/chart/TimeScale.jsx':
    'SVAR-M3 — applies `scaleCellAriaLabel(date, unit, value)` as each scale cell\'s aria-label',
  'types/index.d.ts':
    'SVAR-M3 — type declaration for the new `scaleCellAriaLabel` prop; ' +
    'SVAR-M4 — `ITimelineLine` and the `timelineLines` prop',
  'src/themes/Willow.jsx':
    'fonts={false} to core: this package ships its own fonts and icons, so core must not add the CDN <link>s',
  'src/themes/WillowDark.jsx':
    'fonts={false} to core: this package ships its own fonts and icons, so core must not add the CDN <link>s',
  'src/themes/Material.jsx':
    'fonts={false} to core: this package ships its own fonts and icons, so core must not add the CDN <link>s',
  'vite.config.js':
    'sourcemapPathTransform makes dist/index.es.js.map sources deterministic and package-relative — an ' +
    'ephemeral install-time clone directory path was otherwise leaking into them (SVAR-LOCAL-ASSETS)',
  '.gitignore':
    'ignores licenses/, generated by tools/planner-fonts.mjs the same way dist-full/ is (SVAR-LOCAL-ASSETS)',
};

/** Path prefixes of files this project ADDED (they have no upstream version). */
const PROJECT_ADDED = [
	'tools/planner-',
	'planner-assets/',
	'PLANNER_FORK.md',
	'.gitattributes',
	// SVAR-M4 (Phase 3.2A spike): the vertical-lines component and its stylesheet.
	'src/components/chart/TimelineLines.',
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

let tagCommit = '';
try {
  tagCommit = git('rev-parse', `${UPSTREAM_TAG}^{commit}`);
} catch {
  fail(`upstream tag ${UPSTREAM_TAG} is not present in this clone`);
}

if (tagCommit && tagCommit !== UPSTREAM_COMMIT) {
  fail(
    `upstream tag ${UPSTREAM_TAG} resolves to ${tagCommit}, ` +
      `not the recorded ${UPSTREAM_COMMIT}`,
  );
}

if (tagCommit === UPSTREAM_COMMIT) {
  try {
    git('merge-base', '--is-ancestor', UPSTREAM_COMMIT, 'HEAD');
    note(
      `ok    upstream base ${UPSTREAM_TAG} (${UPSTREAM_COMMIT}) is an ancestor of HEAD`,
    );
  } catch {
    fail(
      `upstream base ${UPSTREAM_TAG} (${UPSTREAM_COMMIT}) is NOT an ancestor of ` +
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
} else if (!tagCommit) {
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

const changed = tagCommit
  ? git('diff', '--name-only', `${UPSTREAM_COMMIT}..HEAD`)
      .split('\n')
      .filter(Boolean)
  : [];

const isProjectAdded = (file) => PROJECT_ADDED.some((p) => file.startsWith(p));
const undeclared = changed.filter(
  (file) => !isProjectAdded(file) && !(file in OWNED_UPSTREAM_FILES),
);

if (!tagCommit) {
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

// This file is excluded from its own scan: it carries the PRO reset sentence
// as the DEFINITION of the boundary, so every identifier necessarily appears
// in it. Excluding the definition keeps the check about uses. Every other path
// this project adds or changes is still scanned.
const addedLines = tagCommit
  ? git(
      'diff',
      '--unified=0',
      `${UPSTREAM_COMMIT}..HEAD`,
      '--',
      '.',
      ':(exclude)tools/planner-verify.mjs',
    )
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
  : [];

const drift = [];
for (const line of addedLines) {
  for (const name of PRO_TOKENS) {
    if (identifierHit(line.slice(1), name)) drift.push({ name, line });
  }
}

if (!tagCommit) {
  fail(
    'PRO drift could not be checked: the upstream base commit is not ' +
      'resolvable in this clone (see check 1) — this is a prerequisite ' +
      'failure, not a pass',
  );
} else if (drift.length > 0) {
  for (const hit of drift) {
    fail(
      `added line mentions PRO identifier "${hit.name}": ${hit.line.trim()}`,
    );
  }
} else {
  note(
    `ok    none of the ${addedLines.length} added line(s) mention any of the ` +
      `${PRO_TOKENS.length} PRO identifiers`,
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
