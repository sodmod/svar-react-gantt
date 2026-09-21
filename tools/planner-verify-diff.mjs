/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unified-diff line classifier for planner-verify.mjs's check 4 (PRO DRIFT).
 *
 * Split out of planner-verify.mjs in the Phase 4.1C R2 remediation (reviewer
 * finding F-R4B) so it can be unit-tested on its own, without a real git
 * repository.
 *
 * F-R4B: the previous parser recognized a `+++ b/<path>` FILE HEADER purely
 * by its text prefix, anywhere in the diff stream. A unified diff's ADDED
 * lines are themselves prefixed with a single `+`, so an added SOURCE line
 * that itself starts with `++` (a pre-increment, `++counter;`) is rendered
 * by `git diff` as a body line starting with `+++`. The old parser read that
 * body line as a new file header, reset the tracked path to whatever text
 * followed it (or to nothing, since `+++counter;` does not start with
 * `+++ b/`), and silently mis-tracked or dropped every subsequent added line
 * until the real next header arrived.
 *
 * The fix does not change WHICH characters begin a diff line — `+`, `-`,
 * ` `, `\` still mean what they always meant — it changes WHEN a line is
 * eligible to be read as a header at all. A unified diff's structure is
 * strict: each hunk announces, in its own `@@ -oldStart,oldCount
 * +newStart,newCount @@` line, exactly how many old-side and new-side lines
 * follow. This parser counts those down explicitly. While a hunk still has
 * lines outstanding, EVERY line belongs to that hunk and is classified only
 * by its own single leading marker character — never by a longer prefix,
 * and never mistaken for `--- `/`+++ `/`@@` structure, no matter what text
 * follows the marker. A header line can only be recognised in the gap
 * between hunks/files, once the current hunk's counts have both reached
 * zero.
 *
 * FAIL-CLOSED: a line encountered while a hunk still has lines outstanding,
 * whose marker is not one of `+`, `-`, ` ` (context) or `\` (the "no
 * newline at end of file" annotation), throws rather than guessing. This
 * parser is meant to run on `git diff`'s own output for a real repository,
 * where that can only happen if the diff itself is corrupt or this parser's
 * assumptions about unified-diff shape are wrong — either way, silently
 * mis-parsing the rest of the stream would be worse than stopping.
 */

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Parses `git diff`'s unified-diff text output (as produced by
 * `git diff --unified=0 <rev>..<rev> -- <pathspec>...`, but not dependent on
 * `--unified=0` specifically — ordinary context lines are handled too, see
 * the NC-R2-8 test) into the flat list of ADDED lines, each attributed to
 * its file path and its 1-based line number in the NEW (post-change) file.
 *
 * Returns `[{ path, text, line }, ...]` in file/document order. `path` is
 * `null` for an added line whose file header could not be resolved to a
 * `+++ b/<path>` form (for example a deleted file's `+++ /dev/null`, which
 * cannot itself contain added lines in a well-formed diff, but is handled
 * the same defensive way as the rest of this parser). `line` is `null` if,
 * somehow, an added line was encountered with no governing hunk header —
 * callers should treat that as a reason to fail closed, not to guess a line
 * number.
 */
export function parseUnifiedDiffAdditions(diffText) {
  const addedLines = [];

  let path = null;
  let newLine = null;

  // Explicit hunk bookkeeping: while either counter is still positive, every
  // line belongs to the CURRENT hunk and is read by its single leading
  // marker character alone. This is what makes a body line starting with
  // `+++` (an added source line whose own text starts with `++`) safe: it is
  // still inside the hunk's declared line count, so it is never offered to
  // the header-recognition logic below at all.
  let oldRemaining = 0;
  let newRemaining = 0;
  let inHunk = false;

  // Outside a hunk, a `--- ` line announces the old side of a new file's
  // header; the SINGLE line immediately following it is unconditionally the
  // new side (`+++ b/<path>`, or `+++ /dev/null` for a deleted file) —
  // never re-matched by its own text prefix, just consumed positionally.
  let awaitingFileHeader = false;

  const lines = diffText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inHunk && (oldRemaining > 0 || newRemaining > 0)) {
      const marker = line.charAt(0);
      if (marker === '+') {
        addedLines.push({ path, text: line.slice(1), line: newLine });
        newLine += 1;
        newRemaining -= 1;
        continue;
      }
      if (marker === '-') {
        oldRemaining -= 1;
        continue;
      }
      if (marker === ' ' || line === '') {
        // A context line (unified diffs with context > 0). An empty string
        // here is a blank context line, not an empty marker.
        if (oldRemaining > 0) oldRemaining -= 1;
        if (newRemaining > 0) newRemaining -= 1;
        continue;
      }
      if (marker === '\\') {
        // "\ No newline at end of file" — annotates the previous line, adds
        // no line of its own to either side.
        continue;
      }
      throw new Error(
        `planner-verify-diff: unrecognized line inside a hunk with ` +
          `${oldRemaining} old / ${newRemaining} new line(s) still expected: ` +
          JSON.stringify(line),
      );
    }
    inHunk = false;

    if (line.startsWith('diff --git ')) {
      path = null;
      newLine = null;
      awaitingFileHeader = false;
      continue;
    }
    if (line.startsWith('--- ')) {
      awaitingFileHeader = true;
      continue;
    }
    if (awaitingFileHeader) {
      awaitingFileHeader = false;
      path = line.startsWith('+++ b/') ? line.slice('+++ b/'.length) : null;
      newLine = null;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = HUNK_HEADER.exec(line);
      if (m) {
        newLine = Number(m[3]);
        oldRemaining = m[2] !== undefined ? Number(m[2]) : 1;
        newRemaining = m[4] !== undefined ? Number(m[4]) : 1;
        inHunk = true;
      } else {
        // A malformed hunk header: no line number to attribute additions
        // to. Fail closed downstream (the caller treats `line: null` as a
        // reason to fail), not here — this parser's job is classification,
        // not policy.
        newLine = null;
        inHunk = false;
      }
      continue;
    }
    // Anything else outside a hunk — `index …`, `old mode …`, `new mode …`,
    // `similarity index …`, `rename from/to …`, a blank separator line — is
    // diff plumbing this parser has no use for and does not affect path or
    // line tracking.
  }

  return addedLines;
}
