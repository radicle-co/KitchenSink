/**
 * @module @commise/features-recipes/collections — what the SETTLED collection list renders from its infinite read, shared
 * by web's `SettledCollectionList` and mobile's `SettledCollections` (`docs/design/uiOverhaul/buildSpec.md` §5.1).
 *
 * The host passes the infinite query in: this package does not depend on `@commise/query`, so the failed-refresh notice
 * (`useRefreshNotice`) and the pull-to-refresh stay with the host, which reads them from the same query. Pure.
 */
import { narrowCollections } from './model.js';

/** The part of the collection list's infinite query this projection reads; the real query result satisfies it. */
export interface CollectionListQuery<T extends { readonly name: string }> {
    readonly data: { readonly pages: readonly { readonly data: readonly T[] }[] };
    readonly hasNextPage: boolean;
    readonly isFetchingNextPage: boolean;
    readonly isFetchNextPageError: boolean;
    readonly fetchNextPage: () => Promise<unknown>;
}

/** The server-paged load-more control's state. */
export interface CollectionListLoadMore {
    readonly hasMore: boolean;
    readonly loading: boolean;
    readonly failed: boolean;
    readonly onLoadMore: () => void;
}

/** What the results render. */
export interface CollectionListRows<T extends { readonly name: string }> {
    /** The loaded collections the search leaves, in order. */
    readonly collections: readonly T[];
    /** Everything loaded, before the search: the first-run and "no matches" states read it. */
    readonly total: number;
    readonly loadMore: CollectionListLoadMore;
}

/**
 * Project the loaded pages into the results' rows.
 *
 * @param query - The collection list's infinite read.
 * @param searchValue - The search text; it narrows what is loaded.
 * @returns The narrowed rows, the loaded total and the load-more control.
 */
export function collectionListRowsOf<T extends { readonly name: string }>(
    query: CollectionListQuery<T>,
    searchValue: string,
): CollectionListRows<T> {
    // Each fetched page appends to `data.pages`, so flatten them; the search narrows what is loaded.
    const loaded = query.data.pages.flatMap((page) => page.data);

    return {
        collections: narrowCollections(loaded, searchValue),
        total: loaded.length,
        loadMore: {
            hasMore: query.hasNextPage,
            loading: query.isFetchingNextPage,
            failed: query.isFetchNextPageError,
            onLoadMore: () => void query.fetchNextPage(),
        },
    };
}
