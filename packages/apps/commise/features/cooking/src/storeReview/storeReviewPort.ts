/**
 * @module The store-review seam of cooking mode (plan 0011 KTD5, KTD6): what the feature needs from a platform's review
 * API, and the one product event S12 sends. Native only: web has no store to rate in (§14), so the web entry does not
 * export these.
 *
 * @pattern Port — the feature declares the need; the mobile app implements it over `expo-store-review`.
 */

/** What one request returned. `requested` means the OS call resolved, not that the OS showed anything. */
export type StoreReviewResult = 'requested' | 'unavailable' | 'failed';

/** The cooking feature's need: ask the platform for a review once. Never throws. */
export interface StoreReviewAdapter {
    request(): Promise<StoreReviewResult>;
}

/** The one product event S12 sends (po P53). Any other `track` name is dropped by the mobile analytics adapter. */
export const STORE_REVIEW_REQUESTED_EVENT = 'cooking.storeReview.requested';

export type ForwardedAnalyticsEvent = typeof STORE_REVIEW_REQUESTED_EVENT;

/**
 * Tells whether an analytics event name is the one S12 sends.
 *
 * @param event - An event name.
 * @returns True only for {@link STORE_REVIEW_REQUESTED_EVENT}.
 */
export function isForwardedAnalyticsEvent(event: string): event is ForwardedAnalyticsEvent {
    return event === STORE_REVIEW_REQUESTED_EVENT;
}
