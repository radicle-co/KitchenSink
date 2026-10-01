'use client';

/**
 * Container for the collection-list route (orchestration): the shared collection-list FRAME around a suspense read of
 * the viewer's collections.
 *
 * The frame (heading + create) sits outside the read boundary, so a pending or failed read swaps only what is under
 * the header. `Suspense` renders `CollectionListLoading`, the error boundary renders `CollectionListLoadError` (its
 * retry refetches), and once settled the RESULTS render the rows, a notice for a failed refresh of them, and the
 * server-paged load-more control. TanStack Query is the source of truth; the visible rows are derived from its pages.
 *
 * `/collections` is server-prefetched, so the boundary is `ClientQueryBoundary` with the prefetched key: a successful
 * prefetch ships the rows in the server HTML, a failed one ships the loading state and the browser reads after
 * hydration (B19). A retry from the refresh notice that succeeds moves focus to the frame's heading; the notice is
 * inside the boundary and the heading outside it, so the recovery crosses as a `useRecoverySignal` counter.
 *
 * @pattern Layout slot — the persistent frame around a Suspense read boundary, with the recovery counter lifted to the
 *     frame's side
 */
import {
    CollectionListFrame,
    CollectionListLoadError,
    CollectionListLoading,
    CollectionListResults,
} from '@commise/features-recipes';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { collectionQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import type { FC } from 'react';

import { ClientQueryBoundary } from '@/components/app/ClientQueryBoundary';

/** Props for {@link CollectionListContainer}. */
export interface CollectionListContainerProps {
    /** The active route locale, used to build locale-prefixed navigation targets. */
    readonly locale: string;
}

/** The collections read the page prefetches and the results render. */
type CollectionListRead = ReturnType<ReturnType<typeof collectionQueries>['listInfinite']>;

/**
 * The live collection-list container.
 *
 * @param props - The active locale.
 * @returns The frame around the read boundary.
 */
export const CollectionListContainer: FC<CollectionListContainerProps> = ({ locale }) => {
    const router = useRouter();
    const client = useRecipeServiceClient();
    // Built ONCE and handed to both sides, so the key the boundary checks for a prefetch and the read it gates can never
    // drift apart.
    const read = collectionQueries(client).listInfinite();
    const recovery = useRecoverySignal();

    return (
        <CollectionListFrame
            onCreate={() => router.push(`/${locale}/collections/new` as Route)}
            headingFocusSignal={recovery.signal}
        >
            <ClientQueryBoundary
                prefetchedKeys={[read.queryKey]}
                loading={<CollectionListLoading />}
                renderError={({ resetErrorBoundary }) => <CollectionListLoadError onRetry={resetErrorBoundary} />}
            >
                <SettledCollectionList
                    read={read}
                    onSelect={(id) => router.push(`/${locale}/collections/${id}` as Route)}
                    onRecovered={recovery.onRecovered}
                />
            </ClientQueryBoundary>
        </CollectionListFrame>
    );
};

/** Props for {@link SettledCollectionList}. */
interface SettledCollectionListProps {
    /** The collections read the boundary gates — the same options object whose key it checked. */
    readonly read: CollectionListRead;
    /** Invoked with a collection id when a row is activated. */
    readonly onSelect: (id: string) => void;
    /** Reports a retry from the refresh notice that succeeded, for the frame's heading. */
    readonly onRecovered: () => void;
}

/**
 * The list once its first page has settled.
 *
 * @param props - The read, the selection handler and the recovery report.
 * @returns The results over the loaded pages.
 */
const SettledCollectionList: FC<SettledCollectionListProps> = ({ read, onSelect, onRecovered }) => {
    const query = useSuspenseInfiniteQuery(read);
    // A failed refresh of the rows on screen is the notice's, and a failed NEXT page is the load-more control's; a
    // suspense read throws into the boundary only when it has no data at all.
    const refreshNotice = useRefreshNotice(query, { onRecovered });

    return (
        <CollectionListResults
            // Each fetched page appends to `data.pages`, so flatten them; the empty state is the view's own split.
            collections={query.data.pages.flatMap((page) => page.data)}
            onSelect={onSelect}
            refreshNotice={refreshNotice}
            loadMore={{
                hasMore: query.hasNextPage,
                loading: query.isFetchingNextPage,
                failed: query.isFetchNextPageError,
                onLoadMore: () => void query.fetchNextPage(),
            }}
        />
    );
};
