'use client';

/**
 * @module @commise/features-recipes — web browse-rail LOAD ERROR body (presentational, U7).
 *
 * What one rail's read boundary renders when that rail failed with nothing loaded: the rail's short failure note and a
 * Try again that retries only this rail. The other rails, and their headings, are untouched. It is an `alert`, so a retry
 * that fails again is announced; the container moves focus to the rail's heading when Try again is pressed.
 */
import { useMessages } from '@commise/i18n/react';
import type { FC } from 'react';

import { discoveryMessages } from './messages.js';
import type { RecipeBrowseRailLoadErrorProps } from './model.js';

export const RecipeBrowseRailLoadError: FC<RecipeBrowseRailLoadErrorProps> = ({ onRetry }) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <div role="alert" className="flex flex-wrap items-center gap-2">
            <p className="text-body-sm text-slate">{discovery.railError}</p>
            <button
                type="button"
                onClick={onRetry}
                className="inline-flex min-h-11 items-center rounded-full px-3 py-1 text-body-sm font-semibold text-ocean-dark transition hover:bg-mist/20 md:min-h-0"
            >
                {discovery.retry}
            </button>
        </div>
    );
};
