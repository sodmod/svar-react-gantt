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
