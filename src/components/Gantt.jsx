import {
  forwardRef,
  useEffect,
  useMemo,
  useRef,
  useImperativeHandle,
  useState,
  useContext,
  useCallback,
} from 'react';

// core widgets lib
import { context } from '@svar-ui/react-core';

// locales
import { locale as l } from '@svar-ui/lib-dom';
import { en } from '@svar-ui/gantt-locales';
import { en as coreEn } from '@svar-ui/core-locales';

// stores
import { EventBusRouter } from '@svar-ui/lib-state';
import {
  DataStore,
  getAdder,
  getDefaultColumns,
  getDefaultGridWidth,
  defaultTaskTypes,
  getUnitStart,
  normalizeZoom,
} from '@svar-ui/gantt-store';

// context
import StoreContext from '../context';

// store factory
import { writable } from '@svar-ui/lib-react';

// ui
import Layout from './Layout.jsx';

// helpers
import {
  prepareScales,
  prepareFormats,
  prepareColumns,
  prepareZoom,
} from '../helpers/prepareConfig.js';

const camelize = (s) =>
  s
    .split('-')
    .map((part) => (part ? part.charAt(0).toUpperCase() + part.slice(1) : ''))
    .join('');

const defaultScales = [
  { unit: 'month', step: 1, format: '%F %Y' },
  { unit: 'day', step: 1, format: '%j' },
];

const EMPTY_ARRAY = [];
const DEFAULT_SCHEDULE = { type: 'forward' };
const ROLLUPS_CLOSEST = { type: 'closest' };

const COMPACT_WIDTH = 650;

/*
 * SVAR-M31 (SVAR Production Planner): the date under the CENTRE of the chart's
 * own viewport, and the scroll offset that puts a date back there.
 *
 * ## Why this lives in the package
 *
 * Because the package owns the date <-> pixel projection, and nothing outside
 * it can ask this question. `@svar-ui/gantt-store` publishes `_scaleDate` — the
 * date under the scroll position — but computes it from the CLAMPED scroll
 * value, so a consumer can only ever learn the dates of pixels in
 * `[0, scaleWidth - chartWidth]`. The centre of the viewport is at
 * `scrollLeft + chartWidth / 2`, which is past that ceiling for the last half
 * a screen of any timeline and for the WHOLE of a timeline that fits its
 * window — measured on the Planner's own product: at a month scale the entire
 * seven-month plan is 854 px against an 848 px chart, so every pixel a
 * consumer could ask about is the first six.
 *
 * The two expressions below are the store's own, used the way the store uses
 * them — `_scales.diff` is the public differ the store's `scroll-chart` action
 * applies to a requested date, and `getUnitStart`/`getAdder` are public
 * exports of the same package. Nothing is re-derived and no calendar rule is
 * invented here: this is arithmetic over the scale the store has already
 * built.
 *
 * BOUNDARY: `dateAtChartCentre` reads the same `lengthUnitWidth / 24` hour
 * quantum the store's own pixel -> date helper uses, because that helper is
 * private to the store. If a future store version changes that quantum, this
 * follows it only by being edited. It is stated here rather than left implicit.
 */
function dateAtChartCentre(state) {
  const { _scales: scales, _start: start, _weekStart: weekStart } = state;
  const chartWidth = state._chartWidth;
  const scrollLeft = state.scrollLeft;
  if (!scales || !chartWidth || !(chartWidth > 0)) return null;
  if (!Number.isFinite(scrollLeft)) return null;
  const perHour =
    scales.lengthUnit === 'day'
      ? scales.lengthUnitWidth / 24
      : scales.lengthUnitWidth;
  if (!(perHour > 0)) return null;
  const centre = scrollLeft + chartWidth / 2;
  return getAdder('hour')(
    getUnitStart(scales.minUnit, start, weekStart),
    Math.floor(centre / perHour),
  );
}

function chartScrollPuttingDateAtCentre(state, date) {
  const { _scales: scales, _start: start } = state;
  const chartWidth = state._chartWidth;
  if (!scales || !chartWidth || !(chartWidth > 0)) return null;
  const x = Math.round(scales.diff(date, start, 'hour') * state.cellWidth);
  if (!Number.isFinite(x)) return null;
  return Math.round(x - chartWidth / 2);
}

