/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for `planner-verify-lexer.mjs`, the token/clause comparator
 * behind planner-verify.mjs's check 4 (PRO DRIFT). Run directly:
 *   `node --test tools/planner-verify-lexer.test.mjs`
 * (plain `node --test`, no extra dependency — consistent with every other
 * `tools/planner-*.test.mjs` in this project).
 *
 * These are synthetic-source tests, not integration tests against this
 * repository's real history: every fixture below uses invented file shapes,
 * an invented PRO identifier list, and file paths that do not exist in
 * `src/`, specifically so the coverage cannot be read as "tuned to
 * Bars.jsx" or "tuned to rollups/splitTasks/summary" (Phase 4.1C, section 5
 * of the remediation task). The three real identifiers and the real
 * Bars.jsx reflow are exercised separately, as a manual negative control
 * against actual git history (NC-1 in the Phase 4.1C task), not as a
 * committed test, because that would pin a permanent test to one commit's
 * exact diff shape.
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves `evaluateProOccurrence` classifies the four required shapes —
 * formatting-only reflow, a genuinely new PRO dependency, a semantic edit to
 * an existing PRO-bearing expression, and a comment-only mention — the way
 * the proof contract in the Phase 4.1C task requires. It does NOT prove
 * `planner-verify.mjs`'s own git plumbing (diff parsing, hunk-header line
 * tracking, `git show` fetches) is correct; that is exercised by running the
 * whole tool against this repository's real history, which the Phase 4.1C
 * negative controls do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  tokenize,
  annotate,
  extractClause,
  clauseText,
  containsClause,
  identifierHit,
  evaluateProOccurrence,
  evaluateProOccurrences,
} from './planner-verify-lexer.mjs';

// A deliberately non-real PRO identifier and a deliberately non-real path,
// used everywhere below except where a test is explicitly about a different
// name or path — see the file header for why.
const PRO_NAME = 'quantumForecast';
const PATH = 'src/components/widget/Sprocket.jsx';

test('formatting-only executable reflow: PASS (the exact bug in M-4.1C-F-01)', () => {
  const oldSource = [
    'function render(a, b) {',
    "  if (a.ready && !(quantumForecast && b.value)) return null;",
    '}',
  ].join('\n');
  // Reflowed across more lines, reindented — not one token changed.
  const newSource = [
    'function render(a, b) {',
    '  if (',
    '    a.ready &&',
    '    !(quantumForecast && b.value)',
    '  )',
    '    return null;',
    '}',
  ].join('\n');
  const result = evaluateProOccurrence({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumber: 4, // "    !(quantumForecast && b.value)"
  });
  assert.equal(result.status, 'preexisting');
});

test('new executable PRO dependency: FAIL', () => {
  const oldSource = [
    'function render(a, b) {',
    '  if (a.ready && b.value) return null;',
    '}',
  ].join('\n');
  const newSource = [
    'function render(a, b) {',
    '  if (a.ready && !(quantumForecast && b.value)) return null;',
    '}',
  ].join('\n');
  const result = evaluateProOccurrence({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumber: 2,
  });
  assert.equal(result.status, 'drift');
  assert.equal(result.clauses.length, 1);
  assert.match(result.clauses[0], /quantumForecast/);
});

test('semantic modification of an existing PRO-bearing statement: FAIL', () => {
  const oldSource = [
    'function render(a, b) {',
    '  if (a.ready && !(quantumForecast && b.value)) return null;',
    '}',
  ].join('\n');
  // Same guard, but the PRO-bearing clause itself now requires one more
  // condition — a real semantic change, not a reflow.
  const newSource = [
    'function render(a, b) {',
    '  if (',
    '    a.ready &&',
    '    !(quantumForecast && b.value && b.locked)',
    '  )',
    '    return null;',
    '}',
  ].join('\n');
  const result = evaluateProOccurrence({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumber: 4,
  });
  assert.equal(result.status, 'drift');
});

test('clean baseline (nothing mentions the PRO identifier): no candidate at all', () => {
  const source = [
    'function render(a, b) {',
    '  if (a.ready && b.value) return null;',
    '}',
  ].join('\n');
  // No occurrence of the name anywhere — the pre-filter in planner-verify.mjs
  // would never even construct a candidate for this line. Confirmed here at
  // the identifierHit level, which is what that pre-filter calls.
  assert.equal(identifierHit(source, PRO_NAME), false);
});

test('trailing comment on an added code line, PRO identifier only in the comment: comment-only', () => {
  const oldSource = 'function render(a) {\n  return a.value;\n}\n';
  const newSource = [
    'function render(a) {',
    '  return a.value; // uses quantumForecast internally',
    '}',
    '',
  ].join('\n');
  const result = evaluateProOccurrence({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumber: 2,
  });
  assert.equal(result.status, 'comment-only');
});

