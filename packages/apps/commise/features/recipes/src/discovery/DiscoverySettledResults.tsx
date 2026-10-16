'use client';

/**
 * @module @commise/features-recipes/discovery/DiscoverySettledResults — (orchestration) the results of a settled search: the suspense read,
 * its refresh notice and pull-to-refresh, and the pager.
 */
import { useRefreshNotice } from '@commise/query/refresh-notice';
import { useSuspenseInfiniteQuery } from '@tanstack/react-query';
import type { FC } from 'react';

import { DiscoveryResultsView, type DiscoveryResultsViewProps } from './DiscoveryResultsView.js';
import type { DiscoverySearchRead } from './discoverySearchRead.js';

/** Props for {@link DiscoverySettledResults}. */
export interface DiscoverySettledResultsProps extends Omit<
    DiscoveryResultsViewProps,
    'pages' | 'refreshNotice' | 'refresh' | 'loadMore'
> {
    /** The settled search's suspense read. */
    readonly read: DiscoverySearchRead;
    /** A retry from the refresh notice succeeded: the frame's heading takes focus, across the boundary. */
    readonly onRecovered: () => void;
}

/**
 * The results of a settled search.
 *
 * @param props - The read, the recovery hand-off, and the view's own props.
 * @returns The results view over the read's pages.
 */
export const DiscoverySettledResults: FC<DiscoverySettledResultsProps> = ({ read, onRecovered, ...results }) => {
    const search = useSuspenseInfiniteQuery(read);
    // A failed pull or background refresh is the notice's; a failed NEXT page is the load-more control's.
    const refreshNotice = useRefreshNotice(search, { onRecovered });

    return (
        <DiscoveryResultsView
            {...results}
            pages={search.data.pages}
            refreshNotice={refreshNotice}
            // Pull-to-refresh (U4/L8): the spinner tracks the in-flight refetch; pulling re-runs the search. The web
            // leaf has no such gesture and ignores it.
            refresh={{ refreshing: search.isRefetching, onRefresh: () => void search.refetch() }}
            loadMore={{
                hasMore: search.hasNextPage,
                loading: search.isFetchingNextPage,
                failed: search.isFetchNextPageError,
                onLoadMore: () => void search.fetchNextPage(),
            }}
        />
    );
};
