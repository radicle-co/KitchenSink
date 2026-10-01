'use client';

/**
 * @module CollectionLoadError — what a collection surface renders when reading the collection fails for a reason a
 * retry may fix. Rendered by the read boundary of every surface that reads ONE collection (the detail route and the
 * rename form), whose `resetErrorBoundary` is the retry — it resets the query error, so the retry refetches.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Presentational: reading the collection failed for a reason a retry may fix. */
export const CollectionLoadError: FC<{ readonly onRetry: () => void }> = ({ onRetry }) => {
    const { collections } = useMessages(webMessages);

    return (
        <div role="alert">
            <p>{collections.detail.errorTitle}</p>
            <button type="button" onClick={onRetry}>
                {collections.detail.retry}
            </button>
        </div>
    );
};
