/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M11).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * Unit tests for the bar-drag preview gate. Run: `npm run test:planner`
 * (plain `node --test`, no extra dependency).
 *
 * The load-bearing case is the FIRST one: a drag of a bar no annotation
 * follows must stop writing layout state after its second step, however far
 * the pointer travels. That is the structural form of the performance
 * property the combined Phase 3.2B independent review asked for (`Major` F-3)
 * — a claim about the number of state writes, not about wall-clock time, so
 * it can be asserted deterministically without a flaky timing threshold
 * (`AGENTS.md` §5).
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT (project rule D-091 §1). Green here
 * proves the pure decision answers as documented for the reported step
 * sequences below. It proves NOTHING about how long a browser then takes, and
 * nothing about what `Layout.jsx` does with the answer; the Planner's own
 * real-Chromium suite and its base-vs-target characterization are the runtime
 * half.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  collectFollowedTaskIds,
  IDLE_BAR_DRAG_PREVIEW,
  nextBarDragPreviewState,
} from '../src/components/chart/annotations/barDragPreviewGate.js';

/**
 * Replays a whole gesture through the gate and reports what the layout would
 * have been told — one entry per PUBLISHED step, in order.
 */
function replay(steps, followedTaskIds) {
  let state = IDLE_BAR_DRAG_PREVIEW;
  const published = [];
  for (const event of steps) {
    const next = nextBarDragPreviewState(state, event, followedTaskIds);
    state = next.state;
    if (next.publish) published.push(next.state.published);
  }
  return { published, state };
}

/** `count` accepted steps of one continuous drag of `id`, then the release. */
function gesture(id, count) {
  const steps = [];
  for (let step = 1; step <= count; step += 1) {
    steps.push({ id, dx: step * 2, diff: 0, inProgress: true });
  }
  steps.push({ id: null, dx: 0, diff: 0, inProgress: false });
  return steps;
}

test('SVAR-M11: a drag no annotation follows writes layout state twice, whatever the distance', () => {
  const nothingFollows = collectFollowedTaskIds([
    { id: 'today', date: new Date() },
    { id: 'other', followsTaskId: 'some-other-task' },
  ]);

  for (const count of [2, 10, 120]) {
    const { published, state } = replay(gesture('leaf', count), nothingFollows);
    assert.deepEqual(
      published,
      [{ id: 'leaf', dx: 2 }, null],
      `${count} accepted steps must still publish exactly the first step and its drop`,
    );
    assert.deepEqual(
      state,
      IDLE_BAR_DRAG_PREVIEW,
      'the gesture leaves no state',
    );
  }
});

test('SVAR-M11: a drag an annotation DOES follow still publishes every step, and clears on release', () => {
  const follows = collectFollowedTaskIds([
    { id: 'milestone:m1', followsTaskId: 'm1' },
  ]);

  const { published, state } = replay(gesture('m1', 4), follows);
  assert.deepEqual(published, [
    { id: 'm1', dx: 2 },
    { id: 'm1', dx: 4 },
    { id: 'm1', dx: 6 },
    { id: 'm1', dx: 8 },
    null,
  ]);
  assert.deepEqual(state, IDLE_BAR_DRAG_PREVIEW);
});

test('SVAR-M11: the FIRST step is published even when nothing follows the bar yet — a consumer may redirect on this very event', () => {
  // A container drag: at the moment the first step is reported, no annotation
  // names the container. The consumer redirects its descendants' markers onto
  // it in response, so from the second step on the gate is open — and the
  // first step's displacement was already in the same commit as the redirect.
  const before = collectFollowedTaskIds([
    { id: 'milestone:m1', followsTaskId: 'm1' },
  ]);
  const after = collectFollowedTaskIds([
    { id: 'milestone:m1', followsTaskId: 'container' },
  ]);

  let state = IDLE_BAR_DRAG_PREVIEW;
  const first = nextBarDragPreviewState(
    state,
    { id: 'container', dx: 4, inProgress: true },
    before,
  );
  assert.equal(first.publish, true);
  assert.deepEqual(first.state.published, { id: 'container', dx: 4 });
  state = first.state;

  const second = nextBarDragPreviewState(
    state,
    { id: 'container', dx: 6, inProgress: true },
    after,
  );
  assert.equal(second.publish, true);
  assert.deepEqual(second.state.published, { id: 'container', dx: 6 });
});

