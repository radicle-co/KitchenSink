/**
 * @module @commise/features-recipes/list/loadMoreOf — an infinite query's paging flags, as the load-more control's props.
 *
 * The recipe library, the collection list and discovery all page the same way, and each used to spell this projection
 * out. One definition keeps the three from disagreeing about which flag means which.
 */
import type { LoadMoreControlProps } from '@commise/ui/load-more';

/** The part of an infinite query's result this projection reads; any TanStack infinite query result satisfies it. */
export interface PagedQuery {
    /** Whether another page exists. */
    readonly hasNextPage: boolean;
    /** Whether the next page is in flight. */
    readonly isFetchingNextPage: boolean;
    /** Whether the last attempt to fetch the next page failed. */
    readonly isFetchNextPageError: boolean;
    /** Fetch the next page. */
    readonly fetchNextPage: () => Promise<unknown>;
}

/**
 * Project an infinite query onto the load-more control.
 *
 * @param query - The infinite query result.
 * @returns The control's props, less its labels.
 * @sideEffect `onLoadMore` fetches the next page.
 */
export function loadMoreOf(query: PagedQuery): Omit<LoadMoreControlProps, 'labels'> {
    return {
        hasMore: query.hasNextPage,
        loading: query.isFetchingNextPage,
        failed: query.isFetchNextPageError,
        onLoadMore: () => void query.fetchNextPage(),
    };
}
