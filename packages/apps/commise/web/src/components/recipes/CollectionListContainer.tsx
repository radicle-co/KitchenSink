'use client';

/**
 * Container for the collection-list route: binds the shared, presentational `CollectionList` building block
 * to live data. It reads the caller's collections via `useCollections`, projects the query state onto
 * `CollectionListViewProps` (loading / error / ready, with empty derived from the loaded page), and wires
 * navigation + retry. It holds no server data of its own — TanStack Query is the source of truth for the
 * remote list; the visible rows are derived from it.
 */
import { CollectionList } from '@commise/features-recipes';
import type { CollectionListStatus } from '@commise/features-recipes';
import { useCollections } from '@kitchensink/recipe-service-client/hooks';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

/** Props for {@link CollectionListContainer}. */
export interface CollectionListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/** Map a TanStack Query state onto the list view's three top-level states. */
function toListStatus(isLoading: boolean, isError: boolean): CollectionListStatus {
    if (isLoading) {
        return 'loading';
    }

    if (isError) {
        return 'error';
    }

    return 'ready';
}

/**
 * The live collection-list container.
 *
 * @param props - The active locale.
 * @returns The wired {@link CollectionList}.
 */
export const CollectionListContainer: FC<CollectionListContainerProps> = ({ locale }) => {
    const router = useRouter();
    const query = useCollections();

    const status = toListStatus(query.isLoading, query.isError);
    // Derive the visible rows straight from the query cache (never copied into local state); the empty state
    // is the view's own split on `collections.length`, not a distinct status.
    const collections = query.data?.data ?? [];

    return (
        <CollectionList
            status={status}
            collections={collections}
            onSelect={(id) => router.push(`/${locale}/collections/${id}` as Route)}
            onCreate={() => router.push(`/${locale}/collections/new` as Route)}
            onRetry={() => void query.refetch()}
        />
    );
};
