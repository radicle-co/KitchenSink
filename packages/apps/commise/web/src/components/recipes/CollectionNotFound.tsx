'use client';

/**
 * @module CollectionNotFound — what a collection surface renders when the collection it reads does not exist or is
 * not the viewer's to see. It offers no retry, because nothing a retry could change. Rendered by the read boundary of
 * every surface that reads ONE collection (the detail route and the rename form), which decides not-found from the
 * owning client's `isNotFoundError`.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { webMessages } from '@/i18n/messages';

/** Presentational: the collection does not exist, or is not the viewer's to see. */
export const CollectionNotFound: FC = () => {
    const { collections } = useMessages(webMessages);

    return (
        <div role="alert">
            <p>{collections.detail.notFoundTitle}</p>
        </div>
    );
};
