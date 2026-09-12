/**
 * @module @commise/ui/sheet — when a downward drag on the native sheet's title row dismisses it.
 *
 * @pattern Specification — a pure predicate over a gesture's travel and velocity.
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
