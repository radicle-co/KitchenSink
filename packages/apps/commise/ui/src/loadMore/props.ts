/**
 * @module @commise/ui/load-more — the shared contract for the explicit "Load more" control of a server-paged list.
 */

/** The localized strings a {@link LoadMoreControlProps} renders; the design system carries no copy of its own. */
export interface LoadMoreControlLabels {
    /** The idle label. */
    readonly loadMore: string;
    /** The label while the next page is in flight. */
    readonly loadingMore: string;
    /** The label after the next page failed. */
    readonly retry: string;
    /** What happened, announced when the next page fails — e.g. "We couldn’t load more recipes." */
    readonly failed: string;
}

/** Props for the `LoadMoreControl` leaves (web and native). */
export interface LoadMoreControlProps {
    /** Whether another page exists; the control renders nothing once it does not. */
    readonly hasMore: boolean;
    /** Whether the next page is in flight. Wins over {@link failed}: a retry in flight is busy, not failed. */
    readonly loading: boolean;
    /** Whether the last attempt to load the next page failed. The pages already loaded stay on screen. */
    readonly failed: boolean;
    /** Load (or retry loading) the next page. */
    readonly onLoadMore: () => void;
    /** The control's strings. */
    readonly labels: LoadMoreControlLabels;
}
