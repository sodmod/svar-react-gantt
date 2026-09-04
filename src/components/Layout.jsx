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
import Resizer from './Resizer.jsx';
import storeContext from '../context';
import './Layout.css';
import { flushSync } from 'react-dom';
import { useTimelineAnnotationLayout } from './chart/annotations/useTimelineAnnotationLayout.js';
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
  const {
    taskTemplate,
    scaleCellAriaLabel,
    timelineAnnotations,
    onTimelineDragPreview,
    gridActionSlot,
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
  const reserveTopScaleRow = laneHeight > 0 || gridActionSlot != null;

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
    () => rScales.height + laneHeight + fullHeight + scrollSize,
    [rScales, laneHeight, fullHeight, scrollSize],
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
      rScalesHeight: rScales.height + laneHeight,
      scrollSize,
    };
  }, [ganttWidth, columnsWidth, ganttHeight, rScales, laneHeight, scrollSize]);

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
  const publishedLaneHeight = useRef(laneHeight);
  useEffect(() => {
    if (publishedLaneHeight.current === laneHeight) return;
    publishedLaneHeight.current = laneHeight;
    chartResizeHandler();
  }, [laneHeight, chartResizeHandler]);

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
                  onTableAPIChange={onTableAPIChange}
                />
                <Resizer containerWidth={ganttWidth} api={api} />
              </>
            ) : null}

            <div className="wx-jlbQoHOz wx-content" ref={chartRef}>
              <Chart
                readonly={readonly}
                fullWidth={fullWidth}
                fullHeight={fullHeight}
                taskTemplate={taskTemplate}
                scaleCellAriaLabel={scaleCellAriaLabel}
                annotationLayout={annotationLayout}
                reserveTopScaleRow={reserveTopScaleRow}
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
