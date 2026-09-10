import { useContext, useEffect, useRef, useState } from 'react';
import storeContext from '../../context';
import { context } from '@svar-ui/react-core';
import { grid } from '@svar-ui/gantt-store';
import { useStore } from '@svar-ui/lib-react';

/*
 * SVAR-M22 (SVAR Production Planner): the chart lattice follows the theme it is
 * currently shown in.
 *
 * The lattice is not CSS. `grid()` draws one cell of it onto a canvas and hands
 * back a `toDataURL()` PNG, so the line colour is BAKED INTO AN IMAGE at the
 * moment the drawing happens. The colour itself is read here, once, out of the
 * live `--wx-gantt-border` custom property.
 *
 * Reading it once was correct while the only way to change theme was to render
 * a different theme wrapper, because that unmounts everything below it and this
 * component comes back with the effect running again. `SVAR-M19` removed that
 * remount on purpose — a theme is a value, not a navigation command — and this
 * was the one place in the package that depended on it. After `SVAR-M19` a
 * consumer that switched Willow -> Willow Dark kept the LIGHT lattice: measured
 * in the consuming product, the chart's day lines stayed `rgb(206, 202, 191)`
 * on a `#202020` surface where the dark theme's own token is `#454545`, which
 * is the near-white lattice Pavel's manual acceptance reported.
 *
 * The theme this subtree is under is already a context value (`SVAR-M19`
 * provides it, and so do the three wrappers). Depending on it is therefore the
 * whole fix: the effect re-reads the property when, and only when, the theme
 * actually changes, and a consumer that never changes theme runs it exactly as
 * often as before — once.
 *
 * It stays an EFFECT rather than a render-time read because the property has to
 * be read off a mounted node: the value depends on where the element sits in
 * the document, which is knowable only after it is in it.
 */

function CellGrid() {
  const api = useContext(storeContext);
  const cellWidth = useStore(api, 'cellWidth');
  const cellHeight = useStore(api, 'cellHeight');
  const cellBorders = useStore(api, 'cellBorders');
  const theme = useContext(context.theme);

  const nodeRef = useRef(null);
  const [color, setColor] = useState('#e4e4e4');

  useEffect(() => {
    if (typeof getComputedStyle !== 'undefined' && nodeRef.current) {
      const border = getComputedStyle(nodeRef.current).getPropertyValue(
        '--wx-gantt-border',
      );
      setColor(border ? border.substring(border.indexOf('#')) : '#1d1e261a');
    }
  }, [theme]);

  const style = {
    width: '100%',
    height: '100%',
    background:
      cellWidth != null && cellHeight != null
        ? `url(${grid(cellWidth, cellHeight, color, cellBorders)})`
        : undefined,
    position: 'absolute',
  };

  return <div ref={nodeRef} style={style} />;
}

export default CellGrid;
