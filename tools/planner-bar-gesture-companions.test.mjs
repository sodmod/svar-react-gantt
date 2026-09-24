/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M55).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The pure half of the gesture companions (src/components/chart/barGestureCompanions.js).
 *
 * PROVES, on synthetic inputs: the base geometry is read once per id, skipping
 * the grabbed bar, duplicates, unknown ids and bars with no drawn geometry;
 * every step translates EVERY companion by the SAME dx and keeps its width;
 * a reset is the step with dx 0. DOES NOT PROVE that Bars.jsx calls these on
 * the right pointer events or that the store draws them — that is the
 * Planner's real-Chromium suite (e2e/hard-preview-ghosts.spec.ts).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectCompanionBases,
  companionReset,
  companionStep,
} from '../src/components/chart/barGestureCompanions.js';

const tasks = new Map([
  ['a', { $x: 100, $w: 40 }],
  ['b', { $x: 150, $w: 20 }],
  ['c', { $x: 10, $w: 60 }],
  ['offscreen', { $x: undefined, $w: undefined }],
]);
const getTask = (id) => tasks.get(id);

test('bases: the grabbed bar, duplicates, unknown ids and undrawn bars are skipped', () => {
  const bases = collectCompanionBases(
    ['b', 'a', 'b', 'missing', 'offscreen', 'c'],
    'a',
    getTask,
  );
  assert.deepEqual(
    [...bases.entries()],
    [
      ['b', { l: 150, w: 20 }],
      ['c', { l: 10, w: 60 }],
    ],
  );
});

test('bases: no answer, or an answer that is not a list, carries nothing', () => {
  assert.equal(collectCompanionBases(null, 'a', getTask).size, 0);
  assert.equal(collectCompanionBases(undefined, 'a', getTask).size, 0);
  assert.equal(collectCompanionBases(42, 'a', getTask).size, 0);
});

test('step: every companion moves by the same dx and keeps its width', () => {
  const bases = collectCompanionBases(['b', 'c'], 'a', getTask);
  assert.deepEqual(companionStep(bases, 37), [
    { id: 'b', left: 187, width: 20 },
    { id: 'c', left: 47, width: 60 },
  ]);
  assert.deepEqual(companionStep(bases, -12), [
    { id: 'b', left: 138, width: 20 },
    { id: 'c', left: -2, width: 60 },
  ]);
});

test('step: the bases are read once — a later step does not compound', () => {
  const bases = collectCompanionBases(['b'], 'a', getTask);
  companionStep(bases, 10);
  assert.deepEqual(companionStep(bases, 25), [
    { id: 'b', left: 175, width: 20 },
  ]);
});

test('reset: every companion back to exactly its base', () => {
  const bases = collectCompanionBases(['b', 'c'], 'a', getTask);
  assert.deepEqual(companionReset(bases), [
    { id: 'b', left: 150, width: 20 },
    { id: 'c', left: 10, width: 60 },
  ]);
  assert.deepEqual(companionReset(null), []);
});
