/**
 * @module @commise/ui/refresh-notice — the shared contract for the notice a surface shows when REFRESHING data it is
 * already showing fails.
 */

/** The localized strings a {@link RefreshNoticeProps} renders; the design system carries no copy of its own. */
export interface RefreshNoticeLabels {
    /** What happened, e.g. "We couldn’t refresh your recipes." */
    readonly failed: string;
    /** The retry action's label. */
    readonly retry: string;
}

/** Props for the `RefreshNotice` leaves (web and native). */
export interface RefreshNoticeProps {
    /**
     * Whether the last refresh of data already on screen failed (TanStack's `isRefetchError`). The data stays; this
     * notice reports that it may be out of date. A read that failed with nothing loaded is the surface's own error
     * state, never this.
     */
    readonly failed: boolean;
    /** Whether a refresh is in flight (TanStack's `isRefetching`) — from the retry, a pull, or a focus refetch. */
    readonly refreshing: boolean;
    /** Refresh again. */
    readonly onRetry: () => void;
    /** The notice's strings. */
    readonly labels: RefreshNoticeLabels;
}
