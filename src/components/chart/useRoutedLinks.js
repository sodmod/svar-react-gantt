import { useContext, useMemo } from 'react';
import storeContext from '../../context';
import { useStore, useStoreWithCounter } from '@svar-ui/lib-react';
import { assignChannels, buildLink } from '../../planner-router/route.js';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M47).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The ONE place a link becomes a route: the full `_tasks` geometry, the
 * deterministic channel assignment and the obstacle set, exactly as
 * `Links.jsx` (SVAR-M32) has built them since Phase 4.1C C1 — moved here
 * unchanged so that a second consumer can read the SAME routes rather than
 * route the same links a second time with different inputs.
 *
 * That second consumer is the offscreen partner chip. Until R4 it called
 * `routeLink` on its own, with no obstacles and no channel offset, and so
 * placed itself against a route the chart was not drawing: on the product
 * fixture every link crossing a group's row is pushed by that group's own
 * blocking bar, and a fan-out's verticals are a `channelStep` apart — both
 * invisible to a routing pass that leaves those inputs out. A chip is the
 * continuation of the route on screen, so it has to be derived from that
 * route and no other (R4 §17).
 *
 * Both consumers call this hook; each gets its own memo over the same store
 * values, and `buildLink` is a pure function of them, so the two answers are
 * identical by construction.
 */

function rectOf(task) {
  return { x: task.$x, y: task.$y, w: task.$w, h: task.$h };
}

export function useRoutedLinks() {
  const api = useContext(storeContext);
  const [linksValue, linksCounter] = useStoreWithCounter(api, '_links');
  const [tasksValue, tasksCounter] = useStoreWithCounter(api, '_tasks');
  const cellHeight = useStore(api, 'cellHeight');

  const taskRects = useMemo(() => {
    const map = new Map();
    for (const task of tasksValue || []) {
      if (typeof task.$x === 'number') map.set(task.id, rectOf(task));
    }
    return map;
  }, [tasksCounter]);

  const obstacleRects = useMemo(
    () => Array.from(taskRects.values()),
    [taskRects],
  );

  const routedLinks = useMemo(() => {
    const links = linksValue || [];
    const routable = links
      .map((link) => ({
        link,
        sourceRect: taskRects.get(link.source),
        targetRect: taskRects.get(link.target),
      }))
      .filter((entry) => entry.sourceRect && entry.targetRect);

    const channelOf = assignChannels(
      routable.map((entry) => ({
        id: entry.link.id,
        sourceId: entry.link.source,
        sourceSide:
          entry.link.type && entry.link.type[0] === 's' ? 'start' : 'end',
        targetId: entry.link.target,
        targetSide:
          entry.link.type && entry.link.type[2] === 'e' ? 'end' : 'start',
      })),
    );

    return routable.map(({ link, sourceRect, targetRect }) => {
      const route = buildLink({
        sourceRect,
        targetRect,
        type: link.type,
        channelOffset: channelOf.get(link.id) ?? 0,
        obstacles: obstacleRects.filter(
          (rect) => rect !== sourceRect && rect !== targetRect,
        ),
        rowHeight: cellHeight,
      });
      return { link, route };
    });
  }, [linksCounter, taskRects, obstacleRects, cellHeight]);

  return { api, taskRects, routedLinks, tasksValue, tasksCounter, cellHeight };
}
