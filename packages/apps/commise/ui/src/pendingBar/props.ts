/**
 * @module @commise/ui/pending-bar — the shared contract for the bar a surface shows while results already on screen
 * are being replaced.
 */

/** Props for the `PendingBar` leaves (web and native). */
export interface PendingBarProps {
    /**
     * Whether newer results are pending while older ones stay on screen. The bar appears once this has held for
     * `PENDING_BAR_DELAY_MS`, and goes as soon as it clears.
     */
    readonly pending: boolean;
}
