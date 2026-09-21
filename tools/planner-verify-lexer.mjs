/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT.
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Lexical-semantic helper for planner-verify.mjs's check 4 (PRO DRIFT).
 *
 * Review finding M-4.1C-F-01: check 4 used to decide "did this project ADD a
 * PRO-identifier reference" purely from `git diff`'s LINE classification. A
 * line-based diff is line-shape sensitive: reflowing an existing expression
 * across more lines (wrapping, reindenting — anything Prettier-equivalent)
 * makes `git diff` show the old single line as removed and the new multi-line
 * shape as entirely "added", even though not one token of the expression
 * changed. Three such false positives (`rollups`, `splitTasks`, `summary` in
 * Bars.jsx) were the concrete evidence: all three PRO-bearing expressions
 * already exist, byte-for-byte, in the upstream Community source; R6 only
 * rewrapped them.
 *
 * This module answers the narrower, provable question check 4 actually
 * needs: given a PRO-identifier occurrence on a line the diff marks ADDED,
 * was the smallest syntactic unit around that occurrence already present,
 * token-for-token, somewhere in the comparison baseline (the upstream file at
 * the recorded base commit) — so that only ITS FORMATTING moved — or is the
 * occurrence, or the expression around it, genuinely new?
 *
 * It is NOT a JavaScript parser. It does not build an AST, does not know JSX
 * element structure, and does not resolve scope, types or control flow. It
 * tokenizes — so whitespace, reindentation and line wrapping cannot hide or
 * fabricate a match — and uses bracket-depth bookkeeping to find the smallest
 * enclosing expression around a hit. That is enough to tell "reformatted"
 * from "changed" for the boolean-guard shape every known false positive and
 * every negative control in this project's proof contract takes:
 * `!(rollups && x)`, `!(splitTasks && y)`, `!(task.type === 'summary' && z)`.
 *
 * FAIL-CLOSED BY CONSTRUCTION: whenever this module cannot place a hit inside
 * real code with confidence (the only occurrence on the line lives inside a
 * trailing comment, not in code), the caller is told so explicitly
 * (`status: 'comment-only'`) and is expected to fail the check for it, the
 * same as before this module existed — see planner-verify.mjs. Nothing here
 * ever turns a hit into a silent pass by giving up; every non-'preexisting'
 * status is a reason to keep failing.
 */

/* ------------------------------------------------------------------------ *
 * Tokenizer
 * ------------------------------------------------------------------------ */

const MULTI_CHAR_PUNCT = [
  '>>>=', '===', '!==', '**=', '...', '<<=', '>>=', '>>>',
  '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>',
].sort((a, b) => b.length - a.length);

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

// Tokens after which a leading `/` starts a regex literal rather than
// division. Deliberately conservative (a false "division" reading only risks
// a desynced bracket count later in the same expression, which the caller's
// own balance check — see `tokenize`'s trailing assertion in its callers —
// would surface; a false "regex" reading is harmless here because regex
// bodies are opaque to this tokenizer either way).
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'throw', 'do', 'else', 'yield', 'await', 'case',
]);
// `<` is excluded deliberately: a `/` immediately after `<` is, in this
// JSX-heavy codebase, essentially always a closing tag (`</div>`), never a
// "less-than compared against a regex". Reading it as regex would swallow
// everything up to the next stray `/` — including brackets that belong to
// real code — and desync bracket depth for the rest of the file.
const NO_REGEX_AFTER_PUNCT = new Set([')', ']', '}', '<']);

const OPEN_BRACKETS = new Set(['(', '{', '[', '${']);
const CLOSE_BRACKETS = new Set([')', '}', ']']);

/**
 * Tokenizes a JS/JSX source string into a flat token list. Comments and
 * strings/templates are single tokens (their internal characters are never
 * mistaken for code); template interpolations (`${...}`) are tokenized as
 * real code, recursively, so a PRO identifier used inside one is still seen.
 *
 * Each token is `{ type, text, line }` where `type` is one of `'comment'`,
 * `'string'`, `'template'`, `'regex'`, `'number'`, `'ident'`, `'punct'`, and
 * `line` is the 1-based source line the token STARTS on.
 */
