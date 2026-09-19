import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import storeContext from '../../context';
import { useStore, useStoreWithCounter } from '@svar-ui/lib-react';
import { setID } from '@svar-ui/lib-dom';
import { assignChannels, buildLink } from '../../planner-router/route.js';
import './Links.css';

/*
 * SVAR-M32 (SVAR Production Planner): the deterministic template router
 * (`src/planner-router/route.js`) replaces the store-computed `link.$p`
 * entirely. See DECISIONS.md D-166 / TECH_SPEC.md §6.10.1 in the consuming
 * product for the product-level rules this file only implements the
 * geometry of; this component itself reads nothing but pixel rectangles.
 *
 * Three consequences of routing here instead of reading `link.$p`:
 *
 *   1. `_links`, not `_visibleLinks` — the store's own visibility rectangle
 *      is computed from ITS route, which this component no longer draws.
 *      A custom route of a different shape can extend outside that old
 *      rectangle while still partly on screen, and `_visibleLinks` would
 *      cull it. This component keeps its own culling rectangle instead,
 *      against the SAME route it is actually about to draw.
 *   2. Task rectangles come from the FULL, unsliced `_tasks` (not the
 *      vertically virtualized slice `Bars.jsx` renders bars from): a link
 *      whose endpoint sits outside the current vertical render window still
 *      needs its real `$x/$y/$w/$h` to route and to cull correctly.
 *   3. `linkPresentation` — a new optional prop, the seam TECH_SPEC.md
 *      §6.10 already specifies (`{ lineStyle, arrowhead }` per public link
 *      identity `{ id, source, target, type }`): this component maps
 *      `lineStyle` to a stroke-dasharray class and nothing else. It knows
 *      nothing about `mode`/`hard`/`soft`/`informational` — that mapping is
 *      the consumer's, per the existing contract.
 */

const DEFAULT_PRESENTATION = { lineStyle: 'solid', arrowhead: true };

function rectOf(task) {
  return { x: task.$x, y: task.$y, w: task.$w, h: task.$h };
}

export default function Links({
  onSelectLink,
  selectedLink,
  readonly,
  linkPresentation,
}) {
  const api = useContext(storeContext);
  const [linksValue, linksCounter] = useStoreWithCounter(api, '_links');
  const [tasksValue, tasksCounter] = useStoreWithCounter(api, '_tasks');
  const cellHeight = useStore(api, 'cellHeight');
  const area = useStore(api, 'area');
  const xArea = useStore(api, 'xArea');
  const criticalPath = useStore(api, 'criticalPath');

  const selectedLineRef = useRef(null);

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

  const visibleRoutedLinks = useMemo(() => {
    if (!xArea) return routedLinks;
    const vFrom = area?.from ?? 0;
    const vTo = area?.to ?? (area?.end ?? 0) * (cellHeight || 0);
    return routedLinks.filter(({ route }) => {
      const { bbox } = route;
      return (
        bbox.x2 >= xArea.from &&
        bbox.x1 <= xArea.to &&
        bbox.y2 >= vFrom &&
        bbox.y1 <= vTo
      );
    });
  }, [routedLinks, xArea, area, cellHeight]);

  const routeById = useMemo(() => {
    const map = new Map();
    for (const { link, route } of routedLinks) map.set(link.id, route);
    return map;
  }, [routedLinks]);

  const presentationOf = useCallback(
    (link) => {
      if (!linkPresentation) return DEFAULT_PRESENTATION;
      const resolved = linkPresentation({
        id: link.id,
        source: link.source,
        target: link.target,
        type: link.type,
      });
      return resolved || DEFAULT_PRESENTATION;
    },
    [linkPresentation],
  );

  const onClickOutside = useCallback(
    (event) => {
      const css = event?.target?.classList;
      if (
        !css?.contains('wx-line-hitbox') &&
        !css?.contains('wx-delete-button')
      ) {
        onSelectLink(null);
      }
    },
    [onSelectLink],
  );

  useEffect(() => {
    if (!readonly && selectedLink && selectedLineRef.current) {
      const handler = (event) => {
        if (
          selectedLineRef.current &&
          !selectedLineRef.current.contains(event.target)
        ) {
          onClickOutside(event);
        }
      };
      document.addEventListener('click', handler);
      return () => {
        document.removeEventListener('click', handler);
      };
    }
  }, [readonly, selectedLink, onClickOutside]);

  const selectedRoute = selectedLink ? routeById.get(selectedLink.id) : null;
  const selectedPresentation = selectedLink
    ? presentationOf(selectedLink)
    : null;

  return (
    <svg className="wx-dkx3NwEn wx-links">
      {visibleRoutedLinks.map(({ link, route }) => {
        const presentation = presentationOf(link);
        const dashClass =
          presentation.lineStyle && presentation.lineStyle !== 'solid'
            ? ` wx-line-${presentation.lineStyle}`
            : '';
        const className =
          'wx-dkx3NwEn wx-line' +
          dashClass +
          (criticalPath && link.critical ? ' wx-critical' : '') +
          (!readonly ? ' wx-line-selectable' : '');
        return (
          <g
            className={className}
            key={link.id}
            onClick={() => !readonly && onSelectLink(link.id)}
            data-link-id={setID(link.id)}
            data-route-class={route.routeClass}
          >
            <path className="wx-dkx3NwEn wx-line-draw" d={route.d} />
            <path className="wx-dkx3NwEn wx-line-hitbox" d={route.d} />
            {presentation.arrowhead !== false ? (
              <polygon
                className="wx-dkx3NwEn wx-line-arrow"
                points={route.arrow}
              />
            ) : null}
          </g>
        );
      })}
      {!readonly && selectedLink && selectedRoute && (
        <g
          ref={selectedLineRef}
          className="wx-dkx3NwEn wx-line wx-line-selected wx-line-selectable wx-delete-link"
          data-link-id={setID(selectedLink.id)}
        >
          <path className="wx-dkx3NwEn wx-line-draw" d={selectedRoute.d} />
          <path className="wx-dkx3NwEn wx-line-hitbox" d={selectedRoute.d} />
          {selectedPresentation?.arrowhead !== false ? (
            <polygon
              className="wx-dkx3NwEn wx-line-arrow wx-line-arrow-selected"
              points={selectedRoute.arrow}
            />
          ) : null}
        </g>
      )}
    </svg>
  );
}
