'use client';

/**
 * @module @commise/features-recipes — web browse-rail LOADING body (presentational, U7).
 *
 * What one rail's read boundary renders while that rail is pending: three decorative shimmer cards the size of a rail
 * card, under the localized label. The label is the region's CONTENT, not only its `aria-label`: the cards are all
 * `aria-hidden`, and a live region announces its content. The cards sit in the loaded rail's own {@link RailTrack}, so
 * the pending strip scrolls inside itself exactly as the loaded one does.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { discoveryMessages } from './messages.js';
import { RailTrack } from './RailTrack.js';

export const RecipeBrowseRailLoading: FC = () => {
    const discovery = useMessages(discoveryMessages);

    return (
        <div role="status" aria-label={discovery.loadingLabel} className="flex flex-col gap-2">
            <p className="text-body-sm text-slate">{discovery.loadingLabel}</p>
            <RailTrack decorative>
                {[0, 1, 2].map((card) => (
                    <li
                        key={card}
                        className="h-56 w-64 shrink-0 animate-pulse rounded-xl bg-mist/20 motion-reduce:animate-none"
                    />
                ))}
            </RailTrack>
        </div>
    );
};
