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
   *
   * SVAR-M17 (SVAR Production Planner): `gridActionSlotMinHeight` — the
   * already-resolved minimum that slot's own content asks the band to have,
   * from the same `Layout.jsx`. A number of pixels and nothing else: this file
   * does not know whether a consumer passed a slot (that is already folded
   * into the number, which is `0` when none did), what the content is, or why
   * it needs the room.
   */
  /*
   * SVAR-M18 (SVAR Production Planner): `consumerOwnsColumnWidths` — the
   * consumer, not this grid, owns what each column's width IS. See `Gantt.jsx`
   * for the two behaviours it turns off together and why they are one
   * decision; the two places it is read are the `resize-column` interception
   * and handler below.
   */
  const {
    readonly,
    onTableAPIChange,
    annotationLaneHeight,
    gridActionSlot,
    reserveTopScaleRow,
    gridActionSlotMinHeight,
    consumerOwnsColumnWidths,
    columnMinWidth,
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

  /*
   * SVAR-M13/M14 (SVAR Production Planner, R4): what the reorder helper's
   * cursor zone MEANS, once the task list is taken into account.
   *
   * `reorder.js` owns the geometry and answers one question: which row is the
   * cursor over, and which third of it is it in. It cannot answer what that
   * means, because meaning needs the list — which row follows this one, and
   * whether this one is an open container whose own subtree comes next. That
   * is this function, and it is pure.
   *
   * ```text
   * before / child        returned untouched: a cursor in a row's upper band
   *                       or its middle says exactly what it means already.
   * after an OPEN         rewritten to "before its first child". The line for
   *   container           "after C" is drawn on C's bottom edge, and C's bottom
   *                       edge is where its first child begins — so "after the
   *                       whole subtree" would draw the promise in the wrong
   *                       place. Unconditional, not only at the boundary.
   * after, ON the         rewritten to "before the row below". One visible
   *   separator           separator can be named from either side, and a
   *                       cursor resting on it jitters between the two rows;
   *                       naming it one way means the RESULT cannot flicker
   *                       with the jitter. Above the snap band the lower part
   *                       of a row still means "after THIS row", so dropping
   *                       as the last child of a group stays reachable.
   * ```
   *
   * ## What R4 deliberately REMOVED
   *
   * Upstream also rewrote "after T" to "before T" whenever the dragged row
   * already sat directly under T. That existed to rescue the BODY-based hit
   * test, which produced "after T" for a gesture the user made by reaching
   * upward. Under a cursor model the same gesture is unambiguous — the cursor
   * is in T's lower band, on the separator the row is already at — and
   * silently inverting the direction is the surprise Pavel's manual acceptance
   * reported. It is gone: that drop is now a no-op, the consumer declines a
   * command that would change nothing, and the line is drawn exactly where the
   * row already is. Aiming at T's UPPER band is how you go above T.
   *
   * It decides nothing about LEGALITY — a consumer that owns hierarchy rules
   * refuses the drop it does not allow, and that is still its own business.
   */
  const resolveDrop = useCallback(({ id, mode, target, atBoundary }) => {
    if (mode !== 'after') return { mode, target };

    const rows = allTasksRef.current;
    const targetIndex = rows.findIndex((t) => t.id === target);
    if (targetIndex === -1) return { mode, target };
    const task = rows[targetIndex];

    if (task && task.data && task.open && task.data.length > 0) {
      return { mode: 'before', target: task.data[0].id };
    }

    if (atBoundary) {
      const below = rows[targetIndex + 1];
      if (below && below.id !== id) return { mode: 'before', target: below.id };
    }

    return { mode, target };
  }, []);

  const reorderTasks = useCallback(
    ({ id, mode, target, inProgress }) => {
      // SVAR-M13 (SVAR Production Planner): `child` is the third zone the
      // reorder helper can now report — "into this row". `move-task` has always
      // accepted the mode and the store has always implemented it; only the
      // gesture that produces it is new.
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

    /*
     * SVAR-M18: with the consumer owning the widths, NOTHING stretches.
     *
     * `@svar-ui/gantt-store` normalizes every column set so that exactly one
     * visible column always carries a `flexgrow` — if the consumer supplied
     * none, it puts one on `text`. That is right when the pane's width is
     * fixed and something has to fill it. When the consumer makes the pane
     * follow its columns there is nothing to fill, and the forced `flexgrow`
     * has one visible consequence left: a resize of THAT column measures its
     * start from the element's `clientWidth` rather than from the column's own
     * width, so the gesture lands one pixel short of the delta the user made.
     *
     * Removed HERE rather than upstream because `@svar-ui/gantt-store` is not
     * ours to change, and it does not need to be: `cols` is this component's
     * own per-render copy, so dropping the flag affects the layout it renders
     * and nothing that is stored.
     */
    if (consumerOwnsColumnWidths) {
      for (const col of cols) delete col.flexgrow;
    }

    return cols;
  }, [columnsVal, _, readonly, compactModeVal, consumerOwnsColumnWidths]);

  useLayoutEffect(() => {
    setColumnWidth(getColumnsWidth(cols));
  }, [cols]);

  /*
   * SVAR-M24 (SVAR Production Planner): a grid row says which KIND of entity
   * it is showing.
   *
   * The chart already does — a bar carries `wx-task`, `wx-summary` or
   * `wx-milestone` — and the left grid did not, so a consumer that wants a
   * container row to read differently from a leaf row has nowhere to hang the
   * rule. The alternatives all mean guessing at something the row already
   * knows: `aria-expanded` is the CHEVRON's state and says "has children"
   * rather than "is a container", and indentation says nothing at all.
   *
   * `type` is the value the CONSUMER put on the task. Nothing here derives it,
   * infers it or corrects it, and nothing here has an opinion about WHICH
   * kinds exist: the shape below is a class-name check, so a value that could
   * not be a class name does not become one, and every kind a consumer has —
   * this package's own three among them — gets the same treatment without
   * this file naming any of them.
   */
  const rowStyle = useCallback((row) => {
    let style = row.$reorder ? 'wx-rHj6070p wx-reorder-task' : 'wx-rHj6070p';
    const kind = row.type;
    if (typeof kind === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(kind)) {
      style += ` wx-row-${kind}`;
    }
    return style;
  }, []);

  const getColumnStyle = useCallback((col) => {
    let style = `wx-rHj6070p wx-text-${col.align} `;

    /*
     * SVAR-M23 (SVAR Production Planner): a column may align its HEADER label
     * independently of the cells under it.
     *
     * `align` is ONE value for both halves of a column, so a consumer whose
     * header labels are centred over left-reading cells — a name column with
     * its hierarchy indentation, an assignee column of names — has nowhere to
     * say so. It cannot say so on the column either: `@svar-ui/gantt-store`
     * normalizes a column set down to a fixed list of properties and drops
     * everything else, and that store is not ours to change.
     *
     * What it does copy through untouched is the HEADER DESCRIPTOR, so that is
     * where the consumer says it: `header: [{ text, align }]`. Nothing in
     * either package reads a descriptor's `align` today, and the word already
     * means this at column level.
     *
     * The class this adds lands on the column's header cells AND on its body
     * cells, because `columnStyle` is one callback for both. Only the header
     * rules in `./Grid.css` mention it, so a body cell provably keeps the
     * alignment `align` gave it. The header rules are also written one level
     * more specific than the vendor's own `wx-text-*` and `:first-child`
     * header rules, so which of them wins is decided by specificity rather
     * than by the order the stylesheets happen to load in.
     */
    const headerAlign = col.header?.[0]?.align;
    if (headerAlign) style += `wx-header-text-${headerAlign} `;

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
    () =>
      splitScaleHeaderForLane(
        scalesVal,
        laneHeight,
        reserveTopScaleRow,
        gridActionSlotMinHeight,
      ),
    [scalesVal, laneHeight, reserveTopScaleRow, gridActionSlotMinHeight],
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
  /**
   * SVAR-M17: the extra blank band the slot's declared minimum asked for, in
   * the same place the chart puts it — under the top scale row, above the
   * marker lane. `0` whenever the natural band already suffices, which is what
   * keeps every already-accepted state pixel-identical.
   */
  const slotReserveHeight = headerSplit.slotReserveExtraHeight;
  /** How far down the whole grid (header included) starts. */
  const headerOffset =
    blankScaleHeight +
    slotReserveHeight +
    (headerSplit.laneSplitsHeader ? laneHeight : 0);
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

      /*
       * SVAR-M15 (SVAR Production Planner): a dragged container KEEPS the
       * expanded state it had.
       *
       * Upstream opened every reorder here by collapsing the dragged row when
       * it was an open container — a plain `open-task` dispatch with mode
       * false, on the row being picked up — and nothing ever re-opened it.
       * Because that is the same command the row's own chevron sends, the
       * collapse outlived the gesture exactly like a collapse the user had
       * asked for: pick a group up, change your mind, release it where it
       * already sat, and the group is closed with the rows you were reading
       * hidden. The pristine statement is quoted in full in PLANNER_FORK.md,
       * deliberately not here: this file is read through the shipped
       * sourcemap by the consumer's provenance check, which proves the change
       * by that statement's ABSENCE, and a verbatim quote of it would make
       * the evidence unreadable.
       *
       * Upstream's reason is presentational — an open subtree left behind
       * while its parent's row travels looks like the children were abandoned
       * mid-gesture. This fork does not need the collapse to answer that: the
       * drop is routed to ONE canonical command that moves the whole subtree,
       * so nothing is being left anywhere, and the consumer marks the
       * travelling row's own identity instead.
       *
       * Nothing replaces it. After this a drag writes no presentation state
       * of its own, which is the wider point: expanded/collapsed becomes
       * something a consumer can own across a drag, a rejected drop and a
       * successful reparent alike, without having to watch the gesture and
       * repair state behind it — which it could not do correctly anyway,
       * since it cannot tell this collapse apart from the user's.
       */

      const t = api.getState()._tasks.find((t) => t.id === id);
      setDragTask(t || null);
      if (!t) return false;
    },
    [api, readonly],
  );

  const endReorder = useCallback(
    ({ id, top, drop }) => {
      /*
       * SVAR-M14 (R3): the drop is the descriptor `reorder.js` had on screen at
       * the moment of release, handed straight here.
       *
       * It used to be the last in-progress detail this component had cached,
       * which is a different value whenever the final pointer move crossed a
       * zone boundary — the marker showed one thing and the drop did another,
       * and which one won depended on how many moves the browser coalesced.
       * There is nothing to cache now: one descriptor, painted and dropped.
       */
      /*
       * SVAR-M14 (R8): the VISUAL drag is ended first, and unconditionally.
       *
       * This is the whole of a defect the consuming product's manual
       * acceptance found as "the dragged row gets stuck and needs another drag
       * to recover", measured in real Chromium as a row left carrying
       * `$reorder` — painted as the floating drag card, in place, after the
       * button came up.
       *
       * The store clears `$reorder` in exactly two places, and both used to be
       * reachable only through the branch below:
       *
       * ```text
       * drag-task  inProgress:false   sets $reorder = false and returns $y
       * move-task  inProgress:false   clears $reorder inside the move handler
       * ```
       *
       * So a drop dispatched `move-task` and relied on the STORE's own move
       * handler to end the drag. A consumer that owns hierarchy cancels
       * `move-task` and runs its own canonical command instead — which is the
       * supported arrangement, and it means that clearing never runs. An
       * ACCEPTED drop hid it: the consumer re-projects afterwards, and fresh
       * task objects carry no `$reorder`. A drop that changes nothing — a
       * no-op, or one the consumer's domain refuses — re-projects to the same
       * state, so nothing replaced the flag and the row stayed a card.
       *
       * Ending the visual drag is this grid's own business and cannot depend
       * on whether someone else accepts the command that follows. `top` is the
       * gesture's ORIGINAL top, so this also puts the bar back where it was
       * picked up; on an accepted drop the consumer's reprojection then places
       * it properly, and the two happen in one batch.
       */
      api.exec('drag-task', {
        id,
        top: top + (scrollDelta ?? 0),
        inProgress: false,
      });
      if (drop) {
        reorderTasks({ ...drop, inProgress: false });
      }
      setDragTask(null);
    },
    [api, reorderTasks, scrollDelta],
  );

  const moveReorder = useCallback(
    ({ id, top, detail }) => {
      if (detail) {
        reorderTasks({ ...detail, inProgress: true });
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

  /*
   * SVAR-M14 (R7): the live drag callbacks, reachable without re-installing
   * the gesture.
   *
   * ## The defect this replaces, measured
   *
   * The effect below used to list `moveReorder`, `endReorder` and the rest in
   * its dependency array. Both of those are `useCallback`s that close over
   * `scrollDelta`, which is `area.from` — the top of the grid's virtual render
   * window. So ANY vertical scroll far enough to move that window changed
   * their identity, re-ran the effect, and called `action.destroy()` on a
   * gesture that was still being held.
   *
   * `destroy()` ran `end(true)`, which detaches listeners and nothing else: it
   * never removed the floating clone, never restored the source row's
   * visibility, never cleared the drop marker and never told this grid the
   * gesture was over. The replacement `reorder()` closure started empty, so
   * the pointer no longer moved anything and the release had nothing left to
   * end.
   *
   * Measured in real Chromium on the consuming product, mouse held down
   * throughout:
   *
   * ```text
   * wheel   12px   render window unchanged  preview follows pointer, clean end
   * wheel  300px   render window moves      preview frozen, drop marker stuck,
   *                                         2 orphan clones and a permanently
   *                                         hidden source row survive mouseup
   * ```
   *
   * That is the whole of the reported "the drag gets stuck and the page has to
   * be reloaded", and it is also why edge auto-scroll could not have worked
   * before it was fixed: auto-scroll scrolls, and scrolling killed the drag.
   *
   * The fix is the pattern this file already uses for `groupBy` two lines up:
   * the changing values live in a ref, the action is installed ONCE per grid
   * node, and the thunks handed to it read the ref when they are called. The
   * callbacks themselves are unchanged — `scrollDelta` is still read, and is
   * still read at the moment of the move rather than at install time, which is
   * the value that was wanted all along.
   */
  const dragRef = useRef(null);
  dragRef.current = { startReorder, endReorder, moveReorder, resolveDrop, api };

  useEffect(() => {
    const node = tableRef.current;
    if (!node) return;
    const action = reorder(node, {
      isDisabled: () => !!groupByRef.current?.field,
      start: (a) => dragRef.current.startReorder(a),
      end: (a) => dragRef.current.endReorder(a),
      move: (a) => dragRef.current.moveReorder(a),
      // SVAR-M14 (R3): the raw zone becomes the drop this grid would actually
      // dispatch, BEFORE anything is drawn from it.
      resolve: (a) => dragRef.current.resolveDrop(a),
      getTask: (id) => dragRef.current.api.getTask(id),
    });
    return action.destroy;
  }, []);

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
      // SVAR-M18 (SVAR Production Planner): read by the two `resize-column`
      // handlers below, which are installed once and therefore have to reach
      // the current value the same way every other input here does.
      consumerOwnsColumnWidths,
      // SVAR-M20 (SVAR Production Planner): read by the same interception, and
      // reaches it the same way, for the same reason.
      columnMinWidth,
      // SVAR-M25 (SVAR Production Planner): likewise.
      gridMaxWidth,
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
    consumerOwnsColumnWidths,
    columnMinWidth,
    gridMaxWidth,
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
      /*
       * SVAR-M20: the gesture never proposes a width below the consumer's own
       * minimum.
       *
       * This is the earliest point at which the number exists: the header cell
       * has turned the pointer's travel into a width, and the store has not yet
       * written it. Clamping HERE means the width the screen shows during the
       * gesture and the width that ends up stored are the same number, which is
       * what stops a column from being dragged into a sliver and then jumping
       * back the next time anything rebuilt it.
       *
       * The store's own floor still applies afterwards and is unchanged; this
       * one is simply higher when a consumer declares one, and absent when it
       * does not.
       */
      const minWidth = handlersStateRef.current.columnMinWidth;
      if (Number.isFinite(minWidth) && minWidth > 0 && ev.width < minWidth) {
        ev.width = minWidth;
      }

      /*
       * SVAR-M25: and never past the width the whole pane is allowed to have.
       *
       * A column gesture and the splitter gesture change the same thing — how
       * much room the grid takes from the chart — so one ceiling has to answer
       * for both, or a column can be dragged through a boundary the splitter
       * refuses to cross. The room left for THIS column is the ceiling less
       * every other column standing in the pane, and the floor above still
       * wins: a pane already at its ceiling stops the gesture rather than
       * shrinking the column that is being dragged.
       */
      const maxGrid = handlersStateRef.current.gridMaxWidth;
      if (Number.isFinite(maxGrid) && maxGrid > 0) {
        const others = (handlersStateRef.current.cols || []).reduce(
          (total, col) => (col.id === ev.id ? total : total + (col.width || 0)),
          0,
        );
        const room = maxGrid - others;
        if (ev.width > room) {
          ev.width = Math.max(
            room,
            Number.isFinite(minWidth) && minWidth > 0 ? minWidth : 1,
          );
        }
      }

      /*
       * SVAR-M18: with the consumer owning the widths, no column is handed
       * another column's `flexgrow`.
       *
       * `flexgrowFallback` is what the grid store uses to keep SOMETHING
       * stretching inside a pane whose width does not move: the resized column
       * loses its `flexgrow` and the widest other column is given one, so the
       * change is absorbed by a column the user did not touch. That is correct
       * when the pane is fixed. It is wrong when the consumer is going to make
       * the pane follow the columns, because then there is nothing to absorb —
       * every width is exactly what somebody asked for.
       */
      if (handlersStateRef.current.consumerOwnsColumnWidths) return;
      ev.flexgrowFallback = getFillColumn(handlersStateRef.current.cols, ev.id);
    });

    tapi.on('resize-column', (ev) => {
      const columns = tapi.getState().columns;
      handlersStateRef.current.setColumnWidth(getColumnsWidth(columns));
      /*
       * SVAR-M18: every accepted step, not only the last one.
       *
       * `inProgress` is the grid's own "the mouse is still down" flag, and
       * reporting only the final width is right for a consumer that merely
       * wants to persist the outcome. A consumer that OWNS the widths is
       * rendering from them, so between mouse-down and mouse-up its value and
       * the screen would disagree — and any width it derives from them, the
       * pane's own among them, would lag a whole gesture behind.
       *
       * The payload is unchanged and so is the action: this is the same
       * `set-columns` the consumer already receives, sent at every step
       * instead of once.
       */
      if (
        ev.inProgress !== true ||
        handlersStateRef.current.consumerOwnsColumnWidths
      ) {
        api.exec('set-columns', { columns });
      }
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
              // SVAR-M17: below the slot's reserve band when there is one, so
              // the lane keeps sitting directly on top of the column headers
              // and the new room appears ABOVE it, never inside it.
              top: `${headerSplit.laneSplitsHeader ? blankScaleHeight + slotReserveHeight : headerHeight}px`,
              height: `${laneHeight}px`,
            }}
          />
        ) : null}
        {/* SVAR-M12 (SVAR Production Planner): the consumer's own controls,
            in the blank band above the column headers.

            It is the SAME band the two spacers above occupy — `headerOffset`
            is the one number this file already computes for them, from the one
            split owner — so this slot can never disagree with the reservation
            it sits in, and it adds no height of its own. Since SVAR-M17 that
            band may carry a third part, the reserve the slot's own declared
            minimum asked for; it enters `headerOffset` through the same split
            owner, so this element still reads one number. `align-items: flex-end`
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
          rowStyle={rowStyle}
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
