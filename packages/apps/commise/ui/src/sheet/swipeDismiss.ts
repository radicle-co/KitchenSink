/**
 * @module @commise/ui/sheet — when a drag on the native sheet's title row moves it, and when it dismisses it.
 *
 * @pattern Specification — pure predicates over a gesture's travel and velocity.
 */

/** Travel, in dp, that dismisses the sheet whatever the speed. */
export const SWIPE_DISMISS_DISTANCE_DP = 96;

/** Downward velocity, in dp per ms, that dismisses the sheet after any travel. */
export const SWIPE_DISMISS_VELOCITY = 0.8;

/**
 * Whether a released drag dismisses the sheet. Pure.
 *
 * @param dy - The drag's total vertical travel; positive is downward.
 * @param vy - Its vertical velocity at release; positive is downward.
 * @returns `true` for a downward drag of {@link SWIPE_DISMISS_DISTANCE_DP} or a flick of
 *   {@link SWIPE_DISMISS_VELOCITY}; an upward drag never dismisses.
 */
export function isDismissingSwipe(dy: number, vy: number): boolean {
    return dy > 0 && (dy >= SWIPE_DISMISS_DISTANCE_DP || vy >= SWIPE_DISMISS_VELOCITY);
}

/**
 * Whether a drag is downward and more vertical than sideways, the only drag the sheet follows. Pure.
 *
 * @param dx - The drag's total horizontal travel.
 * @param dy - Its total vertical travel; positive is downward.
 * @returns `true` when the drag went down further than it went to either side.
 */
export function isDownwardDrag(dx: number, dy: number): boolean {
    return dy > 0 && dy > Math.abs(dx);
}
