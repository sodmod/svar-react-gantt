import { context } from '@svar-ui/react-core';
import './Willow.css';
import './WillowDark.css';
import './Material.css';

/*
 * SVAR-M19 (SVAR Production Planner): one theme element whose IDENTITY does
 * not depend on which theme it is showing.
 *
 * ## What was wrong with choosing a wrapper
 *
 * `Willow`, `WillowDark` and `Material` are three components. A consumer that
 * lets the user change theme therefore renders a DIFFERENT component type at
 * the same position when the theme changes, and React answers that the only
 * way it can: it unmounts the old subtree and mounts a new one. Everything
 * inside is rebuilt, including this package's own store, so the chart comes
 * back scrolled to the beginning of the plan. Measured in the consuming
 * product before this modification: a chart scrolled 900 px in returned to 0,
 * and the first bar moved from x=325 to x=1225 on screen.
 *
 * That is not a theme changing a value. That is a theme being a navigation
 * command, and no consumer can opt out of it, because the choice is made by
 * the shape of the API rather than by anything the consumer does.
 *
 * ## What this renders
 *
 * Exactly what the three wrappers render, expressed once with the theme as a
 * VALUE: the theme context those wrappers provide, and the two nested theme
 * elements they produce (each wrapper nests `@svar-ui/react-core`'s around
 * `@svar-ui/react-grid`'s, and both render the same class). A consumer that
 * swaps `theme` therefore changes one context value and two class names, and
 * nothing below is remounted.
 *
 * The three wrappers stay exactly as they are, exported and unchanged. They
 * are this package's public API, every existing consumer keeps them, and they
 * are also where the grid half of each theme's stylesheet enters the bundle.
 * The three imports above are this file's own half of the same stylesheets, so
 * a page that mounts only this component still has all three themes available
 * to switch between — which is the entire point of switching by value.
 *
 * `fonts` is not a prop here. This package ships its own fonts and icons and
 * the wrappers pass `fonts={false}` down for that reason (SVAR-LOCAL-ASSETS);
 * a component that never renders core's wrapper cannot add the CDN links at
 * all, which is the same guarantee arrived at by construction.
 */

const themeValue = context.theme;

const THEME_NAMES = ['willow', 'willow-dark', 'material'];

export default function ThemeScope({ theme, children }) {
  const name = THEME_NAMES.includes(theme) ? theme : 'willow';
  const className = `wx-theme wx-${name}-theme`;

  return (
    <themeValue.Provider value={name}>
      <div className={className}>
        <div className={className}>{children}</div>
      </div>
    </themeValue.Provider>
  );
}
