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
            <ul>
                {collections.map((collection) => (
                    <li key={collection.id}>
                        <button type="button" onClick={() => onSelect(collection.id)}>
                            {collection.name}
                        </button>
                        {collection.description !== undefined && collection.description.length > 0 && (
                            <p>{collection.description}</p>
                        )}
                    </li>
                ))}
            </ul>
        );
    }

    return (
        <section aria-label={list.heading}>
            <header>
                <h1>{list.heading}</h1>
                <button type="button" onClick={onCreate}>
                    {list.createCta}
                </button>
            </header>
            {body}
        </section>
    );
};
