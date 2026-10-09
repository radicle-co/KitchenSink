'use client';

/**
 * @module @commise/features-recipes — web discovery LOAD ERROR body (presentational; slice 5 of the UI overhaul).
 *
 * What the discovery suspense boundary renders when a search failed (`docs/design/uiOverhaul/buildSpec.md` §4.6): "We
 * couldn't search right now." and a Try again under the field, for any cause — offline included, because a screen never
 * changes behaviour for being offline. The results that were on screen before the failure stay under the message
 * (`previous`); a first load that fails has none. The message is an `alert`, so a retry that fails again is announced; the
 * previous results sit OUTSIDE it so they are not read as part of the alert.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { discoveryMessages } from './messages.js';
import type { RecipeDiscoveryLoadErrorProps } from './model.js';

export const RecipeDiscoveryLoadError: FC<RecipeDiscoveryLoadErrorProps> = ({ onRetry, previous }) => {
    const discovery = useMessages(discoveryMessages);

    return (
        <div className="flex flex-col gap-6">
            <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <p className="text-body text-ink">{discovery.errorTitle}</p>
                <Button variant="secondary" size="sm" icon="rotateCcw" onPress={onRetry}>
                    {discovery.retry}
                </Button>
            </div>
            {previous}
        </div>
    );
};