export function tokenize(source) {
  const tokens = [];
  const n = source.length;
  let i = 0;
  let line = 1;
  // Stack of brace-nesting depths at which a `${` was opened, so the matching
  // `}` resumes template-chunk scanning instead of being read as a plain
  // brace close. Depth here is local bookkeeping for THIS purpose only — the
  // general bracket depth used by clause extraction is computed separately,
  // over the finished token list, in `annotate`.
  const templateReturnDepth = [];
  let braceDepth = 0;

  const lastCodeToken = () => {
    for (let k = tokens.length - 1; k >= 0; k--) {
      if (tokens[k].type !== 'comment') return tokens[k];
    }
    return null;
  };

  const canStartRegex = () => {
    const prev = lastCodeToken();
    if (!prev) return true;
    if (prev.type === 'ident') return REGEX_PRECEDING_KEYWORDS.has(prev.text);
    if (prev.type === 'number' || prev.type === 'string' ||
        prev.type === 'template' || prev.type === 'regex') return false;
    if (prev.type === 'punct') return !NO_REGEX_AFTER_PUNCT.has(prev.text);
    return true;
  };

  // Scans a template-literal chunk (the text between backticks, or between a
  // `}` that closes an interpolation and the next `${`/closing backtick).
  // Returns 'end' (backtick found) or 'interp' (`${` found).
  const scanTemplateChunk = () => {
    const start = i;
    const startLine = line;
    while (i < n) {
      const c = source[i];
      if (c === '\\') { i += 2; continue; }
      if (c === '`') {
        i++;
        tokens.push({ type: 'template', text: source.slice(start, i), line: startLine });
        return 'end';
      }
      if (c === '$' && source[i + 1] === '{') {
        tokens.push({ type: 'template', text: source.slice(start, i), line: startLine });
        i += 2;
        tokens.push({ type: 'punct', text: '${', line });
        braceDepth++;
        templateReturnDepth.push(braceDepth);
        return 'interp';
      }
      if (c === '\n') line++;
      i++;
    }
    tokens.push({ type: 'template', text: source.slice(start, i), line: startLine });
    return 'end';
  };

  while (i < n) {
    const ch = source[i];

    if (ch === '\n') { line++; i++; continue; }
    if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\f' || ch === '\v') { i++; continue; }

    if (ch === '/' && source[i + 1] === '/') {
      const start = i, startLine = line;
      while (i < n && source[i] !== '\n') i++;
      tokens.push({ type: 'comment', text: source.slice(start, i), line: startLine });
      continue;
    }

    if (ch === '/' && source[i + 1] === '*') {
      const start = i, startLine = line;
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line++;
        i++;
      }
      i = Math.min(i + 2, n);
      tokens.push({ type: 'comment', text: source.slice(start, i), line: startLine });
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i, startLine = line;
      i++;
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\') { i++; }
        else if (source[i] === '\n') { line++; }
        i++;
      }
      i++;
      tokens.push({ type: 'string', text: source.slice(start, i), line: startLine });
      continue;
    }

    if (ch === '`') {
      i++;
      scanTemplateChunk();
      continue;
    }

    if (ch === '}') {
      i++;
      if (templateReturnDepth.length > 0 && braceDepth === templateReturnDepth[templateReturnDepth.length - 1]) {
        templateReturnDepth.pop();
        braceDepth--;
        tokens.push({ type: 'punct', text: '}', line });
        scanTemplateChunk();
        continue;
      }
      braceDepth--;
      tokens.push({ type: 'punct', text: '}', line });
      continue;
    }
    if (ch === '{') {
      braceDepth++;
      i++;
      tokens.push({ type: 'punct', text: '{', line });
      continue;
    }

    if (ch === '/' && canStartRegex()) {
      const start = i, startLine = line;
      i++;
      let inClass = false;
      while (i < n) {
        const c = source[i];
        if (c === '\\') { i += 2; continue; }
        if (c === '[') { inClass = true; i++; continue; }
        if (c === ']') { inClass = false; i++; continue; }
        if (c === '/' && !inClass) { i++; break; }
        if (c === '\n') break; // unterminated on this line — bail, not a regex after all
        i++;
      }
      // consume trailing flags
      while (i < n && IDENT_PART.test(source[i])) i++;
      tokens.push({ type: 'regex', text: source.slice(start, i), line: startLine });
      continue;
    }

    if (DIGIT.test(ch) || (ch === '.' && DIGIT.test(source[i + 1] || ''))) {
      const start = i, startLine = line;
      while (i < n && /[0-9a-fA-FxXoObB._]/.test(source[i])) i++;
      // exponent
      if (source[i] === 'e' || source[i] === 'E') {
        i++;
        if (source[i] === '+' || source[i] === '-') i++;
        while (i < n && DIGIT.test(source[i])) i++;
      }
      tokens.push({ type: 'number', text: source.slice(start, i), line: startLine });
      continue;
    }

    if (IDENT_START.test(ch)) {
      const start = i, startLine = line;
      i++;
      while (i < n && IDENT_PART.test(source[i])) i++;
      tokens.push({ type: 'ident', text: source.slice(start, i), line: startLine });
      continue;
    }

    let matched = null;
    for (const op of MULTI_CHAR_PUNCT) {
      if (source.startsWith(op, i)) { matched = op; break; }
    }
    if (matched) {
      tokens.push({ type: 'punct', text: matched, line });
      i += matched.length;
      continue;
    }

    tokens.push({ type: 'punct', text: ch, line });
    i++;
  }

  return tokens;
}

