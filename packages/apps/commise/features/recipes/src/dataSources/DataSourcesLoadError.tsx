'use client';

/**
 * @module @commise/features-recipes/dataSources — web Data sources ERROR state (presentational; design §S16).
 *
 * What the read boundary renders when the read failed: the failure, then a secondary Try again that retries it. Try
 * again stays mounted and busy while the retry runs, so focus stays on it. The failure is an `alert`, keyed by the
 * failure count, so each failure is a new alert and announces itself.
 */
import { useMessages } from '@commise/i18n/react';
import { Button } from '@commise/ui/button';
import type { FC } from 'react';

import { dataSourcesMessages } from './messages.js';
import type { DataSourcesLoadErrorProps } from './model.js';

/**
 * The read's failed state: the failure as an alert, then Try again.
 *
 * @param props - What retrying the read does, whether it runs, and how many reads have failed.
 * @returns The error state.
 */
export const DataSourcesLoadError: FC<DataSourcesLoadErrorProps> = ({ onRetry, retrying, failures }) => {
    const messages = useMessages(dataSourcesMessages);

    return (
        <div className="flex flex-col items-start gap-3">
            {/* The alert is the message alone, so the button's label is not read out as part of it. */}
            <p key={failures} role="alert" className="text-body-md text-ink">
                {messages.loadFailed}
            </p>
            <Button variant="secondary" icon="refreshCw" onPress={onRetry} busy={retrying}>
                {messages.retry}
            </Button>
        </div>
    );
};
