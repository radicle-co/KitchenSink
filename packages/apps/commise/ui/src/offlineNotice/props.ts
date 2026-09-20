/**
 * @module @commise/ui/offline-notice — the shared contract for the offline READ slot.
 *
 * Shown in the content region of a screen whose read is parked while the device is offline — in place of the
 * skeleton, never beside it.
 *
 * ⛔ IT REPLACES THE PENDING NODE, AND THAT IS A CORRECTNESS DECISION rather than a visual one. The skeleton
 * it stands in for is a `role="status"` captioned with the visible string "Loading recipes". A parked read is
 * NOT loading, so augmenting would leave two statements on screen with one of them untrue, nest two status
 * regions, and keep a pulsing animation running beside a text message for the whole length of the outage
 * (SC 2.2.2). The skeleton is correct as it ships; augmenting is what would create the exposure.
 *
 * ⛔ AND IT CARRIES NO RETRY CONTROL. A parked read resumes by itself on reconnect through TanStack's
 * `retryer.continue()` — no user action, no mounted observer. A button here would claim the viewer must act
 * when they need not, and pressing it could achieve nothing a reconnect will not. Its absence is also what
 * makes WCAG 2.4.3 (Focus Order) free: there is nothing focusable to lose focus to.
 *
 * The design system carries no copy of its own — the caller passes the localized string.
 */

/** Props for the offline read slot. */
export interface OfflineReadSlotProps {
    /**
     * The localized message, from `offlineNoticeMessages.readOffline`.
     *
     * ⚠️ A complete two-sentence message, not a title: the second sentence states that the screen recovers on
     * its own, which is the only thing standing in for the absent retry control.
     */
    readonly message: string;
}
