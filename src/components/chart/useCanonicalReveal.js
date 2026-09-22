import { useCallback, useEffect, useRef } from 'react';
import { collapsedAncestorsToOpen } from '../../planner-router/aggregate.js';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M53).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * "Reveal ONE canonical task, opening only its own collapsed ancestors" —
 * the rule, once (Phase 4.1C R6-4/R6-5, SVAR-M45 R3-6; Phase 4.1G R4).
 *
 * The rule itself is not new. It was written for the collapsed-group
 * popover row in `AggregateLinks.jsx` (SVAR-M49 R6-4), and it is exactly
 * what the offscreen chip needs at Phase 4.1G R4 when the task it names
 * lives inside a collapsed group: open the minimum chain of closed
 * ancestors, wait for the rows those opens produce, then land. Writing it a
 * second time inside `OffscreenLinkChips.jsx` would put two answers in the
 * renderer to "what does it take to show a hidden task", which is exactly
 * the second-owner shape the project's own D-091 calls a Blocker even when
 * every automated guard is green. So it moved here unchanged and both
 * components call it.
 *
 * Two named calls rather than one, deliberately. `AggregateLinks.jsx` does
 * two things of its own BETWEEN opening the ancestors and landing — it
 * selects the canonical link and closes the popover — and the accepted R6
 * behaviour is that they happen in that order. A single combined call would
 * have had to either reorder them or take a callback to run in the middle,
 * and both are worse to read than saying the two steps out loud at each
 * call site.
 *
 * What this owns:
 *   - WHICH ancestors to open (`collapsedAncestorsToOpen`, the one walk);
 *   - that they are opened through the store's own public `open-task`, one
 *     exec per group, exactly as a chevron click would;
 *   - that a landing which cannot resolve yet is retried a BOUNDED number
 *     of times against `taskRects` and then abandoned (SVAR-M45 R3-6: an
 *     unresolvable pending reveal used to sit in the ref indefinitely and
 *     fire later, against an unrelated `taskRects` change, as a scroll
 *     nobody asked for).
 *
 * What it does NOT own: where the task ends up. That is `land`, supplied by
 * the caller, which in both callers first offers the whole reveal to the
 * consumer's own reveal owner (`onRevealPartner` — in the Planner
 * `revealTask`, with the accepted D-165 horizontal rule and the centred
 * vertical landing) and only falls back to the store's own scroll when the
 * consumer supplies none. `land` answers `true` when it landed and `false`
 * when the row is not there yet, which is what drives the retry.
 *
 * Presentation only. `open-task` reaches no `DomainCommand`: the disclosure
 * it changes is presentation state the consumer observes through its own
 * `open-task` listener, so canonical state and history are untouched and
 * Undo/Redo do not move it.
 */

/**
 * How many `taskRects` changes a pending landing may wait for.
 *
 * SVAR-M45 (R3-6): one commit per `open-task` cascade is the legitimate
 * case; beyond that the landing is one that can never succeed, and holding
 * it costs the person a surprise scroll later rather than buying anything.
 */
export const REVEAL_ATTEMPTS = 4;

/**
 * @param {{
 *   api: unknown,
 *   getTask: (id: unknown) => { parent?: unknown, open?: boolean } | undefined,
 *   taskRects: Map<unknown, unknown>,
 *   land: (taskId: unknown) => boolean,
 * }} deps
 * @returns {{
 *   openCollapsedAncestors: (taskId: unknown) => Array<unknown>,
 *   landOnceVisible: (taskId: unknown, afterOpening: boolean) => void,
 * }}
 */
export function useCanonicalReveal({ api, getTask, taskRects, land }) {
  const pendingRef = useRef(null);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (land(pending.taskId)) {
      pendingRef.current = null;
      return;
    }
    pending.attemptsLeft -= 1;
    if (pending.attemptsLeft <= 0) pendingRef.current = null;
  }, [taskRects, land]);

  /**
   * Opens exactly the closed ancestors of `taskId` and answers which ones
   * those were. Empty when the task is already on a visible row, or has no
   * ancestors at all — in which case the caller lands immediately.
   */
  const openCollapsedAncestors = useCallback(
    (taskId) => {
      const ancestors = collapsedAncestorsToOpen(taskId, getTask);
      for (const id of ancestors) {
        api.exec('open-task', { id, mode: true });
      }
      return ancestors;
    },
    [api, getTask],
  );

  /**
   * Lands on `taskId` now when nothing had to be opened, or waits for the
   * rows the opens are about to produce when something did.
   */
  const landOnceVisible = useCallback(
    (taskId, afterOpening) => {
      if (!afterOpening) {
        land(taskId);
        return;
      }
      pendingRef.current = { taskId, attemptsLeft: REVEAL_ATTEMPTS };
    },
    [land],
  );

  return { openCollapsedAncestors, landOnceVisible };
}
