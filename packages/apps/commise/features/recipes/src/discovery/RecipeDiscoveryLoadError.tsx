'use client';

/**
 * @module @commise/features-recipes — web discovery LOAD ERROR body (presentational).
 *
 * What the discovery suspense boundary renders when a search failed with nothing loaded for it — on a typed search and
 * on the browse default alike, since the rails have nothing behind them when the main search fails. A styled card with
 * the surface's only Try again, the same settled-failure treatment `CollectionRecipePickerLoadError` uses.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryLoadErrorProps } from './model.js';

export const RecipeDiscoveryLoadError: FC<RecipeDiscoveryLoadErrorProps> = ({ onRetry }) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <div role="alert" className="rounded-2xl bg-card p-6 text-body-md text-slate shadow-sm">
            <p className="font-medium text-charcoal">{discovery.errorTitle}</p>
            <button
                type="button"
                onClick={onRetry}
                className="mt-3 inline-flex min-h-11 items-center rounded-full px-4 py-2 text-body-sm font-semibold text-ocean-dark transition hover:bg-seafoam/10 md:min-h-0"
            >
                {discovery.retry}
            </button>
        </div>
    );
};