test('whole-line comment mention is never a candidate in the first place (documented policy)', () => {
  // planner-verify.mjs excludes a whole-line comment BEFORE calling
  // evaluateProOccurrence at all (see isWholeLineComment there); this test
  // documents and locks that boundary at the regex the pre-filter shares
  // with this module, `identifierHit`, so a change to one cannot silently
  // desync from the other.
  const wholeLineComment = '  // mentions quantumForecast here, on purpose';
  assert.equal(identifierHit(wholeLineComment, PRO_NAME), true);
  const trimmed = wholeLineComment.trim();
  assert.equal(trimmed.startsWith('//'), true);
});

test('a PRO identifier inside a string literal is still a hit (never relaxed)', () => {
  const oldSource = "const label = 'plain';\n";
  const newSource = "const label = 'quantumForecast';\n";
  const result = evaluateProOccurrence({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumber: 1,
  });
  assert.equal(result.status, 'drift');
});

test('a PRO identifier used inside a template-literal interpolation is real code, not opaque text', () => {
  const oldSource = 'const msg = `value: ${a.value}`;\n';
  const newSource = 'const msg = `value: ${quantumForecast}`;\n';
  const result = evaluateProOccurrence({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumber: 1,
  });
  assert.equal(result.status, 'drift');
});

test('reflow through a brand-new file (no baseline at all): every occurrence is drift', () => {
  const newSource = 'function render() {\n  return !(quantumForecast && 1);\n}\n';
  const result = evaluateProOccurrence({
    oldSource: '',
    newSource,
    name: PRO_NAME,
    lineNumber: 2,
  });
  assert.equal(result.status, 'drift');
});

test('not overfit to one identifier or one path: reflow and new-drift both hold under a different name/path', () => {
  const otherName = 'baselineLedger';
  const otherOldSource = 'export function f(x) {\n  return x.a && !(baselineLedger && x.b);\n}\n';
  const otherReflowedSource = [
    'export function f(x) {',
    '  return (',
    '    x.a &&',
    '    !(baselineLedger && x.b)',
    '  );',
    '}',
    '',
  ].join('\n');
  const reflowResult = evaluateProOccurrence({
    oldSource: otherOldSource,
    newSource: otherReflowedSource,
    name: otherName,
    lineNumber: 4,
  });
  assert.equal(reflowResult.status, 'preexisting');

  const otherNewDriftSource = [
    'export function f(x) {',
    '  return (',
    '    x.a &&',
    '    baselineLedger(x.b)', // a genuinely NEW use, not present in old at all
    '  );',
    '}',
    '',
  ].join('\n');
  const driftResult = evaluateProOccurrence({
    oldSource: otherOldSource,
    newSource: otherNewDriftSource,
    name: otherName,
    lineNumber: 4,
  });
  assert.equal(driftResult.status, 'drift');
});

test('word-boundary correctness: a longer identifier containing the PRO name as a substring is not a hit', () => {
  const source = 'const quantumForecastEnabled = true;\n';
  assert.equal(identifierHit(source, PRO_NAME), false);
});

test('clause extraction: the smallest enclosing bracket group, not the whole statement', () => {
  const source = 'if (a && !(quantumForecast && b) && c) { doThing(); }\n';
  const codeTokens = annotate(tokenize(source).filter((t) => t.type !== 'comment'));
  const idx = codeTokens.findIndex((t) => t.type === 'ident' && t.text === PRO_NAME);
  const { start, end } = extractClause(codeTokens, idx);
  const text = clauseText(codeTokens, start, end).split('\u0001').join(' ');
  assert.equal(text, '( quantumForecast && b )');
});

test('containsClause is token-boundary safe (no accidental partial-token substring match)', () => {
  const haystackSource = 'const abquantumForecastcd = 1;\n';
  const hay = annotate(tokenize(haystackSource).filter((t) => t.type !== 'comment'));
  assert.equal(containsClause(hay, 'quantumForecast'), false);
});

test('tokenizer stays balanced on a realistic JSX conditional with nested template and regex', () => {
  const source = [
    'const el = (',
    '  <div className={cond ? `a-${b}-${c}` : "b"}>',
    '    {/x+/.test(x) ? <span>{x}</span> : null}',
    '  </div>',
    ');',
    '',
  ].join('\n');
  const tokens = tokenize(source).filter((t) => t.type !== 'comment');
  const codeTokens = annotate(tokens);
  // Every close bracket resolved a matching open bracket, i.e. the tokenizer
  // never desynced (which would leave some brackets unmatched).
  const openCount = codeTokens.filter(
    (t) => t.type === 'punct' && (t.text === '(' || t.text === '{' || t.text === '[' || t.text === '${'),
  ).length;
  const matchedCloseCount = codeTokens.filter(
    (t) => t.type === 'punct' && (t.text === ')' || t.text === '}' || t.text === ']') && t.matchIndex !== undefined,
  ).length;
  assert.equal(openCount, matchedCloseCount);
});