/* ------------------------------------------------------------------------ *
 * Bracket matching, depth and clause extraction
 * ------------------------------------------------------------------------ */

/**
 * Annotates a CODE-only token list (no `'comment'` tokens) in place with
 * `.depth` (nesting level, 0 at the top) and, for bracket tokens, `.matchIndex`
 * (the index of the paired opener/closer). `${` and its closing `}` are
 * treated as a matched pair like any other bracket, which is all clause
 * extraction needs from them.
 */
export function annotate(codeTokens) {
  const stack = [];
  for (let idx = 0; idx < codeTokens.length; idx++) {
    const tok = codeTokens[idx];
    if (tok.type === 'punct' && OPEN_BRACKETS.has(tok.text)) {
      tok.depth = stack.length;
      stack.push(idx);
    } else if (tok.type === 'punct' && CLOSE_BRACKETS.has(tok.text)) {
      const openIdx = stack.pop();
      if (openIdx !== undefined) {
        codeTokens[openIdx].matchIndex = idx;
        tok.matchIndex = openIdx;
      }
      tok.depth = stack.length;
    } else {
      tok.depth = stack.length;
    }
  }
  return codeTokens;
}

const STATEMENT_BOUNDARY_PUNCT = new Set([';', ',']);
const STATEMENT_BOUNDARY_KEYWORDS = new Set([
  'return', 'const', 'let', 'var', 'if', 'else', 'for', 'while', 'do',
  'switch', 'case', 'function', 'class', 'export', 'import', 'throw',
]);

const isBoundaryToken = (tok) =>
  (tok.type === 'punct' && (STATEMENT_BOUNDARY_PUNCT.has(tok.text) ||
    OPEN_BRACKETS.has(tok.text) || CLOSE_BRACKETS.has(tok.text))) ||
  (tok.type === 'ident' && STATEMENT_BOUNDARY_KEYWORDS.has(tok.text));

/**
 * Finds the smallest syntactic clause around `codeTokens[idx]`: the smallest
 * enclosing bracket pair, or — when the token is not inside any bracket
 * relative to its statement — the run of same-depth tokens up to the nearest
 * statement-ish boundary on each side. Returns `{ start, end }` (inclusive
 * token indices).
 */
export function extractClause(codeTokens, idx) {
  const tok = codeTokens[idx];
  const d = tok.depth;

  if (d > 0) {
    for (let k = idx - 1; k >= 0; k--) {
      const t = codeTokens[k];
      if (t.depth === d - 1 && t.type === 'punct' && OPEN_BRACKETS.has(t.text) &&
          t.matchIndex !== undefined) {
        return { start: k, end: t.matchIndex };
      }
      if (t.depth < d - 1) break;
    }
  }

  let start = idx;
  while (start > 0) {
    const prev = codeTokens[start - 1];
    if (prev.depth !== d || isBoundaryToken(prev)) break;
    start--;
  }
  let end = idx;
  while (end < codeTokens.length - 1) {
    const next = codeTokens[end + 1];
    if (next.depth !== d || isBoundaryToken(next)) break;
    end++;
  }
  return { start, end };
}

