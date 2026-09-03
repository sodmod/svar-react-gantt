import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { locate, locateID, getID, setID } from '@svar-ui/lib-dom';
import storeContext from '../../context';
import { useStore, useStoreWithCounter } from '@svar-ui/lib-react';
import { isSegmentMoveAllowed, extendDragOptions } from '@svar-ui/gantt-store';
import { Button } from '@svar-ui/react-core';
import Links from './Links.jsx';
import {
  collectAncestorBarGeometry,
  resolveCollapsedSummaryGeometry,
} from './summaryDragGeometry.js';
import BarSegments from './BarSegments.jsx';
import Rollups from './Rollups.jsx';
import './Bars.css';

/*
 * SVAR-M5 (SVAR Production Planner). The ONE expression that turns a bar
 * gesture's pixel displacement into a whole-unit displacement.
 *
 * It was already here, inline in `up()`, producing the `diff` that
 * `update-task` carries when the gesture COMMITS. It is named now because the
 * live preview below has to report exactly the same number while the pointer
 * is still moving: a consumer that previews a drop with one rule and commits
 * it with another would show the user a date it then does not write. One
 * expression, two callers — not two expressions.
 */
function unitDiffFromPixels(dx, lengthUnitWidth) {
  return Math.round(dx / lengthUnitWidth);
}

