import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { context } from '@svar-ui/react-core';
import { locateID } from '@svar-ui/lib-dom';
import { reorder } from '../../helpers/reorder';
import { prepareEditTask } from '@svar-ui/gantt-store';
import { Grid as WxGrid } from '@svar-ui/react-grid';
import TextCell from './TextCell.jsx';
import ActionCell from './ActionCell.jsx';
import ResourcesCell from './ResourcesCell.jsx';
import EditorResourcesCell from './EditorResourcesCell.jsx';
import { setTaskResources } from '../../helpers/setTaskResources.js';
import {
  getGridMinHeight,
  getGridStyle,
  getFlexBasis,
  getScrollX,
  getFitColumns,
  getFillColumn,
  getColumnsWidth,
  getSortMarks,
} from '../../helpers/grid';
import { useStore } from '@svar-ui/lib-react';
import { splitScaleHeaderForLane } from '../chart/annotations/timelineAnnotationLayout.js';
import storeContext from '../../context';
import './Grid.css';

function cssTextToStyle(cssText) {
  const style = {};
  cssText.split(';').forEach((decl) => {
    const idx = decl.indexOf(':');
    if (idx === -1) return;
    const prop = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!prop) return;
    const key = prop.startsWith('--')
      ? prop
      : prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    style[key] = value;
  });
  return style;
}

