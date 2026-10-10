/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M58).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The window copier's two promises, in both directions: a row that is still
 * in the window keeps its copy across a pure window shift, and a row whose
 * content may have changed never gets an old copy back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWindowRowCopies,
  isShallowSnapshotOf,
} from '../src/components/windowRowCopies.js';

const task = (id, extra = {}) => ({ id, text: `t${id}`, $x: id * 10, ...extra });

test('the first window gets fresh shallow copies of every row', () => {
  const copies = createWindowRowCopies();
  const rows = [task(1), task(2)];
  const out = copies(rows, 1);
  assert.equal(out.length, 2);
  out.forEach((copy, i) => {
    assert.notEqual(copy, rows[i]);
    assert.deepEqual(copy, rows[i]);
  });
});

test('a pure window shift: the rows that stay keep their copy, the one that enters gets a new one', () => {
  const copies = createWindowRowCopies();
  const all = [task(1), task(2), task(3), task(4)];
  const first = copies(all.slice(0, 3), 7);
  const second = copies(all.slice(1, 4), 7);
  assert.equal(second[0], first[1]);
  assert.equal(second[1], first[2]);
  assert.notEqual(second[2], all[3]);
  assert.deepEqual(second[2], all[3]);
  // And back up: the row that left (task 1) was forgotten, so it is copied anew.
  const third = copies(all.slice(0, 3), 7);
  assert.notEqual(third[0], first[0]);
  assert.deepEqual(third[0], all[0]);
  assert.equal(third[1], second[0]);
});

test('a new version copies every row afresh, even an unchanged one', () => {
  const copies = createWindowRowCopies();
  const rows = [task(1), task(2)];
  const first = copies(rows, 1);
  const second = copies(rows, 2);
  assert.notEqual(second[0], first[0]);
  assert.notEqual(second[1], first[1]);
  assert.deepEqual(second, first);
});

test('a source changed in place under the same version is copied afresh (gantt-store drag-task)', () => {
  const copies = createWindowRowCopies();
  const rows = [task(1), task(2)];
  const first = copies(rows, 1);
  rows[1].$x = 999;
  const second = copies(rows, 1);
  assert.equal(second[0], first[0]);
  assert.notEqual(second[1], first[1]);
  assert.equal(second[1].$x, 999);
});

test('a source that gains or loses a key is copied afresh', () => {
  const copies = createWindowRowCopies();
  const rows = [task(1), task(2)];
  const first = copies(rows, 1);
  rows[0].$reorder = true;
  delete rows[1].text;
  const second = copies(rows, 1);
  assert.notEqual(second[0], first[0]);
  assert.equal(second[0].$reorder, true);
  assert.notEqual(second[1], first[1]);
  assert.equal('text' in second[1], false);
});

test('a new object for the same id is a new row: no copy is matched by id', () => {
  const copies = createWindowRowCopies();
  const a = task(1);
  const first = copies([a], 1);
  const second = copies([{ ...a }], 1);
  assert.notEqual(second[0], first[0]);
  assert.deepEqual(second[0], first[0]);
});

test('a copy that someone changed is not handed out again', () => {
  const copies = createWindowRowCopies();
  const rows = [task(1)];
  const first = copies(rows, 1);
  first[0].text = 'edited downstream';
  const second = copies(rows, 1);
  assert.notEqual(second[0], first[0]);
  assert.equal(second[0].text, 't1');
});

test('the same object twice in one window gets two copies, as upstream did', () => {
  const copies = createWindowRowCopies();
  const a = task(1);
  const out = copies([a, a], 1);
  assert.notEqual(out[0], out[1]);
  assert.deepEqual(out[0], out[1]);
});

test('an empty window and back', () => {
  const copies = createWindowRowCopies();
  const rows = [task(1)];
  const first = copies(rows, 1);
  assert.deepEqual(copies([], 1), []);
  const again = copies(rows, 1);
  assert.notEqual(again[0], first[0]);
});

test('isShallowSnapshotOf compares own keys and values by identity', () => {
  const nested = { a: 1 };
  assert.equal(isShallowSnapshotOf({ x: nested, y: 2 }, { x: nested, y: 2 }), true);
  assert.equal(isShallowSnapshotOf({ x: nested }, { x: { a: 1 } }), false);
  assert.equal(isShallowSnapshotOf({ x: 1 }, { x: 1, y: undefined }), false);
  assert.equal(isShallowSnapshotOf({ x: NaN }, { x: NaN }), true);
  assert.equal(isShallowSnapshotOf({ x: undefined }, { y: undefined }), false);
});
