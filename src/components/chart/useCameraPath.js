import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

/*
 * ADDED BY THE SVAR PRODUCTION PLANNER PROJECT (SVAR-M56).
 * NOT part of the upstream SVAR sources and not code of XB Software Sp. z o.o.
 *
 * The React side of the Pan camera path (`./cameraPath.js`).
 *
 * `Layout.jsx` creates one camera per chart and provides it here; the grid
 * and the chart attach the DOM they own to it. Two small hooks let the rest
 * of the chart consume viewport-dependent state without re-rendering on every
 * camera step:
 *
 *   useStoreValue      a store value compared by VALUE before React hears of
 *                      it. The store publishes a new `xArea` object on every
 *                      `scrollLeft` change; a component that only cares which
 *                      cells are rendered re-renders when that changes and on
 *                      no other step.
 *   useCameraPosition  the position the DOM camera shows, for overlays that
 *                      are anchored to the VIEWPORT rather than to content
 *                      (the offscreen chips). It is read through
 *                      `useSyncExternalStore`, whose updates React renders
 *                      synchronously — in the same frame as the camera write
 *                      that caused them — so a chip held against the
 *                      viewport edge never trails the content by a frame.
 */

export const CameraPathContext = createContext(null);

export function useCameraPath() {
  return useContext(CameraPathContext);
}

const ORIGIN = { left: 0, top: 0 };
const noSubscription = () => () => {};
const atOrigin = () => ORIGIN;

export function useCameraPosition(camera) {
  return useSyncExternalStore(
    camera ? camera.subscribePosition : noSubscription,
    camera ? camera.getPosition : atOrigin,
    camera ? camera.getPosition : atOrigin,
  );
}

/**
 * Like `useStore(api, key)`, but a published value that `isEqual` to the
 * last one React rendered is dropped before it reaches React at all, so no
 * render is scheduled for it.
 */
export function useStoreValue(api, key, isEqual) {
  const [value, setValue] = useState(() => api.getState()[key]);
  const lastRef = useRef(value);
  useEffect(() => {
    const writable = api.getReactiveState()[key];
    if (!writable) return undefined;
    return writable.subscribe((next) => {
      if (isEqual(lastRef.current, next)) return;
      lastRef.current = next;
      setValue(next);
    });
  }, [api, key, isEqual]);
  return value;
}
