# Phase 1 visual audit

Captured with Playwright against the built local preview. The measurements below were obtained from a manual Playwright pass against a local built preview. The seal-time harness produces its own captures in this directory; those captures were not available for this audit.

At 1440 × 900, the chassis measured x=57.59, y=259.98, 1324.80 × 428.02 px: 92.0% of viewport width and aspect ratio 3.095. The deck measured 225.72 px and the keybed 192.28 px (54.0% / 46.0% of their combined heights). Section widths measured 174.64, 249.53, 106.05, 155.95, 311.89, and 249.52 px, corresponding to the photo-corrected 14/20/8.5/12.5/25/20 proportions. There are 73 keys (43 white, 30 black) from E2 through E8. All 111 rendered panel input centers were reachable in the desktop hit test; the console reported no errors.

At 390 × 844, the chassis measured 1000 × 323.08 px inside a 390 px wide horizontal scroll container. The full instrument is available by scrolling; the document itself has no horizontal overflow. The initial layout clipped the drawbars; grouping the panel controls corrected that. The manual browser pass was performed after the correction.

Known deviations: the surface is an approximation of the photograph and does not reproduce every physical control, exact panel legend, or hardware placement. Narrow inspection requires horizontal scrolling. The measurements have not yet been checked against the seal-time harness captures. The test matrix includes a browser audio test that must be run in a browser with the source transpiled as documented; it is not part of `pnpm test`.
