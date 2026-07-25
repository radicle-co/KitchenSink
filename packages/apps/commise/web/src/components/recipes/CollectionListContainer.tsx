'use client';

/**
 * Container for the collection-list route: binds the shared, presentational `CollectionList` building block
 * to live data. It reads the caller's collections via `useCollectionsInfinite` (W5/C7 — server-paged "Load
 * more", no infinite scroll), flattens the fetched pages into the visible rows, and projects the query state
 * onto `CollectionListViewProps` (loading / error / ready, with empty derived from the loaded pages). It
 * holds no server data of its own — TanStack Query is the source of truth for the remote list; the visible
 * rows are derived from `data.pages`, and `hasNextPage`/`fetchNextPage` drive the load-more affordance.
 */
import { CollectionList } from '@commise/features-recipes';
import { toQueryStatus } from '@commise/features-core';
import { useCollectionsInfinite } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

/** Props for {@link CollectionListContainer}. */
export interface CollectionListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/**
 * The live collection-list container.
 *
 * @param props - The active locale.
 * @returns The wired {@link CollectionList}.
 */
export const CollectionListContainer: FC<CollectionListContainerProps> = ({ locale }) => {
    const router = useRouter();
    const query = useCollectionsInfinite();

    const status = toQueryStatus(query.isLoading, query.isError);
    // Derive the visible rows straight from the query cache (never copied into local state); each fetched page
    // appends to `data.pages`, so flatten them. The empty state is the view's own split on `collections.length`.
    const collections = query.data?.pages.flatMap((page) => page.data) ?? [];

    return (
        <CollectionList
            status={status}
            collections={collections}
            onSelect={(id) => router.push(`/${locale}/collections/${id}` as Route)}
            onCreate={() => router.push(`/${locale}/collections/new` as Route)}
            onRetry={() => void query.refetch()}
            loadMore={{
                hasMore: query.hasNextPage,
                loading: query.isFetchingNextPage,
                onLoadMore: () => void query.fetchNextPage(),
            }}
        />
    );
};
