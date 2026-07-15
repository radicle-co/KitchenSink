/**
 * @module @commise/features-recipes — web collection-list view (T071 building block).
 *
 * Controlled, presentational collection list: persistent chrome (heading + create) over a body that renders
 * one of four states — loading, error, empty, populated — derived from `status` + `collections`. It fetches
 * nothing; the composing app wires the query layer (and navigation) to these props.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC, ReactElement } from 'react';

import { collectionMessages } from './messages.js';
import type { CollectionListViewProps } from './model.js';

/** The loading placeholder — a busy status region with inert skeleton rows (hidden from assistive tech). */
const LoadingBody: FC<{ label: string }> = ({ label }) => (
    <div role="status" aria-label={label}>
        {[0, 1, 2].map((row) => (
            <span key={row} aria-hidden="true" />
        ))}
    </div>
);

export const CollectionList: FC<CollectionListViewProps> = ({ status, collections, onSelect, onCreate, onRetry }) => {
    const { list } = useMessages(collectionMessages);

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
