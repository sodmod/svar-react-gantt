/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M38).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the shared overlay viewport-clamp geometry
 * (`src/planner-router/overlayViewport.js`), R1-5/R1-6 of the Pavel
 * manual-acceptance remediation. Run: `npm run test:planner`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  clampDelta,
  clampChipRect,
  clampPopoverRect,
} from '../src/planner-router/overlayViewport.js';

const VIEWPORT = { left: 0, top: 0, right: 1000, bottom: 600 };

test('clampDelta: a rect already fully inside the viewport needs no correction', () => {
  const rect = { left: 100, top: 100, right: 200, bottom: 150 };
  assert.deepEqual(clampDelta(rect, VIEWPORT, 8), { dx: 0, dy: 0 });
});

test('clampDelta: a rect crossing the right edge is pulled back left by exactly the overshoot plus margin', () => {
  const rect = { left: 950, top: 100, right: 1050, bottom: 150 };
  const { dx, dy } = clampDelta(rect, VIEWPORT, 8);
  assert.equal(dy, 0);
  assert.equal(rect.right + dx, VIEWPORT.right - 8);
});

test('clampDelta: a rect crossing the left edge is pushed right', () => {
  const rect = { left: -50, top: 100, right: 50, bottom: 150 };
  const { dx } = clampDelta(rect, VIEWPORT, 8);
  assert.equal(rect.left + dx, VIEWPORT.left + 8);
});

test('clampDelta: a rect crossing the bottom edge is pulled up', () => {
  const rect = { left: 100, top: 580, right: 200, bottom: 650 };
  const { dy } = clampDelta(rect, VIEWPORT, 8);
  assert.equal(rect.bottom + dy, VIEWPORT.bottom - 8);
});

test('clampChipRect: default placement is ABOVE the anchor, horizontally centred on it (R1-5)', () => {
  const anchor = { x: 500, y: 300 };
  const size = { width: 168, height: 22 };
  const { left, top } = clampChipRect(anchor, size, VIEWPORT, { gap: 7 });
  assert.equal(top, anchor.y - 7 - size.height);
  assert.equal(left, anchor.x - size.width / 2);
});

test('clampChipRect: flips BELOW the anchor when there is genuinely no room above the viewport', () => {
  const anchor = { x: 500, y: 10 }; // 10px from the very top of the chart
  const size = { width: 168, height: 22 };
  const { top } = clampChipRect(anchor, size, VIEWPORT, { gap: 7, margin: 8 });
  assert.equal(top, anchor.y + 7, 'must hang below, not clip above the viewport top');
});

test('NEGATIVE CONTROL / R1-5 NC-CHIP-CLAMP: a chip centred near the right edge is pulled fully inside — a naive centred-anchor placement would clip it', () => {
  const anchor = { x: 990, y: 300 }; // 10px from the right edge
  const size = { width: 168, height: 22 };
  const { left } = clampChipRect(anchor, size, VIEWPORT, { gap: 7, margin: 8 });
  assert.ok(
    left + size.width <= VIEWPORT.right - 8,
    'the chip\'s own right edge must stay inside the viewport with margin',
  );
  // Prove this assertion actually distinguishes clamped from unclamped:
  // the NAIVE (unclamped) centred placement this same case would otherwise
  // produce DOES cross the edge, so the assertion above is not vacuous.
  const naiveLeft = anchor.x - size.width / 2;
  assert.ok(naiveLeft + size.width > VIEWPORT.right - 8);
});

test('clampPopoverRect: default placement is BELOW and to the RIGHT of the anchor (R1-6)', () => {
  const anchor = { x: 400, y: 200 };
  const size = { width: 240, height: 90 };
  const { left, top } = clampPopoverRect(anchor, size, VIEWPORT, { gap: 6 });
  assert.equal(top, anchor.y + 6);
  assert.equal(left, anchor.x);
});

test('clampPopoverRect: flips ABOVE when there is no room below', () => {
  const anchor = { x: 400, y: 550 };
  const size = { width: 240, height: 90 };
  const { top } = clampPopoverRect(anchor, size, VIEWPORT, { gap: 6, margin: 8 });
  assert.equal(top, anchor.y - 6 - size.height);
});

test('clampPopoverRect: flips LEFT when there is no room to the right', () => {
  const anchor = { x: 850, y: 200 };
  const size = { width: 240, height: 90 };
  const { left } = clampPopoverRect(anchor, size, VIEWPORT, { gap: 6, margin: 8 });
  assert.equal(left, anchor.x - size.width);
});

test('clampPopoverRect: flips BOTH axes at once for a bottom-right corner ("уходит за экран.jpg")', () => {
  const anchor = { x: 900, y: 550 };
  const size = { width: 240, height: 90 };
  const { left, top } = clampPopoverRect(anchor, size, VIEWPORT, {
    gap: 6,
    margin: 8,
  });
  assert.ok(left + size.width <= VIEWPORT.right - 8);
  assert.ok(top >= VIEWPORT.top + 8);
  assert.ok(top + size.height <= VIEWPORT.bottom - 8);
});

test('NEGATIVE CONTROL / R1-6 NC-POPOVER-FLIP: a popover opened near the bottom-right corner stays fully inside the viewport on every edge', () => {
  const anchor = { x: 995, y: 595 }; // right at the corner
  const size = { width: 240, height: 90 };
  const { left, top } = clampPopoverRect(anchor, size, VIEWPORT, {
    gap: 6,
    margin: 8,
  });
  const rect = { left, top, right: left + size.width, bottom: top + size.height };
  assert.ok(rect.left >= VIEWPORT.left + 8);
  assert.ok(rect.right <= VIEWPORT.right - 8);
  assert.ok(rect.top >= VIEWPORT.top + 8);
  assert.ok(rect.bottom <= VIEWPORT.bottom - 8);
  // Prove the assertion is not vacuous: the naive "always below, always
  // right" placement this same corner would otherwise get crosses BOTH
  // edges, so flip/clamp logic is genuinely load-bearing here.
  const naiveRect = {
    left: anchor.x,
    top: anchor.y + 6,
    right: anchor.x + size.width,
    bottom: anchor.y + 6 + size.height,
  };
  assert.ok(naiveRect.right > VIEWPORT.right - 8);
  assert.ok(naiveRect.bottom > VIEWPORT.bottom - 8);
});
