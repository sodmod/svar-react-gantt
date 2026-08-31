import { Willow as CoreWillow } from '@svar-ui/react-core';
import { Willow as GridWillow } from '@svar-ui/react-grid';
import './Willow.css';

/*
 * SVAR-LOCAL-ASSETS: `fonts={false}`, deliberately, not forwarded.
 *
 * `fonts` is @svar-ui/react-core's switch for injecting <link rel=preconnect>
 * and <link rel=stylesheet href="https://cdn.svar.dev/fonts/wxi/wx-icons.css">
 * into <head>. It has to be passed to EVERY wrapper on the way down, not just
 * the core one: @svar-ui/react-grid's own theme components forward `fonts` to
 * core with a default of `true`, so a grid wrapper left alone re-adds both
 * links even when the core wrapper next to it was told not to. Measured — that
 * is exactly how the first attempt still reached the CDN. This package now ships both the web fonts (@font-face rewritten
 * by tools/planner-fonts.mjs) and the icons (SVG, inlined by
 * tools/planner-icons.mjs) inside its own stylesheet, so asking the CDN for
 * them would fetch what we already have — and fail in the offline and
 * firewalled deployments this project supports.
 *
 * The prop stays in the public types (`fonts?: boolean` in types/index.d.ts)
 * so no consumer breaks, and React still accepts it; it is simply no longer
 * read, because the fonts and icons are neither optional nor remote any more.
 * See PLANNER_FORK.md.
 */
function Willow({ children }) {
  return children ? (
    <CoreWillow fonts={false}>
      <GridWillow fonts={false}>{children}</GridWillow>
    </CoreWillow>
  ) : (
    <>
      <GridWillow fonts={false} />
      <CoreWillow fonts={false} />
    </>
  );
}

export default Willow;