function Bars(props) {
  // SVAR-M5 (SVAR Production Planner): `onDragPreview` — see `Layout.jsx` and
  // `Gantt.jsx` (`onTimelineDragPreview`). A plain callback prop, null by
  // default; nothing below changes for a consumer that does not pass one.
  const { readonly, taskTemplate: TaskTemplate, onDragPreview } = props;

  const api = useContext(storeContext);

  const [rTasksValue, rTasksCounter] = useStoreWithCounter(api, '_tasks');
  const [rLinksValue, rLinksCounter] = useStoreWithCounter(api, '_links');
  const areaValue = useStore(api, 'area');
  const scalesValue = useStore(api, '_scales');
  const taskTypesValue = useStore(api, 'taskTypes');
  const baselinesValue = useStore(api, 'baselines');
  const selectedValue = useStore(api, '_selected');
  const rollups = useStore(api, 'rollups');
  const rRollups = useStore(api, '_rollups');
  const focusTaskStore = useStore(api, 'focusTask');
  const criticalPath = useStore(api, 'criticalPath');
  const tree = useStore(api, 'tree');
  const schedule = useStore(api, 'schedule');
  const splitTasks = useStore(api, 'splitTasks');
  const summary = useStore(api, 'summary');
  const slack = useStore(api, 'slack');

  const tasks = useMemo(() => {
    if (!areaValue || !Array.isArray(rTasksValue)) return [];
    const start = areaValue.start ?? 0;
    const end = areaValue.end ?? 0;
    return rTasksValue.slice(start, end).map((a) => ({ ...a }));
  }, [rTasksCounter, areaValue]);

  const lengthUnitWidth = useMemo(
    () => scalesValue.lengthUnitWidth,
    [scalesValue],
  );

  const hasDuplicatedIds = useMemo(
    () => tasks.some((task) => task.$id && task.$id !== task.id),
    [tasks],
  );

  const ignoreNextClickRef = useRef(false);

  const [linkFrom, setLinkFrom] = useState(undefined);
  const [taskMove, setTaskMove] = useState(null);
  const progressFromRef = useRef(null);

  /*
   * SVAR-M10 (SVAR Production Planner): the pre-gesture bar geometry of the
   * dragged bar's ancestors — see `summaryDragGeometry.js` for what it is for.
   *
   * A ref, not state: it never decides WHEN to render, only what to draw when
   * a render happens, and every accepted drag step already re-renders this
   * component twice over (the store's own `setState`, and `setTaskMove`). It
   * deliberately outlives the gesture, because a gesture that commits nothing
   * leaves the store's collapsed `$w` in place until the consumer re-projects,
   * and `dx` is then `0` — which draws the bar exactly where it began.
   */
  const ancestorGeometryRef = useRef(null);

  const [selectedLinkId, setSelectedLinkId] = useState(null);

  const selectedLink = useMemo(() => {
    return (
      selectedLinkId && {
        ...rLinksValue.find((link) => link.id === selectedLinkId),
      }
    );
  }, [selectedLinkId, rLinksCounter]);

  const [touched, setTouched] = useState(undefined);
  const touchTimerRef = useRef(null);

  const [totalWidth, setTotalWidth] = useState(0);

  const containerRef = useRef(null);

  const hasFocus = useMemo(() => {
    const el = containerRef.current;
    return !!(
      selectedValue.length &&
      el &&
      el.contains(document.activeElement)
    );
  }, [selectedValue, containerRef.current]);

  const focused = useMemo(() => {
    return hasFocus && selectedValue[selectedValue.length - 1]?.id;
  }, [hasFocus, selectedValue]);

  useEffect(() => {
    if (!focusTaskStore) return;
    if (focusTaskStore.column === false) {
      const { id } = focusTaskStore;
      const node = containerRef.current?.querySelector(
        `.wx-bar[data-id='${setID(id)}']`,
      );
      if (node) node.focus({ preventScroll: true });
    }
  }, [focusTaskStore]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    setTotalWidth(el.offsetWidth || 0);
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver((entries) => {
        if (entries[0]) {
          setTotalWidth(entries[0].contentRect.width);
        }
      });
      ro.observe(el);
      return () => ro.disconnect();
    }
  }, [containerRef.current]);

  /*
   * SVAR-M5 (SVAR Production Planner): report the live bar drag, or its end.
   *
   * Reports every bar, of every type: this component does not know what a
   * milestone, a container or a leaf MEANS, and acquiring that knowledge here
   * would be exactly the kind of second semantic owner the boundary forbids.
   * The consumer decides which gestures it previews and what a preview means.
   */
  const previewingRef = useRef(false);
  const reportDragPreview = useCallback(
    (event) => {
      if (!onDragPreview) return;
      if (event === null) {
        if (!previewingRef.current) return;
        previewingRef.current = false;
        onDragPreview({ id: null, dx: 0, diff: 0, inProgress: false });
        return;
      }
      previewingRef.current = true;
      onDragPreview(event);
    },
    [onDragPreview],
  );

  const startDrag = useCallback(() => {
    document.body.style.userSelect = 'none';
  }, []);

  const endDrag = useCallback(() => {
    document.body.style.userSelect = '';
  }, []);

  const getMoveMode = useCallback(
    (node, e, task) => {
      if (e.target.classList.contains('wx-line')) return '';
      if (!task) task = api.getTask(getID(node));
      if (task.type === 'milestone' || task.type === 'summary') return '';

      const segmentNode = locate(e, 'data-segment');
      if (segmentNode) node = segmentNode;

      const { left, width } = node.getBoundingClientRect();
      const p = (e.clientX - left) / width;
      let delta = 0.2 / (width > 200 ? width / 200 : 1);
      if (p < delta) return 'start';
      if (p > 1 - delta) return 'end';
      return '';
    },
    [api],
  );

  const down = useCallback(
    (node, point) => {
      const { clientX } = point;
      const id = getID(node);
      const task = api.getTask(id);
      const css = point.target.classList;
      if (point.target.closest('.wx-delete-button')) return;
      if (!readonly) {
        if (css.contains('wx-progress-marker')) {
          const { progress } = api.getTask(id);
          progressFromRef.current = {
            id,
            x: clientX,
            progress,
            dx: 0,
            node,
            marker: point.target,
          };
          point.target.classList.add('wx-progress-in-drag');
          // SVAR-M10: a progress gesture re-derives no summary geometry, so
          // there is nothing to restore and no stale snapshot to keep.
          ancestorGeometryRef.current = null;
        } else {
          const mode = getMoveMode(node, point, task) || 'move';

          /*
           * SVAR-M10 (SVAR Production Planner): the ancestors' geometry as it
           * stands BEFORE this gesture, taken here for the same reason `l`/`w`
           * below are — the store is about to overwrite it, and for a summary
           * whose content is a single date it overwrites it with a zero width.
           * Taken through the public `api.getTask`, over the tree's depth,
           * once per gesture: no per-step work is added anywhere.
           */
          ancestorGeometryRef.current = collectAncestorBarGeometry(
            (ancestorId) => api.getTask(ancestorId),
            task,
          );

          const newTaskMove = {
            id,
            mode,
            x: clientX,
            dx: 0,
            l: task.$x,
            w: task.$w,
            // SVAR-M5 (SVAR Production Planner): the bar's date as it stands
            // BEFORE the gesture. `drag-task` moves `$x` only and never
            // touches `start`, so this stays the gesture's reference point for
            // as long as the drag lasts — the same reference point the
            // committing `update-task` reports below.
            referenceStart: task.start,
          };

          if (splitTasks && task.segments?.length) {
            const segNode = locate(point, 'data-segment');
            if (segNode) {
              newTaskMove.segmentIndex = segNode.dataset['segment'] * 1;
              extendDragOptions(task, newTaskMove);
            }
          }

          setTaskMove(newTaskMove);
        }
        startDrag();
      }
    },
    [api, readonly, getMoveMode, startDrag, splitTasks],
  );

  const mousedown = useCallback(
    (e) => {
      if (e.button !== 0) return;

      const node = locate(e);
      if (!node) return;

      down(node, e);
    },
    [down],
  );

  const touchstart = useCallback(
    (e) => {
      const node = locate(e);
      if (node) {
        touchTimerRef.current = setTimeout(() => {
          setTouched(true);
          down(node, e.touches[0]);
        }, 300);
      }
    },
    [down],
  );

  const onSelectLink = useCallback((id) => {
    setSelectedLinkId(id);
  }, []);

  const up = useCallback(() => {
    if (progressFromRef.current) {
      const { dx, id, marker, value } = progressFromRef.current;
      progressFromRef.current = null;
      if (typeof value !== 'undefined' && dx)
        api.exec('update-task', {
          id,
          task: { progress: value },
          inProgress: false,
        });
      marker.classList.remove('wx-progress-in-drag');

      ignoreNextClickRef.current = true;
      reportDragPreview(null);
      endDrag();
    } else if (taskMove) {
      const { id, mode, dx, l, w, start, segment, index } = taskMove;
      setTaskMove(null);
      if (start) {
        const diff = unitDiffFromPixels(dx, lengthUnitWidth);

        if (!diff) {
          api.exec('drag-task', {
            id,
            width: w,
            left: l,
            inProgress: false,
            ...(segment && { segmentIndex: index }),
          });
        } else {
          let update = {};
          let task = api.getTask(id);
          if (segment) task = task.segments[index];

          if (mode === 'move') {
            update.start = task.start;
            update.end = task.end;
          } else update[mode] = task[mode];

          api.exec('update-task', {
            id,
            diff,
            task: update,
            ...(segment && { segmentIndex: index }),
          });
        }
        ignoreNextClickRef.current = true;
      }

      // SVAR-M5 (SVAR Production Planner): AFTER the committing action above,
      // never before it. Both land in one React event batch, so the consumer
      // drops the preview and adopts the committed value in the same commit
      // and the marker never flashes back to where it started.
      reportDragPreview(null);
      endDrag();
    }
  }, [api, endDrag, taskMove, lengthUnitWidth, reportDragPreview]);

  const move = useCallback(
    (e, point) => {
      const { clientX } = point;

      if (!readonly) {
        if (progressFromRef.current) {
          const { node, x, id } = progressFromRef.current;
          const dx = (progressFromRef.current.dx = clientX - x);

          const diff = Math.round((dx / node.offsetWidth) * 100);
          let progress = progressFromRef.current.progress + diff;
          progressFromRef.current.value = progress = Math.min(
            Math.max(0, progress),
            100,
          );

          api.exec('update-task', {
            id,
            task: { progress },
            inProgress: true,
          });
        } else if (taskMove) {
          onSelectLink(null);
          const { mode, l, w, x, id, start, segment, index } = taskMove;
          const task = api.getTask(id);
          const dx = clientX - x;
          const minWidth = Math.round(lengthUnitWidth) || 1;
          // SVAR-M2 (SVAR Production Planner): 20 -> 4.
          //
          // How many physical pointer pixels a bar gesture must travel from
          // pointerdown before it counts as a drag at all. Below the threshold
          // this handler returns before doing anything: no visual update, no
          // state write, no update-task. On the first move that clears it the
          // bar jumps straight to the full accumulated offset in one frame, so
          // at the day widths this project renders, 20px read as the bar being
          // magnetised to the day grid — measured identical at cellWidth 17, 34
          // and 68, so it was never a date or grid rule, just this constant.
          //
          // 4px is the classic desktop click-vs-drag tolerance (Win32's own
          // SM_CXDRAG/SM_CYDRAG default). It keeps this gate's only real job —
          // stopping mouse jitter on a plain click from starting a MOVE — and
          // drops both the dead zone and the one-time jump below perception.
          //
          // No date, snapping or duration rule is touched: the gate is a
          // pixel test, and rounding to whole days still happens once, on
          // pointerup. The same condition gates MOVE and both RESIZE edges, so
          // all three change together; that is upstream's own structure here,
          // not a widening of this change.
          if (
            (!start && Math.abs(dx) < 4) ||
            (mode === 'start' && w - dx < minWidth) ||
            (mode === 'end' && w + dx < minWidth) ||
            (mode === 'move' &&
              ((dx < 0 && l + dx < 0) ||
                (dx > 0 && l + w + dx > totalWidth))) ||
            (taskMove.segment && !isSegmentMoveAllowed(task, taskMove))
          )
            return;

          const nextTaskMove = { ...taskMove, dx };

          let left, width;
          if (mode === 'start') {
            left = l + dx;
            width = w - dx;
          } else if (mode === 'end') {
            left = l;
            width = w + dx;
          } else if (mode === 'move') {
            left = l + dx;
            width = w;
          }

          api.exec('drag-task', {
            id,
            width: width,
            left: left,
            inProgress: true,
            start,
            ...(segment && { segmentIndex: index }),
          });

          // SVAR-M5 (SVAR Production Planner): the same transient step, told
          // to the consumer in the two forms it can actually use — `dx`, the
          // pixels the bar has travelled, and `diff`, those pixels as whole
          // scale units by the ONE expression that will also produce the
          // committing `diff` on mouseup. Only reached once the guards above
          // have accepted this step, so a preview never describes a movement
          // the bar did not make.
          reportDragPreview({
            id,
            dx,
            diff: unitDiffFromPixels(dx, lengthUnitWidth),
            referenceStart: taskMove.referenceStart,
            inProgress: true,
          });

          if (
            !nextTaskMove.start &&
            ((mode === 'move' && task.$x === l) ||
              (mode !== 'move' && task.$w === w))
          ) {
            ignoreNextClickRef.current = true;
            up();
            return;
          }
          nextTaskMove.start = true;
          setTaskMove(nextTaskMove);
        } else {
          const taskNode = locate(e);
          if (taskNode) {
            const task = api.getTask(getID(taskNode));
            const segNode = locate(e, 'data-segment');
            const barNode = segNode || taskNode;
            const mode = getMoveMode(barNode, point, task);
            barNode.style.cursor = mode && !readonly ? 'col-resize' : 'pointer';
          }
        }
      }
    },
    [
      api,
      readonly,
      taskMove,
      lengthUnitWidth,
      totalWidth,
      getMoveMode,
      onSelectLink,
      reportDragPreview,
      up,
    ],
  );

  const mousemove = useCallback(
    (e) => {
      move(e, e);
    },
    [move],
  );

  const touchmove = useCallback(
    (e) => {
      if (touched) {
        e.preventDefault();
        move(e, e.touches[0]);
      } else if (touchTimerRef.current) {
        clearTimeout(touchTimerRef.current);
        touchTimerRef.current = null;
      }
    },
    [touched, move],
  );

  const mouseup = useCallback(() => {
    up();
  }, [up]);

  const touchend = useCallback(() => {
    setTouched(null);
    if (touchTimerRef.current) {
      clearTimeout(touchTimerRef.current);
      touchTimerRef.current = null;
    }
    up();
  }, [up]);

  useEffect(() => {
    window.addEventListener('mouseup', mouseup);
    return () => {
      window.removeEventListener('mouseup', mouseup);
    };
  }, [mouseup]);

  const onDblClick = useCallback(
    (e) => {
      if (!readonly) {
        const id = locateID(e.target);
        if (id && !e.target.classList.contains('wx-link')) {
          const segmentIndex = locateID(e.target, 'data-segment');
          api.exec('show-editor', {
            id,
            ...(segmentIndex !== null && { segmentIndex }),
          });
        }
      }
    },
    [api, readonly],
  );

  const types = ['e2s', 's2s', 'e2e', 's2e'];
  const getLinkType = useCallback((fromStart, toStart) => {
    return types[(fromStart ? 1 : 0) + (toStart ? 0 : 2)];
  }, []);

  const alreadyLinked = useCallback(
    (target, toStart) => {
      const source = linkFrom.id;
      const fromStart = linkFrom.start;

      if (target === source) return true;

      return !!rLinksValue.find((l) => {
        return (
          l.target === target &&
          l.source === source &&
          l.type === getLinkType(fromStart, toStart)
        );
      });
    },
    [linkFrom, rLinksCounter, getLinkType],
  );

  const removeLinkMarker = useCallback(() => {
    if (linkFrom) {
      setLinkFrom(null);
    }
  }, [linkFrom]);

  const onClick = useCallback(
    (e) => {
      if (ignoreNextClickRef.current) {
        ignoreNextClickRef.current = false;
        return;
      }

      const id = locateID(e.target);
      if (id) {
        const css = e.target.classList;
        if (css.contains('wx-link')) {
          const toStart = css.contains('wx-left');
          if (!linkFrom) {
            setLinkFrom({ id, start: toStart });
            return;
          }

          if (linkFrom.id !== id && !alreadyLinked(id, toStart)) {
            api.exec('add-link', {
              link: {
                source: linkFrom.id,
                target: id,
                type: getLinkType(linkFrom.start, toStart),
              },
            });
          }
        } else if (css.contains('wx-delete-button-icon')) {
          api.exec('delete-link', { id: selectedLinkId });
          setSelectedLinkId(null);
        } else {
          const segmentIndex = locateID(e.target, 'data-segment');
          api.exec('select-task', {
            id,
            toggle: e.ctrlKey || e.metaKey,
            range: e.shiftKey,
            ...(segmentIndex !== null && { segmentIndex }),
          });
        }
      }
      removeLinkMarker();
    },
    [
      api,
      linkFrom,
      rLinksCounter,
      selectedLink,
      alreadyLinked,
      getLinkType,
      removeLinkMarker,
    ],
  );

  const taskStyle = useCallback(
    (task) => {
      // SVAR-M10 (SVAR Production Planner): `null` for every bar except an
      // ancestor summary whose transient width the store has just collapsed
      // to zero — see `summaryDragGeometry.js`. `taskMove` is the gesture in
      // flight; `dx` is `0` once the pointer is up.
      const collapsed = resolveCollapsedSummaryGeometry(
        task,
        ancestorGeometryRef.current,
        taskMove ? taskMove.dx : 0,
      );
      return {
        left: `${collapsed ? collapsed.x : task.$x}px`,
        top: `${task.$y}px`,
        width: `${collapsed ? collapsed.w : task.$w}px`,
        height: `${task.$h}px`,
        lineHeight: `${task.$h}px`,
      };
    },
    [taskMove],
  );

  const baselineStyle = useCallback((task) => {
    return {
      left: `${task.$x_base}px`,
      top: `${task.$y_base}px`,
      width: `${task.$w_base}px`,
      height: `${task.$h_base}px`,
    };
  }, []);

  const slackStyle = useCallback((task) => {
    return {
      left: `${task.$x_slack}px`,
      top: `${task.$y}px`,
      width: `${Math.max(task.$w_slack, 0)}px`,
      height: `${task.$h}px`,
    };
  }, []);

  const contextmenu = useCallback(
    (ev) => {
      if (touched || touchTimerRef.current) {
        ev.preventDefault();
        return false;
      }
    },
    [touched],
  );

  const taskTypeIds = useMemo(
    () => taskTypesValue.map((t) => t.id),
    [taskTypesValue],
  );

  const taskTypeCss = useCallback(
    (type) => {
      let css = taskTypeIds.includes(type) ? type : 'task';
      if (!['task', 'milestone', 'summary'].includes(type)) {
        css = `task ${css}`;
      }
      return css;
    },
    [taskTypeIds],
  );

  const forward = useCallback(
    (ev) => {
      api.exec(ev.action, ev.data);
    },
    [api],
  );

  const isTaskCritical = useCallback(
    (task) => {
      return criticalPath && task.critical;
    },
    [criticalPath],
  );

  const isLinkMarkerVisible = useCallback(
    (id) => {
      if (schedule?.auto) {
        const summaryIds = tree.getSummaryId(id, true);
        const linkFromSummaryIds = tree.getSummaryId(linkFrom.id, true);
        return (
          linkFrom?.id &&
          !(Array.isArray(summaryIds) ? summaryIds : [summaryIds]).includes(
            linkFrom.id,
          ) &&
          !(
            Array.isArray(linkFromSummaryIds)
              ? linkFromSummaryIds
              : [linkFromSummaryIds]
          ).includes(id)
        );
      }
      return linkFrom;
    },
    [schedule, tree, linkFrom],
  );

  return (
    <div
      className="wx-GKbcLEGA wx-bars"
      ref={containerRef}
      onContextMenu={contextmenu}
      onMouseDown={mousedown}
      onMouseMove={mousemove}
      onTouchStart={touchstart}
      onTouchMove={touchmove}
      onTouchEnd={touchend}
      onClick={onClick}
      onDoubleClick={onDblClick}
      onDragStart={(e) => {
        e.preventDefault();
        return false;
      }}
    >
      {slack
        ? tasks.map((task) =>
            task.$visibleSlack ? (
              <div
                key={task.id}
                className={`wx-GKbcLEGA wx-slack wx-slack-${task.type}`}
                style={slackStyle(task)}
              ></div>
            ) : null,
          )
        : null}
      <Links
        onSelectLink={onSelectLink}
        selectedLink={selectedLink}
        readonly={readonly}
      />
      {tasks.map((task) => {
        if (task.$skip && task.$skip_baseline && !(rollups && rRollups?.[task.id])) return null;
        const barClass =
          `wx-bar wx-${taskTypeCss(task.type)}` +
          (touched && taskMove && task.id === taskMove.id ? ' wx-touch' : '') +
          (linkFrom && linkFrom.id === task.id ? ' wx-selected' : '') +
          (isTaskCritical(task) ? ' wx-critical' : '') +
          (task.$reorder ? ' wx-reorder-task' : '') +
          (splitTasks && task.segments ? ' wx-split' : '');
        const leftLinkClass =
          'wx-link wx-left' +
          (linkFrom ? ' wx-visible' : '') +
          (!linkFrom ||
            (!alreadyLinked(task.id, true) && isLinkMarkerVisible(task.id))
            ? ' wx-target'
            : '') +
          (linkFrom && linkFrom.id === task.id && linkFrom.start
            ? ' wx-selected'
            : '') +
          (isTaskCritical(task) ? ' wx-critical' : '');
        const rightLinkClass =
          'wx-link wx-right' +
          (linkFrom ? ' wx-visible' : '') +
          (!linkFrom ||
            (!alreadyLinked(task.id, false) && isLinkMarkerVisible(task.id))
            ? ' wx-target'
            : '') +
          (linkFrom && linkFrom.id === task.id && !linkFrom.start
            ? ' wx-selected'
            : '') +
          (isTaskCritical(task) ? ' wx-critical' : '');
        return (
          <Fragment key={task.id}>
            {!task.$skip && (
              <div
                className={'wx-GKbcLEGA ' + barClass}
                style={taskStyle(task)}
                data-id={setID(task.id)}
                data-task-id={setID(task.id)}
                tabIndex={focused === task.id ? 0 : -1}
              >
                {!readonly && !hasDuplicatedIds ? (
                  task.id === selectedLink?.target &&
                    selectedLink?.type[2] === 's' ? (
                    <Button
                      type="danger"
                      css="wx-left wx-delete-button wx-delete-link"
                    >
                      <i className="wxi-close wx-delete-button-icon"></i>
                    </Button>
                  ) : (
                    <div className={'wx-GKbcLEGA ' + leftLinkClass}>
                      <div className="wx-GKbcLEGA wx-inner"></div>
                    </div>
                  )
                ) : null}

                {task.type !== 'milestone' ? (
                  <>
                    {task.progress && !(splitTasks && task.segments) ? (
                      <div className="wx-GKbcLEGA wx-progress-wrapper">
                        <div
                          className="wx-GKbcLEGA wx-progress-percent"
                          style={{ width: `${task.progress}%` }}
                        ></div>
                      </div>
                    ) : null}
                    {!readonly &&
                      !(splitTasks && task.segments) &&
                      !(task.type === 'summary' && summary?.autoProgress) ? (
                      <div
                        className="wx-GKbcLEGA wx-progress-marker"
                        style={{ left: `calc(${task.progress}% - 10px)` }}
                      >
                        {task.progress}
                      </div>
                    ) : null}
                    {TaskTemplate ? (
                      <TaskTemplate data={task} api={api} onAction={forward} />
                    ) : splitTasks && task.segments ? (
                      <BarSegments task={task} type={taskTypeCss(task.type)} />
                    ) : (
                      <div className="wx-GKbcLEGA wx-content">
                        {task.text || ''}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="wx-GKbcLEGA wx-content"></div>
                    {TaskTemplate ? (
                      <TaskTemplate data={task} api={api} onAction={forward} />
                    ) : (
                      <div className="wx-GKbcLEGA wx-text-out">{task.text}</div>
                    )}
                  </>
                )}

                {!readonly && !hasDuplicatedIds ? (
                  task.id === selectedLink?.target &&
                    selectedLink?.type[2] === 'e' ? (
                    <Button
                      type="danger"
                      css="wx-right wx-delete-button wx-delete-link"
                    >
                      <i className="wxi-close wx-delete-button-icon"></i>
                    </Button>
                  ) : (
                    <div className={'wx-GKbcLEGA ' + rightLinkClass}>
                      <div className="wx-GKbcLEGA wx-inner"></div>
                    </div>
                  )
                ) : null}
              </div>
            )}
            {rollups && rRollups?.[task.id]
              ? rRollups[task.id].map((rollup, i) => (
                  <Rollups key={i} rollup={rollup} parent={task} />
                ))
              : null}
            {baselinesValue && !task.$skip_baseline ? (
              <div
                className={
                  'wx-GKbcLEGA wx-baseline' +
                  (task.type === 'milestone' ? ' wx-milestone' : '')
                }
                style={baselineStyle(task)}
              ></div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

export default Bars;
