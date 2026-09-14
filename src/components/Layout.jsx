import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useContext,
} from 'react';
import { hotkeys } from '@svar-ui/grid-store';
import { useStore, useWritableProp } from '@svar-ui/lib-react';
import Grid from './grid/Grid.jsx';
import Chart from './chart/Chart.jsx';
import Resizer, {
  RESIZER_RIGHT_THRESHOLD,
  RESIZER_SIZE,
} from './Resizer.jsx';
import storeContext from '../context';
import './Layout.css';
import { flushSync } from 'react-dom';
import { useTimelineAnnotationLayout } from './chart/annotations/useTimelineAnnotationLayout.js';
import { splitScaleHeaderForLane } from './chart/annotations/timelineAnnotationLayout.js';
import AnnotationMeasurer from './chart/annotations/AnnotationMeasurer.jsx';
import {
  collectFollowedTaskIds,
  IDLE_BAR_DRAG_PREVIEW,
  nextBarDragPreviewState,
} from './chart/annotations/barDragPreviewGate.js';

function Layout(props) {
  // SVAR-M3 (SVAR Production Planner): plain prop pass-through, same as
  // `taskTemplate` on this same line — see `Gantt.jsx` for what it is.
  // SVAR-M4 (SVAR Production Planner): `timelineAnnotations` — see
  // `Gantt.jsx`. This component owns the annotation LAYOUT (through the hook
  // below), because the lane's height is part of the scroll/height math here.
  // SVAR-M5 (SVAR Production Planner): `onTimelineDragPreview` — see
  // `Gantt.jsx`. This component owns the transient half of the marker
  // presentation for the same reason it owns the lane layout: the displaced
  // marker and the lane height it may change are one layout, computed once.
  // SVAR-M12 (SVAR Production Planner): `gridActionSlot` — see `Gantt.jsx`.
  // This component owns the flag below for the same reason it owns the lane
  // layout: the grid's blank reservation and the header's own composition are
  // one arrangement, and both halves must be told the same thing about it.
  // SVAR-M17 (SVAR Production Planner): `gridActionSlotMinHeight` — see
  // `Gantt.jsx`. Resolved here, once, for the same reason: the reserve it can
  // produce is part of that one arrangement, and both halves are handed the
  // SAME resolved number so they cannot answer differently.
  // SVAR-M18 (SVAR Production Planner): `consumerOwnsColumnWidths` — see
  // `Gantt.jsx`. Plain pass-through: it concerns only the grid's own column
  // widths, so this component neither reads it nor has an opinion about it.
  // SVAR-M28 (SVAR Production Planner): `onScaleCellContextMenu` — see
  // `Gantt.jsx`. Plain pass-through beside `scaleCellAriaLabel`, unread here.
  const {
    taskTemplate,
    scaleCellAriaLabel,
    onScaleCellContextMenu,
    timelineAnnotations,
    onTimelineDragPreview,
    gridActionSlot,
    gridActionSlotMinHeight,
    consumerOwnsColumnWidths,
    // SVAR-M20 (SVAR Production Planner): pass-through, unread here.
    columnMinWidth,
    // SVAR-M26 (SVAR Production Planner): likewise — it concerns one column's
    // own width, which this component has no opinion about.
    columnMaxWidth,
    // SVAR-M25 (SVAR Production Planner): the consumer's ceiling for the grid
    // pane, and the report that tells the consumer what this layout's own
    // geometry allows. Both are resolved here, once, because this is the only
    // component that knows how wide the whole gantt is.
    gridMaxWidth,
    gridMinWidth,
    onGridWidthLimit,
    readonly,
    onTableAPIChange,
    onGanttWidthChange,
  } = props;

  const api = useContext(storeContext);

  const rTasks = useStore(api, '_tasks');
  const rScales = useStore(api, '_scales');
  const rCellHeight = useStore(api, 'cellHeight');
  const rColumns = useStore(api, 'columns');
  const rScrollTop = useStore(api, 'scrollTop');
  const undo = useStore(api, 'undo');
  const columnsWidth = useStore(api, '_columnsWidth');
  // SVAR-M25 (SVAR Production Planner): read for the width limit below, which
  // is a different number when the chart is not on screen at all.
  const rDisplayMode = useStore(api, 'displayMode');
  // SVAR-M4 (SVAR Production Planner): the store's `cellWidth` is one of the
  // two geometry inputs the annotation placement reads (with `_scales`).
  const rCellWidth = useStore(api, 'cellWidth');

  /*
   * SVAR-M5 (SVAR Production Planner): the live bar-drag preview.
   *
   * `Bars.jsx` reports one step per accepted pointer move; this state is the
   * PIXEL half of it (`{ id, dx }`), which is all the annotation layout needs
   * to slide the dragged bar's own marker onto the bar. The SEMANTIC half —
   * what date the bar will land on — is not decided here and never is: the
   * event is handed on to the consumer, which owns dates and answers by
   * putting a `previewDate` on the annotation it hands back.
   *
   * Kept out of the store deliberately (D-102 §B): a transient presentation
   * value of this fork is not a reason to touch `@svar-ui/gantt-store`.
   *
   * SVAR-M11 (SVAR Production Planner): WHETHER a given step is written into
   * that state at all. A write here re-renders this whole layout, and until
   * R7 every accepted step of every drag paid for one — including on a page
   * with no annotations, where the recomputed layout is provably identical.
   * `./chart/annotations/barDragPreviewGate.js` is the pure decision, with the
   * measurements and the one first-step exception written down; the state
   * itself, and everything the layout does with it, are unchanged.
   *
   * The gate's own state lives in a ref, not in React state: it decides WHEN
   * to render and must therefore not cause one.
   */
  const [barDragPreview, setBarDragPreview] = useState(null);
  const barDragPreviewGate = useRef(IDLE_BAR_DRAG_PREVIEW);
  const followedTaskIds = useMemo(
    () => collectFollowedTaskIds(timelineAnnotations),
    [timelineAnnotations],
  );
  const onBarDragPreview = useCallback(
    (event) => {
      const next = nextBarDragPreviewState(
        barDragPreviewGate.current,
        event,
        followedTaskIds,
      );
      barDragPreviewGate.current = next.state;
      if (next.publish) setBarDragPreview(next.state.published);
      if (onTimelineDragPreview) onTimelineDragPreview(event);
    },
    [followedTaskIds, onTimelineDragPreview],
  );

  // SVAR-M4 (SVAR Production Planner): ONE memoised layout for the lines in
  // the chart body and the chips in the annotation lane. `laneHeight` is the
  // vertical room the lane takes from the chart body; it enters the scroll
  // height and the chart height below exactly as the scale height does — and,
  // since SVAR-M6, the left grid's own blank spacer, so both halves of the
  // split surface reserve the SAME resolved pixel height and their rows stay
  // on one line.
  const { layout: annotationLayout, onMeasured: onAnnotationsMeasured } =
    useTimelineAnnotationLayout(
      timelineAnnotations,
      rScales,
      rCellWidth,
      barDragPreview,
    );
  const laneHeight = annotationLayout.laneHeight;

  /*
   * SVAR-M12 (SVAR Production Planner): whether the top scale row's band is
   * kept blank on the grid side even with no marker lane to fill it.
   *
   * The band is where `gridActionSlot` renders, and a project can legitimately
   * have no annotation at all — an empty one, or one whose only dates sit
   * outside the visible range — so without this the slot's room would come and
   * go with the consumer's data. Handed to BOTH halves so the one split owner still
   * gives one answer; on the chart side a zero-height lane renders nothing, so
   * the header looks exactly as it did.
   */
  const hasGridActionSlot = gridActionSlot != null;
  const reserveTopScaleRow = laneHeight > 0 || hasGridActionSlot;

  /*
   * SVAR-M17 (SVAR Production Planner): the minimum the consumer's own slot
   * content asks the band to have, resolved to a plain number ONCE.
   *
   * Two things are decided here and nowhere else. That the minimum applies at
   * all: it is dropped unless the consumer actually passed a `gridActionSlot`,
   * so it is a request from THAT consumer about THAT content rather than a
   * floor every surface pays — a harness with a strip and no minimum keeps the
   * band it has today. And that both halves are told the same number, for the
   * same reason `reserveTopScaleRow` is: the grid's reservation and the
   * header's own composition are one arrangement, and a disagreement between
   * them is a vertical desynchronization of the two panes.
   */
  const slotMinHeight =
    hasGridActionSlot &&
    Number.isFinite(gridActionSlotMinHeight) &&
    gridActionSlotMinHeight > 0
      ? gridActionSlotMinHeight
      : 0;

  /*
   * SVAR-M17: the shortfall this layout has to pay for, from the ONE split
   * owner both halves ask — asked here as well because the reserve is real
   * vertical room above the chart body, so it belongs in the scroll travel and
   * in the chart height published to the store exactly as the lane does.
   */
  const headerSplit = useMemo(
    () =>
      splitScaleHeaderForLane(
        rScales,
        laneHeight,
        reserveTopScaleRow,
        slotMinHeight,
      ),
    [rScales, laneHeight, reserveTopScaleRow, slotMinHeight],
  );
  const slotReserveExtraHeight = headerSplit.slotReserveExtraHeight;

  const [ganttWidth, setGanttWidth] = useWritableProp(props.ganttWidth);
  const [ganttHeight, setGanttHeight] = useState(0);
  const [innerWidth, setInnerWidth] = useState(undefined);

  const scrollSize = useMemo(
    () => (ganttWidth ?? 0) - (innerWidth ?? 0),
    [ganttWidth, innerWidth],
  );
  const fullWidth = useMemo(() => rScales.width, [rScales]);
  const fullHeight = useMemo(
    () => rTasks.length * rCellHeight,
    [rTasks, rCellHeight],
  );
  const scrollHeight = useMemo(
    // SVAR-M4 (SVAR Production Planner): + laneHeight — the lane sits between
    // the scale rows and the body, so the last row needs that much more
    // scroll travel to come fully into view.
    // SVAR-M17 (SVAR Production Planner): + the slot's reserve, for exactly
    // the same reason — it is another band between the scale rows and the
    // body, and a row hidden behind room nobody counted is a row the user
    // cannot scroll to.
    () =>
      rScales.height +
      laneHeight +
      slotReserveExtraHeight +
      fullHeight +
      scrollSize,
    [rScales, laneHeight, slotReserveExtraHeight, fullHeight, scrollSize],
  );

  const chartRef = useRef(null);

  const latestLayout = useRef({
    ganttWidth: 0,
    columnsWidth: 0,
    ganttHeight: 0,
    rScalesHeight: 0,
    scrollSize: 0,
  });

  useEffect(() => {
    latestLayout.current = {
      ganttWidth: ganttWidth ?? 0,
      columnsWidth,
      ganttHeight: ganttHeight ?? 0,
      // SVAR-M4 (SVAR Production Planner): the header block the chart body
      // sits under is the scale rows PLUS the annotation lane.
      // SVAR-M17 (SVAR Production Planner): PLUS the slot's reserve band. The
      // store learns the chart's height by subtracting this from the surface
      // height, so a reserve missing here would give the body more height than
      // it has and put the last rows under the header.
      rScalesHeight: rScales.height + laneHeight + slotReserveExtraHeight,
      scrollSize,
    };
  }, [
    ganttWidth,
    columnsWidth,
    ganttHeight,
    rScales,
    laneHeight,
    slotReserveExtraHeight,
    scrollSize,
  ]);

  const chartResizeHandler = useCallback(() => {
    const {
      ganttWidth: gw,
      columnsWidth: cw,
      ganttHeight: gh,
      rScalesHeight: sh,
      scrollSize: ss,
    } = latestLayout.current;
    api.exec('resize-chart', {
      width: gw - cw - ss - 4, // resizer width
      height: gh - sh,
      scrollSize: ss,
    });
  }, [api]);

  useEffect(() => {
    let ro;
    if (chartRef.current) {
      ro = new ResizeObserver(chartResizeHandler);
      ro.observe(chartRef.current);
    }
    return () => {
      if (ro) ro.disconnect();
    };
  }, [chartRef.current, chartResizeHandler]);

  // SVAR-M4 (SVAR Production Planner): a lane-height change is not a DOM
  // resize of the chart element, so the ResizeObserver above does not see it;
  // re-publish the chart height whenever the lane actually changes height.
  // Declared AFTER the `latestLayout` effect so it reads the updated value.
  // SVAR-M17 (SVAR Production Planner): the slot's reserve is the same kind of
  // change and is watched by the same ref — the two move in OPPOSITE
  // directions (a lane appearing eats the shortfall it made), so watching the
  // lane alone would miss the very moment the reserve appears or goes.
  const publishedHeaderBand = useRef(laneHeight + slotReserveExtraHeight);
  useEffect(() => {
    const band = laneHeight + slotReserveExtraHeight;
    if (publishedHeaderBand.current === band) return;
    publishedHeaderBand.current = band;
    chartResizeHandler();
  }, [laneHeight, slotReserveExtraHeight, chartResizeHandler]);

  const ganttDivRef = useRef(null);
  const pseudoRowsRef = useRef(null);
  const expectedScrollTop = useRef(null);
  const isUserScrollRef = useRef(false);

  const onScroll = useCallback(() => {
    const el = ganttDivRef.current;
    if (el && el.scrollTop !== expectedScrollTop.current) {
      expectedScrollTop.current = el.scrollTop;
      isUserScrollRef.current = true;
      api.exec('scroll-chart', {
        top: el.scrollTop,
      });
    }
  }, [api]);

  useEffect(() => {
    const ganttDiv = ganttDivRef.current;
    const pseudoRows = pseudoRowsRef.current;
    if (!ganttDiv || !pseudoRows) return;
    const update = () => {
      flushSync(() => {
        setGanttHeight(ganttDiv.offsetHeight);
        setGanttWidth(ganttDiv.offsetWidth);
        setInnerWidth(pseudoRows.offsetWidth);
      });
    };
    const ro = new ResizeObserver(update);
    ro.observe(ganttDiv);
    return () => ro.disconnect();
  }, [ganttDivRef.current]);

  useEffect(() => {
    if (onGanttWidthChange) onGanttWidthChange(ganttWidth);
  }, [ganttWidth, onGanttWidthChange]);

  /*
   * SVAR-M25: the widest the grid pane may be made before the chart is gone.
   *
   * The consumer owns its own ceiling — how wide its columns are allowed to
   * be — and cannot know this one, because this one is geometry: the width
   * this layout actually has, less the sliver at which the drag below already
   * treats the chart as no longer worth showing. Reporting the SUBTRACTED
   * number rather than the raw width is what keeps that sliver a fact of this
   * component instead of a constant two packages have to agree about.
   *
   * Reported whenever it changes, so a consumer that resizes the window has
   * the current answer without asking.
   */
  const gridWidthLimit = useMemo(() => {
    /*
     * Grid-only is a DIFFERENT limit, and R5 is why.
     *
     * The sliver subtracted below exists to keep a chart that is on screen
     * worth looking at. Once the arrow has taken the chart off screen there is
     * no chart to keep, and reserving room for it leaves a band of empty grid
     * the columns are not allowed to use. What bounds the pane then is the
     * only thing left: the width the grid actually has, which in this mode is
     * its own flex-basis of `calc(100% - 4px)` — the whole layout less this
     * strip.
     */
    if (rDisplayMode === 'grid') {
      return Math.max(0, ganttWidth - RESIZER_SIZE);
    }
    // One pixel INSIDE the threshold, not on it: the drag's own test is
    // `containerWidth - position <= rightThreshold`, so a position exactly at
    // `containerWidth - rightThreshold` is already the grid-only case. The
    // limit has to be the widest position that is still NOT it.
    return Math.max(0, ganttWidth - RESIZER_RIGHT_THRESHOLD - 1);
  }, [ganttWidth, rDisplayMode]);
  useEffect(() => {
    if (onGridWidthLimit) onGridWidthLimit(gridWidthLimit);
  }, [gridWidthLimit, onGridWidthLimit]);

  /*
   * SVAR-M25: and the one number both gestures are clamped to.
   *
   * The consumer's ceiling and this layout's own limit are two different
   * statements about the same width, so the smaller of them is the answer.
   * Zero means the consumer declared none and nothing is clamped.
   */
  /*
   * SVAR-M25 (R5): the consumer's floor is taken as given.
   *
   * It is the one bound this layout must NOT narrow. The ceiling is geometry —
   * how much room there is — and geometry can always ask for less. The floor
   * is arithmetic on the consumer's own contents, and a layout too narrow for
   * it is a layout the consumer overflows, not a consumer that can be made
   * smaller. Clamping it to fit would hand the gesture a position the consumer
   * then refuses, and a consumer that refuses a value returns the model it
   * already had — so nothing would correct the screen, and the splitter would
   * sit beside a list that is wider than it. Measured before this: 6 px apart.
   */
  const resolvedGridMinWidth = useMemo(
    () =>
      Number.isFinite(gridMinWidth) && gridMinWidth > 0 ? gridMinWidth : 0,
    [gridMinWidth],
  );

  const resolvedGridMaxWidth = useMemo(() => {
    if (!Number.isFinite(gridMaxWidth) || gridMaxWidth <= 0) return 0;
    const capped =
      gridWidthLimit > 0 ? Math.min(gridMaxWidth, gridWidthLimit) : gridMaxWidth;
    // ...and never below that floor, for the same reason.
    return resolvedGridMinWidth > 0
      ? Math.max(capped, resolvedGridMinWidth)
      : capped;
  }, [gridMaxWidth, gridWidthLimit, resolvedGridMinWidth]);

  useEffect(() => {
    const ganttDiv = ganttDivRef.current;
    if (!ganttDiv) return;
    // change originated from the user's own scroll — don't write it back,
    // otherwise we re-trigger onScroll and loop (see Layout.svelte FIXME)
    if (isUserScrollRef.current) {
      isUserScrollRef.current = false;
      return;
    }
    // only programmatic scrolls (scrollToTask, etc.) reach here
    if (rScrollTop !== ganttDiv.scrollTop) {
      expectedScrollTop.current = rScrollTop;
      ganttDiv.scrollTop = rScrollTop;
    }
  }, [rScrollTop]);

  const layoutRef = useRef(null);

  useEffect(() => {
    const node = layoutRef.current;
    if (!node) return;

    const cleanup = hotkeys(node, {
      keys: {
        'ctrl+c': true,
        'ctrl+v': true,
        'ctrl+x': true,
        'ctrl+d': true,
        backspace: true,
        'ctrl+z': undo,
        'ctrl+y': undo,
      },
      exec: (ev) => {
        if (!ev.isInput) api.exec('hotkey', ev);
      },
    });

    return () => {
      cleanup?.destroy();
    };
  }, [undo]);

  return (
    <div className="wx-jlbQoHOz wx-gantt" ref={ganttDivRef} onScroll={onScroll}>
      <div
        className="wx-jlbQoHOz wx-pseudo-rows"
        style={{ height: scrollHeight, width: '100%' }}
        ref={pseudoRowsRef}
      >
        <div
          className="wx-jlbQoHOz wx-stuck"
          style={{
            height: ganttHeight,
            width: innerWidth,
          }}
        >
          <div tabIndex={0} className="wx-jlbQoHOz wx-layout" ref={layoutRef}>
            {rColumns.length ? (
              <>
                <Grid
                  readonly={readonly}
                  fullHeight={fullHeight}
                  annotationLaneHeight={laneHeight}
                  gridActionSlot={gridActionSlot}
                  reserveTopScaleRow={reserveTopScaleRow}
                  gridActionSlotMinHeight={slotMinHeight}
                  consumerOwnsColumnWidths={consumerOwnsColumnWidths}
                  columnMinWidth={columnMinWidth}
                  columnMaxWidth={columnMaxWidth}
                  onTableAPIChange={onTableAPIChange}
                />
                <Resizer
                  containerWidth={ganttWidth}
                  maxWidth={resolvedGridMaxWidth}
                  minWidth={resolvedGridMinWidth}
                  api={api}
                />
              </>
            ) : null}

            <div className="wx-jlbQoHOz wx-content" ref={chartRef}>
              <Chart
                readonly={readonly}
                fullWidth={fullWidth}
                fullHeight={fullHeight}
                taskTemplate={taskTemplate}
                scaleCellAriaLabel={scaleCellAriaLabel}
                onScaleCellContextMenu={onScaleCellContextMenu}
                annotationLayout={annotationLayout}
                reserveTopScaleRow={reserveTopScaleRow}
                gridActionSlotMinHeight={slotMinHeight}
                onBarDragPreview={onBarDragPreview}
              />
            </div>
          </div>
        </div>
      </div>
      {/* SVAR-M4 (SVAR Production Planner): hidden, zero-height; measures
          chip widths once per label set, never per frame. Renders nothing
          when there are no annotations. */}
      <AnnotationMeasurer
        annotations={timelineAnnotations}
        onMeasured={onAnnotationsMeasured}
      />
    </div>
  );
}

export default Layout;
