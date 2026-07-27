/**
 * @module @commise/features-recipes — web collection-list view (T071 building block).
 *
 * Controlled, presentational collection list: persistent chrome (heading + create) over a body that renders
 * one of four states — loading, error, empty, populated — derived from `status` + `collections`. The
 * populated state also renders a server-paged `[Load more]` control (W5/C7) when `hasMore`, mirroring the
 * discovery list's S4 load-more contract. It fetches nothing; the composing app wires the query layer
 * (`useCollectionsInfinite` — Task 12) and navigation to these props.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { collectionMessages } from './messages.js';
import type { CollectionListViewProps } from './model.js';

/**
 * The loading placeholder — a busy status region captioned with its localized label, over inert skeleton rows
 * (hidden from assistive tech).
 *
 * The caption is not decoration: an empty `role="status"` node is zero-height (nothing for a sighted viewer,
 * and Playwright resolves it as `hidden`) AND silent, because a live region announces its CONTENT, not its
 * `aria-label`. The rows below it are `aria-hidden`, so the caption alone announces the wait.
 */
const LoadingBody: FC<{ label: string }> = ({ label }) => (
    <div role="status" aria-label={label} className="flex flex-col gap-3">
        <p className="text-body-sm font-medium text-slate">{label}</p>
        <div aria-hidden="true" className="flex flex-col gap-3">
            {[0, 1, 2].map((row) => (
                <span key={row} className="h-16 animate-pulse rounded-2xl bg-pearl motion-reduce:animate-none" />
            ))}
        </div>
    </div>
);

export const CollectionList: FC<CollectionListViewProps> = ({
    status,
    collections,
    onSelect,
    onCreate,
    onRetry,
    loadMore,
}) => {
    const { list } = useMessages(collectionMessages);
    const hasMore = loadMore?.hasMore ?? false;
    const isFetchingNextPage = loadMore?.loading ?? false;

    let body: ReactElement;

    if (status === 'loading') {
        body = <LoadingBody label={list.loadingLabel} />;
    } else if (status === 'error') {
        body = (
            <div role="alert">
                <p>{list.errorTitle}</p>
                <button type="button" onClick={onRetry}>
                    {list.retry}
                </button>
            </div>
        );
    } else if (collections.length === 0) {
        body = (
            <div>
                <p>{list.emptyTitle}</p>
                <p>{list.emptyBody}</p>
            </div>
        );
    } else {
        body = (
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
                                <span className="font-display text-heading-md font-semibold text-charcoal transition-colors group-hover:text-seafoam">
                                    {collection.name}
                                </span>
                                {collection.description !== undefined && collection.description.length > 0 && (
                                    <span className="text-body-sm text-slate">{collection.description}</span>
                                )}
                            </button>
                        </li>
                    ))}
                </ul>
                {hasMore && (
                    // W5/C7 — server-paged "Load more" (no infinite scroll); vanishes once the last page loads.
                    <button
                        type="button"
                        onClick={() => loadMore?.onLoadMore()}
                        disabled={isFetchingNextPage}
                        aria-busy={isFetchingNextPage || undefined}
                        className="self-center rounded-full bg-pearl px-6 py-2.5 text-body-sm font-semibold text-charcoal transition hover:bg-mist/40 disabled:opacity-60"
                    >
                        {isFetchingNextPage ? list.loadingMore : list.loadMore}
                    </button>
                )}
            </div>
        );
    }

    return (
        <section aria-label={list.heading} className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
            <header className="flex items-center justify-between gap-4">
                <h1 className="font-display text-display-md font-bold text-charcoal">{list.heading}</h1>
                <button
                    type="button"
                    onClick={onCreate}
                    className="rounded-full bg-seafoam px-5 py-2.5 text-body-sm font-semibold text-white shadow-sm transition hover:bg-ocean-dark"
                >
                    {list.createCta}
                </button>
            </header>
            {body}
        </section>
    );
};
