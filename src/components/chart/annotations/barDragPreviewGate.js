/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M11).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * WHEN the live bar-drag preview (SVAR-M5) has to reach the annotation layout,
 * and when it does not.
 *
 * ## The defect this repairs
 *
 * SVAR-M5 gives `Layout.jsx` one piece of transient state, `{ id, dx }`, so a
 * marker can travel with the bar it follows. `Bars.jsx` reports EVERY accepted
 * pointer step of EVERY bar, of every consumer — it has to, because it does not
 * know what a marker is — and `Layout.jsx` wrote that report into React state
 * unconditionally. A state write there re-renders the whole layout: the grid,
 * the resizer, the chart, the scale. Once per accepted pointer step. For every
 * consumer, including one with no annotations at all, where the resulting
 * layout is provably identical to the previous one.
 *
 * Measured on the pinned build, 120 accepted steps of one continuous leaf drag,
 * three compositions (the combined Phase 3.2B independent review's `Major`
 * F-3):
 *
 * ```text
 *                            before SVAR-M4/M5   with SVAR-M5, unconditional
 *   full application            32.8 ms/step            48.5 ms/step
 *   application disabled        33.6 ms/step            47.8 ms/step
 *   bare Gantt, no consumer      34.1 ms/step            44.4 ms/step
 * ```
 *
 * The last row is the decisive one: a page with no annotations, no application
 * code and nothing to preview paid 30% more per step. That is a cost this fork
 * imposed on ordinary dragging, not a cost of the feature.
 *
 * ## The rule
 *
 * The annotation layout depends on `{ id, dx }` only through `followsTaskId`:
 * `placeAnnotations` displaces an annotation exactly when that annotation names
 * the dragged bar (`./timelineAnnotationLayout.js`). So the state write is
 * needed exactly when some annotation follows the bar being dragged — with ONE
 * deliberate exception, the first accepted step of a gesture.
 *
 * That exception is not caution, it is correctness. A consumer may REDIRECT an
 * annotation onto the dragged bar in response to the very event that reports
 * the step — that is how a container carries its descendants' markers — and it
 * can only do so after seeing the event. Publishing the first step
 * unconditionally means the redirect and the pixel displacement land in the
 * SAME React commit, so a marker never lags a frame behind the bar. If the
 * second step shows that nothing followed the bar after all, the first step's
 * value is dropped once and the gesture then runs silent.
 *
 * A gesture therefore costs, in layout state writes:
 *
 * ```text
 *   some annotation follows the bar    one per accepted step (needed: the
 *                                      marker has to move)
 *   nothing follows the bar            exactly two, whatever the distance
 *                                      travelled: the first step, and the
 *                                      one that drops it
 * ```
 *
 * ## What this module is not
 *
 * It is a pure decision over values: no React, no store, no DOM, no timer, no
 * knowledge of what an annotation MEANS. It does not decide where anything is
 * drawn — `./timelineAnnotationLayout.js` still owns every pixel — only
 * whether the layout needs recomputing at all.
 */

/** The state of this decision between gestures: nothing published, none open. */
export const IDLE_BAR_DRAG_PREVIEW = Object.freeze({
  published: null,
  gestureId: null,
});

/** `true` when `event` is a report that no gesture is in flight any more. */
function endsGesture(event) {
  return !event || event.inProgress === false || event.id == null;
}

/**
 * Every task id some annotation currently follows, as strings.
 *
 * Strings because `followsTaskId` and a task's own `id` may legitimately be a
 * number on one side and its text form on the other; `placeAnnotations`
 * already compares them as strings, and this must agree with it exactly or the
 * gate would close on a bar whose marker does need to move.
 */
export function collectFollowedTaskIds(annotations) {
  const ids = new Set();
  if (!annotations || !annotations.length) return ids;
  for (const annotation of annotations) {
    if (annotation && annotation.followsTaskId != null) {
      ids.add(String(annotation.followsTaskId));
    }
  }
  return ids;
}

/**
 * The next state of the bar-drag preview, and whether the layout has to be
 * told about it.
 *
 * @param state             the previous value of this function's own state,
 *                          starting from `IDLE_BAR_DRAG_PREVIEW`
 * @param event             one `onDragPreview` report from `Bars.jsx`
 * @param followedTaskIds   `collectFollowedTaskIds(...)` of the annotations
 *                          the consumer is currently passing
 * @returns `{ state, publish }`. `publish: false` means the caller must NOT
 *          write React state for this step — that is the whole point of this
 *          module. `publish: true` means write `state.published`, which is
 *          `null` when the preview is being cleared.
 */
export function nextBarDragPreviewState(state, event, followedTaskIds) {
  const previous = state || IDLE_BAR_DRAG_PREVIEW;

  if (endsGesture(event)) {
    if (previous.published === null && previous.gestureId === null) {
      return { state: IDLE_BAR_DRAG_PREVIEW, publish: false };
    }
    return {
      state: IDLE_BAR_DRAG_PREVIEW,
      publish: previous.published !== null,
    };
  }

  const id = event.id;
  const key = String(id);
  const value = { id, dx: event.dx };

  // The first accepted step of THIS bar's gesture: always published, so a
  // consumer that redirects an annotation onto this bar in response to this
  // same event has the pixel displacement in the same commit.
  if (previous.gestureId !== key) {
    return { state: { published: value, gestureId: key }, publish: true };
  }

  if (followedTaskIds && followedTaskIds.has(key)) {
    const published = previous.published;
    if (
      published !== null &&
      published.id === value.id &&
      published.dx === value.dx
    ) {
      return { state: previous, publish: false };
    }
    return { state: { published: value, gestureId: key }, publish: true };
  }

  // Nothing follows this bar. Drop the first step's value once — it must not
  // linger if the consumer redirects an annotation onto this bar later — and
  // then stay silent for the rest of the gesture, however far it travels.
  if (previous.published !== null) {
    return { state: { published: null, gestureId: key }, publish: true };
  }
  return { state: previous, publish: false };
}
