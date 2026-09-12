'use client';

/**
 * @module @commise/features-recipes — web collection-list RESULTS (presentational): what renders inside the list's suspense boundary
 * once the read has settled.
 *
 * The refresh notice for a failed refresh of the rows on screen, then the empty state or the rows, then the
 * server-paged `[Load more]` control (W5/C7) when `hasMore`, mirroring the discovery list's S4 load-more contract. It
 * fetches nothing; the composing container wires the settled read (`useSuspenseInfiniteQuery` over
 * `collectionQueries(client).listInfinite()`) and navigation to these props.
 */
import { LoadMoreControl } from '@commise/ui/load-more';
import { RefreshNotice } from '@commise/ui/refresh-notice';
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';
import type { CollectionListResultsProps } from './model.js';

export const CollectionListResults: FC<CollectionListResultsProps> = ({
    collections,
    onSelect,
    loadMore,
    refreshNotice,
}) => {
    const { list } = useMessages(collectionMessages);

    return (
        <>
            {refreshNotice !== undefined && (
                <RefreshNotice
                    failed={refreshNotice.failed}
                    refreshing={refreshNotice.refreshing}
                    onRetry={refreshNotice.onRetry}
                    labels={{ failed: list.refreshError, retry: list.retry }}
                />
            )}
            {collections.length === 0 ? (
                <div>
                    <p>{list.emptyTitle}</p>
                    <p>{list.emptyBody}</p>
                </div>
            ) : (
                <div className="flex flex-col gap-4">
                    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {collections.map((collection) => (
                            <li key={collection.id} className="group">
                                <button
                                    type="button"
                                    onClick={() => onSelect(collection.id)}
                                    aria-label={collection.name}
                                    className="flex w-full flex-col gap-1 rounded-2xl bg-card p-5 text-left shadow-sm ring-1 ring-border transition hover:-translate-y-0.5 hover:shadow-md"
                                >
                                    {/* `group-hover:text-ocean-dark`, not seafoam: at 20px/600 this name is NOT
                                        WCAG "large text" (which needs ≥18.66px BOLD), so the 4.5:1 body floor
                                        governs the hovered state too — seafoam scored 4.02:1, i.e. pointing at a
                                        card made its own title harder to read. */}
                                    <span className="font-display text-heading-md font-semibold text-charcoal transition-colors group-hover:text-ocean-dark">
                                        {collection.name}
                                    </span>
                                    {collection.description !== undefined && collection.description.length > 0 && (
                                        <span className="text-body-sm text-slate">{collection.description}</span>
                                    )}
                                </button>
                            </li>
                        ))}
                    </ul>
                    {/* W5/C7 — server-paged "Load more" (no infinite scroll); vanishes once the last page loads. */}
                    {loadMore === undefined ? null : (
                        <LoadMoreControl
                            {...loadMore}
                            labels={{
                                loadMore: list.loadMore,
                                loadingMore: list.loadingMore,
                                retry: list.retry,
                                failed: list.loadMoreError,
                            }}
                        />
                    )}
                </div>
            )}
        </>
    );
};