const Gantt = forwardRef(function Gantt(
  {
    taskTemplate = null,
    markers = EMPTY_ARRAY,
    taskTypes = defaultTaskTypes,
    tasks = EMPTY_ARRAY,
    selected = EMPTY_ARRAY,
    activeTask = null,
    links = EMPTY_ARRAY,
    resources = null,
    assignments = EMPTY_ARRAY,
    scales = defaultScales,
    columns = null,
    start = null,
    end = null,
    lengthUnit = 'day',
    durationUnit = 'day',
    cellWidth = 100,
    cellHeight = 38,
    scaleHeight = 36,
    gridWidth = null,
    displayMode = 'all',
    readonly = false,
    /*
     * SVAR-M30 (SVAR Production Planner): new optional prop, purely additive.
     *
     * Withholds the DIRECT BAR GESTURES and the affordances that advertise
     * them, and nothing else:
     *
     * ```text
     * withheld   bar move, both resize edges, a container bar's own date
     *            drag, milestone drag, the progress-handle drag, and starting
     *            a link from a bar edge
     * withheld   their affordances: the col-resize cursor, the progress
     *            handle, the link-creation handles
     * kept       double click (the editor), selection, link selection, the
     *            grid's row reorder, its add-task column, its column resize,
     *            the splitter, scrolling and every read-only presentation
     *            (the progress FILL included)
     * ```
     *
     * It is the narrow half of what `readonly` already meant. `readonly` is a
     * whole-widget mode and takes the double click, the row reorder and the
     * add-task column with it; a consumer that wants an OVERVIEW — look, read,
     * select, open the editor, but do not drag the bars — could not say so
     * with it.
     *
     * This package is told nothing about WHY. It does not know what a scale
     * mode is, has no notion of month/week/day beyond the units it draws, and
     * asks no question about dates: the consumer decides when the flag is on.
     *
     * `false` by default: without it every gesture behaves exactly as before.
     */
    barGesturesDisabled = false,
    cellBorders = 'full',
    zoom = false,
    baselines = false,
    rollups = false,
    highlightTime = null,
    // SVAR-M3 (SVAR Production Planner): new optional prop, purely additive.
    //
    // A generic accessible-name seam for scale cells (month/day/week/... —
    // whatever `scales` renders), modelled on `highlightTime` immediately
    // above: a plain function prop, called per cell with the same
    // `(date, unit)` this renderer already reads off the cell, undefined by
    // default so nothing changes for a consumer that does not pass it. This
    // component has no dictionary, no working-day/date-business logic and no
    // notion of language — it only forwards whatever string the caller's
    // function returns to the DOM as that cell's `aria-label`. See
    // `src/components/chart/TimeScale.jsx` for where it is applied.
    scaleCellAriaLabel = null,
    // SVAR-M28 (SVAR Production Planner): new optional prop, purely additive.
    //
    // A generic right-click seam for scale cells, the interaction twin of
    // `scaleCellAriaLabel` just above and threaded down the same path. When a
    // `contextmenu` event reaches a rendered scale cell — any row, any unit —
    // the renderer calls `onScaleCellContextMenu({ event, date, unit })` with
    // the event as it arrived and the SAME two values `highlightTime` and
    // `scaleCellAriaLabel` already read off that cell. One argument, like
    // every other `on*` prop of this component, because the public type gives
    // every `on*` name a one-argument signature. That is the whole of it:
    // WHICH cell the pointer hit is decided by the DOM the renderer drew (each
    // cell handles its own event), so no pixel-to-date arithmetic exists
    // anywhere in this seam.
    //
    // The renderer decides nothing else. It does not call `preventDefault`,
    // open a menu, filter by unit, or know what a date means to the consumer:
    // whether a click on this cell does anything at all is the consumer's
    // question. It never enters the store. `null` by default: without it no
    // cell has a handler and the header behaves exactly as before.
    onScaleCellContextMenu = null,
    // SVAR-M4 (SVAR Production Planner): new optional prop, purely additive.
    // Timeline annotations — a vertical line at a date plus a labelled chip in
    // an annotation lane under the scale rows. See
    // `src/components/chart/annotations/` for what is drawn and what this
    // component deliberately does not know. An ordinary React prop threaded
    // down the same path as `taskTemplate`; it never enters the store.
    timelineAnnotations = EMPTY_ARRAY,
    // SVAR-M5 (SVAR Production Planner): new optional prop, purely additive.
    // Called on every accepted pointer step of a bar drag with
    // `{ id, dx, diff, referenceStart, inProgress: true }`, and once with
    // `inProgress: false` when the gesture ends — `dx` the pixels the bar has
    // travelled, `diff` those pixels as whole scale units by the same
    // expression that produces the committing `update-task` `diff`, and
    // `referenceStart` the bar's pre-gesture date. It reports; it decides
    // nothing. A consumer that owns dates can answer with a `previewDate` on
    // the annotation that follows the bar, and the marker then travels with
    // the bar instead of waiting on the drop. `null` by default: without it
    // nothing in this component behaves differently.
    onTimelineDragPreview = null,
    // SVAR-M12 (SVAR Production Planner): new optional prop, purely additive.
    //
    // Consumer-owned content rendered in the blank band the LEFT grid already
    // reserves above its column headers — the grid-side counterpart of the
    // marker lane (SVAR-M6/SVAR-M8). It is a plain React node, threaded down
    // the same path as `taskTemplate`; it never enters the store.
    //
    // The band is bottom-aligned, so the content stays directly on top of the
    // column titles and extra room from a taller marker lane opens above it.
    // When the consumer passes a slot the band is reserved even with no
    // marker lane at all, so the content cannot vanish with the data.
    //
    // This renderer does not know what the content is. It holds no action, no
    // availability rule, no selection, no history, no hierarchy rule, no
    // working-day arithmetic and no notion of language: it renders the node in
    // a place it already owns, and nothing else. `null` by default — without
    // it the header and the grid are byte-for-byte what they were.
    gridActionSlot = null,
    // SVAR-M17 (SVAR Production Planner): new optional prop, purely additive.
    //
    // The minimum total height, in px, the content of `gridActionSlot` needs
    // the band it lives in to have.
    //
    // SVAR-M12 guarantees that band EXISTS whatever the data does; it does not
    // guarantee the band is big enough. Its natural height is the top scale
    // row plus the marker lane, and the lane's height is decided by the
    // consumer's own annotations: a project whose visible range happens to
    // carry none leaves the band at the top scale row alone. Persistent
    // controls that fit comfortably with one marker row on screen are then
    // squeezed into whatever is left, which is a trap of exactly the kind
    // SVAR-M12 existed to close and closed only halfway.
    //
    // So a consumer may say how much room its own content needs. When the
    // natural band is already at least that tall — the ordinary case, with one
    // or more marker rows — this changes NOTHING, not a pixel; when it is not,
    // the renderer adds one blank reserve band of exactly the shortfall,
    // between the top scale row and the marker lane, on both halves of the
    // surface at once.
    //
    // PER CONSUMER, never a global floor: it applies only when this consumer
    // also passed a `gridActionSlot`, and a surface that passes no minimum
    // renders byte-for-byte what it rendered before. The renderer still knows
    // nothing about the content — this is a number of pixels, not a hint about
    // what is in the slot, and nothing here measures the consumer's DOM.
    gridActionSlotMinHeight = null,
    // SVAR-M18 (SVAR Production Planner): the consumer, not this renderer,
    // owns what each column's width IS.
    //
    // Two renderer behaviours make that impossible by default, and this prop
    // turns off both together because they are one decision:
    //
    //   1. a finished column resize is reported once, at mouse-up. A consumer
    //      that owns the widths cannot follow the gesture, so the width it
    //      holds and the width on screen disagree for the whole drag;
    //   2. the grid keeps the pane's width fixed and hands the `flexgrow` of a
    //      resized column to the widest OTHER column, so that something inside
    //      the pane absorbs the change. Widening one column therefore narrows
    //      a different one, which is a width the user never asked to change.
    //
    // With it on: every accepted step of a column resize is reported through
    // `set-columns`, and no column is ever given another column's `flexgrow`.
    // The consumer decides what the widths become and what the pane's own
    // width becomes, and hands both back through `columns` and `gridWidth`.
    //
    // The renderer stores no preference and learns nothing about why a width
    // is what it is. Omitted (the default), every surface behaves exactly as
    // it did before, byte for byte.
    consumerOwnsColumnWidths = false,
    // SVAR-M20 (SVAR Production Planner): `columnMinWidth` — the narrowest a
    // column may be made BY THE GESTURE, declared by the consumer.
    //
    // This grid has always had a floor of its own, 17 px, applied by the store
    // when it writes the new width. That is a floor against a column vanishing,
    // not a product decision, and a consumer that owns the widths necessarily
    // has its own: 17 px is a sliver no user can grab again. Without a way to
    // say so, the consumer could only clamp AFTERWARDS — and then the width the
    // renderer showed during the gesture and the width that was stored were
    // two different numbers, so the column jumped the next time anything
    // rebuilt it.
    //
    // The renderer is told the number and nothing else: not what a column is,
    // not why the number is what it is, not what it should do with a width it
    // has already accepted. Omitted (the default), the store's own 17 px floor
    // is the only one, exactly as before.
    columnMinWidth = 0,
    /*
     * SVAR-M26 (SVAR Production Planner): `columnMaxWidth` — the widest ONE
     * column may be made BY THE GESTURE, declared by the consumer.
     *
     * The mirror of `columnMinWidth` above, and it exists for the same reason
     * that one does: a consumer that owns the widths has a maximum of its own,
     * and clamping only afterwards means the width shown while dragging and
     * the width stored are two different numbers. Here that is worse than a
     * jump — a model that refuses the new width is a model that did not
     * change, so the consumer cannot even tell the gesture to stop, and the
     * column keeps growing past a number the consumer has already declined.
     *
     * Omitted (the default), nothing is clamped, exactly as before.
     */
    columnMaxWidth = 0,
    /*
     * SVAR-M25 (SVAR Production Planner): `gridMaxWidth` — the widest the grid
     * pane may be made BY THE SPLITTER GESTURE, and `onGridWidthLimit` — what
     * this component's own geometry allows, reported back so the consumer can
     * compose the two into the one ceiling it then declares here.
     *
     * The pair exists because neither side can answer alone: only the consumer
     * knows how wide its columns may be, and only this component knows how
     * wide it is. A COLUMN gesture is not bounded by it (R6): a consumer whose
     * columns need more room than the pane has gets a grid that scrolls.
     * Omitted, both gestures behave exactly as they did.
     */
    gridMaxWidth = 0,
    /*
     * SVAR-M25 (R5): `gridMinWidth` — the narrowest the consumer will let the
     * splitter gesture make the pane. Same pair, the other side: past the
     * grid's own collapse threshold this component disables the splitter
     * entirely, so a drag that goes there leaves a boundary the user can see
     * and cannot take hold of.
     */
    gridMinWidth = 0,
    onGridWidthLimit = null,
    init = null,
    autoScale = true,
    unscheduledTasks = false,
    criticalPath = null,
    schedule = DEFAULT_SCHEDULE,
    projectStart = null,
    projectEnd = null,
    calendar = null,
    calendars = EMPTY_ARRAY,
    undo = false,
    splitTasks = false,
    summary = null,
    slack = false,
    groupBy = null,
    wbs = false,
    ...restProps
  },
  ref,
) {
  // keep latest rest props for event routing
  const restPropsRef = useRef();
  restPropsRef.current = restProps;

  // init stores
  const dataStore = useMemo(() => new DataStore(writable), []);

  // locale and formats
  // uses same logic as the Locale component
  const words = useMemo(() => ({ ...coreEn, ...en }), []);
  const i18nCtx = useContext(context.i18n);
  const locale = useMemo(() => {
    if (!i18nCtx) return l(words);
    return i18nCtx.extend(words, true);
  }, [i18nCtx, words]);

  // prepare configuration objects
  const lCalendar = useMemo(() => locale.getRaw().calendar, [locale]);

  // default column set (incl. auto-added resources/wbs columns) drives the
  // default grid width when none is provided by the user
  const defaultGridColumns = useMemo(
    () => getDefaultColumns({ resources: !!resources, wbs }),
    [resources, wbs],
  );
  const resolvedGridWidth = useMemo(
    () => gridWidth ?? getDefaultGridWidth(defaultGridColumns),
    [gridWidth, defaultGridColumns],
  );

  const normalizedConfig = useMemo(() => {
    let config = {
      zoom: prepareZoom(zoom, lCalendar),
      scales: prepareScales(scales, lCalendar),
      columns: prepareColumns(columns ?? defaultGridColumns, lCalendar),
      links,
      cellWidth,
    };
    if (config.zoom) {
      config = {
        ...config,
        ...normalizeZoom(
          config.zoom,
          prepareFormats(lCalendar, locale.getGroup('gantt')),
          config.scales,
          cellWidth,
        ),
      };
    }
    return config;
  }, [
    zoom,
    scales,
    columns,
    defaultGridColumns,
    links,
    cellWidth,
    lCalendar,
    locale,
  ]);

  const firstInRoute = useMemo(() => dataStore.in, [dataStore]);

  const lastInRouteRef = useRef(null);
  if (lastInRouteRef.current === null) {
    lastInRouteRef.current = new EventBusRouter((a, b) => {
      const name = 'on' + camelize(a);
      if (restPropsRef.current && restPropsRef.current[name]) {
        restPropsRef.current[name](b);
      }
    });
    firstInRoute.setNext(lastInRouteRef.current);
  }

  // two-way binding for tableAPI
  const [tableAPI, setTableAPI] = useState(null);
  const tableAPIRef = useRef(null);
  tableAPIRef.current = tableAPI;

  // compact mode (only changes when width crosses COMPACT_WIDTH)
  const [compactMode, setCompactMode] = useState(false);
  const onGanttWidthChange = useCallback((width) => {
    const next = width != null && width <= COMPACT_WIDTH;
    setCompactMode((prev) => (prev === next ? prev : next));
  }, []);

  // public API
  const api = useMemo(
    () => ({
      getState: dataStore.getState.bind(dataStore),
      getReactiveState: dataStore.getReactive.bind(dataStore),
      getStores: () => ({ data: dataStore }),
      exec: firstInRoute.exec,
      setNext: (ev) => {
        lastInRouteRef.current = lastInRouteRef.current.setNext(ev);
        return lastInRouteRef.current;
      },
      intercept: firstInRoute.intercept.bind(firstInRoute),
      on: firstInRoute.on.bind(firstInRoute),
      detach: firstInRoute.detach.bind(firstInRoute),
      getTask: (id) => dataStore.getTask(id),
      getResource: (id) => dataStore.getResource(id),
      serialize: (config) => dataStore.serialize(config),
      getTable: (waitRender) =>
        waitRender
          ? new Promise((res) => setTimeout(() => res(tableAPIRef.current), 1))
          : tableAPIRef.current,
      getHistory: () => dataStore.getHistory(),
      getCalendar: (id) => dataStore.getCalendar(id),
      getTaskCalendar: (task) => dataStore.getTaskCalendar(task),
      getResourceCalendar: (resource) =>
        dataStore.getResourceCalendar(resource),
      getTaskResources: (id) => dataStore.getTaskResources(id),
      getResourceTasks: (id) => dataStore.getResourceTasks(id),
    }),
    [dataStore, firstInRoute],
  );

  // common API available in components
  const storeApi = useMemo(
    () => ({
      getReactiveState: dataStore.getReactive.bind(dataStore),
      getState: dataStore.getState.bind(dataStore),
      exec: firstInRoute.exec.bind(firstInRoute),
      getTask: dataStore.getTask.bind(dataStore),
      getTaskCalendar: dataStore.getTaskCalendar.bind(dataStore),
      getResourceCalendar: dataStore.getResourceCalendar.bind(dataStore),
      getCalendar: dataStore.getCalendar.bind(dataStore),
      getTaskResources: dataStore.getTaskResources.bind(dataStore),
      getHistory: dataStore.getHistory.bind(dataStore),
    }),
    [dataStore, firstInRoute],
  );

  // expose API via ref
  useImperativeHandle(
    ref,
    () => ({
      ...api,
    }),
    [api],
  );

  const rollupsConfig = useMemo(
    () => (rollups === true ? ROLLUPS_CLOSEST : rollups),
    [rollups],
  );

  const storeConfig = useMemo(
    () => ({
      tasks,
      links: normalizedConfig.links,
      resources,
      assignments,
      start,
      columns: normalizedConfig.columns,
      end,
      lengthUnit,
      cellWidth: normalizedConfig.cellWidth,
      cellHeight,
      scaleHeight,
      scales: normalizedConfig.scales,
      taskTypes,
      zoom: normalizedConfig.zoom,
      selected,
      activeTask,
      baselines,
      rollups: rollupsConfig,
      autoScale,
      unscheduledTasks,
      markers,
      durationUnit,
      criticalPath,
      schedule,
      projectStart,
      projectEnd,
      calendar,
      calendars,
      slack,
      undo,
      _weekStart: lCalendar.weekStart,
      splitTasks,
      summary,
      groupBy,
      highlightTime,
      wbs,
      displayMode,
      gridWidth: resolvedGridWidth,
      cellBorders,
      _compactMode: compactMode,
    }),
    [
      tasks,
      normalizedConfig,
      resources,
      assignments,
      start,
      end,
      lengthUnit,
      cellHeight,
      scaleHeight,
      taskTypes,
      selected,
      activeTask,
      baselines,
      rollupsConfig,
      autoScale,
      unscheduledTasks,
      markers,
      durationUnit,
      criticalPath,
      schedule,
      projectStart,
      projectEnd,
      calendar,
      calendars,
      slack,
      undo,
      lCalendar,
      splitTasks,
      summary,
      groupBy,
      highlightTime,
      wbs,
      displayMode,
      resolvedGridWidth,
      cellBorders,
      compactMode,
    ],
  );

  const initOnceRef = useRef(0);
  /*
   * SVAR-M31 (SVAR Production Planner): the scale configuration this component
   * last initialized the store with.
   *
   * Compared by VALUE against the next one so the re-centring below happens on
   * a scale change and on nothing else. `storeConfig` is rebuilt whenever ANY
   * input changes — a task edit, a selection, a column width — and re-centring
   * on those would move the chart under a user who only renamed something.
   */
  const lastScaleRef = useRef(null);
  useEffect(() => {
    const scale = {
      scales: normalizedConfig.scales,
      cellWidth: normalizedConfig.cellWidth,
      lengthUnit,
    };
    const previous = lastScaleRef.current;
    lastScaleRef.current = scale;

    if (!initOnceRef.current) {
      if (init) init(api);
    } else {
      /*
       * SVAR-M31: a scale change keeps the date at the centre of the viewport,
       * instead of keeping the pixel.
       *
       * Upstream keeps `scrollLeft` across a store re-initialization, so
       * halving or doubling the cell width leaves the same PIXEL on screen and
       * therefore a different DAY: measured on the Planner, doubling the day
       * width from 34 to 68 moved the visible window from 25% of the plan to
       * 12.5% and took the task that had been in the middle of the screen off
       * it entirely. The date under the middle of the chart is what a reader is
       * actually looking at, so that is what survives.
       *
       * Both halves are here, around the one line that changes the scale, so
       * the "before" value is read while the old scale is still live and the
       * "after" is written once the new one is in place — no frame is rendered
       * in between, so nothing flickers. A null answer (no chart width yet, a
       * scale that cannot say) simply skips: then upstream's own behaviour is
       * what happens, exactly as before.
       */
      const scaleChanged =
        previous === null ||
        previous.scales !== scale.scales ||
        previous.cellWidth !== scale.cellWidth ||
        previous.lengthUnit !== scale.lengthUnit;
      const centre = scaleChanged
        ? dateAtChartCentre(dataStore.getState())
        : null;

      dataStore.init(storeConfig);

      if (centre) {
        const left = chartScrollPuttingDateAtCentre(
          dataStore.getState(),
          centre,
        );
        // The store clamps it to its own travel, which is what should happen
        // at either end of the timeline: a date half a screen from the end
        // cannot be centred, and pinning to the end is the honest answer.
        if (left !== null) firstInRoute.exec('scroll-chart', { left });
      }
    }
    initOnceRef.current++;
  }, [
    api,
    init,
    storeConfig,
    dataStore,
    firstInRoute,
    normalizedConfig,
    lengthUnit,
  ]);

  if (initOnceRef.current === 0) {
    dataStore.init(storeConfig);
  }

  return (
    <context.i18n.Provider value={locale}>
      <StoreContext.Provider value={storeApi}>
        <Layout
          taskTemplate={taskTemplate}
          scaleCellAriaLabel={scaleCellAriaLabel}
          onScaleCellContextMenu={onScaleCellContextMenu}
          timelineAnnotations={timelineAnnotations}
          onTimelineDragPreview={onTimelineDragPreview}
          gridActionSlot={gridActionSlot}
          gridActionSlotMinHeight={gridActionSlotMinHeight}
          consumerOwnsColumnWidths={consumerOwnsColumnWidths}
          columnMinWidth={columnMinWidth}
          columnMaxWidth={columnMaxWidth}
          gridMaxWidth={gridMaxWidth}
          gridMinWidth={gridMinWidth}
          onGridWidthLimit={onGridWidthLimit}
          readonly={readonly}
          barGesturesDisabled={barGesturesDisabled}
          onTableAPIChange={setTableAPI}
          onGanttWidthChange={onGanttWidthChange}
        />
      </StoreContext.Provider>
    </context.i18n.Provider>
  );
});

export default Gantt;