export default function Grid(props) {
  /*
   * SVAR-M6 (SVAR Production Planner): `annotationLaneHeight` — the RESOLVED
   * pixel height of the timeline's annotation lane, computed once by the one
   * lane-layout owner (`chart/annotations/timelineAnnotationLayout.js`) and
   * handed down by `Layout.jsx`.
   *
   * The chart's body starts below the scale rows PLUS that lane; the grid's
   * body starts below the grid header alone. Left and right rows therefore sat
   * `annotationLaneHeight` px apart, which is what the acceptance run found.
   * The grid reserves the same height here and the two halves line up again.
   *
   * SVAR-M8 (SVAR Production Planner): WHERE it reserves it moved. The lane
   * now sits between the top scale row and the lower ones, so the grid's own
   * blank reservation grows ABOVE its column-header block instead of below
   * it: the column titles stay directly on top of the first task row however
   * tall the lane gets, which is the whole point of the change. The split is
   * asked of `splitScaleHeaderForLane` — the same pure function the header
   * itself asks — so the two sides cannot disagree about it.
   *
   * `annotationLaneHeight` is still a NUMBER, arriving from the owner that
   * already resolved it. Nothing in this file measures a label, resolves a
   * chip collision, counts anything on the timeline or knows what an
   * annotation is; a second answer to "how tall is the lane" would be a
   * second owner, and that is exactly what this prop exists to avoid.
   */
  /*
   * SVAR-M12 (SVAR Production Planner): `gridActionSlot` — consumer-owned
   * content rendered in the blank band this grid already reserves above its
   * column headers, and `reserveTopScaleRow`, the flag that guarantees the
   * band exists. Both arrive from `Layout.jsx`; see the render below and
   * `Gantt.jsx` for what the seam is and what it deliberately is not.
   */
  const {
    readonly,
    onTableAPIChange,
    annotationLaneHeight,
    gridActionSlot,
    reserveTopScaleRow,
  } = props;
  const laneHeight = Number.isFinite(annotationLaneHeight)
    ? Math.max(0, annotationLaneHeight)
    : 0;
  const [columnWidth, setColumnWidth] = useState(0);
  const [tableAPI, setTableAPI] = useState();

  const i18n = useContext(context.i18n);
  const _ = useMemo(() => i18n.getGroup('gantt'), [i18n]);
  const api = useContext(storeContext);

  const scrollTopVal = useStore(api, 'scrollTop');
  const cellHeightVal = useStore(api, 'cellHeight');
  const focusTask = useStore(api, 'focusTask');
  const selectedVal = useStore(api, '_selected');
  const areaVal = useStore(api, 'area');
  const rTasksVal = useStore(api, '_tasks');
  const scalesVal = useStore(api, '_scales');
  const headerLengthVal = useStore(api, '_headerLength');
  const columnsVal = useStore(api, 'columns');
  const sortVal = useStore(api, '_sort');
  const durationUnitVal = useStore(api, 'durationUnit');
  const splitTasksVal = useStore(api, 'splitTasks');
  const filterValuesVal = useStore(api, 'filterValues');
  const groupByVal = useStore(api, 'groupBy');
  const gridWidthVal = useStore(api, 'gridWidth');
  const displayModeVal = useStore(api, 'displayMode');
  const compactModeVal = useStore(api, '_compactMode');

  const [dragTask, setDragTask] = useState(null);

  const tasks = useMemo(() => {
    if (!rTasksVal || !areaVal) return [];
    return rTasksVal.slice(areaVal.start, areaVal.end);
  }, [rTasksVal, areaVal]);

  const execAction = useCallback(
    (id, action) => {
      if (action === 'add-task') {
        api.exec(action, {
          target: id,
          task: { text: _('New Task') },
          mode: 'child',
          show: true,
          focus: id ? 'grid' : null,
        });
      } else if (action === 'open-task') {
        const task = tasks.find((a) => a.id === id);
        if (task?.data || task?.lazy)
          api.exec(action, { id, mode: !task.open });
      }
    },
    [tasks],
  );

  const onClick = useCallback(
    (e) => {
      if (e.detail > 1) return;
      const id = locateID(e);
      const action = e.target.dataset.action;
      if (action) e.preventDefault();
      if (id) {
        if (action === 'add-task' || action === 'open-task') {
          execAction(id, action);
        } else {
          api.exec('select-task', {
            id,
            toggle: e.ctrlKey || e.metaKey,
            range: e.shiftKey,
            show: 'xy',
            focus: 'grid',
          });
        }
      } else if (action === 'add-task') {
        execAction(null, action);
      }
    },
    [api, execAction],
  );

  const tableRef = useRef(null);
  const tableContainerRef = useRef(null);
  const [gridClientWidth, setGridClientWidth] = useState(0);
  const [gridClientHeight, setGridClientHeight] = useState(0);

  useEffect(() => {
    const node = tableContainerRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      setGridClientWidth(node.clientWidth);
      setGridClientHeight(node.clientHeight);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  const allTasks = useMemo(() => {
    const rows =
      dragTask && !tasks.find((t) => t.id === dragTask.id)
        ? [...tasks, dragTask]
        : tasks;
    return rows.map((t) => ({ ...t }));
  }, [tasks, dragTask]);

  const allTasksRef = useRef(allTasks);
  useEffect(() => {
    allTasksRef.current = allTasks;
  }, [allTasks]);

  const lastDetailRef = useRef(null);

  const reorderTasks = useCallback(
    (detail) => {
      const id = detail.id;
      const { before, after } = detail;
      const inProgress = detail.onMove;

      let target = before || after;
      let mode = before ? 'before' : 'after';

      if (inProgress) {
        if (mode === 'after') {
          const index = allTasksRef.current.findIndex((t) => t.id === id);
          const targetIndex = allTasksRef.current.findIndex(
            (t) => t.id === target,
          );
          const task = allTasksRef.current[targetIndex];
          if (index - targetIndex === 1) {
            mode = 'before';
          } else if (task && task.data && task.open) {
            mode = 'before';
            target = task.data[0].id;
          }
        }
        lastDetailRef.current = { id, [mode]: target };
      } else lastDetailRef.current = null;

      api.exec('move-task', {
        id,
        mode,
        target,
        inProgress,
      });
    },
    [api],
  );

  // COLUMNS
  // --------

  const cols = useMemo(() => {
    let cols = (columnsVal || []).map((col) => {
      col = { ...col };
      const header = [...col.header];
      header.forEach((line) => {
        if (line.text) line.text = _(line.text);
      });
      col.header = header;
      return col;
    });

    const ti = cols.findIndex((c) => c.id === 'text');
    const ai = cols.findIndex((c) => c.id === 'add-task');
    const ri = cols.findIndex((c) => c.id === 'resources');

    if (ti !== -1) {
      if (cols[ti].cell) cols[ti]._cell = cols[ti].cell;
      cols[ti].cell = TextCell;
    }
    if (ri !== -1) {
      const resCol = cols[ri];
      if (!resCol.cell) resCol.cell = ResourcesCell;
      if (resCol.editor && typeof resCol.editor !== 'function') {
        const editor = resCol.editor;
        const config = editor.config;
        if (!config.cell) config.cell = EditorResourcesCell;
        config.cell = EditorResourcesCell;
        if (!config.dropdown) config.dropdown = { width: 'auto' };
        resCol.editor = (row) => {
          if (row.type !== 'summary') return editor;
        };
      }
    }
    if (ai !== -1) {
      cols[ai].cell = cols[ai].cell || ActionCell;
      const header = cols[ai].header[0];
      cols[ai].header[0].cell = header.cell || ActionCell;

      if (readonly) {
        cols.splice(ai, 1);
      } else {
        if (compactModeVal) {
          const [actionCol] = cols.splice(ai, 1);
          cols.unshift(actionCol);
        }
      }
    }

    if (cols.length > 0) cols[cols.length - 1].resize = false;
    return cols;
  }, [columnsVal, _, readonly, compactModeVal]);

  useLayoutEffect(() => {
    setColumnWidth(getColumnsWidth(cols));
  }, [cols]);

  const getColumnStyle = useCallback((col) => {
    let style = `wx-rHj6070p wx-text-${col.align} `;

    if (col.id === 'add-task') style += 'wx-action ';
    else if (col.id === 'wbs') style += 'wx-wbs ';

    return style.trim();
  }, []);

  // SIZES
  // --------

  const scrollDelta = useMemo(() => areaVal?.from ?? 0, [areaVal]);

  /*
   * SVAR-M8 (SVAR Production Planner): the grid's three vertical bands above
   * its first task row, all three of them decided by the ONE split owner:
   *
   *   blankScaleHeight   the top scale row's own height, blank on this side
   *   laneHeight         the marker lane's resolved height, blank on this side
   *   headerHeight       the column-header block — the LOWER scale rows' band
   *
   * With no lane (`laneSplitsHeader === false`) every one of these collapses
   * back to exactly what this file did before: the header block is the whole
   * scale height, there is nothing above it, and any lane height is reserved
   * BELOW it through `bodyOffset`, as SVAR-M6 always did.
   */
  const headerSplit = useMemo(
    () => splitScaleHeaderForLane(scalesVal, laneHeight, reserveTopScaleRow),
    [scalesVal, laneHeight, reserveTopScaleRow],
  );
  const headerHeight = useMemo(
    () =>
      headerSplit.laneSplitsHeader
        ? headerSplit.heightBelowLane
        : (scalesVal?.height ?? 0),
    [headerSplit, scalesVal],
  );
  /** Blank on the grid side because the top scale row carries no grid data. */
  const blankScaleHeight = headerSplit.laneSplitsHeader
    ? headerSplit.heightAboveLane
    : 0;
  /** How far down the whole grid (header included) starts. */
  const headerOffset =
    blankScaleHeight + (headerSplit.laneSplitsHeader ? laneHeight : 0);
  /** The lane height still reserved BELOW the header (the pre-SVAR-M8 case). */
  const laneBelowHeader = headerSplit.laneSplitsHeader ? 0 : laneHeight;

  const flexBasis = useMemo(
    () => getFlexBasis(columnsVal || [], displayModeVal, gridWidthVal),
    [columnsVal, displayModeVal, gridWidthVal],
  );

  const scrollX = useMemo(
    () =>
      getScrollX(
        compactModeVal,
        displayModeVal,
        columnWidth,
        gridClientWidth,
        gridWidthVal,
      ),
    [
      compactModeVal,
      displayModeVal,
      columnWidth,
      gridClientWidth,
      gridWidthVal,
    ],
  );

  const bodyOffset = useMemo(
    // SVAR-M6 (SVAR Production Planner): + the lane height still reserved
    // below the header — the same reservation the chart makes, applied to the
    // grid body so row N is at the same y on both sides at every scroll
    // position. SVAR-M8 moved that reservation above the header for every
    // multi-row scale, and then this term is 0 because `headerOffset` already
    // carries it.
    () => (scrollDelta ?? 0) - (scrollTopVal ?? 0) + laneBelowHeader,
    [scrollDelta, scrollTopVal, laneBelowHeader],
  );

  const tableStyle = useMemo(() => {
    const css =
      getGridMinHeight(gridClientHeight, cellHeightVal ?? 0) +
      getGridStyle(displayModeVal, columnWidth, scrollX);
    const style = cssTextToStyle(css);
    style['--wx-body-offset'] = `${bodyOffset}px`;
    // SVAR-M8 (SVAR Production Planner): how far down the grid's own header
    // starts, so the blank scale/marker bands above it are real vertical room
    // rather than an overlay. Read by Grid.css.
    style['--wx-annotation-header-offset'] = `${headerOffset}px`;
    return style;
  }, [
    gridClientHeight,
    cellHeightVal,
    displayModeVal,
    columnWidth,
    scrollX,
    bodyOffset,
    headerOffset,
  ]);

  // SELECTION
  // --------
  const sel = useMemo(
    () => (Array.isArray(selectedVal) ? selectedVal.map((o) => o.id) : []),
    [selectedVal],
  );

  const fitColumns = useMemo(
    () => getFitColumns(cols, displayModeVal),
    [cols, displayModeVal],
  );

  const onDblClick = useCallback(
    (e) => {
      if (!readonly) {
        const id = locateID(e);
        const column = locateID(e, 'data-col-id');
        const columnObj = column && cols.find((c) => c.id === column);
        if (!columnObj?.editor && id) api.exec('show-editor', { id });
      }
    },
    [api, readonly, cols],
  );

  const sortMarks = useMemo(
    () => getSortMarks(allTasks, sortVal),
    [allTasks, sortVal],
  );

  const filters = useMemo(() => {
    return sortMarks ? { ...filterValuesVal } : filterValuesVal;
  }, [sortMarks, filterValuesVal]);

  const pendingFocusRef = useRef(false);
  useEffect(() => {
    if (!focusTask || !tableAPI) return;

    const { id, column } = focusTask;
    if (column) {
      if (!pendingFocusRef.current) {
        pendingFocusRef.current = true;
        requestAnimationFrame(() => {
          const { focusCell, editor } = tableAPI.getState();
          if (!editor) {
            tableAPI.exec('focus-cell', {
              row: id,
              column: focusCell?.column || cols[0]?.id,
            });
            pendingFocusRef.current = false;
          }
        });
      }
    }
  }, [focusTask, tableAPI]);

  const startReorder = useCallback(
    ({ id }) => {
      if (readonly) return false;

      if (api.getTask(id).open) api.exec('open-task', { id, mode: false });

      const t = api.getState()._tasks.find((t) => t.id === id);
      setDragTask(t || null);
      if (!t) return false;
    },
    [api, readonly],
  );

  const endReorder = useCallback(
    ({ id, top }) => {
      if (lastDetailRef.current) {
        reorderTasks({ ...lastDetailRef.current, onMove: false });
      } else {
        api.exec('drag-task', {
          id,
          top: top + (scrollDelta ?? 0),
          inProgress: false,
        });
      }
      setDragTask(null);
    },
    [api, reorderTasks, scrollDelta],
  );

  const moveReorder = useCallback(
    ({ id, top, detail }) => {
      if (detail) {
        reorderTasks({ ...detail, onMove: true });
      }
      api.exec('drag-task', {
        id,
        top: top + (scrollDelta ?? 0),
        inProgress: true,
      });
    },
    [api, reorderTasks, scrollDelta],
  );

  const groupByRef = useRef(groupByVal);
  useEffect(() => {
    groupByRef.current = groupByVal;
  }, [groupByVal]);

  useEffect(() => {
    const node = tableRef.current;
    if (!node) return;
    const action = reorder(node, {
      isDisabled: () => !!groupByRef.current?.field,
      start: startReorder,
      end: endReorder,
      move: moveReorder,
      getTask: api.getTask,
    });
    return action.destroy;
  }, [api, startReorder, endReorder, moveReorder]);

  const handleHotkey = useCallback(
    (ev) => {
      const { key, isInput } = ev;
      if (!isInput && (key === 'arrowup' || key === 'arrowdown')) {
        ev.eventSource = 'grid';
        api.exec('hotkey', ev);
        return false;
      } else if (key === 'enter') {
        const focusCell = tableAPI?.getState().focusCell;
        if (focusCell) {
          const { row, column } = focusCell;
          if (column === 'add-task') {
            execAction(row, 'add-task');
          } else if (column === 'text') {
            execAction(row, 'open-task');
          }
        }
      }
    },
    [api, execAction, tableAPI],
  );

  // FIXME - temporary hack to provide fresh values to grid's handlers
  const handlersStateRef = useRef(null);
  const setHandlersState = () => {
    handlersStateRef.current = {
      setTableAPI,
      handleHotkey,
      sortVal,
      api,
      cols,
      setColumnWidth,
      tasks,
      durationUnitVal,
      splitTasksVal,
      onTableAPIChange,
    };
  };
  setHandlersState();
  useEffect(() => {
    setHandlersState();
  }, [
    setTableAPI,
    handleHotkey,
    sortVal,
    api,
    cols,
    setColumnWidth,
    tasks,
    durationUnitVal,
    splitTasksVal,
    onTableAPIChange,
  ]);

  const init = useCallback((tapi) => {
    setTableAPI(tapi);
    tapi.intercept('hotkey', (ev) => handlersStateRef.current.handleHotkey(ev));
    tapi.intercept('select-row', () => false);
    tapi.intercept('scroll', () => false);
    tapi.intercept('sort-rows', (e) => {
      const sortVal = handlersStateRef.current.sortVal;
      const { key, add } = e;
      const keySort = sortVal ? sortVal.find((s) => s.key === key) : null;
      let order = 'asc';
      if (keySort) order = !keySort || keySort.order === 'asc' ? 'desc' : 'asc';

      api.exec('sort-tasks', {
        key,
        order,
        add,
      });
      return false;
    });
    tapi.intercept('filter-rows', (ev) => {
      const { key, value } = ev;

      api.exec('filter-tasks', {
        key,
        value,
        open: true,
      });
      return false;
    });

    tapi.intercept('resize-column', (ev) => {
      ev.flexgrowFallback = getFillColumn(handlersStateRef.current.cols, ev.id);
    });

    tapi.on('resize-column', (ev) => {
      const columns = tapi.getState().columns;
      handlersStateRef.current.setColumnWidth(getColumnsWidth(columns));
      if (ev.inProgress !== true) api.exec('set-columns', { columns });
    });

    tapi.on('hide-column', () => {
      const columns = tapi.getState().columns;
      handlersStateRef.current.setColumnWidth(getColumnsWidth(columns));
      api.exec('set-columns', { columns });
    });

    tapi.intercept('update-cell', (e) => {
      const { id, column, value } = e;
      const task = handlersStateRef.current.tasks.find((t) => t.id === id);

      if (task) {
        if (column === 'resources') {
          setTaskResources(id, value, api);
          return;
        }

        const update = { ...task };
        let v = value;
        if (v && !isNaN(v) && !(v instanceof Date)) v *= 1;
        update[column] = v;

        prepareEditTask(
          update,
          {
            durationUnit: handlersStateRef.current.durationUnitVal,
            splitTasks: handlersStateRef.current.splitTasksVal,
          },
          api.getTaskCalendar(update),
          column,
        );

        api.exec('update-task', {
          id: id,
          task: update,
        });
      }
      return false;
    });

    onTableAPIChange && onTableAPIChange(tapi);
  }, []);

  return (
    <div
      className="wx-rHj6070p wx-table-container"
      style={{ flex: `0 0 ${flexBasis}` }}
      ref={tableContainerRef}
    >
      <div
        ref={tableRef}
        style={tableStyle}
        className="wx-rHj6070p wx-table"
        onClick={onClick}
        onDoubleClick={onDblClick}
      >
        {/* SVAR-M8 (SVAR Production Planner): the grid's blank counterpart of
            the TOP scale row. Blank because the coarse month/year band names
            no grid column; opaque for the same reason the lane spacer below
            is. Present only while the lane actually splits the header. */}
        {blankScaleHeight ? (
          <div
            className="wx-rHj6070p wx-annotation-scale-spacer"
            data-annotation-scale-spacer="true"
            aria-hidden="true"
            style={{ top: '0px', height: `${blankScaleHeight}px` }}
          />
        ) : null}
        {/* SVAR-M6 (SVAR Production Planner): the grid's half of the marker
            lane — blank by construction. It carries no chip, no line and no
            grid data; its only job is to hold the same vertical room the
            timeline's lane holds, and to be opaque, so a row scrolled under it
            disappears behind it exactly as it disappears behind the sticky
            lane on the chart side. It does not scroll with the rows.
            SVAR-M8: it now sits ABOVE the column-header block (directly under
            the blank scale band), so the column titles stay adjacent to the
            first task row however tall the lane grows. */}
        {laneHeight ? (
          <div
            className="wx-rHj6070p wx-annotation-lane-spacer"
            data-annotation-lane-spacer="true"
            aria-hidden="true"
            style={{
              top: `${headerSplit.laneSplitsHeader ? blankScaleHeight : headerHeight}px`,
              height: `${laneHeight}px`,
            }}
          />
        ) : null}
        {/* SVAR-M12 (SVAR Production Planner): the consumer's own controls,
            in the blank band above the column headers.

            It is the SAME band the two spacers above occupy — `headerOffset`
            is the one number this file already computes for them, from the one
            split owner — so this slot can never disagree with the reservation
            it sits in, and it adds no height of its own. `align-items: flex-end`
            in the stylesheet keeps the content directly on top of the column
            titles: when the marker lane grows, the new room appears ABOVE the
            content, not between it and the headers.

            What arrives here is an opaque React node. This component does not
            know what the controls do, when they are enabled, what they are
            called or in which language — it renders them, and it stops there. */}
        {gridActionSlot && headerOffset > 0 ? (
          <div
            className="wx-rHj6070p wx-grid-action-slot"
            data-grid-action-slot="true"
            style={{ top: '0px', height: `${headerOffset}px` }}
          >
            {gridActionSlot}
          </div>
        ) : null}
        <WxGrid
          init={init}
          sizes={{
            rowHeight: cellHeightVal,
            headerHeight: (headerHeight ?? 0) / (headerLengthVal ?? 1),
          }}
          rowStyle={(row) =>
            row.$reorder ? 'wx-rHj6070p wx-reorder-task' : 'wx-rHj6070p'
          }
          columnStyle={getColumnStyle}
          data={allTasks}
          columns={fitColumns}
          selectedRows={[...sel]}
          sortMarks={sortMarks}
          filterValues={filters}
        />
      </div>
    </div>
  );
}
