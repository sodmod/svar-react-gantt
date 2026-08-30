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
 *   2  LICENCE         upstream's own license.txt is present and byte-identical
 *                      to the upstream base
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
};

/** Path prefixes of files this project ADDED (they have no upstream version). */
const PROJECT_ADDED = ['tools/planner-', 'PLANNER_FORK.md'];

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

const licensePath = resolve(repoRoot, 'license.txt');
if (!existsSync(licensePath)) {
  fail("upstream's license.txt is missing");
} else {
  const current = readFileSync(licensePath, 'utf8');
  const base = git('show', `${UPSTREAM_COMMIT}:license.txt`);
  if (current.trimEnd() !== base.trimEnd()) {
    fail('license.txt differs from the upstream base — it must stay untouched');
  } else if (!/MIT/.test(current) || !/XB Software/.test(current)) {
    fail('license.txt no longer carries the upstream MIT notice and copyright');
  } else {
    note(
      'ok    license.txt is present and byte-identical to the upstream base',
    );
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

if (undeclared.length > 0) {
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

if (drift.length > 0) {
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
