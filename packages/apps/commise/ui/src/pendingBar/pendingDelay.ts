/**
 * @module @commise/ui/pending-bar — the one timing value both `PendingBar` leaves read.
 *
 * It sits in a pure module rather than beside either leaf because the component specifier resolves to
 * `PendingBar.native.tsx` on React Native, where a constant exported from the web leaf would not exist.
 */

/**
 * How long results must have been pending before the bar appears. A response inside a second needs no indicator, so
 * a fast search shows nothing but the region's busy state. The web leaf hands this to CSS as `animation-delay`; the
 * native leaf waits it out with a timer.
 */
export const PENDING_BAR_DELAY_MS = 500;