const CLAUSE_SEP = '\u0001';

/** Canonical, whitespace-free text of `codeTokens[start..end]` inclusive. */
export function clauseText(codeTokens, start, end) {
  return codeTokens.slice(start, end + 1).map((t) => t.text).join(CLAUSE_SEP);
}

/**
 * `true` if `needle` (as produced by `clauseText`) occurs as a contiguous,
 * token-boundary-aligned run somewhere in `haystackTokens`. Token-delimited
 * on both sides so a match can never straddle part of one token and part of
 * another.
 */
export function containsClause(haystackTokens, needle) {
  if (!needle) return false;
  const hay = CLAUSE_SEP + haystackTokens.map((t) => t.text).join(CLAUSE_SEP) + CLAUSE_SEP;
  return hay.includes(CLAUSE_SEP + needle + CLAUSE_SEP);
}

/* ------------------------------------------------------------------------ *
 * Identifier matching
 * ------------------------------------------------------------------------ */

/**
 * `true` if `text` contains `name` as a whole identifier — not as part of a
 * longer identifier — using the same "not preceded/followed by an identifier
 * character" rule the original line-based check used. Applied to a single
 * token's raw text, so for a string/template token this deliberately still
 * matches `name` written inside the quotes: a PRO identifier spelled in a
 * string was always in scope for this tripwire (see planner-verify.mjs's own
 * header), and nothing here relaxes that.
 */
export function identifierHit(text, name) {
  return new RegExp(`(?<![\\p{ID_Continue}$])${name}(?![\\p{ID_Continue}$])`, 'u').test(text);
}

const tokenMatchesIdentifier = (token, name) => {
  if (token.type === 'ident') return token.text === name;
  if (token.type === 'string' || token.type === 'template') return identifierHit(token.text, name);
  return false;
};

/* ------------------------------------------------------------------------ *
 * The check-4 decision, per (added line, PRO identifier)
 * ------------------------------------------------------------------------ */

/**
 * Decides whether one PRO-identifier occurrence, on one line the diff marks
 * ADDED in `newSource`, is drift.
 *
 * `oldSource` is the comparison baseline's full text for the same path (the
 * empty string if the path did not exist there — everything in a brand-new
 * file is, correctly, "new"). `newSource` is the full text at HEAD.
 * `lineNumber` is the 1-based line in `newSource` the diff attributes the
 * addition to. `name` is one PRO identifier.
 *
 * Returns one of:
 *   `{ status: 'preexisting' }`
 *     every code-token occurrence of `name` on that line has a clause that
 *     already exists, token-for-token, in `oldSource` — formatting only.
 *   `{ status: 'drift', clauses: string[] }`
 *     at least one occurrence's clause does NOT exist in `oldSource` — a new
 *     dependency, or an existing one whose semantics changed. `clauses` is
 *     the human-readable (space-joined) text of each such clause.
 *   `{ status: 'comment-only' }`
 *     `name` appears on that line, but only inside a comment token — no code
 *     token on the line matches it. The line-level pre-filter that calls this
 *     function already excludes WHOLE-LINE comments (see planner-verify.mjs
 *     for that policy); this status covers a trailing comment on an added
 *     code line, which the pre-fix check always failed on, and still should.
 */
export function evaluateProOccurrence({ oldSource, newSource, name, lineNumber }) {
  const newCode = annotate(tokenize(newSource).filter((t) => t.type !== 'comment'));
  const matches = [];
  for (let idx = 0; idx < newCode.length; idx++) {
    if (newCode[idx].line === lineNumber && tokenMatchesIdentifier(newCode[idx], name)) {
      matches.push(idx);
    }
  }
  if (matches.length === 0) return { status: 'comment-only' };

  const oldCode = annotate(tokenize(oldSource || '').filter((t) => t.type !== 'comment'));
  const driftClauses = [];
  for (const idx of matches) {
    const { start, end } = extractClause(newCode, idx);
    const needle = clauseText(newCode, start, end);
    if (!containsClause(oldCode, needle)) {
      driftClauses.push(needle.split(CLAUSE_SEP).join(' '));
    }
  }
  if (driftClauses.length > 0) return { status: 'drift', clauses: driftClauses };
  return { status: 'preexisting' };
}
