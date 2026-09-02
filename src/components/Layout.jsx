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

function Layout(props) {
  // SVAR-M3 (SVAR Production Planner): plain prop pass-through, same as
  // `taskTemplate` on this same line — see `Gantt.jsx` for what it is.
  // SVAR-M4 (SVAR Production Planner): `timelineAnnotations` — see
  // `Gantt.jsx`. This component owns the annotation LAYOUT (through the hook
  // below), because the lane's height is part of the scroll/height math here.
  const {
    taskTemplate,
    scaleCellAriaLabel,
    timelineAnnotations,
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

  // SVAR-M4 (SVAR Production Planner): ONE memoised layout for the lines in
  // the chart body and the chips in the annotation lane. `laneHeight` is the
  // vertical room the lane takes from the chart body; it enters the scroll
  // height and the chart height below exactly as the scale height does.
  const { layout: annotationLayout, onMeasured: onAnnotationsMeasured } =
    useTimelineAnnotationLayout(timelineAnnotations, rScales, rCellWidth);
  const laneHeight = annotationLayout.laneHeight;

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
