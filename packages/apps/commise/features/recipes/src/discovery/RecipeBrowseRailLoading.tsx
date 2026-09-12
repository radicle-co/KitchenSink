'use client';

/**
 * @module @commise/features-recipes — web browse-rail LOADING body (presentational, U7).
 *
 * What one rail's read boundary renders while that rail is pending: three decorative shimmer cards the size of a rail
 * card, under the localized label. The label is the region's CONTENT, not only its `aria-label`: the cards are all
 * `aria-hidden`, and a live region announces its content.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { discoveryMessages } from './messages.js';

export const RecipeBrowseRailLoading: FC = () => {
    const discovery = useMessages(discoveryMessages);

    return (
        <div role="status" aria-label={discovery.loadingLabel} className="flex flex-col gap-2">
            <p className="text-body-sm text-slate">{discovery.loadingLabel}</p>
            <div aria-hidden="true" className="flex gap-4">
                {[0, 1, 2].map((card) => (
                    <span
                        key={card}
                        className="h-56 w-64 shrink-0 animate-pulse rounded-xl bg-mist/20 motion-reduce:animate-none"
                    />
                ))}
            </div>
        </div>
    );
};