/*
 * Phase 4.1C R2: `evaluateProOccurrences` (plural) — occurrence COUNTING,
 * not existence. Reviewer counterexample R4a: a genuinely new occurrence of
 * a clause that already exists in the baseline elsewhere must fail, even
 * though a pure "does this clause exist anywhere in the baseline" check
 * (the R1 fix) would have passed it. See planner-verify-lexer.mjs's own
 * header, "Occurrence counting, not existence", for the full account.
 */

test('batched form still passes a formatting-only reflow (evaluateProOccurrences, not just the single-line wrapper)', () => {
  const oldSource = [
    'function render(a, b) {',
    "  if (a.ready && !(quantumForecast && b.value)) return null;",
    '}',
  ].join('\n');
  const newSource = [
    'function render(a, b) {',
    '  if (',
    '    a.ready &&',
    '    !(quantumForecast && b.value)',
    '  )',
    '    return null;',
    '}',
  ].join('\n');
  const results = evaluateProOccurrences({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumbers: [4],
  });
  assert.equal(results.get(4).status, 'preexisting');
});

test('reviewer counterexample R4a: a NEW occurrence of an already-used clause is drift, even with the original left untouched', () => {
  const oldSource = [
    'function render(a, b) {',
    '  if (a.ready && !(quantumForecast && b.value)) return null;',
    '  return null;',
    '}',
  ].join('\n');
  // The original guard is left completely untouched — same text, same
  // line, not part of this diff at all. A SECOND, independent use of the
  // exact same clause text is added elsewhere in the file. A pure
  // existence check ("does this clause occur anywhere in the baseline?")
  // would wrongly pass this; the baseline had exactly one occurrence, and
  // that one occurrence is still fully spoken for by the untouched line.
  const newSource = [
    'function render(a, b) {',
    '  if (a.ready && !(quantumForecast && b.value)) return null;',
    '  if (!(quantumForecast && b.value)) probe();',
    '  return null;',
    '}',
  ].join('\n');
  const results = evaluateProOccurrences({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumbers: [3], // only the new probe line is diff-added
  });
  assert.equal(results.get(3).status, 'drift');
});

test('a literal duplicate of an existing PRO-bearing statement, with the original left untouched, is drift', () => {
  const oldSource = [
    'function guard(x) {',
    '  return !(quantumForecast && x.flag);',
    '}',
  ].join('\n');
  const newSource = [
    'function guard(x) {',
    '  return !(quantumForecast && x.flag);',
    '}',
    'function guardAgain(x) {',
    '  return !(quantumForecast && x.flag);',
    '}',
  ].join('\n');
  const results = evaluateProOccurrences({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumbers: [5],
  });
  assert.equal(results.get(5).status, 'drift');
});

test('two simultaneous candidate occurrences of one baseline clause: only as many pass as the baseline had', () => {
  const oldSource = [
    'function render(a, b) {',
    '  if (a.ready && !(quantumForecast && b.value)) return null;',
    '}',
  ].join('\n');
  // Both occurrences are reported as diff-added: one is the reflow of the
  // baseline guard, the other is a genuinely new, independent use. The
  // baseline only ever had ONE occurrence of this clause, so exactly one of
  // the two candidates may pass — never both.
  const newSource = [
    'function render(a, b) {',
    '  if (',
    '    a.ready &&',
    '    !(quantumForecast && b.value)',
    '  )',
    '    return null;',
    '  if (!(quantumForecast && b.value)) probe();',
    '}',
  ].join('\n');
  const results = evaluateProOccurrences({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumbers: [4, 7],
  });
  const statuses = [results.get(4).status, results.get(7).status].sort();
  assert.deepEqual(statuses, ['drift', 'preexisting']);
});

test('same clause at a different executable location is drift, not just formatting movement', () => {
  const oldSource = [
    'function onlyHere(x) {',
    '  return !(quantumForecast && x.flag);',
    '}',
  ].join('\n');
  // The clause text is byte-identical to the baseline's, but it now also
  // executes from a wholly different function/call site — not the same
  // occurrence reformatted, a second one.
  const newSource = [
    'function onlyHere(x) {',
    '  return !(quantumForecast && x.flag);',
    '}',
    'function elsewhere(x) {',
    '  if (!(quantumForecast && x.flag)) log(x);',
    '}',
  ].join('\n');
  const results = evaluateProOccurrences({
    oldSource,
    newSource,
    name: PRO_NAME,
    lineNumbers: [5],
  });
  assert.equal(results.get(5).status, 'drift');
});
