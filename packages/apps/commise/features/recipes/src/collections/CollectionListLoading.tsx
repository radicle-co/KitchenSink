'use client';

/**
 * @module @commise/features-recipes — web collection-list LOADING fallback (presentational): what the list's `Suspense` renders while
 * the first page is pending.
 *
 * A busy status region captioned with its localized label, over inert skeleton rows (hidden from assistive tech). The
 * caption is not decoration: an empty `role="status"` node is zero-height (nothing for a sighted viewer, and
 * Playwright resolves it as `hidden`) AND silent, because a live region announces its CONTENT, not its `aria-label`.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { collectionMessages } from './messages.js';

export const CollectionListLoading: FC = () => {
    const { list } = useMessages(collectionMessages);

    return (
        <div role="status" aria-label={list.loadingLabel} className="flex flex-col gap-3">
            <p className="text-body-sm font-medium text-slate">{list.loadingLabel}</p>
            <div aria-hidden="true" className="flex flex-col gap-3">
                {[0, 1, 2].map((row) => (
                    <span key={row} className="h-16 animate-pulse rounded-2xl bg-pearl motion-reduce:animate-none" />
                ))}
            </div>
        </div>
    );
};
