'use client';

/**
 * @module CookingLoading — the web loading body.
 *
 * Nothing for the first phase, then three line-shaped blocks (28 tall, then two at 24), then the "Opening the recipe…"
 * house `LoadingNotice` under them. The same height is reserved in every phase, so nothing shifts when the recipe arrives. The phase
 * comes from the shared loading timer; this component only draws it. No shimmer, so reduced motion needs nothing.
 *
 * Presentational: props → JSX.
 */
import { LoadingNotice } from '@commise/ui/loading-notice';
import type { FC } from 'react';

import type { CookingLoadingProps } from './cookingViewProps.js';

/** The skeleton's three lines: the focus line, then two "Then" lines. */
const SKELETON_LINES = ['h-7 w-11/12', 'h-6 w-4/5', 'h-6 w-3/5'] as const;

/** The web loading body. */
export const CookingLoading: FC<CookingLoadingProps> = ({ phase, label }) => (
    <div className="flex min-h-48 flex-col gap-4 px-4 py-4">
        {phase === 'blank' ? null : (
            <div aria-hidden="true" className="flex flex-col gap-4">
                {SKELETON_LINES.map((size) => (
                    <span key={size} data-skeleton-line className={`block rounded-md bg-surface-muted ${size}`} />
                ))}
            </div>
        )}
        {phase === 'label' ? <LoadingNotice label={label} /> : null}
    </div>
);