test('SVAR-M11: an unfollowed first step is DROPPED, so it can never linger as a stale displacement', () => {
  const nothingFollows = collectFollowedTaskIds([]);

  let state = IDLE_BAR_DRAG_PREVIEW;
  const first = nextBarDragPreviewState(
    state,
    { id: 'leaf', dx: 4, inProgress: true },
    nothingFollows,
  );
  state = first.state;
  const second = nextBarDragPreviewState(
    state,
    { id: 'leaf', dx: 6, inProgress: true },
    nothingFollows,
  );
  assert.equal(second.publish, true);
  assert.equal(second.state.published, null);

  const third = nextBarDragPreviewState(
    (state = second.state),
    { id: 'leaf', dx: 8, inProgress: true },
    nothingFollows,
  );
  assert.equal(third.publish, false);
  assert.equal(third.state.published, null);
});

test('SVAR-M11: an unchanged step of a followed bar publishes nothing', () => {
  const follows = collectFollowedTaskIds([{ id: 'a', followsTaskId: 'm1' }]);
  const first = nextBarDragPreviewState(
    IDLE_BAR_DRAG_PREVIEW,
    { id: 'm1', dx: 4, inProgress: true },
    follows,
  );
  const repeat = nextBarDragPreviewState(
    first.state,
    { id: 'm1', dx: 4, inProgress: true },
    follows,
  );
  assert.equal(repeat.publish, false);
  assert.equal(repeat.state, first.state);
});

test('SVAR-M11: a release with nothing published writes nothing at all', () => {
  const release = nextBarDragPreviewState(
    IDLE_BAR_DRAG_PREVIEW,
    { id: null, dx: 0, inProgress: false },
    collectFollowedTaskIds([]),
  );
  assert.equal(release.publish, false);
  assert.deepEqual(release.state, IDLE_BAR_DRAG_PREVIEW);

  for (const event of [null, undefined, { id: null, inProgress: true }]) {
    const answer = nextBarDragPreviewState(
      IDLE_BAR_DRAG_PREVIEW,
      event,
      collectFollowedTaskIds([]),
    );
    assert.equal(answer.publish, false, JSON.stringify(event));
  }
});

test('SVAR-M11: a second bar grabbed after the first is its own gesture, so its first step publishes', () => {
  const nothingFollows = collectFollowedTaskIds([]);
  const first = nextBarDragPreviewState(
    IDLE_BAR_DRAG_PREVIEW,
    { id: 'leaf-a', dx: 4, inProgress: true },
    nothingFollows,
  );
  const other = nextBarDragPreviewState(
    first.state,
    { id: 'leaf-b', dx: 4, inProgress: true },
    nothingFollows,
  );
  assert.equal(other.publish, true);
  assert.deepEqual(other.state.published, { id: 'leaf-b', dx: 4 });
});

test('SVAR-M11: followsTaskId is compared as text, so a numeric id and its string form agree', () => {
  const follows = collectFollowedTaskIds([{ id: 'a', followsTaskId: 17 }]);
  assert.equal(follows.has('17'), true);

  const first = nextBarDragPreviewState(
    IDLE_BAR_DRAG_PREVIEW,
    { id: 17, dx: 2, inProgress: true },
    follows,
  );
  const second = nextBarDragPreviewState(
    first.state,
    { id: 17, dx: 4, inProgress: true },
    follows,
  );
  assert.equal(second.publish, true);
  assert.deepEqual(second.state.published, { id: 17, dx: 4 });
});

test('SVAR-M11: collectFollowedTaskIds ignores annotations that follow nothing, and survives a missing list', () => {
  assert.equal(collectFollowedTaskIds(undefined).size, 0);
  assert.equal(collectFollowedTaskIds(null).size, 0);
  assert.equal(collectFollowedTaskIds([]).size, 0);
  assert.equal(
    collectFollowedTaskIds([null, {}, { followsTaskId: null }]).size,
    0,
  );
  assert.deepEqual(
    [
      ...collectFollowedTaskIds([
        { followsTaskId: 'a' },
        { followsTaskId: 'a' },
      ]),
    ],
    ['a'],
  );
});
