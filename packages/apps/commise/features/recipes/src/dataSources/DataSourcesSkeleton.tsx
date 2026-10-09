'use client';

/**
 * @module @commise/features-recipes/dataSources — web Data sources LOADING state (presentational; design §S16).
 *
 * The read boundary's pending node: a polite status whose content is its visible caption, and three placeholder cards
 * about as tall as a five-line card, so the list does not jump when it lands. The placeholders are decorative and
 * honour `prefers-reduced-motion`. When the device is offline, the app's offline slot replaces this node rather than
 * sitting beside it (`@commise/query`'s `PendingSlot`).
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { dataSourcesMessages } from './messages.js';

/** How many placeholder cards stand in for the list. */
const PLACEHOLDER_CARDS = [0, 1, 2] as const;

/**
 * The read's pending state: the caption as a polite status, and three decorative placeholder cards.
 *
 * @returns The loading state.
 */
export const DataSourcesSkeleton: FC = () => {
    const messages = useMessages(dataSourcesMessages);

    return (
        <div className="flex flex-col gap-3">
            <p role="status" className="text-caption text-ink-muted">
                {messages.loading}
            </p>
            <div aria-hidden="true" className="flex flex-col gap-3">
                {PLACEHOLDER_CARDS.map((card) => (
                    <div
                        key={card}
                        className="h-40 animate-pulse rounded-2xl bg-surface-muted motion-reduce:animate-none"
                    />
                ))}
            </div>
        </div>
    );
};
