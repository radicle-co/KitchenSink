'use client';

/**
 * @module @commise/features-recipes — web collection-list LOAD-ERROR fallback (presentational): what the list's error boundary renders
 * when the read failed with nothing loaded. Its retry is the boundary's reset, which refetches.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';
import type { CollectionListLoadErrorProps } from './model.js';

export const CollectionListLoadError: FC<CollectionListLoadErrorProps> = ({ onRetry }) => {
    const { list } = useMessages(collectionMessages);

    return (
        <div role="alert">
            <p>{list.errorTitle}</p>
            <button type="button" onClick={onRetry}>
                {list.retry}
            </button>
        </div>
    );
};
