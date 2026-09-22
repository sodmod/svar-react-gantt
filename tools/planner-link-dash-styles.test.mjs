/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M51).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * WHAT THIS PINS
 *
 * Two stylesheets draw a presentation route in this renderer:
 *
 *   Links.css            a canonical link            `.wx-line`
 *   AggregateLinks.css   a collapsed group's line    `.wx-aggregate-line`
 *
 * They are the SAME presentation seen at two disclosure states, so a
 * `lineStyle` the consumer's `linkPresentation` prop can name must paint the
 * same dash pattern in both. Nothing in CSS enforces that. Each file scopes
 * its rules with its own component token (`wx-dkx3NwEn` / `wx-4kNpQzTa`), so
 * one file's rule can never fall through to the other's element, and a class
 * with no matching rule is not an error — it simply paints the base style.
 *
 * MEASURED (Pavel manual acceptance, Phase 4.1G R2 Finding A): with
 * `.wx-line-dotted` present in `Links.css` and absent from
 * `AggregateLinks.css`, one and the same Informational link painted
 * `stroke-dasharray: 1.5 3` with its group expanded and `none` — solid —
 * with it collapsed. Collapsing is allowed to change the route's geometry
 * (that is this whole feature); it is not allowed to change which link the
 * person is looking at.
 *
 * BOUNDARY (project D-091 §10.1): this is a bounded textual tripwire over
 * two stylesheets. Green means both files declare the same dash pattern for
 * every style either of them names. It does NOT prove the class ever reaches
 * the element, that the element is painted, or that any consumer asks for a
 * given style — the product's own browser proof
 * (`e2e/phase-4-1g-r2-collapsed-presentation.spec.ts`, which reads
 * `getComputedStyle(...).strokeDasharray` off the rendered path) is the
 * evidence for that, and this test does not replace it.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHART = path.join(HERE, '..', 'src', 'components', 'chart');

/**
 * Every `stroke-dasharray` declared for a `wx-line-<style>` class in one
 * stylesheet, as a Map from the style name to its normalized pattern.
 *
 * The scan is deliberately syntactic and narrow: a rule whose selector text
 * contains `.wx-line-<name>` and whose body declares `stroke-dasharray`.
 * Comments are stripped first so the prose above a rule cannot be read as a
 * rule (this file's own `AggregateLinks.css` note names both styles).
 */
function dashPatterns(file) {
  const css = readFileSync(path.join(CHART, file), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    '',
  );
  const found = new Map();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let match;
  while ((match = ruleRe.exec(css)) !== null) {
    const [, selector, body] = match;
    const dash = /stroke-dasharray\s*:\s*([^;}]+)/.exec(body);
    if (dash === null) continue;
    const style = /\.wx-line-([a-z]+)\b/.exec(selector);
    if (style === null) continue;
    const name = style[1];
    const pattern = dash[1].replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const previous = found.get(name);
    assert.equal(
      previous ?? pattern,
      pattern,
      `${file} declares two different stroke-dasharray values for wx-line-${name}`,
    );
    found.set(name, pattern);
  }
  return found;
}

test('SVAR-M51: the canonical-link and aggregate stylesheets name the SAME set of line styles', () => {
  const links = dashPatterns('Links.css');
  const aggregate = dashPatterns('AggregateLinks.css');
  // `solid` is deliberately absent from both: it is the base rule, the
  // absence of a dash pattern. Every OTHER style either file names must be
  // named by both — that is the whole invariant.
  assert.deepEqual(
    [...aggregate.keys()].sort(),
    [...links.keys()].sort(),
    'a line style with a dash pattern in one stylesheet and none in the other paints solid on one of the two disclosure states',
  );
  // The gap this test was written for, named so a failure reads plainly.
  assert.ok(
    links.has('dotted') && aggregate.has('dotted'),
    'wx-line-dotted must carry a dash pattern in BOTH stylesheets',
  );
  assert.ok(
    links.has('dashed') && aggregate.has('dashed'),
    'wx-line-dashed must carry a dash pattern in BOTH stylesheets',
  );
});

test('SVAR-M51: each named line style paints the same dash pattern in both stylesheets', () => {
  const links = dashPatterns('Links.css');
  const aggregate = dashPatterns('AggregateLinks.css');
  for (const [style, pattern] of links) {
    assert.equal(
      aggregate.get(style),
      pattern,
      `wx-line-${style} paints "${pattern}" for a canonical link and "${aggregate.get(style)}" for an aggregate — the same link would change appearance when its group is collapsed`,
    );
  }
});

test('SVAR-M51: the pattern scan actually reads the two files (self-check)', () => {
  // A scan that silently matched nothing would make both assertions above
  // vacuously true. These are the two patterns the accepted visual contract
  // has carried since SVAR-M32; they are visual-tuning values (D-166 §I) and
  // may be retuned, but not to nothing.
  const links = dashPatterns('Links.css');
  assert.ok(links.size >= 2, 'Links.css named fewer styles than it declares');
  for (const pattern of links.values()) {
    assert.match(pattern, /^[\d.]+(px)? [\d.]+(px)?$/);
  }
});
