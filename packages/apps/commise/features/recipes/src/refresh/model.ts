/**
 * @module @commise/features-recipes/refresh — the failed-refresh notice contract every surface in this package shares.
 */
import type { RefreshNoticeProps } from '@commise/ui/refresh-notice';

/**
 * The failed-refresh notice a list, rail block or detail surface renders over data it keeps showing: the
 * `RefreshNotice` facts and retry, plus `recoveries` — how many retries started from the notice succeeded. A change
 * in `recoveries` moves focus to the surface's heading, because the button the viewer pressed is gone. The leaf
 * supplies the copy.
 *
 * Its producer is `useRefreshNotice` (`@commise/query/refresh-notice`), whose `RefreshNoticeState` has the same
 * shape. The shape is stated on both sides because neither package may depend on the other's; a drift fails `tsc`
 * at every container that passes one into the other.
 *
 * ⛔ Separate from the native pull-to-refresh controls (`RecipeListRefreshControl`) on purpose: those are a gesture
 * the web leaves ignore, while this ships on both platforms, and a recovery by pulling must never move focus.
 */
export interface RefreshNoticeControl extends Omit<RefreshNoticeProps, 'labels'> {
    /** How many retries started from the notice have succeeded; a change moves focus to the heading. */
    readonly recoveries: number;
}
