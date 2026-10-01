/**
 * Collections list screen (mobile, T071, orchestration). The shared native collection-list FRAME (heading + create) around a suspense
 * read of the viewer's collections: `Suspense` renders `CollectionListLoading`, the error boundary renders
 * `CollectionListLoadError` (its retry refetches), and once settled the RESULTS render the flattened pages with
 * pull-to-refresh, a notice for a failed refresh of them, and the server-paged load-more control (W5/C7).
 *
 * The frame sits outside the boundary, so a pending or failed read never unmounts the heading or the create action. A
 * retry from the refresh notice that succeeds moves the screen-reader cursor to the heading; the notice is inside the
 * boundary and the heading outside it, so the recovery crosses as a `useRecoverySignal` counter.
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
import { QueryBoundary } from '@commise/query/boundary';
import { useRecoverySignal } from '@commise/query/recovery-signal';
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { collectionQueries } from '@kitchensink/recipe-service-client';
import { useRecipeServiceClient } from '@kitchensink/recipe-service-client/hooks';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { JSX } from 'react';

/** Props for {@link CollectionsScreen}. */
export interface CollectionsScreenProps {
    /** Invoked with a collection id when a row is activated. */
    readonly onSelect: (collectionId: string) => void;
    /** Invoked when the create-collection action is activated. */
    readonly onCreate: () => void;
}

/**
 * The collections list screen.
 *
 * @param props - The selection and create handlers.
 * @returns The frame around the read boundary.
 */
export function CollectionsScreen({ onSelect, onCreate }: CollectionsScreenProps): JSX.Element {
    const recovery = useRecoverySignal();

    return (
        <CollectionListFrame onCreate={onCreate} headingFocusSignal={recovery.signal}>
            <QueryBoundary
                loading={<CollectionListLoading />}
                renderError={({ resetErrorBoundary }) => <CollectionListLoadError onRetry={resetErrorBoundary} />}
            >
                <SettledCollections onSelect={onSelect} onRecovered={recovery.onRecovered} />
            </QueryBoundary>
        </CollectionListFrame>
    );
}

/**
 * The collections once the first page has settled.
 *
 * @param props - The selection handler and the recovery report for the frame's heading.
 * @returns The results over the loaded pages.
 */
function SettledCollections({
    onSelect,
    onRecovered,
}: {
    readonly onSelect: (collectionId: string) => void;
    readonly onRecovered: () => void;
}): JSX.Element {
    const client = useRecipeServiceClient();
    const query = useSuspenseInfiniteQuery(collectionQueries(client).listInfinite());
    // A failed pull or background refresh is the notice's, and a failed NEXT page is the load-more control's; a suspense
    // read throws into the boundary only when it has no data at all.
    const refreshNotice = useRefreshNotice(query, { onRecovered });

    return (
        <CollectionListResults
            collections={query.data.pages.flatMap((page) => page.data)}
            onSelect={onSelect}
            // Pull-to-refresh (U4/L8): the spinner tracks the in-flight refetch; pulling re-runs the query.
            refresh={{ refreshing: query.isRefetching, onRefresh: () => void query.refetch() }}
            refreshNotice={refreshNotice}
            loadMore={{
                hasMore: query.hasNextPage,
                loading: query.isFetchingNextPage,
                failed: query.isFetchNextPageError,
                onLoadMore: () => void query.fetchNextPage(),
            }}
        />
    );
}
